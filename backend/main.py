import hashlib
import io
import json
import logging
import os
import secrets
import shutil
import sqlite3
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from collections import deque
from urllib import error as urllib_error, request as urllib_request
from pathlib import Path
from datetime import datetime, timedelta
from threading import Event, Lock, Thread
from zoneinfo import ZoneInfo
from typing import Literal
from urllib.parse import parse_qs, quote, urlparse

from fastapi import Cookie, FastAPI, File, Form, Header, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel
from cryptography.fernet import Fernet, InvalidToken

from .processor import apply_speaker_mapping, run_llm_postprocess, transcribe_meeting
from .config import settings
from .read import read_text
from .upload_validation import (
    MB,
    RequestBudget,
    UploadPolicyError,
    copy_upload_limited,
    inspect_audio,
    validate_audio_extension,
    validate_reference_extension,
    validate_reference_file,
)
from .write import build_prompt, format_transcript, generate_report
from .confluence import ConfluencePublishError, create_page as create_confluence_page
from .audio_normalization import AudioNormalizationError, normalize_meeting_audio

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
JOB_ROOT = BASE_DIR / "jobs"
WORK_ROOT = BASE_DIR / ".jobs_work"
BACKEND_WORKSPACE_ROOT = BASE_DIR / "backend" / "workspace"
APP_DB_PATH = BASE_DIR / "backend" / "app.db"
CONFLUENCE_SECRET_KEY_PATH = BASE_DIR / "backend" / ".secrets" / "confluence_fernet.key"
JOB_ROOT.mkdir(exist_ok=True)
WORK_ROOT.mkdir(exist_ok=True)
BACKEND_WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)
KST = ZoneInfo("Asia/Seoul")
WORK_CLEANUP_HOUR = 5
RECORDING_DRAFT_RETENTION_DAYS = 7
SESSION_TTL_HOURS = 12
MEDIA_SESSION_TTL_HOURS = 2
MEDIA_SESSION_COOKIE = "wiameet_media_session"
CONFLUENCE_TOKEN_PREFIX = "fernet:"

GPU_WORKERS = settings.jobs.gpu_workers
LLM_WORKERS = settings.jobs.llm_workers
MAX_ACTIVE_JOBS = settings.jobs.max_active
MAX_QUEUED_JOBS = settings.jobs.max_queued
MAX_ACTIVE_JOBS_PER_USER = settings.jobs.max_active_per_user
MAX_UNFINISHED_JOBS_PER_USER = settings.jobs.max_unfinished_per_user

cleanup_stop_event = Event()
cleanup_thread: Thread | None = None
sessions: dict[str, dict] = {}
sessions_lock = Lock()
media_sessions: dict[str, dict] = {}
media_sessions_lock = Lock()


def hash_password(password: str, salt: str | None = None):
    password_salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        password_salt.encode("utf-8"),
        120_000,
    ).hex()
    return password_salt, digest


def verify_password(password: str, salt: str, password_hash: str):
    _, digest = hash_password(password, salt)
    return secrets.compare_digest(digest, password_hash)


def hash_session_token(token: str):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_temporary_password():
    return "wia1234!"


def parse_session_datetime(value: str | None):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=KST)
    return parsed.astimezone(KST)


def get_confluence_secret_key():
    env_key = os.getenv("WIAMEET_CONFLUENCE_SECRET_KEY", "").strip()
    if env_key:
        return env_key.encode("utf-8")

    CONFLUENCE_SECRET_KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    if CONFLUENCE_SECRET_KEY_PATH.exists():
        return CONFLUENCE_SECRET_KEY_PATH.read_bytes().strip()

    key = Fernet.generate_key()
    CONFLUENCE_SECRET_KEY_PATH.write_bytes(key)
    CONFLUENCE_SECRET_KEY_PATH.chmod(0o600)
    return key


def get_confluence_cipher():
    try:
        return Fernet(get_confluence_secret_key())
    except ValueError as exc:
        raise RuntimeError("Invalid WIAMEET_CONFLUENCE_SECRET_KEY for Confluence token encryption.") from exc


def encrypt_confluence_token(token: str):
    token = token.strip()
    if not token:
        return ""
    if token.startswith(CONFLUENCE_TOKEN_PREFIX):
        return token
    encrypted = get_confluence_cipher().encrypt(token.encode("utf-8")).decode("utf-8")
    return CONFLUENCE_TOKEN_PREFIX + encrypted


def decrypt_confluence_token(value: str):
    value = (value or "").strip()
    if not value:
        return ""
    if not value.startswith(CONFLUENCE_TOKEN_PREFIX):
        return value
    encrypted = value.removeprefix(CONFLUENCE_TOKEN_PREFIX).encode("utf-8")
    try:
        return get_confluence_cipher().decrypt(encrypted).decode("utf-8")
    except InvalidToken as exc:
        raise HTTPException(status_code=500, detail="Confluence Access Token 복호화에 실패했습니다. 암호화 키를 확인하세요.") from exc


def get_db_connection():
    conn = sqlite3.connect(APP_DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def table_exists(conn, table_name: str):
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = \"table\" AND name = ?",
        (table_name,),
    ).fetchone() is not None


def create_users_table(conn, table_name: str = "users"):
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            user_uuid TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT \"user\",
            active INTEGER NOT NULL DEFAULT 1,
            password_reset_required INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            last_login_at TEXT
        )
        """
    )


def create_auth_sessions_table(conn, table_name: str = "auth_sessions"):
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            token_hash TEXT PRIMARY KEY,
            user_uuid TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY(user_uuid) REFERENCES users(user_uuid)
        )
        """
    )


def create_users_member_table(conn, table_name: str = "users_member"):
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            member_uuid TEXT PRIMARY KEY,
            user_uuid TEXT NOT NULL,
            member_name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_uuid) REFERENCES users(user_uuid)
        )
        """
    )


def create_users_category_table(conn, table_name: str = "users_category"):
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            category_uuid TEXT PRIMARY KEY,
            user_uuid TEXT NOT NULL,
            category_name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_uuid) REFERENCES users(user_uuid)
        )
        """
    )


def migrate_users_category_table(conn):
    if not table_exists(conn, "users_category"):
        create_users_category_table(conn)
        return

    columns = {row[1] for row in conn.execute("PRAGMA table_info(users_category)").fetchall()}
    if "id" not in columns:
        return

    rows = conn.execute("SELECT * FROM users_category ORDER BY sort_order ASC, id ASC").fetchall()
    conn.execute("DROP TABLE IF EXISTS users_category_new")
    create_users_category_table(conn, "users_category_new")
    for row in rows:
        conn.execute(
            """
            INSERT OR IGNORE INTO users_category_new (category_uuid, user_uuid, category_name, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                row["category_uuid"] if "category_uuid" in row.keys() and row["category_uuid"] else uuid.uuid4().hex,
                row["user_uuid"],
                row["category_name"],
                row["sort_order"] if "sort_order" in row.keys() else 0,
                row["created_at"],
            ),
        )
    conn.execute("DROP TABLE users_category")
    conn.execute("ALTER TABLE users_category_new RENAME TO users_category")


def migrate_users_table(conn):
    if not table_exists(conn, "users"):
        create_users_table(conn)
        return

    columns = {row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
    if "id" not in columns and "user_uuid" in columns:
        return

    id_to_uuid: dict[int, str] = {}
    existing_usernames: set[str] = set()
    user_rows = conn.execute("SELECT * FROM users ORDER BY COALESCE(created_at, \"\") ASC").fetchall()

    conn.execute("DROP TABLE IF EXISTS users_new")
    create_users_table(conn, "users_new")
    for row in user_rows:
        keys = row.keys()
        user_uuid = row["user_uuid"] if "user_uuid" in keys and row["user_uuid"] else uuid.uuid4().hex
        old_id = row["id"] if "id" in keys else None
        if old_id is not None:
            id_to_uuid[old_id] = user_uuid
        username = row["username"]
        if username in existing_usernames:
            continue
        existing_usernames.add(username)
        conn.execute(
            """
            INSERT OR IGNORE INTO users_new (
                user_uuid, username, display_name, password_hash, salt, role, active,
                password_reset_required, created_at, last_login_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_uuid,
                username,
                row["display_name"],
                row["password_hash"],
                row["salt"],
                row["role"] if "role" in keys else "user",
                row["active"] if "active" in keys else 1,
                row["password_reset_required"] if "password_reset_required" in keys else 0,
                row["created_at"],
                row["last_login_at"] if "last_login_at" in keys else None,
            ),
        )

    migrate_auth_sessions_table(conn, id_to_uuid=id_to_uuid, target_table="auth_sessions_new")
    conn.execute("DROP TABLE users")
    conn.execute("ALTER TABLE users_new RENAME TO users")
    if table_exists(conn, "auth_sessions"):
        conn.execute("DROP TABLE auth_sessions")
    conn.execute("ALTER TABLE auth_sessions_new RENAME TO auth_sessions")


def migrate_auth_sessions_table(conn, id_to_uuid: dict[int, str] | None = None, target_table: str = "auth_sessions"):
    id_to_uuid = id_to_uuid or {}
    should_replace_auth_sessions = target_table == "auth_sessions"
    source_exists = table_exists(conn, "auth_sessions")
    source_columns = {
        row[1] for row in conn.execute("PRAGMA table_info(auth_sessions)").fetchall()
    } if source_exists else set()
    required_columns = {"token_hash", "user_uuid", "created_at", "expires_at"}

    if should_replace_auth_sessions and required_columns.issubset(source_columns):
        return

    if target_table != "auth_sessions" and table_exists(conn, target_table):
        conn.execute(f"DROP TABLE {target_table}")

    destination_table = target_table
    if should_replace_auth_sessions:
        conn.execute("DROP TABLE IF EXISTS auth_sessions_new")
        destination_table = "auth_sessions_new"
    create_auth_sessions_table(conn, destination_table)

    if source_exists:
        rows = conn.execute("SELECT * FROM auth_sessions").fetchall()
        for row in rows:
            keys = set(row.keys())
            user_uuid = row["user_uuid"] if "user_uuid" in keys else id_to_uuid.get(row["user_id"])
            if not user_uuid:
                continue

            raw_token = row["token"] if "token" in keys else None
            token_hash = row["token_hash"] if "token_hash" in keys else hash_session_token(raw_token)
            created_at = parse_session_datetime(row["created_at"]) or datetime.now(KST)
            expires_at = (
                parse_session_datetime(row["expires_at"])
                if "expires_at" in keys
                else created_at + timedelta(hours=SESSION_TTL_HOURS)
            )
            conn.execute(
                f"""
                INSERT OR IGNORE INTO {destination_table}
                    (token_hash, user_uuid, created_at, expires_at)
                VALUES (?, ?, ?, ?)
                """,
                (token_hash, user_uuid, created_at.isoformat(), expires_at.isoformat()),
            )

    if should_replace_auth_sessions:
        if source_exists:
            conn.execute("DROP TABLE auth_sessions")
        conn.execute("ALTER TABLE auth_sessions_new RENAME TO auth_sessions")


