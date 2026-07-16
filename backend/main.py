import hashlib
import io
import json
import os
import secrets
import shutil
import sqlite3
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from datetime import datetime, timedelta
from threading import Event, Lock, Thread
from zoneinfo import ZoneInfo
from typing import Literal
from urllib.parse import quote

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from .processor import apply_speaker_mapping, run_llm_postprocess, transcribe_meeting
from .read import SUPPORTED_EXTENSIONS, read_text
from .write import build_prompt, format_transcript, generate_report

BASE_DIR = Path(__file__).resolve().parent.parent
JOB_ROOT = BASE_DIR / "jobs"
WORK_ROOT = BASE_DIR / ".jobs_work"
APP_DB_PATH = BASE_DIR / "backend" / "app.db"
JOB_ROOT.mkdir(exist_ok=True)
WORK_ROOT.mkdir(exist_ok=True)
KST = ZoneInfo("Asia/Seoul")
WORK_CLEANUP_HOUR = 5
INITIAL_PASSWORD = "wia1234!"

cleanup_stop_event = Event()
cleanup_thread: Thread | None = None
sessions: dict[str, dict] = {}
sessions_lock = Lock()


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


def get_db_connection():
    conn = sqlite3.connect(APP_DB_PATH)
    conn.row_factory = sqlite3.Row
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
            token TEXT PRIMARY KEY,
            user_uuid TEXT NOT NULL,
            created_at TEXT NOT NULL,
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
    if target_table != "auth_sessions" and table_exists(conn, target_table):
        conn.execute(f"DROP TABLE {target_table}")
    create_auth_sessions_table(conn, target_table)
    if not table_exists(conn, "auth_sessions"):
        return

    columns = {row[1] for row in conn.execute("PRAGMA table_info(auth_sessions)").fetchall()}
    if target_table == "auth_sessions" and "user_id" not in columns and "user_uuid" in columns:
        return

    rows = conn.execute("SELECT * FROM auth_sessions").fetchall()
    if target_table == "auth_sessions":
        conn.execute("DROP TABLE IF EXISTS auth_sessions_new")
        create_auth_sessions_table(conn, "auth_sessions_new")
        target_table = "auth_sessions_new"
    for row in rows:
        user_uuid = None
        if "user_uuid" in row.keys():
            user_uuid = row["user_uuid"]
        elif "user_id" in row.keys():
            user_uuid = id_to_uuid.get(row["user_id"])
        if not user_uuid:
            continue
        conn.execute(
            f"INSERT OR IGNORE INTO {target_table} (token, user_uuid, created_at) VALUES (?, ?, ?)",
            (row["token"], user_uuid, row["created_at"]),
        )

    if should_replace_auth_sessions:
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


def init_app_db():
    APP_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_db_connection() as conn:
        conn.execute("PRAGMA foreign_keys = OFF")
        migrate_users_table(conn)
        migrate_auth_sessions_table(conn)
        migrate_users_member_table(conn)
        migrate_users_category_table(conn)
        migrate_meeting_reports_table(conn)
        conn.execute("PRAGMA foreign_keys = ON")

        user_count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if user_count == 0:
            default_username = os.getenv("WIAMEET_ADMIN_USERNAME", "admin")
            default_password = os.getenv("WIAMEET_ADMIN_PASSWORD", INITIAL_PASSWORD)
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


