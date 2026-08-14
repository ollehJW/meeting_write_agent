from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from .config import settings
from .upload_validation import UploadPolicyError, validate_archive


SUPPORTED_EXTENSIONS = set(settings.upload.references.allowed_extensions)


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
    pdftotext = shutil.which("pdftotext")
    pdfinfo = shutil.which("pdfinfo")
    if pdftotext is None or pdfinfo is None:
        raise RuntimeError("pdftotext and pdfinfo are required to extract PDF text.")

    try:
        info = subprocess.run(
            [pdfinfo, str(path)],
            check=True,
            capture_output=True,
            text=True,
            timeout=settings.documents.extraction_timeout_seconds,
        )
        page_match = re.search(r"^Pages:\s+(\d+)", info.stdout, flags=re.MULTILINE)
        if not page_match:
            raise RuntimeError("PDF page count could not be determined.")
        page_count = int(page_match.group(1))
        if page_count > settings.documents.pdf_max_pages:
            raise UploadPolicyError(
                "PDF_TOO_MANY_PAGES",
                f"PDF는 최대 {settings.documents.pdf_max_pages}페이지까지 처리할 수 있습니다.",
            )

        completed = subprocess.run(
            [pdftotext, "-layout", "-enc", "UTF-8", str(path), "-"],
            check=True,
            capture_output=True,
            text=True,
            timeout=settings.documents.extraction_timeout_seconds,
        )
    except subprocess.TimeoutExpired as exc:
        raise UploadPolicyError(
            "DOCUMENT_TIMEOUT",
            "PDF 처리 시간이 초과되었습니다.",
        ) from exc
    except subprocess.CalledProcessError as exc:
        raise UploadPolicyError(
            "CORRUPTED_REFERENCE",
            "PDF 파일을 읽을 수 없습니다.",
        ) from exc
    return normalize_text(completed.stdout)


def slide_sort_key(path: str) -> tuple[int, str]:
    match = re.search(r"slide(\d+)\.xml$", path)
    return (int(match.group(1)) if match else 0, path)


def extract_text_from_xml(xml_bytes: bytes) -> list[str]:
    upper_prefix = xml_bytes[:4096].upper()
    if b"<!DOCTYPE" in upper_prefix or b"<!ENTITY" in upper_prefix:
        raise UploadPolicyError(
            "UNSAFE_ARCHIVE",
            "외부 엔티티 또는 DTD가 포함된 XML 문서는 처리할 수 없습니다.",
        )
    root = ElementTree.fromstring(xml_bytes)
    texts = []
    for element in root.iter():
        if element.tag.endswith("}t") and element.text:
            text = element.text.strip()
            if text:
                texts.append(text)
    return texts


def read_pptx_text(path: Path) -> str:
    validate_archive(path)
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
        try:
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
                timeout=settings.documents.libreoffice_timeout_seconds,
            )
        except subprocess.TimeoutExpired as exc:
            raise UploadPolicyError(
                "DOCUMENT_TIMEOUT",
                "PPT 변환 시간이 초과되었습니다.",
            ) from exc
        except subprocess.CalledProcessError as exc:
            raise UploadPolicyError(
                "CORRUPTED_REFERENCE",
                "PPT 파일을 변환할 수 없습니다.",
            ) from exc
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