def migrate_users_member_table(conn):
    if not table_exists(conn, "users_member"):
        create_users_member_table(conn)
        return

    columns = {row[1] for row in conn.execute("PRAGMA table_info(users_member)").fetchall()}
    if "id" not in columns:
        return

    rows = conn.execute("SELECT * FROM users_member ORDER BY sort_order ASC, created_at ASC").fetchall()
    conn.execute("DROP TABLE IF EXISTS users_member_new")
    create_users_member_table(conn, "users_member_new")
    for row in rows:
        conn.execute(
            """
            INSERT OR IGNORE INTO users_member_new (member_uuid, user_uuid, member_name, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                row["member_uuid"] if row["member_uuid"] else uuid.uuid4().hex,
                row["user_uuid"],
                row["member_name"],
                row["sort_order"] if "sort_order" in row.keys() else 0,
                row["created_at"],
            ),
        )
    conn.execute("DROP TABLE users_member")
    conn.execute("ALTER TABLE users_member_new RENAME TO users_member")


def create_meeting_reports_table(conn, table_name: str = "meeting_reports"):
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            report_uuid TEXT PRIMARY KEY,
            job_id TEXT NOT NULL UNIQUE,
            user_uuid TEXT NOT NULL,
            title TEXT NOT NULL,
            purpose TEXT,
            meeting_date TEXT,
            start_time TEXT,
            end_time TEXT,
            organizations_json TEXT,
            participants_json TEXT,
            category_uuid TEXT,
            category_name TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_uuid) REFERENCES users(user_uuid)
        )
        """
    )


def create_confluence_published_reports_table(conn, table_name: str = "confluence_published_reports"):
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            publish_uuid TEXT PRIMARY KEY,
            report_uuid TEXT NOT NULL UNIQUE,
            job_id TEXT NOT NULL,
            user_uuid TEXT NOT NULL,
            confluence_page_id TEXT NOT NULL,
            confluence_page_url TEXT NOT NULL,
            confluence_page_title TEXT NOT NULL,
            parent_page_url TEXT NOT NULL,
            published_at TEXT NOT NULL,
            FOREIGN KEY(report_uuid) REFERENCES meeting_reports(report_uuid) ON DELETE CASCADE,
            FOREIGN KEY(user_uuid) REFERENCES users(user_uuid)
        )
        """
    )


def create_confluence_settings_table(conn, table_name: str = "confluence_settings"):
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            setting_uuid TEXT PRIMARY KEY,
            user_uuid TEXT NOT NULL UNIQUE,
            page_url TEXT NOT NULL DEFAULT '',
            token_encrypted TEXT NOT NULL DEFAULT '',
            enabled INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_tested_at TEXT,
            last_test_status TEXT,
            FOREIGN KEY(user_uuid) REFERENCES users(user_uuid)
        )
        """
    )


def migrate_confluence_settings_table(conn):
    if not table_exists(conn, "confluence_settings"):
        create_confluence_settings_table(conn)
        return

    columns = {row[1] for row in conn.execute("PRAGMA table_info(confluence_settings)").fetchall()}
    if "username" not in columns and "password_encrypted" not in columns:
        return

    rows = conn.execute("SELECT * FROM confluence_settings").fetchall()
    conn.execute("DROP TABLE IF EXISTS confluence_settings_new")
    create_confluence_settings_table(conn, "confluence_settings_new")
    for row in rows:
        keys = row.keys()
        conn.execute(
            """
            INSERT OR IGNORE INTO confluence_settings_new (
                setting_uuid, user_uuid, page_url, token_encrypted, enabled,
                created_at, updated_at, last_tested_at, last_test_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["setting_uuid"] if "setting_uuid" in keys and row["setting_uuid"] else uuid.uuid4().hex,
                row["user_uuid"],
                row["page_url"] if "page_url" in keys else "",
                row["token_encrypted"] if "token_encrypted" in keys else "",
                row["enabled"] if "enabled" in keys else 0,
                row["created_at"] if "created_at" in keys and row["created_at"] else datetime.now(KST).isoformat(timespec="seconds"),
                row["updated_at"] if "updated_at" in keys and row["updated_at"] else datetime.now(KST).isoformat(timespec="seconds"),
                row["last_tested_at"] if "last_tested_at" in keys else None,
                row["last_test_status"] if "last_test_status" in keys else None,
            ),
        )
    conn.execute("DROP TABLE confluence_settings")
    conn.execute("ALTER TABLE confluence_settings_new RENAME TO confluence_settings")


def migrate_confluence_tokens_encrypted(conn):
    if not table_exists(conn, "confluence_settings"):
        return

    rows = conn.execute(
        "SELECT setting_uuid, token_encrypted FROM confluence_settings WHERE token_encrypted != ''"
    ).fetchall()
    for row in rows:
        token_value = row["token_encrypted"] or ""
        if token_value.startswith(CONFLUENCE_TOKEN_PREFIX):
            continue
        conn.execute(
            "UPDATE confluence_settings SET token_encrypted = ?, updated_at = ? WHERE setting_uuid = ?",
            (
                encrypt_confluence_token(token_value),
                datetime.now(KST).isoformat(timespec="seconds"),
                row["setting_uuid"],
            ),
        )


def create_recording_drafts_table(conn, table_name: str = "recording_drafts"):
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            draft_uuid TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            title TEXT NOT NULL,
            storage_path TEXT NOT NULL,
            duration_seconds INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(user_uuid)
        )
        """
    )


def migrate_recording_drafts_table(conn):
    if not table_exists(conn, "recording_drafts"):
        create_recording_drafts_table(conn)
        return

    columns = {row[1] for row in conn.execute("PRAGMA table_info(recording_drafts)").fetchall()}
    required = {"draft_uuid", "user_id", "title", "storage_path", "duration_seconds", "created_at"}
    if required.issubset(columns) and "original_filename" not in columns:
        return

    rows = conn.execute("SELECT * FROM recording_drafts").fetchall()
    conn.execute("DROP TABLE IF EXISTS recording_drafts_new")
    create_recording_drafts_table(conn, "recording_drafts_new")
    for row in rows:
        keys = row.keys()
        draft_uuid = row["draft_uuid"] if "draft_uuid" in keys and row["draft_uuid"] else uuid.uuid4().hex
        user_id = row["user_id"] if "user_id" in keys else row["user_uuid"] if "user_uuid" in keys else ""
        storage_path = row["storage_path"] if "storage_path" in keys else ""
        if not user_id or not storage_path:
            continue
        conn.execute(
            """
            INSERT OR IGNORE INTO recording_drafts_new (
                draft_uuid, user_id, title, storage_path, duration_seconds, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                draft_uuid,
                user_id,
                row["title"] if "title" in keys and row["title"] else "임시 녹음",
                storage_path,
                row["duration_seconds"] if "duration_seconds" in keys else 0,
                row["created_at"] if "created_at" in keys and row["created_at"] else datetime.now(KST).isoformat(),
            ),
        )
    conn.execute("DROP TABLE recording_drafts")
    conn.execute("ALTER TABLE recording_drafts_new RENAME TO recording_drafts")


def migrate_meeting_reports_table(conn):
    if not table_exists(conn, "meeting_reports"):
        create_meeting_reports_table(conn)
        return

    columns = {row[1] for row in conn.execute("PRAGMA table_info(meeting_reports)").fetchall()}
    if "id" not in columns and "report_path" not in columns and "category_uuid" in columns and "category_name" in columns:
        return

    rows = conn.execute("SELECT * FROM meeting_reports").fetchall()
    conn.execute("DROP TABLE IF EXISTS meeting_reports_new")
    create_meeting_reports_table(conn, "meeting_reports_new")
    seen_job_ids: set[str] = set()
    for row in rows:
        job_id = row["job_id"]
        if job_id in seen_job_ids:
            continue
        seen_job_ids.add(job_id)
        conn.execute(
            """
            INSERT OR IGNORE INTO meeting_reports_new (
                report_uuid, job_id, user_uuid, title, purpose, meeting_date, start_time, end_time,
                organizations_json, participants_json, category_uuid, category_name, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["report_uuid"] if row["report_uuid"] else uuid.uuid4().hex,
                job_id,
                row["user_uuid"],
                row["title"],
                row["purpose"] if "purpose" in row.keys() else "",
                row["meeting_date"] if "meeting_date" in row.keys() else "",
                row["start_time"] if "start_time" in row.keys() else "",
                row["end_time"] if "end_time" in row.keys() else "",
                row["organizations_json"] if "organizations_json" in row.keys() else "[]",
                row["participants_json"] if "participants_json" in row.keys() else "[]",
                row["category_uuid"] if "category_uuid" in row.keys() else "",
                row["category_name"] if "category_name" in row.keys() else "",
                row["created_at"],
            ),
        )
    conn.execute("DROP TABLE meeting_reports")
    conn.execute("ALTER TABLE meeting_reports_new RENAME TO meeting_reports")


def create_processing_jobs_table(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS processing_jobs (
            job_id TEXT PRIMARY KEY,
            user_uuid TEXT NOT NULL,
            status TEXT NOT NULL,
            stage TEXT NOT NULL,
            progress INTEGER NOT NULL DEFAULT 0,
            message TEXT NOT NULL DEFAULT '',
            logs_json TEXT NOT NULL DEFAULT '[]',
            payload_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            error_message TEXT
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_processing_jobs_user ON processing_jobs(user_uuid, updated_at)"
    )


def init_app_db():
    APP_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    get_confluence_secret_key()
    with get_db_connection() as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
        conn.execute("PRAGMA foreign_keys = OFF")
        migrate_users_table(conn)
        migrate_auth_sessions_table(conn)
        migrate_users_member_table(conn)
        migrate_users_category_table(conn)
        migrate_meeting_reports_table(conn)
        migrate_recording_drafts_table(conn)
        create_confluence_published_reports_table(conn)
        migrate_confluence_settings_table(conn)
        migrate_confluence_tokens_encrypted(conn)
        create_processing_jobs_table(conn)
        conn.execute("PRAGMA foreign_keys = ON")

        user_count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if user_count == 0:
            default_username = os.getenv("WIAMEET_ADMIN_USERNAME", "admin").strip() or "admin"
            default_password = os.getenv("WIAMEET_ADMIN_PASSWORD", "").strip()
            if not default_password:
                raise RuntimeError(
                    "WIAMEET_ADMIN_PASSWORD is required when initializing the first administrator account."
                )
            salt, password_hash = hash_password(default_password)
            conn.execute(
                """
                INSERT INTO users (username, user_uuid, display_name, password_hash, salt, role, active, password_reset_required, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)
                """,
                (
                    default_username,
                    uuid.uuid4().hex,
                    "WIAMeet Admin",
                    password_hash,
                    salt,
                    "admin",
                    datetime.now(KST).isoformat(),
                ),
            )
        conn.commit()


def public_user(row):
    data = {
        "username": row["username"],
        "user_uuid": row["user_uuid"] if "user_uuid" in row.keys() else None,
        "display_name": row["display_name"],
        "role": row["role"],
        "password_reset_required": bool(row["password_reset_required"]) if "password_reset_required" in row.keys() else False,
    }
    if "active" in row.keys():
        data["active"] = bool(row["active"])
    if "created_at" in row.keys():
        data["created_at"] = row["created_at"]
    if "last_login_at" in row.keys():
        data["last_login_at"] = row["last_login_at"]
    return data


def extract_session_token(authorization: str | None = None):
    if authorization and authorization.startswith("Bearer "):
        bearer_token = authorization.removeprefix("Bearer ").strip()
        if bearer_token:
            return bearer_token
    raise HTTPException(status_code=401, detail="Authentication required.")


def remove_cached_user_sessions(user_uuid: str, except_token_hash: str | None = None):
    with sessions_lock:
        for cached_token_hash, session in list(sessions.items()):
            if (
                session["user"].get("user_uuid") == user_uuid
                and cached_token_hash != except_token_hash
            ):
                sessions.pop(cached_token_hash, None)


def remove_user_media_sessions(user_uuid: str):
    with media_sessions_lock:
        for media_token_hash, session in list(media_sessions.items()):
            if session.get("user_uuid") == user_uuid:
                media_sessions.pop(media_token_hash, None)


def get_media_user_uuid(
    authorization: str | None = None,
    media_session: str | None = None,
):
    if authorization:
        return get_session_user(authorization)["user_uuid"]
    if not media_session:
        raise HTTPException(status_code=401, detail="Media authentication required.")

    media_token_hash = hash_session_token(media_session)
    now = datetime.now(KST)
    with media_sessions_lock:
        session = media_sessions.get(media_token_hash)
        expires_at = parse_session_datetime(session.get("expires_at")) if session else None
        if not session or not expires_at or expires_at <= now:
            media_sessions.pop(media_token_hash, None)
            raise HTTPException(status_code=401, detail="Invalid or expired media session.")
    return session["user_uuid"]


def get_session_user(authorization: str | None = None):
    raw_token = extract_session_token(authorization)
    token_hash = hash_session_token(raw_token)
    now = datetime.now(KST)

    with sessions_lock:
        session = sessions.get(token_hash)
    if session:
        expires_at = parse_session_datetime(session.get("expires_at"))
        if expires_at and expires_at > now:
            return session["user"]
        with sessions_lock:
            sessions.pop(token_hash, None)

    with get_db_connection() as conn:
        row = conn.execute(
            """
            SELECT users.username, users.user_uuid, users.display_name, users.role,
                   users.active, users.password_reset_required, users.created_at, users.last_login_at,
                   auth_sessions.expires_at
            FROM auth_sessions
            JOIN users ON users.user_uuid = auth_sessions.user_uuid
            WHERE auth_sessions.token_hash = ? AND users.active = 1
            """,
            (token_hash,),
        ).fetchone()
        expires_at = parse_session_datetime(row["expires_at"]) if row else None
        if not row or not expires_at or expires_at <= now:
            if row:
                conn.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (token_hash,))
                conn.commit()
            raise HTTPException(status_code=401, detail="Invalid or expired session.")

    user_data = public_user(row)
    with sessions_lock:
        sessions[token_hash] = {
            "user": user_data,
            "expires_at": expires_at.isoformat(),
        }
    return user_data


