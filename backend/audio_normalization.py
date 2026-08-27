from __future__ import annotations

from fractions import Fraction
from pathlib import Path

import av


class AudioNormalizationError(RuntimeError):
    pass


def normalize_meeting_audio(
    source_path: Path,
    analysis_path: Path,
    archive_path: Path,
    sample_rate: int = 16_000,
    archive_bitrate: int = 64_000,
):
    analysis_temporary = analysis_path.with_name(f"{analysis_path.stem}.tmp{analysis_path.suffix}")
    archive_temporary = archive_path.with_name(f"{archive_path.stem}.tmp{archive_path.suffix}")
    for path in (analysis_temporary, archive_temporary):
        path.unlink(missing_ok=True)

    input_container = None
    analysis_container = None
    archive_container = None
    total_samples = 0
    completed = False
    try:
        input_container = av.open(str(source_path), mode="r")
        audio_streams = list(input_container.streams.audio)
        if not audio_streams:
            raise AudioNormalizationError("업로드 파일에 오디오 트랙이 없습니다.")

        analysis_container = av.open(str(analysis_temporary), mode="w", format="wav")
        analysis_stream = analysis_container.add_stream("pcm_s16le", rate=sample_rate)
        analysis_stream.layout = "mono"

        archive_container = av.open(str(archive_temporary), mode="w", format="ipod")
        archive_stream = archive_container.add_stream("aac", rate=sample_rate)
        archive_stream.layout = "mono"
        archive_stream.bit_rate = archive_bitrate

        resampler = av.AudioResampler(format="s16", layout="mono", rate=sample_rate)

        def encode_frame(frame):
            nonlocal total_samples
            frame.pts = total_samples
            frame.time_base = Fraction(1, sample_rate)
            total_samples += frame.samples
            for packet in analysis_stream.encode(frame):
                analysis_container.mux(packet)
            for packet in archive_stream.encode(frame):
                archive_container.mux(packet)

        for decoded_frame in input_container.decode(audio=0):
            for normalized_frame in resampler.resample(decoded_frame):
                encode_frame(normalized_frame)
        for normalized_frame in resampler.resample(None):
            encode_frame(normalized_frame)

        for packet in analysis_stream.encode(None):
            analysis_container.mux(packet)
        for packet in archive_stream.encode(None):
            archive_container.mux(packet)
        completed = True
    except AudioNormalizationError:
        raise
    except Exception as exc:
        raise AudioNormalizationError(
            f"회의 녹음을 표준 오디오 형식으로 변환하지 못했습니다: {exc}"
        ) from exc
    finally:
        for container in (archive_container, analysis_container, input_container):
            if container is not None:
                try:
                    container.close()
                except Exception:
                    completed = False
        if not completed:
            analysis_temporary.unlink(missing_ok=True)
            archive_temporary.unlink(missing_ok=True)

    if total_samples <= 0:
        analysis_temporary.unlink(missing_ok=True)
        archive_temporary.unlink(missing_ok=True)
        raise AudioNormalizationError("변환할 수 있는 오디오 데이터가 없습니다.")

    analysis_temporary.replace(analysis_path)
    archive_temporary.replace(archive_path)
    return total_samples / sample_rate
