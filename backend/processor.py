import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Callable

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import torch
import torchaudio
from pyannote.audio import Pipeline
from tqdm import tqdm

from .llm_client import chat_completion

try:
    from qwen_asr import Qwen3ASRModel
except ImportError as exc:
    raise RuntimeError(
        "qwen-asr is required for Qwen3-ASR. Install it with: pip install -U qwen-asr"
    ) from exc

log = logging.getLogger(__name__)

STT_MODEL_PATH = "./qwen3-asr-1.7b"
DIARIZATION_MODEL_PATH = "./pyannote_diarization_local"
MAX_MERGE_SILENCE_S = 10.0
MIN_SEGMENT_DURATION_S = 1.5
MAX_STT_SEGMENT_DURATION_S = 30.0
STT_BATCH_SIZE = 8
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
DEVICE_MAP = "cuda:0" if torch.cuda.is_available() else "cpu"
TORCH_DTYPE = torch.bfloat16 if torch.cuda.is_available() else torch.float32
PROMPT_DIR = Path(__file__).resolve().parent / "prompts"

torch.backends.cudnn.enabled = False

ProgressCallback = Callable[[str, int, str], None]


def elapsed(start):
    return f"{time.time() - start:.1f}s"


def get_transcript_text(result):
    if hasattr(result, "text"):
        return result.text.strip()
    if isinstance(result, dict):
        return str(result.get("text", "")).strip()
    return str(result).strip()


def merge_consecutive_speaker_segments(speaker_segments, max_silence_s):
    if not speaker_segments:
        return []

    sorted_segments = sorted(speaker_segments, key=lambda segment: segment["start"])
    merged_segments = []
    current = sorted_segments[0].copy()

    for segment in sorted_segments[1:]:
        silence_s = segment["start"] - current["end"]
        can_merge = (
            segment["speaker"] == current["speaker"]
            and silence_s < max_silence_s
        )

        if can_merge:
            current["end"] = max(current["end"], segment["end"])
            continue

        merged_segments.append(current)
        current = segment.copy()

    merged_segments.append(current)
    return merged_segments


def drop_short_segments(speaker_segments, min_duration_s):
    return [
        segment
        for segment in speaker_segments
        if segment["end"] - segment["start"] >= min_duration_s
    ]


def fix_overlapping_segments(speaker_segments):
    if not speaker_segments:
        return []

    result = [speaker_segments[0].copy()]
    for segment in speaker_segments[1:]:
        prev = result[-1]
        fixed = segment.copy()
        if fixed["start"] < prev["end"]:
            fixed["start"] = prev["end"] + 0.1
        if fixed["end"] <= fixed["start"]:
            fixed["end"] = fixed["start"] + 0.1
        result.append(fixed)
    return result


def preprocess_speaker_segments(speaker_segments, max_silence_s, min_duration_s):
    first_merged = merge_consecutive_speaker_segments(speaker_segments, max_silence_s)
    filtered = drop_short_segments(first_merged, min_duration_s)
    second_merged = merge_consecutive_speaker_segments(filtered, max_silence_s)
    overlap_fixed = fix_overlapping_segments(second_merged)
    final_filtered = drop_short_segments(overlap_fixed, min_duration_s)
    final_merged = merge_consecutive_speaker_segments(final_filtered, max_silence_s)
    return first_merged, filtered, second_merged, overlap_fixed, final_filtered, final_merged


def find_low_energy_split_time(
    mono_waveform,
    sample_rate,
    search_start_s,
    search_end_s,
    frame_s=0.2,
    hop_s=0.05,
):
    search_start_sample = max(0, int(search_start_s * sample_rate))
    search_end_sample = min(mono_waveform.shape[0], int(search_end_s * sample_rate))
    frame_samples = max(1, int(frame_s * sample_rate))
    hop_samples = max(1, int(hop_s * sample_rate))

    if search_end_sample - search_start_sample < frame_samples:
        return search_end_s

    best_energy = None
    best_start_sample = search_start_sample
    for frame_start in range(search_start_sample, search_end_sample - frame_samples + 1, hop_samples):
        frame = mono_waveform[frame_start:frame_start + frame_samples]
        energy = float(torch.mean(frame.float() ** 2).item())
        if best_energy is None or energy < best_energy:
            best_energy = energy
            best_start_sample = frame_start

    split_sample = best_start_sample + frame_samples // 2
    return split_sample / sample_rate