def require_admin(authorization: str | None):
    user = get_session_user(authorization)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin permission required.")
    return user


def seconds_until_next_work_cleanup():
    now = datetime.now(KST)
    target = now.replace(hour=WORK_CLEANUP_HOUR, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


def parse_kst_datetime(value: str | None):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=KST)
    return parsed.astimezone(KST)


def clear_expired_recording_drafts():
    cutoff = datetime.now(KST) - timedelta(days=RECORDING_DRAFT_RETENTION_DAYS)
    deleted_count = 0
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT draft_uuid, storage_path, created_at FROM recording_drafts"
        ).fetchall()

        for row in rows:
            created_at = parse_kst_datetime(row["created_at"])
            if not created_at or created_at > cutoff:
                continue

            storage_path = Path(row["storage_path"])
            if storage_path.exists():
                storage_path.unlink()

            draft_dir = storage_path.parent
            try:
                if (
                    draft_dir.name == row["draft_uuid"]
                    and BACKEND_WORKSPACE_ROOT.resolve() in draft_dir.resolve().parents
                    and draft_dir.exists()
                ):
                    shutil.rmtree(draft_dir)
            except FileNotFoundError:
                pass

            conn.execute(
                "DELETE FROM recording_drafts WHERE draft_uuid = ?",
                (row["draft_uuid"],),
            )
            deleted_count += 1
        conn.commit()

    if deleted_count:
        print(f"[recording-drafts-cleanup] deleted {deleted_count} expired recording draft(s).", flush=True)
    return deleted_count


def clear_work_root():
    with jobs_lock:
        retained_job_ids = set(jobs)

    for path in WORK_ROOT.iterdir():
        if path.name in retained_job_ids:
            continue
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()


def clear_expired_auth_sessions():
    now = datetime.now(KST)
    with get_db_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM auth_sessions WHERE expires_at <= ?",
            (now.isoformat(),),
        )
        conn.commit()

    with sessions_lock:
        for token_hash, session in list(sessions.items()):
            expires_at = parse_session_datetime(session.get("expires_at"))
            if not expires_at or expires_at <= now:
                sessions.pop(token_hash, None)

    with media_sessions_lock:
        for token_hash, session in list(media_sessions.items()):
            expires_at = parse_session_datetime(session.get("expires_at"))
            if not expires_at or expires_at <= now:
                media_sessions.pop(token_hash, None)

    if cursor.rowcount:
        print(f"[auth-sessions-cleanup] deleted {cursor.rowcount} expired session(s).", flush=True)
    return cursor.rowcount


def work_cleanup_loop():
    while not cleanup_stop_event.wait(seconds_until_next_work_cleanup()):
        clear_work_root()
        clear_expired_recording_drafts()
        clear_expired_auth_sessions()


app = FastAPI(title="WIAMeet API")


@app.middleware("http")
async def reject_oversized_upload_requests(request, call_next):
    if request.method == "POST" and request.url.path in {"/api/jobs", "/api/recording-drafts"}:
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                request_bytes = int(content_length)
            except ValueError:
                return JSONResponse(
                    status_code=400,
                    content={"detail": "올바르지 않은 Content-Length 헤더입니다."},
                )
            maximum_bytes = settings.upload.request_max_mb * MB
            if request_bytes > maximum_bytes:
                return JSONResponse(
                    status_code=413,
                    content={
                        "detail": (
                            f"전체 업로드 크기는 {settings.upload.request_max_mb}MB를 "
                            "초과할 수 없습니다."
                        )
                    },
                    headers={"X-WIAMeet-Error-Code": "REQUEST_TOO_LARGE"},
                )
    return await call_next(request)


@app.on_event("startup")
def start_work_cleanup_scheduler():
    global cleanup_thread
    init_app_db()
    load_processing_jobs()
    clear_work_root()
    recover_processing_jobs()
    clear_expired_recording_drafts()
    clear_expired_auth_sessions()
    if cleanup_thread and cleanup_thread.is_alive():
        return
    cleanup_stop_event.clear()
    cleanup_thread = Thread(target=work_cleanup_loop, name="jobs-work-cleanup", daemon=True)
    cleanup_thread.start()


@app.on_event("shutdown")
def stop_work_cleanup_scheduler():
    cleanup_stop_event.set()
    gpu_executor.shutdown(wait=False, cancel_futures=True)
    llm_executor.shutdown(wait=False, cancel_futures=True)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:9702", "http://127.0.0.1:9702"],
    allow_origin_regex=r"http://.*:9702",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

gpu_executor = ThreadPoolExecutor(max_workers=GPU_WORKERS, thread_name_prefix="gpu-worker")
llm_executor = ThreadPoolExecutor(max_workers=LLM_WORKERS, thread_name_prefix="llm-worker")
jobs: dict[str, dict] = {}
jobs_lock = Lock()
active_job_ids: set[str] = set()
pending_job_ids = deque()


class LoginRequest(BaseModel):
    username: str
    password: str


class CreateUserRequest(BaseModel):
    username: str
    display_name: str
    role: Literal["admin", "user"] = "user"


class UpdatePasswordRequest(BaseModel):
    password: str


class ResetPasswordRequest(BaseModel):
    pass


class CreateMemberRequest(BaseModel):
    member_name: str


class ReorderMembersRequest(BaseModel):
    member_uuids: list[str]


class CreateCategoryRequest(BaseModel):
    category_name: str


class ReorderCategoriesRequest(BaseModel):
    category_uuids: list[str]


class SpeakerMappingRequest(BaseModel):
    mapping: dict[str, str]
    sentences: list[dict] | None = None


class ReportRequest(BaseModel):
    special_instruction: str = ""


class ReportFinalizeRequest(BaseModel):
    report_markdown: str


class ConfluenceTokenTestRequest(BaseModel):
    page_url: str
    token: str


class JobStatus(BaseModel):
    job_id: str
    status: Literal["queued", "running", "completed", "failed"]
    stage: str
    progress: int
    message: str
    logs: list[str] = []


def require_job_owner(job_id: str, authorization: str | None):
    user = get_session_user(authorization)
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        if job.get("created_by_user_uuid") != user["user_uuid"]:
            raise HTTPException(status_code=403, detail="You cannot access this job.")
    return user


def append_job_log(job: dict, stage: str, percent: int, message: str):
    logs = job.setdefault("logs", [])
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {percent:>3}% {stage:<16} {message}"
    if not logs or logs[-1] != line:
        logs.append(line)


def processing_job_payload(job):
    excluded = {
        "status", "stage", "progress", "message", "logs", "result",
        "original_result", "refined_result", "stt_corrections", "speaker_matches",
    }
    return {key: value for key, value in job.items() if key not in excluded}


