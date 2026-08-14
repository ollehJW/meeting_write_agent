from __future__ import annotations

import json
import stat
import subprocess
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from .config import settings

MB = 1024 * 1024
AUDIO_FORMATS = {
    ".webm": {"matroska", "webm"},
    ".m4a": {"mov", "mp4", "m4a", "3gp", "3g2", "mj2"},
    ".mp4": {"mov", "mp4", "m4a", "3gp", "3g2", "mj2"},
    ".mp3": {"mp3"},
    ".wav": {"wav"},
}


class UploadPolicyError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass
class RequestBudget:
    maximum_bytes: int
    used_bytes: int = 0

    def add(self, size: int):
        self.used_bytes += size
        if self.used_bytes > self.maximum_bytes:
            raise UploadPolicyError(
                "REQUEST_TOO_LARGE",
                f"전체 업로드 크기는 {self.maximum_bytes // MB}MB를 초과할 수 없습니다.",
                413,
            )


def copy_upload_limited(
    upload,
    destination: Path,
    maximum_bytes: int,
    budget: RequestBudget,
    error_code: str = "FILE_TOO_LARGE",
    error_message: str | None = None,
):
    written = 0
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        with destination.open("wb") as output:
            while True:
                chunk = upload.file.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > maximum_bytes:
                    raise UploadPolicyError(
                        error_code,
                        error_message
                        or f"{Path(upload.filename or 'file').name} 파일이 허용 크기를 초과했습니다.",
                        413,
                    )
                budget.add(len(chunk))
                output.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return written


def validate_audio_extension(filename: str):
    extension = Path(filename).suffix.lower()
    if extension not in settings.upload.audio.allowed_extensions:
        allowed = ", ".join(settings.upload.audio.allowed_extensions)
        raise UploadPolicyError(
            "INVALID_AUDIO_FORMAT",
            f"지원하지 않는 오디오 형식입니다. 허용 형식: {allowed}",
        )
    return extension


def _probe_audio(path: Path):
    import av

    with av.open(str(path), mode="r") as container:
        format_names = {
            item.strip().lower()
            for item in (container.format.name or "").split(",")
            if item.strip()
        }
        audio_streams = list(container.streams.audio)
        if not audio_streams:
            raise ValueError("오디오 스트림이 없습니다.")

        stream = audio_streams[0]
        duration = None
        if container.duration is not None:
            duration = float(container.duration / av.time_base)
        elif stream.duration is not None and stream.time_base is not None:
            duration = float(stream.duration * stream.time_base)
        decoder = container.decode(audio=stream.index)
        first_frame = next(decoder, None)
        if first_frame is None:
            raise ValueError("오디오 데이터를 디코딩할 수 없습니다.")

        frame_start = float(first_frame.time or 0)
        frame_duration = (
            float(first_frame.samples / first_frame.sample_rate)
            if first_frame.sample_rate
            else 0
        )
        decoded_end = frame_start + frame_duration
        for frame in decoder:
            frame_start = float(frame.time or 0)
            frame_duration = (
                float(frame.samples / frame.sample_rate)
                if frame.sample_rate
                else 0
            )
            decoded_end = max(decoded_end, frame_start + frame_duration)

        duration = max(float(duration or 0), decoded_end)
        if duration <= 0:
            raise ValueError("재생 시간을 확인할 수 없습니다.")
        return {"duration_seconds": duration, "format_names": sorted(format_names)}


def inspect_audio(path: Path, extension: str):
    command = [
        sys.executable,
        "-m",
        "backend.upload_validation",
        "--probe-audio",
        str(path),
    ]
    try:
        completed = subprocess.run(
            command,
            cwd=str(Path(__file__).resolve().parents[1]),
            check=False,
            capture_output=True,
            text=True,
            timeout=settings.upload.audio.validation_timeout_seconds,
        )
    except subprocess.TimeoutExpired as exc:
        raise UploadPolicyError(
            "AUDIO_VALIDATION_TIMEOUT",
            "오디오 파일 검사 시간이 초과되었습니다.",
        ) from exc

    if completed.returncode != 0:
        raise UploadPolicyError(
            "CORRUPTED_AUDIO",
            "손상되었거나 읽을 수 없는 오디오 파일입니다.",
        )
    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise UploadPolicyError("CORRUPTED_AUDIO", "오디오 검사 결과를 확인할 수 없습니다.") from exc

    actual_formats = set(result.get("format_names", []))
    expected_formats = AUDIO_FORMATS.get(extension, set())
    if expected_formats and not actual_formats.intersection(expected_formats):
        raise UploadPolicyError(
            "INVALID_AUDIO_FORMAT",
            "파일 확장자와 실제 오디오 형식이 일치하지 않습니다.",
        )

    duration = float(result["duration_seconds"])
    maximum_seconds = settings.upload.audio.max_duration_minutes * 60
    if duration > maximum_seconds:
        raise UploadPolicyError(
            "AUDIO_TOO_LONG",
            f"회의 녹음은 최대 {settings.upload.audio.max_duration_minutes}분까지 업로드할 수 있습니다.",
        )
    return duration