def split_long_speaker_segments(
    speaker_segments,
    max_duration_s,
    mono_waveform=None,
    sample_rate=None,
    search_window_s=5.0,
    min_chunk_s=1.5,
):
    if max_duration_s is None or max_duration_s <= 0:
        return [segment.copy() for segment in speaker_segments]

    split_segments = []
    for segment in speaker_segments:
        start = segment["start"]
        end = segment["end"]
        if end - start <= max_duration_s:
            split_segments.append(segment.copy())
            continue

        current_start = start
        while end - current_start > max_duration_s:
            target_end = current_start + max_duration_s
            split_time = target_end
            if mono_waveform is not None and sample_rate is not None:
                search_start = max(current_start + min_chunk_s, target_end - search_window_s)
                search_end = min(target_end, end)
                split_time = find_low_energy_split_time(
                    mono_waveform,
                    sample_rate,
                    search_start,
                    search_end,
                )
                if split_time <= current_start + min_chunk_s or split_time > target_end:
                    split_time = target_end

            split_segment = segment.copy()
            split_segment["start"] = current_start
            split_segment["end"] = split_time
            split_segments.append(split_segment)
            current_start = split_time

        if end - current_start >= min_chunk_s:
            split_segment = segment.copy()
            split_segment["start"] = current_start
            split_segment["end"] = end
            split_segments.append(split_segment)
        elif split_segments:
            split_segments[-1]["end"] = end

    return split_segments


def format_time_range(start_s, end_s):
    return f"{start_s:.1f}s - {end_s:.1f}s"


def format_transcript_sentences(sentences):
    formatted_sentences = []
    for index, sentence in enumerate(sentences, start=1):
        formatted = sentence.copy()
        formatted["index"] = index
        formatted["time"] = format_time_range(sentence["start"], sentence["end"])
        formatted_sentences.append(formatted)
    return formatted_sentences


def merge_consecutive_transcript_sentences(sentences, max_silence_s):
    if not sentences:
        return []

    merged_sentences = []
    current = sentences[0].copy()

    for sentence in sentences[1:]:
        silence_s = sentence["start"] - current["end"]
        can_merge = (
            sentence["speaker"] == current["speaker"]
            and silence_s < max_silence_s
        )

        if can_merge:
            current["end"] = max(current["end"], sentence["end"])
            current["content"] = f"{current['content']} {sentence['content']}".strip()
            current["time"] = format_time_range(current["start"], current["end"])
            continue

        merged_sentences.append(current)
        current = sentence.copy()

    merged_sentences.append(current)
    output = []
    for index, sentence in enumerate(merged_sentences, start=1):
        merged = {
            "index": index,
            "speaker": sentence["speaker"],
            "content": sentence["content"],
            "time": format_time_range(sentence["start"], sentence["end"]),
        }
        if "speaker_id" in sentence:
            merged["speaker_id"] = sentence["speaker_id"]
        output.append(merged)
    return output


def build_segment_audio(segment, mono_waveform, sample_rate):
    start_sample = max(0, int(segment["start"] * sample_rate))
    end_sample = min(mono_waveform.shape[0], int(segment["end"] * sample_rate))
    if end_sample <= start_sample:
        return None
    return mono_waveform[start_sample:end_sample].cpu().numpy(), sample_rate


def notify(progress: ProgressCallback | None, stage: str, percent: int, message: str):
    if progress:
        progress(stage, percent, message)



def extract_json_object(text):
    try:
        return json.loads(text)
    except Exception:
        pass

    blocks = re.findall(r'```(?:json)?\s*([\s\S]*?)```', text)
    for block in blocks:
        try:
            return json.loads(block)
        except Exception:
            pass
    return None


def format_transcript_for_llm(sentences):
    return "\n".join(
        f"[{sentence['index']}] Speaker {sentence.get('speaker_id', sentence['speaker'])} "
        f"({sentence.get('time', '')}): {sentence.get('content', '').strip()}"
        for sentence in sentences
        if sentence.get("content", "").strip()
    )