def persist_job(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return
        snapshot = dict(job)
        snapshot["logs"] = list(job.get("logs", []))
    now = datetime.now(KST).isoformat()
    with get_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO processing_jobs (
                job_id, user_uuid, status, stage, progress, message, logs_json,
                payload_json, created_at, updated_at, error_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(job_id) DO UPDATE SET
                status=excluded.status, stage=excluded.stage, progress=excluded.progress,
                message=excluded.message, logs_json=excluded.logs_json,
                payload_json=excluded.payload_json, updated_at=excluded.updated_at,
                error_message=excluded.error_message
            """,
            (
                job_id,
                snapshot.get("created_by_user_uuid", ""),
                snapshot.get("status", "queued"),
                snapshot.get("stage", "queued"),
                snapshot.get("progress", 0),
                snapshot.get("message", ""),
                json.dumps(snapshot.get("logs", []), ensure_ascii=False),
                json.dumps(processing_job_payload(snapshot), ensure_ascii=False),
                snapshot.get("created_at", now),
                now,
                snapshot.get("error_message"),
            ),
        )
        conn.commit()


def delete_processing_job(job_id: str):
    with get_db_connection() as conn:
        conn.execute("DELETE FROM processing_jobs WHERE job_id = ?", (job_id,))
        conn.commit()


def read_json_artifact(path: Path, default=None):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def load_processing_jobs():
    with get_db_connection() as conn:
        rows = conn.execute("SELECT * FROM processing_jobs ORDER BY created_at").fetchall()

    restored = {}
    for row in rows:
        try:
            payload = json.loads(row["payload_json"] or "{}")
            logs = json.loads(row["logs_json"] or "[]")
        except json.JSONDecodeError:
            continue
        job = {
            **payload,
            "job_id": row["job_id"],
            "status": row["status"],
            "stage": row["stage"],
            "progress": row["progress"],
            "message": row["message"],
            "logs": logs,
            "error_message": row["error_message"],
        }
        meta_dir = Path(job.get("meta_dir", WORK_ROOT / row["job_id"] / "meta"))
        report_dir = Path(job.get("report_dir", WORK_ROOT / row["job_id"] / "report"))
        job["result"] = read_json_artifact(meta_dir / "result.json")
        job["original_result"] = read_json_artifact(meta_dir / "original_result.json")
        job["refined_result"] = read_json_artifact(meta_dir / "refined_result.json")
        job["stt_corrections"] = read_json_artifact(
            meta_dir / "stt_corrections.json", {"corrections": []}
        )
        job["speaker_matches"] = read_json_artifact(
            meta_dir / "speaker_matches.json", {"matches": []}
        )
        job["speaker_mapping"] = {
            str(item["speaker_id"]): item["participant_match"]
            for item in job["speaker_matches"].get("matches", [])
            if "speaker_id" in item and "participant_match" in item
        }
        report_path = report_dir / "meeting_report.md"
        if report_path.exists():
            job["meeting_report"] = report_path.read_text(encoding="utf-8").strip()
        restored[row["job_id"]] = job

    with jobs_lock:
        jobs.update(restored)


def set_job(job_id: str, **updates):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return
        job.update(updates)
        if {"stage", "progress", "message"}.issubset(updates):
            append_job_log(job, updates["stage"], updates["progress"], updates["message"])
    persist_job(job_id)


def progress_callback(job_id: str):
    def update(stage: str, percent: int, message: str):
        set_job(job_id, stage=stage, progress=percent, message=message)
    return update


def parse_participants(text: str):
    normalized = text.replace(",", "\n")
    return [item.strip() for item in normalized.splitlines() if item.strip()]


def write_json_artifact(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    temporary_path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary_path.replace(path)


def next_pipeline_stage(job_id: str):
    with jobs_lock:
        job = jobs[job_id]
        return "llm" if job.get("result") else "gpu"


def submit_pipeline_stage(job_id: str):
    if next_pipeline_stage(job_id) == "llm":
        set_job(job_id, status="running", stage="llm_queued", progress=88,
                message="LLM 후처리 대기 중입니다.")
        llm_executor.submit(run_llm_job, job_id)
    else:
        set_job(job_id, status="queued", stage="gpu_queued", progress=0,
                message="GPU 분석 대기 중입니다.")
        gpu_executor.submit(run_gpu_job, job_id)


def active_pipeline_count_for_user(user_uuid: str):
    return sum(
        1
        for active_id in active_job_ids
        if jobs.get(active_id, {}).get("created_by_user_uuid") == user_uuid
    )


def can_activate_pipeline_job(job_id: str):
    job = jobs.get(job_id)
    if not job or len(active_job_ids) >= MAX_ACTIVE_JOBS:
        return False
    return (
        active_pipeline_count_for_user(job.get("created_by_user_uuid", ""))
        < MAX_ACTIVE_JOBS_PER_USER
    )


def admit_pipeline_job(job_id: str):
    submit_now = False
    with jobs_lock:
        if can_activate_pipeline_job(job_id):
            active_job_ids.add(job_id)
            submit_now = True
        elif len(pending_job_ids) < MAX_QUEUED_JOBS:
            pending_job_ids.append(job_id)
            job = jobs[job_id]
            job.update(
                status="queued",
                stage="capacity_queued",
                progress=0,
                message="서버 작업 슬롯 대기 중입니다.",
            )
            append_job_log(job, job["stage"], job["progress"], job["message"])
        else:
            return False
    persist_job(job_id)
    if submit_now:
        submit_pipeline_stage(job_id)
    return True


def finish_pipeline_job(job_id: str):
    next_job_id = None
    with jobs_lock:
        active_job_ids.discard(job_id)
        pending_count = len(pending_job_ids)
        for _ in range(pending_count):
            candidate = pending_job_ids.popleft()
            if candidate not in jobs:
                continue
            if can_activate_pipeline_job(candidate):
                active_job_ids.add(candidate)
                next_job_id = candidate
                break
            pending_job_ids.append(candidate)
    if next_job_id:
        submit_pipeline_stage(next_job_id)


def run_gpu_job(job_id: str):
    set_job(job_id, status="running", stage="audio_normalizing", progress=1,
            message="회의 녹음을 분석용 오디오로 변환하고 있습니다.")
    with jobs_lock:
        job = dict(jobs[job_id])
    source_audio_path = Path(job.get("source_audio_path", job["audio_path"]))
    audio_dir = source_audio_path.parent
    analysis_audio_path = audio_dir / "analysis.wav"
    archive_audio_path = audio_dir / "audio.m4a"
    try:
        normalized_duration = normalize_meeting_audio(
            source_audio_path,
            analysis_audio_path,
            archive_audio_path,
            sample_rate=settings.upload.audio.analysis_sample_rate_hz,
            archive_bitrate=settings.upload.audio.archive_bitrate_kbps * 1_000,
        )
        analysis_duration = inspect_audio(analysis_audio_path, ".wav")
        archive_duration = inspect_audio(archive_audio_path, ".m4a")
        duration_difference = max(
            abs(normalized_duration - analysis_duration),
            abs(normalized_duration - archive_duration),
        )
        if duration_difference > max(1.0, normalized_duration * 0.005):
            raise AudioNormalizationError(
                "변환된 오디오의 재생시간이 원본과 일치하지 않습니다."
            )

        source_audio_path.unlink(missing_ok=True)
        set_job(
            job_id,
            audio_path=str(analysis_audio_path),
            archive_audio_path=str(archive_audio_path),
            stage="gpu_starting",
            progress=4,
            message="오디오 변환이 완료되어 GPU 분석을 시작합니다.",
        )
        result = transcribe_meeting(
            analysis_audio_path, Path(job["meta_dir"]), progress_callback(job_id)
        )
        write_json_artifact(Path(job["meta_dir"]) / "result.json", result)
        set_job(job_id, result=result)
        submit_pipeline_stage(job_id)
    except Exception as exc:
        set_job(job_id, status="failed", stage="gpu_failed", progress=100,
                message=str(exc), error_message=str(exc))
        finish_pipeline_job(job_id)
    finally:
        analysis_audio_path.unlink(missing_ok=True)


def run_llm_job(job_id: str):
    set_job(job_id, status="running", stage="llm_running", progress=89,
            message="LLM 후처리를 시작합니다.")
    with jobs_lock:
        job = dict(jobs[job_id])
    try:
        result = job.get("result") or read_json_artifact(Path(job["meta_dir"]) / "result.json")
        if not result:
            raise RuntimeError("GPU 분석 결과를 찾지 못했습니다.")
        postprocess = run_llm_postprocess(
            result,
            Path(job["meta_dir"]),
            job.get("participants", []),
            job.get("meeting_purpose", ""),
            job.get("meeting_reference_text", ""),
            progress_callback(job_id),
            job_id,
        )
        corrected_result = {**result, "sentences": postprocess["corrected_sentences"]}
        write_json_artifact(Path(job["meta_dir"]) / "result.json", corrected_result)
        write_json_artifact(
            Path(job["meta_dir"]) / "stt_corrections.json", postprocess["stt_corrections"]
        )
        speaker_mapping = {
            str(match["speaker_id"]): match["participant_match"]
            for match in postprocess["speaker_matches"].get("matches", [])
            if "speaker_id" in match and "participant_match" in match
        }
        set_job(
            job_id,
            status="completed",
            stage="mapping_review",
            progress=100,
            message="처리가 완료되었습니다. 화자 매핑을 확인하세요.",
            result=corrected_result,
            original_result=postprocess["original_sentences"],
            refined_result=postprocess["refined_sentences"],
            stt_corrections=postprocess["stt_corrections"],
            speaker_matches=postprocess["speaker_matches"],
            speaker_mapping=speaker_mapping,
            error_message=None,
        )
    except Exception as exc:
        set_job(job_id, status="failed", stage="llm_failed", progress=100,
                message=str(exc), error_message=str(exc))
    finally:
        finish_pipeline_job(job_id)


def recover_processing_jobs():
    with jobs_lock:
        recoverable = [
            job_id for job_id, job in jobs.items()
            if job.get("status") in {"queued", "running"}
        ]
        reports = [
            (job_id, job.get("report_instruction", ""))
            for job_id, job in jobs.items()
            if job.get("report_status") in {"queued", "running"}
        ]
    for job_id in recoverable:
        set_job(job_id, status="queued", message="서버 재시작 후 작업을 복구하고 있습니다.")
        if not admit_pipeline_job(job_id):
            set_job(job_id, status="failed", stage="recovery_failed", progress=100,
                    message="복구 대기열 용량을 초과했습니다.")
    for job_id, instruction in reports:
        set_job(job_id, report_status="queued")
        llm_executor.submit(run_report_job, job_id, instruction)


@app.post("/api/auth/login")
def login(request: LoginRequest):
    username = request.username.strip()
    password = request.password
    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password are required.")

    now = datetime.now(KST)
    expires_at = now + timedelta(hours=SESSION_TTL_HOURS)
    with get_db_connection() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE username = ? AND active = 1",
            (username,),
        ).fetchone()
        if not user or not verify_password(password, user["salt"], user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid username or password.")
        conn.execute(
            "UPDATE users SET last_login_at = ? WHERE user_uuid = ?",
            (now.isoformat(), user["user_uuid"]),
        )
        user = conn.execute(
            "SELECT * FROM users WHERE user_uuid = ?",
            (user["user_uuid"],),
        ).fetchone()
        conn.commit()

    token = secrets.token_urlsafe(32)
    token_hash = hash_session_token(token)
    user_data = public_user(user)
    with get_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO auth_sessions (token_hash, user_uuid, created_at, expires_at)
            VALUES (?, ?, ?, ?)
            """,
            (token_hash, user["user_uuid"], now.isoformat(), expires_at.isoformat()),
        )
        conn.commit()
    with sessions_lock:
        sessions[token_hash] = {
            "user": user_data,
            "expires_at": expires_at.isoformat(),
        }

    return {"token": token, "expires_at": expires_at.isoformat(), "user": user_data}


@app.post("/api/auth/media-session")
def create_media_session(
    response: Response,
    authorization: str | None = Header(default=None),
):
    user = get_session_user(authorization)
    raw_session_token = extract_session_token(authorization)
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT expires_at FROM auth_sessions WHERE token_hash = ?",
            (hash_session_token(raw_session_token),),
        ).fetchone()
    login_expires_at = parse_session_datetime(row["expires_at"]) if row else None
    if not login_expires_at:
        raise HTTPException(status_code=401, detail="Invalid session.")

    remove_user_media_sessions(user["user_uuid"])
    raw_token = secrets.token_urlsafe(32)
    token_hash = hash_session_token(raw_token)
    now = datetime.now(KST)
    expires_at = min(
        now + timedelta(hours=MEDIA_SESSION_TTL_HOURS),
        login_expires_at,
    )
    max_age = max(1, int((expires_at - now).total_seconds()))
    with media_sessions_lock:
        media_sessions[token_hash] = {
            "user_uuid": user["user_uuid"],
            "expires_at": expires_at.isoformat(),
        }
    response.set_cookie(
        key=MEDIA_SESSION_COOKIE,
        value=raw_token,
        max_age=max_age,
        path="/api",
        secure=True,
        httponly=True,
        samesite="strict",
    )
    return {"expires_at": expires_at.isoformat()}


@app.post("/api/auth/logout")
def logout(
    response: Response,
    authorization: str | None = Header(default=None),
):
    raw_token = extract_session_token(authorization)
    token_hash = hash_session_token(raw_token)
    user_uuid = None
    with sessions_lock:
        cached_session = sessions.get(token_hash)
        if cached_session:
            user_uuid = cached_session["user"].get("user_uuid")
    if not user_uuid:
        with get_db_connection() as conn:
            row = conn.execute(
                "SELECT user_uuid FROM auth_sessions WHERE token_hash = ?",
                (token_hash,),
            ).fetchone()
            user_uuid = row["user_uuid"] if row else None

    with get_db_connection() as conn:
        conn.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (token_hash,))
        conn.commit()
    with sessions_lock:
        sessions.pop(token_hash, None)
    if user_uuid:
        remove_user_media_sessions(user_uuid)
    response.delete_cookie(MEDIA_SESSION_COOKIE, path="/api", secure=True, httponly=True, samesite="strict")
    return {"logged_out": True}