def validate_archive(path: Path):
    archive_settings = settings.documents.archive
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > archive_settings.max_files:
                raise UploadPolicyError(
                    "UNSAFE_ARCHIVE",
                    f"압축 문서 내부 파일 수가 {archive_settings.max_files}개를 초과했습니다.",
                )

            total_uncompressed = 0
            for entry in entries:
                normalized_name = entry.filename.replace("\\", "/")
                member_path = PurePosixPath(normalized_name)
                has_drive_prefix = bool(member_path.parts and member_path.parts[0].endswith(":"))
                file_type = (entry.external_attr >> 16) & 0o170000
                if (
                    member_path.is_absolute()
                    or has_drive_prefix
                    or ".." in member_path.parts
                    or file_type == stat.S_IFLNK
                ):
                    raise UploadPolicyError(
                        "UNSAFE_ARCHIVE",
                        "안전하지 않은 압축 경로 또는 링크가 포함되어 있습니다.",
                    )
                if entry.flag_bits & 0x1:
                    raise UploadPolicyError(
                        "UNSAFE_ARCHIVE",
                        "암호화된 압축 문서는 처리할 수 없습니다.",
                    )
                total_uncompressed += entry.file_size
                if total_uncompressed > archive_settings.max_uncompressed_mb * MB:
                    raise UploadPolicyError(
                        "UNSAFE_ARCHIVE",
                        f"압축 해제 예상 용량이 {archive_settings.max_uncompressed_mb}MB를 초과했습니다.",
                    )
                if entry.file_size and entry.compress_size == 0:
                    raise UploadPolicyError("UNSAFE_ARCHIVE", "비정상적인 압축 항목이 포함되어 있습니다.")
                if entry.compress_size:
                    ratio = entry.file_size / entry.compress_size
                    if ratio > archive_settings.max_compression_ratio:
                        raise UploadPolicyError(
                            "UNSAFE_ARCHIVE",
                            "비정상적으로 압축률이 높은 문서입니다.",
                        )
            names = set(archive.namelist())
    except zipfile.BadZipFile as exc:
        raise UploadPolicyError("CORRUPTED_REFERENCE", "손상된 압축 문서입니다.") from exc
    return names


def validate_reference_file(path: Path, extension: str):
    with path.open("rb") as source:
        header = source.read(8)
    if extension == ".pdf":
        if not header.startswith(b"%PDF-"):
            raise UploadPolicyError(
                "INVALID_REFERENCE_FORMAT",
                "PDF 확장자와 실제 파일 형식이 일치하지 않습니다.",
            )
        return

    if extension == ".pptx":
        names = validate_archive(path)
        if "[Content_Types].xml" not in names or "ppt/presentation.xml" not in names:
            raise UploadPolicyError(
                "INVALID_REFERENCE_FORMAT",
                "올바른 PPTX 프레젠테이션 파일이 아닙니다.",
            )
        return

    if extension == ".ppt" and not header.startswith(bytes.fromhex("D0CF11E0A1B11AE1")):
        raise UploadPolicyError(
            "INVALID_REFERENCE_FORMAT",
            "PPT 확장자와 실제 파일 형식이 일치하지 않습니다.",
        )


def validate_reference_extension(filename: str):
    extension = Path(filename).suffix.lower()
    if extension not in settings.upload.references.allowed_extensions:
        allowed = ", ".join(settings.upload.references.allowed_extensions)
        raise UploadPolicyError(
            "UNSUPPORTED_REFERENCE_FORMAT",
            f"지원하지 않는 참고자료 형식입니다. 허용 형식: {allowed}",
        )
    return extension


def _main():
    if len(sys.argv) == 3 and sys.argv[1] == "--probe-audio":
        try:
            result = _probe_audio(Path(sys.argv[2]))
        except Exception as exc:
            print(str(exc), file=sys.stderr)
            raise SystemExit(2) from exc
        print(json.dumps(result))
        return
    raise SystemExit(2)


if __name__ == "__main__":
    _main()
