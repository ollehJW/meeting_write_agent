from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree


SUPPORTED_EXTENSIONS = {".pdf", ".pptx", ".ppt"}


def normalize_text(text: str) -> str:
    lines = []
    previous_blank = False
    for raw_line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = re.sub(r"[ \t]+", " ", raw_line).strip()
        if not line:
            if not previous_blank:
                lines.append("")
            previous_blank = True
            continue
        lines.append(line)
        previous_blank = False
    return "\n".join(lines).strip()


def read_pdf_text(path: Path) -> str:
    if shutil.which("pdftotext") is None:
        raise RuntimeError("pdftotext is required to extract PDF text.")

    completed = subprocess.run(
        ["pdftotext", "-layout", "-enc", "UTF-8", str(path), "-"],
        check=True,
        capture_output=True,
        text=True,
    )
    return normalize_text(completed.stdout)


def slide_sort_key(path: str) -> tuple[int, str]:
    match = re.search(r"slide(\d+)\.xml$", path)
    return (int(match.group(1)) if match else 0, path)


def extract_text_from_xml(xml_bytes: bytes) -> list[str]:
    root = ElementTree.fromstring(xml_bytes)
    texts = []
    for element in root.iter():
        if element.tag.endswith("}t") and element.text:
            text = element.text.strip()
            if text:
                texts.append(text)
    return texts


def read_pptx_text(path: Path) -> str:
    chunks = []
    with zipfile.ZipFile(path) as archive:
        slide_names = sorted(
            (
                name
                for name in archive.namelist()
                if name.startswith("ppt/slides/slide") and name.endswith(".xml")
            ),
            key=slide_sort_key,
        )
        for slide_index, slide_name in enumerate(slide_names, start=1):
            texts = extract_text_from_xml(archive.read(slide_name))
            if texts:
                chunks.append(f"[Slide {slide_index}]")
                chunks.append("\n".join(texts))

        note_names = sorted(
            (
                name
                for name in archive.namelist()
                if name.startswith("ppt/notesSlides/notesSlide") and name.endswith(".xml")
            ),
            key=slide_sort_key,
        )
        for note_index, note_name in enumerate(note_names, start=1):
            texts = extract_text_from_xml(archive.read(note_name))
            if texts:
                chunks.append(f"[Notes {note_index}]")
                chunks.append("\n".join(texts))

    return normalize_text("\n\n".join(chunks))


def read_ppt_text(path: Path) -> str:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if soffice is None:
        raise RuntimeError("LibreOffice/soffice is required to extract PPT text.")

    with tempfile.TemporaryDirectory(prefix="ppt_to_text_") as temp_dir:
        temp_path = Path(temp_dir)
        subprocess.run(
            [
                soffice,
                "--headless",
                "--convert-to",
                "pptx",
                "--outdir",
                str(temp_path),
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        converted = temp_path / f"{path.stem}.pptx"
        if not converted.exists():
            matches = list(temp_path.glob("*.pptx"))
            if not matches:
                raise RuntimeError(f"Failed to convert PPT to PPTX: {path}")
            converted = matches[0]
        return read_pptx_text(converted)


def read_text(path: str | Path) -> str:
    file_path = Path(path)
    if not file_path.exists():
        raise FileNotFoundError(file_path)
    if not file_path.is_file():
        raise ValueError(f"Not a file: {file_path}")

    extension = file_path.suffix.lower()
    if extension == ".pdf":
        return read_pdf_text(file_path)
    if extension == ".pptx":
        return read_pptx_text(file_path)
    if extension == ".ppt":
        return read_ppt_text(file_path)

    raise ValueError(
        f"Unsupported file extension: {extension}. "
        f"Supported extensions: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
    )