@app.get("/api/admin/users")
def list_users(authorization: str | None = Header(default=None)):
    require_admin(authorization)
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT username, user_uuid, display_name, role, active, password_reset_required, created_at, last_login_at
            FROM users
            ORDER BY created_at ASC, username ASC
            """
        ).fetchall()
    return {"users": [public_user(row) for row in rows]}


@app.post("/api/admin/users")
def create_user(request: CreateUserRequest, authorization: str | None = Header(default=None)):
    require_admin(authorization)
    username = request.username.strip()
    display_name = request.display_name.strip()
    if not username or not display_name:
        raise HTTPException(status_code=400, detail="Username and display name are required.")

    temporary_password = generate_temporary_password()
    salt, password_hash = hash_password(temporary_password)
    try:
        with get_db_connection() as conn:
            conn.execute(
                """
                INSERT INTO users (username, user_uuid, display_name, password_hash, salt, role, active, password_reset_required, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)
                """,
                (username, uuid.uuid4().hex, display_name, password_hash, salt, request.role, datetime.now(KST).isoformat()),
            )
            conn.commit()
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Username already exists.") from exc

    with get_db_connection() as conn:
        user = conn.execute(
            "SELECT username, user_uuid, display_name, role, active, password_reset_required, created_at, last_login_at FROM users WHERE username = ?",
            (username,),
        ).fetchone()
    return {"user": public_user(user), "temporary_password": temporary_password}


@app.post("/api/admin/users/{user_uuid}/password/reset")
def reset_user_password(user_uuid: str, authorization: str | None = Header(default=None)):
    require_admin(authorization)
    temporary_password = generate_temporary_password()
    salt, password_hash = hash_password(temporary_password)
    with get_db_connection() as conn:
        cursor = conn.execute(
            "UPDATE users SET password_hash = ?, salt = ?, password_reset_required = 1 WHERE user_uuid = ?",
            (password_hash, salt, user_uuid),
        )
        if cursor.rowcount:
            conn.execute("DELETE FROM auth_sessions WHERE user_uuid = ?", (user_uuid,))
        conn.commit()
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="User not found.")
    remove_cached_user_sessions(user_uuid)
    remove_user_media_sessions(user_uuid)
    return {"reset": True, "temporary_password": temporary_password}


@app.post("/api/auth/password")
def update_own_password(request: UpdatePasswordRequest, authorization: str | None = Header(default=None)):
    user = get_session_user(authorization)
    password = request.password
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")

    raw_token = extract_session_token(authorization)
    current_token_hash = hash_session_token(raw_token)
    salt, password_hash = hash_password(password)
    with get_db_connection() as conn:
        conn.execute(
            "UPDATE users SET password_hash = ?, salt = ?, password_reset_required = 0 WHERE user_uuid = ?",
            (password_hash, salt, user["user_uuid"]),
        )
        conn.execute(
            "DELETE FROM auth_sessions WHERE user_uuid = ? AND token_hash != ?",
            (user["user_uuid"], current_token_hash),
        )
        updated = conn.execute(
            "SELECT username, user_uuid, display_name, role, active, password_reset_required, created_at, last_login_at FROM users WHERE user_uuid = ?",
            (user["user_uuid"],),
        ).fetchone()
        conn.commit()

    user_data = public_user(updated)
    remove_cached_user_sessions(user["user_uuid"], current_token_hash)
    remove_user_media_sessions(user["user_uuid"])
    with sessions_lock:
        if current_token_hash in sessions:
            sessions[current_token_hash]["user"] = user_data
    return {"user": user_data}


@app.get("/api/confluence-settings")
def get_confluence_settings(authorization: str | None = Header(default=None)):
    user = get_session_user(authorization)
    with get_db_connection() as conn:
        row = conn.execute(
            """
            SELECT setting_uuid, page_url, enabled, created_at, updated_at,
                   last_tested_at, last_test_status
            FROM confluence_settings
            WHERE user_uuid = ?
            """,
            (user["user_uuid"],),
        ).fetchone()

    if not row:
        return {
            "setting": None,
            "is_connected": False,
            "last_test_status": None,
        }

    setting = dict(row)
    setting["enabled"] = bool(setting.get("enabled"))
    return {
        "setting": setting,
        "is_connected": setting.get("last_test_status") == "success",
        "last_test_status": setting.get("last_test_status"),
    }


def parse_confluence_page_url(page_url: str):
    parsed = urlparse(page_url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Confluence 저장 페이지 URL을 확인하세요.")

    path_parts = [part for part in parsed.path.split("/") if part]
    page_id = ""
    if "pages" in path_parts:
        index = path_parts.index("pages")
        if index + 1 < len(path_parts) and path_parts[index + 1].isdigit():
            page_id = path_parts[index + 1]

    if not page_id:
        query_page_id = parse_qs(parsed.query).get("pageId", [""])[0]
        if query_page_id.isdigit():
            page_id = query_page_id

    if not page_id:
        raise HTTPException(status_code=400, detail="Confluence 페이지 ID를 URL에서 찾지 못했습니다.")

    return f"{parsed.scheme}://{parsed.netloc}", page_id


def test_confluence_page_with_token(page_url: str, token: str):
    base_url, page_id = parse_confluence_page_url(page_url)
    api_url = f"{base_url}/rest/api/content/{page_id}?expand=space,version"
    req = urllib_request.Request(
        api_url,
        headers={
            "Authorization": f"Bearer {token.strip()}",
            "Accept": "application/json",
            "User-Agent": "WIAMeet/1.0",
        },
        method="GET",
    )
    try:
        with urllib_request.urlopen(req, timeout=12) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib_error.HTTPError as exc:
        if exc.code in {401, 403}:
            raise HTTPException(status_code=400, detail="Token 인증에 실패했습니다. Token 권한을 확인하세요.") from exc
        if exc.code == 404:
            raise HTTPException(status_code=400, detail="저장 페이지를 찾지 못했거나 접근 권한이 없습니다.") from exc
        raise HTTPException(status_code=400, detail=f"Confluence 연결 테스트 실패: HTTP {exc.code}") from exc
    except urllib_error.URLError as exc:
        raise HTTPException(status_code=400, detail=f"Confluence 서버에 연결하지 못했습니다: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Confluence 응답을 해석하지 못했습니다.") from exc

    if str(payload.get("id")) != page_id or payload.get("type") != "page":
        raise HTTPException(status_code=400, detail="입력한 URL이 Confluence 페이지인지 확인하지 못했습니다.")

    return {
        "base_url": base_url,
        "page_id": page_id,
        "page_title": payload.get("title") or "",
        "space_key": (payload.get("space") or {}).get("key") or "",
    }


@app.post("/api/confluence-settings/test-token")
def test_confluence_token_settings(payload: ConfluenceTokenTestRequest, authorization: str | None = Header(default=None)):
    user = get_session_user(authorization)
    page_url = payload.page_url.strip()
    token = payload.token.strip()
    if not page_url:
        raise HTTPException(status_code=400, detail="회의록 저장 페이지 URL을 입력하세요.")
    if not token:
        raise HTTPException(status_code=400, detail="Token을 입력하세요.")

    test_result = test_confluence_page_with_token(page_url, token)
    now = datetime.now(KST).isoformat(timespec="seconds")
    with get_db_connection() as conn:
        existing = conn.execute(
            "SELECT setting_uuid FROM confluence_settings WHERE user_uuid = ?",
            (user["user_uuid"],),
        ).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE confluence_settings
                SET page_url = ?, token_encrypted = ?, enabled = 1, updated_at = ?,
                    last_tested_at = ?, last_test_status = 'success'
                WHERE user_uuid = ?
                """,
                (page_url, encrypt_confluence_token(token), now, now, user["user_uuid"]),
            )
            setting_uuid = existing["setting_uuid"]
        else:
            setting_uuid = uuid.uuid4().hex
            conn.execute(
                """
                INSERT INTO confluence_settings (
                    setting_uuid, user_uuid, page_url, token_encrypted,
                    enabled, created_at, updated_at, last_tested_at, last_test_status
                ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'success')
                """,
                (setting_uuid, user["user_uuid"], page_url, encrypt_confluence_token(token), now, now, now),
            )
        conn.commit()

    return {
        "ok": True,
        "setting_uuid": setting_uuid,
        "page_url": page_url,
        "page_id": test_result["page_id"],
        "page_title": test_result["page_title"],
        "space_key": test_result["space_key"],
        "last_tested_at": now,
    }


@app.post("/api/confluence-settings/retest")
def retest_confluence_settings(authorization: str | None = Header(default=None)):
    user = get_session_user(authorization)
    with get_db_connection() as conn:
        row = conn.execute(
            """
            SELECT setting_uuid, page_url, token_encrypted
            FROM confluence_settings
            WHERE user_uuid = ?
            """,
            (user["user_uuid"],),
        ).fetchone()

    if not row or not row["page_url"] or not row["token_encrypted"]:
        raise HTTPException(status_code=400, detail="저장된 Confluence 연동 정보가 없습니다.")

    now = datetime.now(KST).isoformat(timespec="seconds")
    try:
        test_result = test_confluence_page_with_token(row["page_url"], decrypt_confluence_token(row["token_encrypted"]))
    except HTTPException:
        with get_db_connection() as conn:
            conn.execute(
                """
                UPDATE confluence_settings
                SET updated_at = ?, last_tested_at = ?, last_test_status = 'failed'
                WHERE user_uuid = ?
                """,
                (now, now, user["user_uuid"]),
            )
            conn.commit()
        raise

    with get_db_connection() as conn:
        conn.execute(
            """
            UPDATE confluence_settings
            SET enabled = 1, updated_at = ?, last_tested_at = ?, last_test_status = 'success'
            WHERE user_uuid = ?
            """,
            (now, now, user["user_uuid"]),
        )
        conn.commit()

    return {
        "ok": True,
        "setting_uuid": row["setting_uuid"],
        "page_url": row["page_url"],
        "page_id": test_result["page_id"],
        "page_title": test_result["page_title"],
        "space_key": test_result["space_key"],
        "last_tested_at": now,
    }


@app.delete("/api/confluence-settings")
def disconnect_confluence_settings(authorization: str | None = Header(default=None)):
    user = get_session_user(authorization)
    with get_db_connection() as conn:
        conn.execute("DELETE FROM confluence_settings WHERE user_uuid = ?", (user["user_uuid"],))
        conn.commit()
    return {"ok": True}


@app.get("/api/members")
def list_members(authorization: str | None = Header(default=None)):
    user = get_session_user(authorization)
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT member_uuid, member_name, sort_order, created_at
            FROM users_member
            WHERE user_uuid = ?
            ORDER BY sort_order ASC, created_at ASC
            """,
            (user["user_uuid"],),
        ).fetchall()
    return {"members": [dict(row) for row in rows]}


@app.post("/api/members")
def create_member(request: CreateMemberRequest, authorization: str | None = Header(default=None)):
    user = get_session_user(authorization)
    member_name = request.member_name.strip()
    if not member_name:
        raise HTTPException(status_code=400, detail="Member name is required.")
    with get_db_connection() as conn:
        next_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM users_member WHERE user_uuid = ?",
            (user["user_uuid"],),
        ).fetchone()[0]
        member_uuid = uuid.uuid4().hex
        conn.execute(
            """
            INSERT INTO users_member (user_uuid, member_uuid, member_name, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user["user_uuid"], member_uuid, member_name, next_order, datetime.now(KST).isoformat()),
        )
        conn.commit()
        row = conn.execute(
            "SELECT member_uuid, member_name, sort_order, created_at FROM users_member WHERE member_uuid = ?",
            (member_uuid,),
        ).fetchone()
    return {"member": dict(row)}


@app.post("/api/members/reorder")
def reorder_members(request: ReorderMembersRequest, authorization: str | None = Header(default=None)):
    user = get_session_user(authorization)
    with get_db_connection() as conn:
        owned = {
            row[0]
            for row in conn.execute(
                "SELECT member_uuid FROM users_member WHERE user_uuid = ?",
                (user["user_uuid"],),
            ).fetchall()
        }
        if set(request.member_uuids) != owned:
            raise HTTPException(status_code=400, detail="Member order does not match current members.")
        for index, member_uuid in enumerate(request.member_uuids):
            conn.execute(
                "UPDATE users_member SET sort_order = ? WHERE user_uuid = ? AND member_uuid = ?",
                (index, user["user_uuid"], member_uuid),
            )
        conn.commit()
    return {"updated": True}