def load_prompt_template(name):
    return (PROMPT_DIR / name).read_text(encoding="utf-8")


def keep_first_consecutive_duplicate_content(sentences):
    cleaned = []
    current_run = []
    current_content = None

    def merge_run(run):
        merged = run[0].copy()
        if len(run) > 1:
            if "start" in run[0] and "end" in run[-1]:
                merged["start"] = run[0]["start"]
                merged["end"] = run[-1]["end"]
                merged["time"] = format_time_range(merged["start"], merged["end"])
            else:
                start_time = run[0]["time"].split(" - ", 1)[0]
                end_time = run[-1]["time"].split(" - ", 1)[1]
                merged["time"] = f"{start_time} - {end_time}"
        return merged

    for sentence in sentences:
        content = sentence.get("content", "").strip()
        if current_run and content != current_content:
            cleaned.append(merge_run(current_run))
            current_run = []
        current_run.append(sentence)
        current_content = content

    if current_run:
        cleaned.append(merge_run(current_run))

    for index, sentence in enumerate(cleaned, start=1):
        sentence["index"] = index
    return cleaned


def find_stt_corrections(sentences, participant_list, meeting_purpose="", meeting_reference_text=""):
    transcript_text = format_transcript_for_llm(sentences)
    purpose_text = meeting_purpose.strip() or "없음"
    reference_text = meeting_reference_text.strip() or "없음"
    prompt = load_prompt_template("stt_correction.txt").format(
        participant_list=participant_list,
        purpose_text=purpose_text,
        reference_text=reference_text,
        transcript_text=transcript_text,
    )
    parsed = extract_json_object(chat_completion(prompt))
    return parsed.get("corrections", []) if parsed else []


def apply_stt_corrections(sentences, corrections):
    corrected_sentences = [sentence.copy() for sentence in sentences]
    sentence_by_index = {sentence["index"]: sentence for sentence in corrected_sentences}
    applied = []

    for correction in corrections:
        index = correction.get("index")
        corrected_content = correction.get("corrected_content", "").strip()
        sentence = sentence_by_index.get(index)
        if sentence is None or not corrected_content:
            continue
        original_content = sentence.get("content", "")
        if corrected_content == original_content:
            continue
        sentence["content"] = corrected_content
        applied.append({
            "index": index,
            "original_content": original_content,
            "corrected_content": corrected_content,
            "reason": correction.get("reason", ""),
            "confidence": correction.get("confidence"),
        })
    return corrected_sentences, applied


def match_speakers(sentences, total_speakers, participant_list):
    transcript_text = format_transcript_for_llm(sentences)
    prompt = load_prompt_template("speaker_matching.txt").format(
        last_speaker_id=max(total_speakers - 1, 0),
        participant_list=participant_list,
        transcript_text=transcript_text,
    )
    parsed = extract_json_object(chat_completion(prompt))
    return parsed if parsed else {"matches": []}


