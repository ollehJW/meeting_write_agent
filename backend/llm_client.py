import json
import logging
import os
import random
import threading
import time
from datetime import datetime
from email.utils import parsedate_to_datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
from openai import APIConnectionError, APIStatusError, APITimeoutError, AzureOpenAI, RateLimitError

ROOT_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT_DIR / ".env"
LLM_LOG_PATH = ROOT_DIR / "backend" / "logs" / "llm_calls.jsonl"
KST = ZoneInfo("Asia/Seoul")
log = logging.getLogger(__name__)
_log_lock = threading.Lock()


def load_env_file(path=ENV_PATH):
    if not path.exists():
        return

    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def env_int(name, default, minimum=0):
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, value)


def env_float(name, default, minimum=0.0):
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, value)


load_env_file()

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5.4")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "")
OPENAI_API_VERSION = os.getenv("OPENAI_API_VERSION", "2025-04-01-preview")
LLM_CONNECT_TIMEOUT_SECONDS = env_float("LLM_CONNECT_TIMEOUT_SECONDS", 10, 1)
LLM_READ_TIMEOUT_SECONDS = env_float("LLM_READ_TIMEOUT_SECONDS", 180, 1)
LLM_MAX_RETRIES = env_int("LLM_MAX_RETRIES", 4)
LLM_RETRY_BASE_SECONDS = env_float("LLM_RETRY_BASE_SECONDS", 2, 0.1)
LLM_MAX_RETRY_DELAY_SECONDS = env_float("LLM_MAX_RETRY_DELAY_SECONDS", 60, 1)

_client = None
_client_lock = threading.Lock()


def create_llm_client():
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is required. Set it in .env.")
    if not OPENAI_BASE_URL:
        raise RuntimeError("OPENAI_BASE_URL is required. Set it in .env.")

    return AzureOpenAI(
        azure_endpoint=OPENAI_BASE_URL,
        api_key=OPENAI_API_KEY,
        api_version=OPENAI_API_VERSION,
        timeout=httpx.Timeout(
            timeout=LLM_READ_TIMEOUT_SECONDS,
            connect=LLM_CONNECT_TIMEOUT_SECONDS,
        ),
        max_retries=0,
    )


def get_llm_client():
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                _client = create_llm_client()
    return _client


def retry_after_seconds(exc):
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None)
    if not headers:
        return None

    value = headers.get("retry-after-ms")
    if value:
        try:
            return max(0.0, float(value) / 1000)
        except ValueError:
            pass

    value = headers.get("retry-after")
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        try:
            retry_at = parsedate_to_datetime(value)
            now = datetime.now(retry_at.tzinfo)
            return max(0.0, (retry_at - now).total_seconds())
        except (TypeError, ValueError):
            return None


def should_retry(exc):
    if isinstance(exc, (RateLimitError, APIConnectionError, APITimeoutError)):
        return True
    if isinstance(exc, APIStatusError):
        return exc.status_code >= 500
    return False


def retry_delay(exc, retry_index):
    header_delay = retry_after_seconds(exc)
    if header_delay is not None:
        return min(LLM_MAX_RETRY_DELAY_SECONDS, header_delay)
    exponential = LLM_RETRY_BASE_SECONDS * (2 ** max(0, retry_index - 1))
    jitter = random.uniform(0, min(1.0, exponential * 0.25))
    return min(LLM_MAX_RETRY_DELAY_SECONDS, exponential + jitter)


def usage_value(usage, name):
    value = getattr(usage, name, None) if usage else None
    return int(value) if value is not None else None


def write_llm_log(payload):
    LLM_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    with _log_lock:
        with LLM_LOG_PATH.open("a", encoding="utf-8") as log_file:
            log_file.write(line + "\n")


def chat_completion(prompt, temperature=0, context=None):
    context = dict(context or {})
    started = time.monotonic()
    started_at = datetime.now(KST).isoformat()
    total_attempts = LLM_MAX_RETRIES + 1

    for attempt in range(1, total_attempts + 1):
        try:
            response = get_llm_client().chat.completions.create(
                model=OPENAI_MODEL,
                messages=[{"role": "user", "content": prompt}],
            )
            content = (response.choices[0].message.content or "").strip()
            usage = getattr(response, "usage", None)
            write_llm_log({
                **context,
                "model": OPENAI_MODEL,
                "status": "success",
                "attempt": attempt,
                "retry_count": attempt - 1,
                "started_at": started_at,
                "completed_at": datetime.now(KST).isoformat(),
                "duration_seconds": round(time.monotonic() - started, 3),
                "input_tokens": usage_value(usage, "prompt_tokens"),
                "output_tokens": usage_value(usage, "completion_tokens"),
                "total_tokens": usage_value(usage, "total_tokens"),
                "request_id": getattr(response, "_request_id", None),
            })
            return content
        except Exception as exc:
            retryable = should_retry(exc)
            status_code = getattr(exc, "status_code", None)
            final_attempt = attempt >= total_attempts or not retryable
            if final_attempt:
                write_llm_log({
                    **context,
                    "model": OPENAI_MODEL,
                    "status": "failed",
                    "attempt": attempt,
                    "retry_count": attempt - 1,
                    "started_at": started_at,
                    "completed_at": datetime.now(KST).isoformat(),
                    "duration_seconds": round(time.monotonic() - started, 3),
                    "error_type": type(exc).__name__,
                    "http_status": status_code,
                    "request_id": getattr(exc, "request_id", None),
                })
                raise

            delay = retry_delay(exc, attempt)
            log.warning(
                "LLM request retry %s/%s in %.1fs (stage=%s, status=%s, error=%s)",
                attempt,
                LLM_MAX_RETRIES,
                delay,
                context.get("stage", "unknown"),
                status_code,
                type(exc).__name__,
            )
            time.sleep(delay)

    raise RuntimeError("LLM request failed without a final exception.")