@app.delete("/api/members/{member_uuid}")
def delete_member(member_uuid: str, authorization: str | None = Header(default=None)):
    user = get_session_user(authorization)
    with get_db_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM users_member WHERE user_uuid = ? AND member_uuid = ?",
            (user["user_uuid"], member_uuid),
        )
        conn.commit()
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Member not found.")
    return {"deleted": True}


@app.get("/api/categories")
def list_categories(authorization: str | None = Header(default=None)):
    user = get_session_user(authorization)
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT category_uuid, category_name, sort_order, created_at
            FROM users_category
            WHERE user_uuid = ?
            ORDER BY sort_order ASC, created_at ASC
            """,
            (user["user_uuid"],),
        ).fetchall()
    return {"categories": [dict(row) for row in rows]}


@app.post("/api/categories")
def create_category(request: CreateCategoryRequest, authorization: str | None = Header(default=None)):
    user = get_session_user(authorization)
    category_name = request.category_name.strip()
    if not category_name:
        raise HTTPException(status_code=400, detail="Category name is required.")
    with get_db_connection() as conn:
        next_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM users_category WHERE user_uuid = ?",
            (user["user_uuid"],),
        ).fetchone()[0]
        category_uuid = uuid.uuid4().hex
        conn.execute(
            """
            INSERT INTO users_category (category_uuid, user_uuid, category_name, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (category_uuid, user["user_uuid"], category_name, next_order, datetime.now(KST).isoformat()),
        )
        conn.commit()
        row = conn.execute(
            "SELECT category_uuid, category_name, sort_order, created_at FROM users_category WHERE category_uuid = ?",
            (category_uuid,),
        ).fetchone()
    return {"category": dict(row)}


@app.post("/api/categories/reorder")
def reorder_categories(request: ReorderCategoriesRequest, authorization: str | None = Header(default=None)):
    user = get_session_user(authorization)
    with get_db_connection() as conn:
        owned = {
            row[0]
            for row in conn.execute(
                "SELECT category_uuid FROM users_category WHERE user_uuid = ?",
                (user["user_uuid"],),
            ).fetchall()
        }
        if set(request.category_uuids) != owned:
            raise HTTPException(status_code=400, detail="Category order does not match current categories.")
        for index, category_uuid in enumerate(request.category_uuids):
            conn.execute(
                "UPDATE users_category SET sort_order = ? WHERE user_uuid = ? AND category_uuid = ?",
                (index, user["user_uuid"], category_uuid),
            )
        conn.commit()
    return {"updated": True}


@app.delete("/api/categories/{category_uuid}")
def delete_category(category_uuid: str, authorization: str | None = Header(default=None)):
    user = get_session_user(authorization)
    with get_db_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM users_category WHERE user_uuid = ? AND category_uuid = ?",
            (user["user_uuid"], category_uuid),
        )
        conn.commit()
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Category not found.")
    return {"deleted": True}


@app.get("/api/recording-drafts")
def list_recording_drafts(authorization: str | None = Header(default=None)):
    user = get_session_user(authorization)
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT draft_uuid, title, storage_path, duration_seconds, created_at
            FROM recording_drafts
            WHERE user_id = ?
            ORDER BY created_at DESC
            """,
            (user["user_uuid"],),
        ).fetchall()
    return {
        "drafts": [
            {
                "draft_uuid": row["draft_uuid"],
                "title": row["title"],
                "duration_seconds": row["duration_seconds"],
                "created_at": row["created_at"],
                "available": Path(row["storage_path"]).exists(),
            }
            for row in rows
        ]
    }


def enforce_request_size(content_length: int | None):
    maximum_bytes = settings.upload.request_max_mb * MB
    if content_length is not None and content_length > maximum_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"전체 업로드 크기는 {settings.upload.request_max_mb}MB를 초과할 수 없습니다.",
            headers={"X-WIAMeet-Error-Code": "REQUEST_TOO_LARGE"},
        )


def upload_policy_http_error(exc: UploadPolicyError):
    return HTTPException(
        status_code=exc.status_code,
        detail=exc.message,
        headers={"X-WIAMeet-Error-Code": exc.code},
    )


def reserve_user_job(job_id: str, user: dict):
    with jobs_lock:
        unfinished_count = sum(
            1
            for job in jobs.values()
            if job.get("created_by_user_uuid") == user["user_uuid"]
            and job.get("status") in {"queued", "running"}
        )
        if unfinished_count >= MAX_UNFINISHED_JOBS_PER_USER:
            raise HTTPException(
                status_code=429,
                detail=(
                    f"사용자당 미완료 작업은 최대 "
                    f"{MAX_UNFINISHED_JOBS_PER_USER}건까지 허용됩니다."
                ),
                headers={"X-WIAMeet-Error-Code": "USER_JOB_LIMIT_EXCEEDED"},
            )
        jobs[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "stage": "upload_validation",
            "progress": 0,
            "message": "업로드 파일을 검사하고 있습니다.",
            "logs": [],
            "created_by_user_uuid": user["user_uuid"],
            "created_by_username": user.get("username", ""),
        }


@app.post("/api/recording-drafts")
def create_recording_draft(
    audio: UploadFile = File(...),
    title: str = Form(""),
    duration_seconds: int = Form(0),
    authorization: str | None = Header(default=None),
    content_length: int | None = Header(default=None, alias="Content-Length"),
):
    user = get_session_user(authorization)
    enforce_request_size(content_length)
    clean_title = title.strip()
    if not clean_title:
        clean_title = "임시 녹음 " + datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    if not audio.filename:
        raise HTTPException(status_code=400, detail="No audio file uploaded.")

    draft_uuid = uuid.uuid4().hex
    draft_dir = BACKEND_WORKSPACE_ROOT / draft_uuid
    storage_path = None
    try:
        extension = validate_audio_extension(Path(audio.filename).name)
        draft_dir.mkdir(parents=True, exist_ok=True)
        storage_path = draft_dir / f"draft{extension}"
        budget = RequestBudget(settings.upload.request_max_mb * MB)
        copy_upload_limited(
            audio,
            storage_path,
            settings.upload.audio.max_size_mb * MB,
            budget,
            "AUDIO_TOO_LARGE",
            f"오디오 파일은 최대 {settings.upload.audio.max_size_mb}MB까지 업로드할 수 있습니다.",
        )
        actual_duration = inspect_audio(storage_path, extension)
    except UploadPolicyError as exc:
        shutil.rmtree(draft_dir, ignore_errors=True)
        raise upload_policy_http_error(exc) from exc
    except Exception:
        shutil.rmtree(draft_dir, ignore_errors=True)
        raise

    now = datetime.now(KST).isoformat()
    try:
        with get_db_connection() as conn:
            conn.execute(
                """
                INSERT INTO recording_drafts (
                    draft_uuid, user_id, title, storage_path, duration_seconds, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    draft_uuid,
                    user["user_uuid"],
                    clean_title,
                    str(storage_path),
                    max(0, round(actual_duration)),
                    now,
                ),
            )
            conn.commit()
    except Exception:
        shutil.rmtree(draft_dir, ignore_errors=True)
        raise

    return {
        "draft": {
            "draft_uuid": draft_uuid,
            "title": clean_title,
            "duration_seconds": max(0, round(actual_duration)),
            "created_at": now,
        }
    }