def apply_speaker_matches(sentences, matches_data, output_dir: Path):
    speaker_matches = {
        str(match["speaker_id"]): match["participant_match"]
        for match in matches_data.get("matches", [])
        if "speaker_id" in match and "participant_match" in match
    }
    mapped_sentences = []
    for sentence in sentences:
        mapped = sentence.copy()
        speaker_id = mapped.get("speaker_id", mapped.get("speaker"))
        mapped["speaker_id"] = speaker_id
        mapped["speaker"] = speaker_matches.get(str(speaker_id), f"Speaker {speaker_id}")
        mapped_sentences.append(mapped)

    (output_dir / "refined_result.json").write_text(
        json.dumps(mapped_sentences, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "speaker_matches.json").write_text(
        json.dumps(matches_data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return mapped_sentences


def run_llm_postprocess(result, output_dir: Path, participant_list, meeting_purpose, meeting_reference_text, progress=None):
    sentences = keep_first_consecutive_duplicate_content(result.get("sentences", []))
    for sentence in sentences:
        sentence.setdefault("speaker_id", sentence["speaker"])

    notify(progress, "stt_correction", 90, "STT 결과를 교정하고 있습니다.")
    corrections = find_stt_corrections(sentences, participant_list, meeting_purpose, meeting_reference_text)
    sentences, applied_corrections = apply_stt_corrections(sentences, corrections)
    stt_corrections_output = {"corrections": applied_corrections}
    sentences = merge_consecutive_transcript_sentences(sentences, MAX_MERGE_SILENCE_S)

    notify(progress, "speaker_matching", 95, "화자를 참석자 명단과 매칭하고 있습니다.")
    matches_data = match_speakers(sentences, result.get("total_speakers", 0), participant_list)
    mapped_sentences = apply_speaker_matches(sentences, matches_data, output_dir)
    notify(progress, "mapping_review", 99, "화자 매칭 결과를 확인할 준비가 되었습니다.")
    return {
        "corrected_sentences": sentences,
        "stt_corrections": stt_corrections_output,
        "speaker_matches": matches_data,
        "refined_sentences": mapped_sentences,
    }


def transcribe_meeting(audio_path: Path, output_dir: Path, progress: ProgressCallback | None = None):
    output_dir.mkdir(parents=True, exist_ok=True)
    notify(progress, "loading", 5, "오디오를 로드하고 있습니다.")

    t = time.time()
    waveform, sample_rate = torchaudio.load(str(audio_path))
    audio_length = waveform.shape[1] / sample_rate
    mono_waveform = waveform.mean(dim=0)
    audio_loaded_message = f"오디오 로드 완료 — {audio_length:.1f}초 분량 ({elapsed(t)})"
    log.info(audio_loaded_message)
    notify(progress, "loading", 8, audio_loaded_message)

    notify(progress, "diarization", 12, "화자 분리 모델을 로드하고 있습니다.")
    t = time.time()
    diarization_pipeline = Pipeline.from_pretrained(DIARIZATION_MODEL_PATH)
    diarization_pipeline.to(DEVICE)
    log.info("pyannote 파이프라인 로드 완료 (%s)", elapsed(t))

    notify(progress, "diarization", 20, "화자 분리를 실행하고 있습니다.")
    t = time.time()
    audio_input = {"waveform": waveform, "sample_rate": sample_rate}
    diarization = diarization_pipeline(audio_input)
    speaker_segments = [
        {"start": turn.start, "end": turn.end, "speaker": speaker}
        for turn, _, speaker in diarization.speaker_diarization.itertracks(yield_label=True)
    ]
    speaker_ids = sorted({s["speaker"] for s in speaker_segments})
    speaker_map = {s: i for i, s in enumerate(speaker_ids)}
    (
        first_merged_segments,
        filtered_segments,
        second_merged_segments,
        overlap_fixed_segments,
        final_filtered_segments,
        merged_speaker_segments,
    ) = preprocess_speaker_segments(
        speaker_segments,
        MAX_MERGE_SILENCE_S,
        MIN_SEGMENT_DURATION_S,
    )
    diarization_done_message = (
        f"화자 분리 완료 — {len(speaker_ids)}명 감지, "
        f"원본 {len(speaker_segments)}개 → 1차 병합 {len(first_merged_segments)}개 → "
        f"1.5초 미만 제거 {len(filtered_segments)}개 → 2차 병합 {len(second_merged_segments)}개 → "
        f"겹침 보정 {len(overlap_fixed_segments)}개 → 1.5초 미만 재제거 {len(final_filtered_segments)}개 → "
        f"최종 병합 {len(merged_speaker_segments)}개 ({elapsed(t)})"
    )
    log.info(diarization_done_message)
    notify(progress, "diarization", 30, diarization_done_message)

    notify(progress, "stt", 35, "Qwen3-ASR 모델을 로드하고 있습니다.")
    t = time.time()
    stt_model = Qwen3ASRModel.from_pretrained(
        STT_MODEL_PATH,
        dtype=TORCH_DTYPE,
        device_map=DEVICE_MAP,
        max_inference_batch_size=STT_BATCH_SIZE,
        max_new_tokens=512,
    )
    for candidate in (stt_model, getattr(stt_model, "model", None)):
        generation_config = getattr(candidate, "generation_config", None)
        if generation_config is not None and getattr(generation_config, "pad_token_id", None) is None:
            eos_token_id = getattr(generation_config, "eos_token_id", None)
            generation_config.pad_token_id = eos_token_id[0] if isinstance(eos_token_id, list) else eos_token_id
    log.info("Qwen3-ASR 모델 로드 완료 (%s)", elapsed(t))

    notify(progress, "stt", 45, "병합된 화자 구간별 STT를 실행하고 있습니다.")
    stt_speaker_segments = split_long_speaker_segments(merged_speaker_segments, MAX_STT_SEGMENT_DURATION_S, mono_waveform, sample_rate)
    if len(stt_speaker_segments) != len(merged_speaker_segments):
        log.info(
            "STT 입력 구간 분할 — %s개 → %s개, 최대 %.1f초",
            len(merged_speaker_segments),
            len(stt_speaker_segments),
            MAX_STT_SEGMENT_DURATION_S,
        )
    segments_for_stt = []
    for segment in stt_speaker_segments:
        audio = build_segment_audio(segment, mono_waveform, sample_rate)
        if audio is None:
            continue
        segments_for_stt.append((segment, audio))

    stt_results = []
    total_batches = max(1, (len(segments_for_stt) + STT_BATCH_SIZE - 1) // STT_BATCH_SIZE)
    for batch_index, batch_start in enumerate(range(0, len(segments_for_stt), STT_BATCH_SIZE), start=1):
        batch = segments_for_stt[batch_start:batch_start + STT_BATCH_SIZE]
        start_percent = 45 + int(45 * (batch_index - 1) / total_batches)
        notify(progress, "stt", start_percent, f"STT 배치 실행 중: {batch_index}/{total_batches} 배치")
        batch_results = stt_model.transcribe(
            audio=[audio for _, audio in batch],
            language=["Korean"] * len(batch),
        )
        stt_results.extend(batch_results)
        percent = 45 + int(45 * batch_index / total_batches)
        notify(progress, "stt", percent, f"STT 배치 완료: {batch_index}/{total_batches} 배치")

    sentences = []
    for segment, result in zip((item[0] for item in segments_for_stt), stt_results):
        content = get_transcript_text(result)
        if not content:
            continue

        sentences.append({
            "index": len(sentences) + 1,
            "speaker": speaker_map[segment["speaker"]],
            "content": content,
            "start": segment["start"],
            "end": segment["end"],
        })

    stt_sentences = format_transcript_sentences(sentences)
    output = {
        "audio_length": round(audio_length, 1),
        "total_speakers": len(speaker_ids),
        "sentences": stt_sentences,
    }

    notify(progress, "stt_completed", 88, "화자 분리와 STT가 완료되었습니다.")
    return output


def apply_speaker_mapping(result: dict, speaker_mapping: dict[str, str], output_dir: Path, match_details=None):
    detail_by_id = {}
    if match_details:
        detail_by_id = {
            str(match.get("speaker_id")): match
            for match in match_details.get("matches", [])
        }

    mapped_sentences = []
    for sentence in result.get("sentences", []):
        mapped = sentence.copy()
        speaker_id = mapped.get("speaker_id", mapped.get("speaker"))
        mapped["speaker_id"] = speaker_id
        mapped["speaker"] = speaker_mapping.get(str(speaker_id), f"Speaker {speaker_id}")
        mapped_sentences.append(mapped)

    refined_path = output_dir / "refined_result.json"
    refined_path.write_text(json.dumps(mapped_sentences, ensure_ascii=False, indent=2), encoding="utf-8")

    matches = {
        "matches": [
            {
                "speaker_id": int(speaker_id),
                "participant_match": name,
                "confidence": detail_by_id.get(str(speaker_id), {}).get("confidence"),
                "evidence": detail_by_id.get(str(speaker_id), {}).get("evidence", "사용자가 확인/수정한 매핑"),
                "match_basis": detail_by_id.get(str(speaker_id), {}).get("match_basis", "manual_review"),
            }
            for speaker_id, name in sorted(speaker_mapping.items(), key=lambda item: int(item[0]))
        ]
    }
    (output_dir / "speaker_matches.json").write_text(
        json.dumps(matches, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return mapped_sentences, matches