def get_session_user(authorization: str | None):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required.")
    token = authorization.removeprefix("Bearer ").strip()
    with sessions_lock:
        session = sessions.get(token)
    if session:
        return session["user"]

    with get_db_connection() as conn:
        row = conn.execute(
            """
            SELECT users.username, users.user_uuid, users.display_name, users.role,
                   users.active, users.password_reset_required, users.created_at, users.last_login_at
            FROM auth_sessions
            JOIN users ON users.user_uuid = auth_sessions.user_uuid
            WHERE auth_sessions.token = ? AND users.active = 1
            """,
            (token,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Invalid session.")

    user_data = public_user(row)
    with sessions_lock:
        sessions[token] = {
            "user": user_data,
            "created_at": datetime.now(KST).isoformat(),
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


def clear_work_root():
    with jobs_lock:
        active_job_ids = {
            job_id
            for job_id, job in jobs.items()
            if job.get("status") in {"queued", "running"}
        }

    for path in WORK_ROOT.iterdir():
        if path.name in active_job_ids:
            continue
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()


def work_cleanup_loop():
    while not cleanup_stop_event.wait(seconds_until_next_work_cleanup()):
        clear_work_root()


app = FastAPI(title="WIAMeet API")


@app.on_event("startup")
def start_work_cleanup_scheduler():
    global cleanup_thread
    init_app_db()
    clear_work_root()
    if cleanup_thread and cleanup_thread.is_alive():
        return
    cleanup_stop_event.clear()
    cleanup_thread = Thread(target=work_cleanup_loop, name="jobs-work-cleanup", daemon=True)
    cleanup_thread.start()


@app.on_event("shutdown")
def stop_work_cleanup_scheduler():
    cleanup_stop_event.set()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:9702", "http://127.0.0.1:9702"],
    allow_origin_regex=r"http://.*:9702",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

executor = ThreadPoolExecutor(max_workers=1)
jobs: dict[str, dict] = {}
jobs_lock = Lock()


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


class JobStatus(BaseModel):
    job_id: str
    status: Literal["queued", "running", "completed", "failed"]
    stage: str
    progress: int
    message: str
    logs: list[str] = []


def append_job_log(job: dict, stage: str, percent: int, message: str):
    logs = job.setdefault("logs", [])
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {percent:>3}% {stage:<16} {message}"
    if not logs or logs[-1] != line:
        logs.append(line)


def set_job(job_id: str, **updates):
    with jobs_lock:
        job = jobs[job_id]
        job.update(updates)
        if {"stage", "progress", "message"}.issubset(updates):
            append_job_log(job, updates["stage"], updates["progress"], updates["message"])


def progress_callback(job_id: str):
    def update(stage: str, percent: int, message: str):
        set_job(job_id, stage=stage, progress=percent, message=message)
    return update


def parse_participants(text: str):
    normalized = text.replace(",", "\n")
    return [item.strip() for item in normalized.splitlines() if item.strip()]


def run_job(job_id: str):
    set_job(job_id, status="running", stage="starting", progress=1, message="처리를 시작합니다.")
    with jobs_lock:
        job = jobs[job_id]
        audio_path = Path(job["audio_path"])
        output_dir = Path(job["meta_dir"])
    try:
        result = transcribe_meeting(audio_path, output_dir, progress_callback(job_id))
        participant_list = job.get("participants", [])
        postprocess = run_llm_postprocess(
            result,
            output_dir,
            participant_list,
            job.get("meeting_purpose", ""),
            job.get("meeting_reference_text", ""),
            progress_callback(job_id),
        )
        speaker_mapping = {
            str(match["speaker_id"]): match["participant_match"]
            for match in postprocess["speaker_matches"].get("matches", [])
            if "speaker_id" in match and "participant_match" in match
        }
        set_job(
            job_id,
            status="completed",
            stage="completed",
            progress=100,
            message="처리가 완료되었습니다. 화자 매핑을 확인하세요.",
            result={**result, "sentences": postprocess["corrected_sentences"]},
            refined_result=postprocess["refined_sentences"],
            stt_corrections=postprocess["stt_corrections"],
            speaker_matches=postprocess["speaker_matches"],
            speaker_mapping=speaker_mapping,
        )
    except Exception as exc:  # noqa: BLE001 - job errors should surface to API users.
        set_job(job_id, status="failed", stage="failed", progress=100, message=str(exc))


@app.post("/api/auth/login")
def login(request: LoginRequest):
    username = request.username.strip()
    password = request.password
    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password are required.")

    with get_db_connection() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE username = ? AND active = 1",
            (username,),
        ).fetchone()
        if not user or not verify_password(password, user["salt"], user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid username or password.")
        password_reset_required = 1 if verify_password(INITIAL_PASSWORD, user["salt"], user["password_hash"]) else user["password_reset_required"]
        conn.execute(
            "UPDATE users SET last_login_at = ?, password_reset_required = ? WHERE user_uuid = ?",
            (datetime.now(KST).isoformat(), password_reset_required, user["user_uuid"]),
        )
        user = conn.execute(
            "SELECT * FROM users WHERE user_uuid = ?",
            (user["user_uuid"],),
        ).fetchone()
        conn.commit()

    token = secrets.token_urlsafe(32)
    user_data = public_user(user)
    with get_db_connection() as conn:
        conn.execute(
            "INSERT INTO auth_sessions (token, user_uuid, created_at) VALUES (?, ?, ?)",
            (token, user["user_uuid"], datetime.now(KST).isoformat()),
        )
        conn.commit()
    with sessions_lock:
        sessions[token] = {
            "user": user_data,
            "created_at": datetime.now(KST).isoformat(),
        }

    return {"token": token, "user": user_data}


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

    salt, password_hash = hash_password(INITIAL_PASSWORD)
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
    return {"user": public_user(user)}


@app.post("/api/admin/users/{user_uuid}/password/reset")
def reset_user_password(user_uuid: str, authorization: str | None = Header(default=None)):
    require_admin(authorization)
    salt, password_hash = hash_password(INITIAL_PASSWORD)
    with get_db_connection() as conn:
        cursor = conn.execute(
            "UPDATE users SET password_hash = ?, salt = ?, password_reset_required = 1 WHERE user_uuid = ?",
            (password_hash, salt, user_uuid),
        )
        conn.commit()
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="User not found.")
    return {"reset": True}


@app.post("/api/auth/password")
def update_own_password(request: UpdatePasswordRequest, authorization: str | None = Header(default=None)):
    user = get_session_user(authorization)
    password = request.password
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    if password == INITIAL_PASSWORD:
        raise HTTPException(status_code=400, detail="Password must be different from the initial password.")
    salt, password_hash = hash_password(password)
    with get_db_connection() as conn:
        conn.execute(
            "UPDATE users SET password_hash = ?, salt = ?, password_reset_required = 0 WHERE user_uuid = ?",
            (password_hash, salt, user["user_uuid"]),
        )
        updated = conn.execute(
            "SELECT username, user_uuid, display_name, role, active, password_reset_required, created_at, last_login_at FROM users WHERE user_uuid = ?",
            (user["user_uuid"],),
        ).fetchone()
        conn.commit()
    user_data = public_user(updated)
    token = authorization.removeprefix("Bearer ").strip()
    with sessions_lock:
        if token in sessions:
            sessions[token]["user"] = user_data
    return {"user": user_data}


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


@app.post("/api/jobs", response_model=JobStatus)
def create_job(
    audio: UploadFile = File(...),
    references: list[UploadFile] | None = File(default=None),
    authorization: str | None = Header(default=None),
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
    if not parse_participants(meeting_organizations):
        raise HTTPException(status_code=400, detail="At least one meeting organization is required.")
    if not parse_participants(participants):
        raise HTTPException(status_code=400, detail="At least one participant is required.")

    current_user = get_session_user(authorization)

    job_id = uuid.uuid4().hex
    output_dir = WORK_ROOT / job_id
    persist_dir = JOB_ROOT / job_id
    audio_dir = output_dir / "audio"
    meta_dir = output_dir / "meta"
    report_dir = output_dir / "report"
    references_dir = output_dir / "references"
    for directory in (audio_dir, meta_dir, report_dir, references_dir):
        directory.mkdir(parents=True, exist_ok=True)

    suffix = Path(audio.filename).suffix or ".audio"
    audio_path = audio_dir / f"audio{suffix}"

    with audio_path.open("wb") as f:
        shutil.copyfileobj(audio.file, f)

    reference_text_parts = []
    for reference in references or []:
        if not reference.filename:
            continue
        reference_name = Path(reference.filename).name
        reference_suffix = Path(reference_name).suffix.lower()
        if reference_suffix not in SUPPORTED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported reference file type: {reference_name}",
            )

        reference_path = references_dir / reference_name
        with reference_path.open("wb") as f:
            shutil.copyfileobj(reference.file, f)

        try:
            extracted_text = read_text(reference_path)
        except Exception as exc:  # noqa: BLE001 - extraction errors should surface to users.
            raise HTTPException(
                status_code=400,
                detail=f"Failed to extract reference text from {reference_name}: {exc}",
            ) from exc

        if extracted_text.strip():
            reference_text_parts.append(f"[Reference: {reference_name}]\n{extracted_text.strip()}")

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
        "organizations": parse_participants(meeting_organizations),
        "participants": parse_participants(participants),
        "category_uuid": meeting_category_uuid.strip(),
        "category_name": meeting_category_name.strip(),
    }
    (meta_dir / "meeting_metadata.json").write_text(
        json.dumps(meeting_metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    with jobs_lock:
        jobs[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "stage": "queued",
            "progress": 0,
            "message": "작업 대기 중입니다.",
            "logs": [],
            "audio_path": str(audio_path),
            "output_dir": str(output_dir),
            "persist_dir": str(persist_dir),
            "meta_dir": str(meta_dir),
            "report_dir": str(report_dir),
            "references_dir": str(references_dir),
            "result": None,
            "speaker_mapping": {},
            "speaker_matches": {"matches": []},
            "stt_corrections": {"corrections": []},
            "refined_result": None,
            "participants": parse_participants(participants),
            "meeting_metadata": meeting_metadata,
            "created_by_user_uuid": current_user.get("user_uuid"),
            "created_by_username": current_user.get("username"),
            "meeting_purpose": meeting_purpose,
            "meeting_reference_text": combined_reference_text,
            "meeting_report": "",
            "report_finalized": False,
            "persisted": False,
        }

    executor.submit(run_job, job_id)
    return get_job(job_id)


@app.get("/api/jobs/{job_id}", response_model=JobStatus)
def get_job(job_id: str):
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
def get_result(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        if job["status"] != "completed" or not job.get("result"):
            raise HTTPException(status_code=409, detail="Job is not completed.")
        return {
            "job_id": job_id,
            "result": job["result"],
            "refined_result": job.get("refined_result"),
            "speaker_mapping": job.get("speaker_mapping", {}),
            "speaker_matches": job.get("speaker_matches", {"matches": []}),
            "stt_corrections": job.get("stt_corrections", {"corrections": []}),
            "meeting_metadata": job.get("meeting_metadata", {}),
        }


@app.get("/api/jobs/{job_id}/stt-corrections")
def get_stt_corrections(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        return job.get("stt_corrections", {"corrections": []})


@app.get("/api/jobs/{job_id}/speaker-matches")
def get_speaker_matches(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        return job.get("speaker_matches", {"matches": []})


@app.get("/api/jobs/{job_id}/refined-result")
def get_refined_result(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        refined_result = job.get("refined_result")
        if refined_result is None:
            raise HTTPException(status_code=409, detail="Refined result is not ready.")
        return {"job_id": job_id, "sentences": refined_result}


@app.post("/api/jobs/{job_id}/speaker-map")
def update_speaker_mapping(job_id: str, request: SpeakerMappingRequest):
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
    with jobs_lock:
        job["result"] = base_result
        job["speaker_mapping"] = request.mapping
        job["speaker_matches"] = updated_matches
        job["refined_result"] = mapped_sentences

    return {"job_id": job_id, "sentences": mapped_sentences, "speaker_matches": updated_matches}


@app.post("/api/jobs/{job_id}/report")
def create_report(job_id: str, request: ReportRequest):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        sentences = job.get("refined_result")
        output_dir = Path(job.get("report_dir", job["output_dir"]))

    if not sentences:
        raise HTTPException(status_code=409, detail="Speaker mapping result is not ready.")

    transcript_text = format_transcript(sentences)
    if not transcript_text:
        raise HTTPException(status_code=409, detail="No transcript content found.")

    prompt = build_prompt(transcript_text, request.special_instruction)
    report_markdown = generate_report(prompt).strip()
    (output_dir / "meeting_report.md").write_text(report_markdown + "\n", encoding="utf-8")

    with jobs_lock:
        job = jobs[job_id]
        job["meeting_report"] = report_markdown
        job["report_finalized"] = False

    return {"job_id": job_id, "report_markdown": report_markdown}


@app.post("/api/jobs/{job_id}/report/finalize")
def finalize_report(job_id: str, request: ReportFinalizeRequest):
    report_markdown = request.report_markdown.strip()
    if not report_markdown:
        raise HTTPException(status_code=400, detail="Report markdown is required.")

    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        output_dir = Path(job.get("report_dir", job["output_dir"]))

    (output_dir / "meeting_report.md").write_text(report_markdown + "\n", encoding="utf-8")

    with jobs_lock:
        job = jobs[job_id]
        job["meeting_report"] = report_markdown
        job["report_finalized"] = True

    return {"job_id": job_id, "report_markdown": report_markdown, "finalized": True}


@app.post("/api/jobs/{job_id}/complete")
def complete_job(job_id: str):
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
    return detail


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
def get_meeting_report_audio(job_id: str, authorization: str | None = Header(default=None)):
    user = get_session_user(authorization)
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT job_id FROM meeting_reports WHERE job_id = ? AND user_uuid = ?",
            (job_id, user["user_uuid"]),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found.")

    audio_files = sorted((JOB_ROOT / job_id / "audio").glob("audio.*"))
    if not audio_files:
        raise HTTPException(status_code=404, detail="Audio file not found.")
    return FileResponse(audio_files[0], filename=audio_files[0].name)


@app.get("/api/jobs/{job_id}/download/{filename}")
def download_file(job_id: str, filename: str):
    path_by_filename = {
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