@app.get("/api/recording-drafts/{draft_uuid}/audio")
def get_recording_draft_audio(
    draft_uuid: str,
    authorization: str | None = Header(default=None),
    media_session: str | None = Cookie(default=None, alias=MEDIA_SESSION_COOKIE),
):
    user_uuid = get_media_user_uuid(authorization, media_session)
    with get_db_connection() as conn:
        row = conn.execute(
            """
            SELECT title, storage_path
            FROM recording_drafts
            WHERE draft_uuid = ? AND user_id = ?
            """,
            (draft_uuid, user_uuid),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Recording draft not found.")
    path = Path(row["storage_path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="Recording draft file not found.")
    filename = f"{row['title']}{path.suffix or '.webm'}"
    return FileResponse(path, filename=filename)


@app.post("/api/jobs", response_model=JobStatus)
def create_job(
    audio: UploadFile = File(...),
    references: list[UploadFile] | None = File(default=None),
    authorization: str | None = Header(default=None),
    content_length: int | None = Header(default=None, alias="Content-Length"),
    meeting_title: str = Form(""),
    meeting_date: str = Form(""),
    meeting_start_time: str = Form(""),
    meeting_end_time: str = Form(""),
    meeting_organizations: str = Form(""),
    participants: str = Form(""),
    meeting_purpose: str = Form(""),
    meeting_category_uuid: str = Form(""),
    meeting_category_name: str = Form(""),
    meeting_reference_text: str = Form(""),
):
    enforce_request_size(content_length)
    if not audio.filename:
        raise HTTPException(status_code=400, detail="No audio file uploaded.")
    if not meeting_title.strip():
        raise HTTPException(status_code=400, detail="Meeting title is required.")
    if not meeting_purpose.strip():
        raise HTTPException(status_code=400, detail="Meeting purpose is required.")
    if not meeting_category_uuid.strip() or not meeting_category_name.strip():
        raise HTTPException(status_code=400, detail="Meeting category is required.")
    if not meeting_date.strip():
        raise HTTPException(status_code=400, detail="Meeting date is required.")
    if not meeting_start_time.strip():
        raise HTTPException(status_code=400, detail="Meeting start time is required.")
    if not meeting_end_time.strip():
        raise HTTPException(status_code=400, detail="Meeting end time is required.")

    organizations = parse_participants(meeting_organizations)
    participant_list = parse_participants(participants)
    if not organizations:
        raise HTTPException(status_code=400, detail="At least one meeting organization is required.")
    if not participant_list:
        raise HTTPException(status_code=400, detail="At least one participant is required.")

    reference_uploads = [item for item in (references or []) if item.filename]
    if len(reference_uploads) > settings.upload.references.max_files:
        raise HTTPException(
            status_code=400,
            detail=f"참고자료는 최대 {settings.upload.references.max_files}개까지 첨부할 수 있습니다.",
            headers={"X-WIAMeet-Error-Code": "TOO_MANY_REFERENCES"},
        )

    current_user = get_session_user(authorization)
    job_id = uuid.uuid4().hex
    reserve_user_job(job_id, current_user)

    output_dir = WORK_ROOT / job_id
    persist_dir = JOB_ROOT / job_id
    audio_dir = output_dir / "audio"
    meta_dir = output_dir / "meta"
    report_dir = output_dir / "report"
    references_dir = output_dir / "references"

    try:
        audio_extension = validate_audio_extension(Path(audio.filename).name)
        for directory in (audio_dir, meta_dir, report_dir, references_dir):
            directory.mkdir(parents=True, exist_ok=True)

        budget = RequestBudget(settings.upload.request_max_mb * MB)
        audio_path = audio_dir / f"source{audio_extension}"
        copy_upload_limited(
            audio,
            audio_path,
            settings.upload.audio.max_size_mb * MB,
            budget,
            "AUDIO_TOO_LARGE",
            f"오디오 파일은 최대 {settings.upload.audio.max_size_mb}MB까지 업로드할 수 있습니다.",
        )
        audio_duration_seconds = inspect_audio(audio_path, audio_extension)

        reference_text_parts = []
        reference_total_bytes = 0
        seen_reference_names = set()
        for reference in reference_uploads:
            reference_name = Path(reference.filename).name
            if reference_name in seen_reference_names:
                raise UploadPolicyError(
                    "DUPLICATE_REFERENCE_NAME",
                    f"같은 이름의 참고자료를 중복 첨부할 수 없습니다: {reference_name}",
                )
            seen_reference_names.add(reference_name)
            reference_extension = validate_reference_extension(reference_name)
            reference_path = references_dir / reference_name
            reference_size = copy_upload_limited(
                reference,
                reference_path,
                settings.upload.references.max_file_size_mb * MB,
                budget,
                "REFERENCE_TOO_LARGE",
                f"참고자료 한 개는 최대 {settings.upload.references.max_file_size_mb}MB까지 첨부할 수 있습니다.",
            )
            reference_total_bytes += reference_size
            if reference_total_bytes > settings.upload.references.max_total_size_mb * MB:
                raise UploadPolicyError(
                    "REFERENCES_TOO_LARGE",
                    f"참고자료 전체 크기는 {settings.upload.references.max_total_size_mb}MB를 초과할 수 없습니다.",
                    413,
                )
            validate_reference_file(reference_path, reference_extension)
            try:
                extracted_text = read_text(reference_path)
            except UploadPolicyError:
                raise
            except Exception as exc:
                raise UploadPolicyError(
                    "REFERENCE_EXTRACTION_FAILED",
                    f"{reference_name} 참고자료에서 텍스트를 추출하지 못했습니다: {exc}",
                ) from exc
            if extracted_text.strip():
                reference_text_parts.append(
                    f"[Reference: {reference_name}]\n{extracted_text.strip()}"
                )

        extracted_reference_text = "\n\n".join(reference_text_parts).strip()
        combined_reference_text = "\n\n".join(
            item.strip()
            for item in (meeting_reference_text, extracted_reference_text)
            if item and item.strip()
        )
        meeting_metadata = {
            "title": meeting_title.strip(),
            "purpose": meeting_purpose.strip(),
            "date": meeting_date.strip(),
            "start_time": meeting_start_time.strip(),
            "end_time": meeting_end_time.strip(),
            "organizations": organizations,
            "participants": participant_list,
            "category_uuid": meeting_category_uuid.strip(),
            "category_name": meeting_category_name.strip(),
            "audio_duration_seconds": round(audio_duration_seconds, 1),
        }
        write_json_artifact(meta_dir / "meeting_metadata.json", meeting_metadata)

        with jobs_lock:
            jobs[job_id] = {
                "job_id": job_id,
                "status": "queued",
                "stage": "queued",
                "progress": 0,
                "message": "작업 대기 중입니다.",
                "logs": [],
                "audio_path": str(audio_path),
                "source_audio_path": str(audio_path),
                "output_dir": str(output_dir),
                "persist_dir": str(persist_dir),
                "meta_dir": str(meta_dir),
                "report_dir": str(report_dir),
                "references_dir": str(references_dir),
                "result": None,
                "speaker_mapping": {},
                "speaker_matches": {"matches": []},
                "stt_corrections": {"corrections": []},
                "original_result": None,
                "refined_result": None,
                "participants": participant_list,
                "meeting_metadata": meeting_metadata,
                "created_by_user_uuid": current_user["user_uuid"],
                "created_by_username": current_user.get("username", ""),
                "meeting_purpose": meeting_purpose,
                "meeting_reference_text": combined_reference_text,
                "meeting_report": "",
                "report_finalized": False,
                "report_status": "idle",
                "report_error": "",
                "report_instruction": "",
                "persisted": False,
                "created_at": datetime.now(KST).isoformat(),
            }

        persist_job(job_id)
        if not admit_pipeline_job(job_id):
            raise UploadPolicyError(
                "QUEUE_CAPACITY_EXCEEDED",
                "현재 분석 대기열이 가득 찼습니다. 잠시 후 다시 시도하세요.",
                429,
            )
    except UploadPolicyError as exc:
        logger.warning(
            "job upload rejected user_uuid=%s job_id=%s audio_extension=%s code=%s message=%s",
            current_user["user_uuid"],
            job_id,
            Path(audio.filename or "").suffix.lower() or "none",
            exc.code,
            exc.message,
        )
        with jobs_lock:
            jobs.pop(job_id, None)
            active_job_ids.discard(job_id)
            try:
                pending_job_ids.remove(job_id)
            except ValueError:
                pass
        delete_processing_job(job_id)
        shutil.rmtree(output_dir, ignore_errors=True)
        raise upload_policy_http_error(exc) from exc
    except Exception:
        with jobs_lock:
            jobs.pop(job_id, None)
            active_job_ids.discard(job_id)
            try:
                pending_job_ids.remove(job_id)
            except ValueError:
                pass
        delete_processing_job(job_id)
        shutil.rmtree(output_dir, ignore_errors=True)
        raise

    return get_job(job_id, authorization)


@app.get("/api/jobs/{job_id}", response_model=JobStatus)
def get_job(job_id: str, authorization: str | None = Header(default=None)):
    require_job_owner(job_id, authorization)
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        return JobStatus(
            job_id=job_id,
            status=job["status"],
            stage=job["stage"],
            progress=job["progress"],
            message=job["message"],
            logs=job.get("logs", []),
        )


@app.get("/api/jobs/{job_id}/result")
def get_result(job_id: str, authorization: str | None = Header(default=None)):
    require_job_owner(job_id, authorization)
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        if job["status"] != "completed" or not job.get("result"):
            raise HTTPException(status_code=409, detail="Job is not completed.")
        return {
            "job_id": job_id,
            "result": job["result"],
            "original_result": job.get("original_result"),
            "refined_result": job.get("refined_result"),
            "speaker_mapping": job.get("speaker_mapping", {}),
            "speaker_matches": job.get("speaker_matches", {"matches": []}),
            "stt_corrections": job.get("stt_corrections", {"corrections": []}),
            "meeting_metadata": job.get("meeting_metadata", {}),
        }


@app.get("/api/jobs/{job_id}/stt-corrections")
def get_stt_corrections(job_id: str, authorization: str | None = Header(default=None)):
    require_job_owner(job_id, authorization)
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        return job.get("stt_corrections", {"corrections": []})


@app.get("/api/jobs/{job_id}/speaker-matches")
def get_speaker_matches(job_id: str, authorization: str | None = Header(default=None)):
    require_job_owner(job_id, authorization)
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        return job.get("speaker_matches", {"matches": []})


@app.get("/api/jobs/{job_id}/refined-result")
def get_refined_result(job_id: str, authorization: str | None = Header(default=None)):
    require_job_owner(job_id, authorization)
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        refined_result = job.get("refined_result")
        if refined_result is None:
            raise HTTPException(status_code=409, detail="Refined result is not ready.")
        return {"job_id": job_id, "sentences": refined_result}


@app.post("/api/jobs/{job_id}/speaker-map")
def update_speaker_mapping(
    job_id: str,
    request: SpeakerMappingRequest,
    authorization: str | None = Header(default=None),
):
    require_job_owner(job_id, authorization)
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        result = job.get("result")
        output_dir = Path(job.get("meta_dir", job["output_dir"]))
        speaker_matches = job.get("speaker_matches", {"matches": []})

    if not result:
        raise HTTPException(status_code=409, detail="Job has no completed result.")

    base_result = {**result, "sentences": request.sentences} if request.sentences is not None else result
    mapped_sentences, updated_matches = apply_speaker_mapping(
        base_result,
        request.mapping,
        output_dir,
        speaker_matches,
    )
    write_json_artifact(output_dir / "result.json", base_result)
    set_job(
        job_id,
        result=base_result,
        speaker_mapping=request.mapping,
        speaker_matches=updated_matches,
        refined_result=mapped_sentences,
    )

    return {"job_id": job_id, "sentences": mapped_sentences, "speaker_matches": updated_matches}


def run_report_job(job_id: str, special_instruction: str):
    set_job(job_id, report_status="running", report_error="")
    with jobs_lock:
        job = dict(jobs.get(job_id, {}))
    try:
        sentences = job.get("refined_result")
        if not sentences:
            raise RuntimeError("화자 매핑 결과를 찾지 못했습니다.")
        transcript_text = format_transcript(sentences)
        if not transcript_text:
            raise RuntimeError("회의 발화 내용이 없습니다.")
        prompt = build_prompt(transcript_text, special_instruction)
        report_markdown = generate_report(
            prompt,
            context={"job_id": job_id, "stage": "report_generation"},
        ).strip()
        output_dir = Path(job.get("report_dir", job["output_dir"]))
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "meeting_report.md").write_text(
            report_markdown + "\n", encoding="utf-8"
        )
        set_job(
            job_id,
            meeting_report=report_markdown,
            report_finalized=False,
            report_status="completed",
            report_error="",
        )
    except Exception as exc:
        set_job(job_id, report_status="failed", report_error=str(exc))


@app.post("/api/jobs/{job_id}/report", status_code=202)
def create_report(
    job_id: str,
    request: ReportRequest,
    authorization: str | None = Header(default=None),
):
    require_job_owner(job_id, authorization)
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        if not job.get("refined_result"):
            raise HTTPException(status_code=409, detail="Speaker mapping result is not ready.")
        if job.get("report_status") in {"queued", "running"}:
            return {"job_id": job_id, "status": job["report_status"]}
        job["report_status"] = "queued"
        job["report_error"] = ""
        job["report_instruction"] = request.special_instruction
    persist_job(job_id)
    llm_executor.submit(run_report_job, job_id, request.special_instruction)
    return {"job_id": job_id, "status": "queued"}


@app.get("/api/jobs/{job_id}/report")
def get_report_status(job_id: str, authorization: str | None = Header(default=None)):
    require_job_owner(job_id, authorization)
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        return {
            "job_id": job_id,
            "status": job.get("report_status", "idle"),
            "report_markdown": job.get("meeting_report", ""),
            "error": job.get("report_error", ""),
        }


@app.post("/api/jobs/{job_id}/report/finalize")
def finalize_report(
    job_id: str,
    request: ReportFinalizeRequest,
    authorization: str | None = Header(default=None),
):
    require_job_owner(job_id, authorization)
    report_markdown = request.report_markdown.strip()
    if not report_markdown:
        raise HTTPException(status_code=400, detail="Report markdown is required.")

    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        output_dir = Path(job.get("report_dir", job["output_dir"]))

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "meeting_report.md").write_text(report_markdown + "\n", encoding="utf-8")

    with jobs_lock:
        job = jobs[job_id]
        job["meeting_report"] = report_markdown
        job["report_finalized"] = True

    persist_job(job_id)
    return {"job_id": job_id, "report_markdown": report_markdown, "finalized": True}


@app.post("/api/jobs/{job_id}/complete")
def complete_job(job_id: str, authorization: str | None = Header(default=None)):
    require_job_owner(job_id, authorization)
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        if not job.get("report_finalized"):
            raise HTTPException(status_code=409, detail="Report is not finalized.")
        work_dir = Path(job["output_dir"])
        persist_dir = Path(job.get("persist_dir", JOB_ROOT / job_id))

    if not work_dir.exists():
        raise HTTPException(status_code=404, detail="Working files not found.")

    if persist_dir.exists():
        shutil.rmtree(persist_dir)
    shutil.copytree(work_dir, persist_dir)
    shutil.rmtree(work_dir)

    metadata = job.get("meeting_metadata", {})
    user_uuid = job.get("created_by_user_uuid")
    if not user_uuid:
        raise HTTPException(status_code=409, detail="Job has no owner user.")
    with get_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO meeting_reports (
                report_uuid, job_id, user_uuid, title, purpose, meeting_date, start_time, end_time,
                organizations_json, participants_json, category_uuid, category_name, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(job_id) DO UPDATE SET
                user_uuid = excluded.user_uuid,
                title = excluded.title,
                purpose = excluded.purpose,
                meeting_date = excluded.meeting_date,
                start_time = excluded.start_time,
                end_time = excluded.end_time,
                organizations_json = excluded.organizations_json,
                participants_json = excluded.participants_json,
                category_uuid = excluded.category_uuid,
                category_name = excluded.category_name
            """,
            (
                uuid.uuid4().hex,
                job_id,
                user_uuid,
                metadata.get("title", ""),
                metadata.get("purpose", ""),
                metadata.get("date", ""),
                metadata.get("start_time", ""),
                metadata.get("end_time", ""),
                json.dumps(metadata.get("organizations", []), ensure_ascii=False),
                json.dumps(metadata.get("participants", []), ensure_ascii=False),
                metadata.get("category_uuid", ""),
                metadata.get("category_name", ""),
                datetime.now(KST).isoformat(),
            ),
        )
        conn.commit()

    with jobs_lock:
        job = jobs[job_id]
        job["persisted"] = True
        job["persist_dir"] = str(persist_dir)
        job["work_dir_deleted"] = True
    delete_processing_job(job_id)

    return {"job_id": job_id, "persisted": True}


@app.get("/api/reports")
def list_meeting_reports(authorization: str | None = Header(default=None)):
    user = get_session_user(authorization)
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT report_uuid, job_id, user_uuid, title, purpose, meeting_date, start_time, end_time,
                   organizations_json, participants_json, category_uuid, category_name, created_at
            FROM meeting_reports
            WHERE user_uuid = ?
            ORDER BY meeting_date DESC, created_at ASC
            """,
            (user["user_uuid"],),
        ).fetchall()

    reports = []
    for row in rows:
        item = dict(row)
        item["organizations"] = json.loads(item.pop("organizations_json") or "[]")
        item["participants"] = json.loads(item.pop("participants_json") or "[]")
        item["has_audio"] = any((JOB_ROOT / item["job_id"] / "audio").glob("audio.*"))
        item["has_report"] = (JOB_ROOT / item["job_id"] / "report" / "meeting_report.md").exists()
        reports.append(item)
    return {"reports": reports}


@app.delete("/api/reports/{job_id}")
def delete_meeting_report(job_id: str, authorization: str | None = Header(default=None)):
    user = get_session_user(authorization)
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT job_id FROM meeting_reports WHERE job_id = ? AND user_uuid = ?",
            (job_id, user["user_uuid"]),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Report not found.")
        conn.execute(
            "DELETE FROM meeting_reports WHERE job_id = ? AND user_uuid = ?",
            (job_id, user["user_uuid"]),
        )
        conn.commit()

    shutil.rmtree(JOB_ROOT / job_id, ignore_errors=True)
    shutil.rmtree(WORK_ROOT / job_id, ignore_errors=True)
    with jobs_lock:
        jobs.pop(job_id, None)
        active_job_ids.discard(job_id)
        try:
            pending_job_ids.remove(job_id)
        except ValueError:
            pass
    delete_processing_job(job_id)
    return {"deleted": True}


@app.get("/api/reports/{job_id}")
def get_meeting_report_detail(job_id: str, authorization: str | None = Header(default=None)):
    user = get_session_user(authorization)
    with get_db_connection() as conn:
        row = conn.execute(
            """
            SELECT report_uuid, job_id, user_uuid, title, purpose, meeting_date, start_time, end_time,
                   organizations_json, participants_json, category_uuid, category_name, created_at
            FROM meeting_reports
            WHERE job_id = ? AND user_uuid = ?
            """,
            (job_id, user["user_uuid"]),
        ).fetchone()
        confluence_setting = conn.execute(
            """
            SELECT setting_uuid, page_url, token_encrypted, last_test_status
            FROM confluence_settings
            WHERE user_uuid = ?
            """,
            (user["user_uuid"],),
        ).fetchone()
        confluence_publish = conn.execute(
            """
            SELECT publish_uuid, confluence_page_id, confluence_page_url, confluence_page_title,
                   parent_page_url, published_at
            FROM confluence_published_reports
            WHERE job_id = ? AND user_uuid = ?
            """,
            (job_id, user["user_uuid"]),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found.")

    report_path = JOB_ROOT / job_id / "report" / "meeting_report.md"
    metadata_path = JOB_ROOT / job_id / "meta" / "meeting_metadata.json"
    refined_path = JOB_ROOT / job_id / "meta" / "refined_result.json"
    audio_files = sorted((JOB_ROOT / job_id / "audio").glob("audio.*"))
    reference_files = sorted(
        file for file in (JOB_ROOT / job_id / "references").glob("*")
        if file.is_file()
    )

    report_markdown = report_path.read_text(encoding="utf-8") if report_path.exists() else ""
    metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else {}
    refined = json.loads(refined_path.read_text(encoding="utf-8")) if refined_path.exists() else []
    if isinstance(refined, dict):
        recap_items = refined.get("sentences", [])
    else:
        recap_items = refined

    detail = dict(row)
    detail["organizations"] = json.loads(detail.pop("organizations_json") or "[]")
    detail["participants"] = json.loads(detail.pop("participants_json") or "[]")
    detail["metadata"] = metadata
    detail["report_markdown"] = report_markdown
    detail["recap"] = recap_items
    detail["has_audio"] = bool(audio_files)
    detail["references"] = [
        {"filename": file.name, "size": file.stat().st_size}
        for file in reference_files
    ]
    detail["has_references"] = bool(reference_files)
    detail["confluence"] = {
        "can_publish": bool(
            confluence_setting
            and confluence_setting["page_url"]
            and confluence_setting["token_encrypted"]
            and confluence_setting["last_test_status"] == "success"
        ),
        "requires_auth": not bool(
            confluence_setting
            and confluence_setting["page_url"]
            and confluence_setting["token_encrypted"]
            and confluence_setting["last_test_status"] == "success"
        ),
        "published": dict(confluence_publish) if confluence_publish else None,
    }
    return detail


@app.post("/api/reports/{job_id}/confluence/publish")
def publish_meeting_report_to_confluence(job_id: str, authorization: str | None = Header(default=None)):
    user = get_session_user(authorization)
    with get_db_connection() as conn:
        row = conn.execute(
            """
            SELECT report_uuid, job_id, user_uuid, title, purpose, meeting_date, start_time, end_time,
                   organizations_json, participants_json, category_uuid, category_name
            FROM meeting_reports
            WHERE job_id = ? AND user_uuid = ?
            """,
            (job_id, user["user_uuid"]),
        ).fetchone()
        setting = conn.execute(
            """
            SELECT page_url, token_encrypted, last_test_status
            FROM confluence_settings
            WHERE user_uuid = ?
            """,
            (user["user_uuid"],),
        ).fetchone()
        published = conn.execute(
            """
            SELECT publish_uuid, confluence_page_url, confluence_page_title, published_at
            FROM confluence_published_reports
            WHERE job_id = ? AND user_uuid = ?
            """,
            (job_id, user["user_uuid"]),
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Report not found.")
    if published:
        raise HTTPException(status_code=409, detail="이미 Confluence에 발행된 회의록입니다.")
    if not setting or not setting["page_url"] or not setting["token_encrypted"]:
        raise HTTPException(status_code=400, detail="Confluence 인증 정보가 필요합니다.")
    if setting["last_test_status"] != "success":
        raise HTTPException(status_code=400, detail="Confluence 연결 테스트를 먼저 완료하세요.")

    report_path = JOB_ROOT / job_id / "report" / "meeting_report.md"
    metadata_path = JOB_ROOT / job_id / "meta" / "meeting_metadata.json"
    if not report_path.exists():
        raise HTTPException(status_code=404, detail="회의록 마크다운 파일을 찾지 못했습니다.")

    report_markdown = report_path.read_text(encoding="utf-8")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else {}
    metadata.setdefault("title", row["title"] or "")
    metadata.setdefault("purpose", row["purpose"] or "")
    metadata.setdefault("date", row["meeting_date"] or "")
    metadata.setdefault("start_time", row["start_time"] or "")
    metadata.setdefault("end_time", row["end_time"] or "")
    metadata.setdefault("category_name", row["category_name"] or "")
    metadata.setdefault("organizations", json.loads(row["organizations_json"] or "[]"))
    metadata.setdefault("participants", json.loads(row["participants_json"] or "[]"))

    try:
        publish_result = create_confluence_page(
            setting["page_url"],
            decrypt_confluence_token(setting["token_encrypted"]),
            metadata,
            report_markdown,
        )
    except ConfluencePublishError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    now = datetime.now(KST).isoformat(timespec="seconds")
    publish_uuid = uuid.uuid4().hex
    with get_db_connection() as conn:
        try:
            conn.execute(
                """
                INSERT INTO confluence_published_reports (
                    publish_uuid, report_uuid, job_id, user_uuid, confluence_page_id,
                    confluence_page_url, confluence_page_title, parent_page_url, published_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    publish_uuid,
                    row["report_uuid"],
                    row["job_id"],
                    user["user_uuid"],
                    publish_result["confluence_page_id"],
                    publish_result["confluence_page_url"],
                    publish_result["confluence_page_title"],
                    publish_result["parent_page_url"],
                    now,
                ),
            )
            conn.commit()
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="이미 Confluence에 발행된 회의록입니다.") from exc

    return {
        "publish_uuid": publish_uuid,
        "report_uuid": row["report_uuid"],
        "job_id": row["job_id"],
        "published_at": now,
        **publish_result,
    }


@app.get("/api/reports/{job_id}/references.zip")
def download_meeting_report_references(job_id: str, authorization: str | None = Header(default=None)):
    user = get_session_user(authorization)
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT job_id, title FROM meeting_reports WHERE job_id = ? AND user_uuid = ?",
            (job_id, user["user_uuid"]),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found.")

    references_dir = JOB_ROOT / job_id / "references"
    reference_files = sorted(file for file in references_dir.glob("*") if file.is_file())
    if not reference_files:
        raise HTTPException(status_code=404, detail="Reference files not found.")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file in reference_files:
            archive.write(file, arcname=file.name)
    zip_buffer.seek(0)

    raw_filename = f"{row['title'] or 'meeting_references'}_references.zip"
    encoded_filename = quote(raw_filename)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": (
                "attachment; filename=meeting_references.zip; "
                f"filename*=UTF-8''{encoded_filename}"
            ),
        },
    )


@app.get("/api/reports/{job_id}/audio")
def get_meeting_report_audio(
    job_id: str,
    authorization: str | None = Header(default=None),
    media_session: str | None = Cookie(default=None, alias=MEDIA_SESSION_COOKIE),
):
    user_uuid = get_media_user_uuid(authorization, media_session)
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT job_id FROM meeting_reports WHERE job_id = ? AND user_uuid = ?",
            (job_id, user_uuid),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found.")

    audio_files = sorted((JOB_ROOT / job_id / "audio").glob("audio.*"))
    if not audio_files:
        raise HTTPException(status_code=404, detail="Audio file not found.")
    return FileResponse(audio_files[0], filename=audio_files[0].name)


@app.get("/api/jobs/{job_id}/download/{filename}")
def download_file(
    job_id: str,
    filename: str,
    authorization: str | None = Header(default=None),
):
    user = get_session_user(authorization)
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT 1 FROM meeting_reports WHERE job_id = ? AND user_uuid = ?",
            (job_id, user["user_uuid"]),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found.")

    path_by_filename = {
        "original_result.json": JOB_ROOT / job_id / "meta" / "original_result.json",
        "refined_result.json": JOB_ROOT / job_id / "meta" / "refined_result.json",
        "speaker_matches.json": JOB_ROOT / job_id / "meta" / "speaker_matches.json",
        "meeting_metadata.json": JOB_ROOT / job_id / "meta" / "meeting_metadata.json",
        "meeting_report.md": JOB_ROOT / job_id / "report" / "meeting_report.md",
    }
    path = path_by_filename.get(filename)
    if path is None:
        raise HTTPException(status_code=400, detail="Unsupported file.")
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found.")
    return FileResponse(path, filename=filename)
