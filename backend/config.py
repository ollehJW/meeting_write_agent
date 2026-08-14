import os
from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = ROOT_DIR / "config" / "limits.yaml"


class StrictConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class AudioLimits(StrictConfig):
    max_size_mb: int = Field(ge=1)
    max_duration_minutes: int = Field(ge=1)
    validation_timeout_seconds: int = Field(ge=1, le=300)
    allowed_extensions: tuple[str, ...]

    @field_validator("allowed_extensions")
    @classmethod
    def normalize_extensions(cls, values):
        normalized = tuple(
            value.lower() if value.startswith(".") else f".{value.lower()}"
            for value in values
        )
        if not normalized:
            raise ValueError("At least one audio extension is required.")
        return normalized


class ReferenceLimits(StrictConfig):
    max_files: int = Field(ge=0)
    max_file_size_mb: int = Field(ge=1)
    max_total_size_mb: int = Field(ge=1)
    allowed_extensions: tuple[str, ...]

    @field_validator("allowed_extensions")
    @classmethod
    def normalize_extensions(cls, values):
        normalized = tuple(
            value.lower() if value.startswith(".") else f".{value.lower()}"
            for value in values
        )
        if not normalized:
            raise ValueError("At least one reference extension is required.")
        return normalized


class UploadLimits(StrictConfig):
    request_max_mb: int = Field(ge=1)
    audio: AudioLimits
    references: ReferenceLimits


class ArchiveLimits(StrictConfig):
    max_files: int = Field(ge=1)
    max_uncompressed_mb: int = Field(ge=1)
    max_compression_ratio: int = Field(ge=1)


class DocumentLimits(StrictConfig):
    extraction_timeout_seconds: int = Field(ge=1, le=600)
    libreoffice_timeout_seconds: int = Field(ge=1, le=600)
    pdf_max_pages: int = Field(ge=1)
    archive: ArchiveLimits


class JobLimits(StrictConfig):
    gpu_workers: int = Field(ge=1)
    llm_workers: int = Field(ge=1)
    max_active: int = Field(ge=1)
    max_queued: int = Field(ge=0)
    max_active_per_user: int = Field(ge=1)
    max_unfinished_per_user: int = Field(ge=1)


class LlmLimits(StrictConfig):
    connect_timeout_seconds: float = Field(gt=0)
    read_timeout_seconds: float = Field(gt=0)
    max_retries: int = Field(ge=0)
    retry_base_seconds: float = Field(gt=0)
    max_retry_delay_seconds: float = Field(gt=0)


class AppConfig(StrictConfig):
    upload: UploadLimits
    documents: DocumentLimits
    jobs: JobLimits
    llm: LlmLimits


@lru_cache(maxsize=1)
def get_config():
    configured_path = os.getenv("WIAMEET_CONFIG_PATH", "").strip()
    path = Path(configured_path).expanduser() if configured_path else DEFAULT_CONFIG_PATH
    if not path.is_absolute():
        path = ROOT_DIR / path
    if not path.exists():
        raise RuntimeError(f"WIAMeet config file not found: {path}")

    try:
        raw_config = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise RuntimeError(f"Invalid WIAMeet YAML config: {path}: {exc}") from exc
    if not isinstance(raw_config, dict):
        raise RuntimeError(f"WIAMeet config must be a YAML mapping: {path}")

    return AppConfig.model_validate(raw_config)


settings = get_config()
