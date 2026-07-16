import json
from pathlib import Path

from .llm_client import chat_completion

PROMPT_DIR = Path(__file__).resolve().parent / "prompts"


def load_sentences(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, dict):
        sentences = data.get("sentences", [])
    else:
        sentences = data

    if not isinstance(sentences, list):
        raise ValueError("Input JSON must be a list of sentences or contain a 'sentences' list.")

    return sentences


def format_transcript(sentences):
    lines = []
    for sentence in sentences:
        index = sentence.get("index", "")
        speaker = sentence.get("speaker", "Unknown")
        time = sentence.get("time", "")
        content = sentence.get("content", "").strip()
        if not content:
            continue
        lines.append(f"[{index}] {speaker} ({time}): {content}")
    return "\n".join(lines)


def load_prompt_template(name):
    return (PROMPT_DIR / name).read_text(encoding="utf-8")


def build_prompt(transcript_text, special_instruction):
    instruction_block = special_instruction.strip() or "없음"
    return load_prompt_template("report_generation.txt").format(
        instruction_block=instruction_block,
        transcript_text=transcript_text,
    )


def generate_report(prompt):
    return chat_completion(prompt)
