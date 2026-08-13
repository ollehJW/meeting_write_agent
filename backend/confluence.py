import html
import json
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from fastapi import HTTPException
from markdown_it import MarkdownIt


class ConfluencePublishError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def parse_parent_page_url(parent_page_url: str):
    parsed = urlparse(parent_page_url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ConfluencePublishError("invalid_parent_url", "Confluence 저장 페이지 URL을 확인하세요.")

    path_parts = [part for part in parsed.path.split("/") if part]
    space_key = ""
    if "spaces" in path_parts:
        index = path_parts.index("spaces")
        if index + 1 < len(path_parts):
            space_key = path_parts[index + 1]

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
        raise ConfluencePublishError("invalid_parent_url", "Confluence 페이지 ID를 URL에서 찾지 못했습니다.")

    return f"{parsed.scheme}://{parsed.netloc}", page_id, space_key


def build_auth_headers(access_token: str):
    token = access_token.strip()
    if not token:
        raise ConfluencePublishError("missing_token", "Confluence Access Token이 없습니다.")
    return {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }


def markdown_to_storage_html(markdown_text: str):
    return MarkdownIt("commonmark", {"breaks": True}).enable("table").render(markdown_text or "")


def escape_text(value):
    return html.escape(str(value or ""), quote=True)


def format_list(values):
    items = [escape_text(value) for value in values if str(value or "").strip()]
    return "<br />".join(items) if items else "-"


def build_page_title(metadata: dict):
    category = metadata.get("category_name") or "회의"
    meeting_date = metadata.get("date") or metadata.get("meeting_date") or "날짜 미정"
    title = metadata.get("title") or "회의 제목 없음"
    return f"[{category}] {meeting_date} {title}"


def metadata_to_storage_html(metadata: dict):
    meeting_time = " - ".join(
        part for part in [metadata.get("start_time"), metadata.get("end_time")] if part
    ) or "-"
    rows = [
        ("회의 날짜", metadata.get("date") or metadata.get("meeting_date") or "-"),
        ("회의 시간", meeting_time),
        ("회의 목적", metadata.get("purpose", "-")),
        ("참여 조직", format_list(metadata.get("organizations", []))),
        ("참여자", format_list(metadata.get("participants", []))),
    ]

    table_rows = []
    for label, value in rows:
        cell_value = value if label in {"참여 조직", "참여자"} else escape_text(value)
        table_rows.append(
            "<tr>"
            f'<th style="width: 140px; text-align: left; background: #f4f5f7;">{escape_text(label)}</th>'
            f"<td>{cell_value}</td>"
            "</tr>"
        )

    return (
        "<h2>회의 정보</h2>"
        "<table>"
        "<tbody>"
        + "".join(table_rows)
        + "</tbody>"
        "</table>"
        "<hr />"
    )


def build_page_storage_html(metadata: dict, report_markdown: str):
    return metadata_to_storage_html(metadata) + markdown_to_storage_html(report_markdown)


def create_page(parent_page_url: str, access_token: str, metadata: dict, report_markdown: str):
    base_url, parent_page_id, space_key = parse_parent_page_url(parent_page_url)
    title = build_page_title(metadata)
    payload = {
        "type": "page",
        "title": title,
        "ancestors": [{"id": parent_page_id}],
        "body": {
            "storage": {
                "value": build_page_storage_html(metadata, report_markdown),
                "representation": "storage",
            }
        },
    }
    if space_key:
        payload["space"] = {"key": space_key}

    request = urllib.request.Request(
        f"{base_url}/rest/api/content",
        data=json.dumps(payload).encode("utf-8"),
        headers=build_auth_headers(access_token),
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        print(f"[confluence-publish] HTTP {exc.code}: {detail[:2000]}", flush=True)
        if exc.code in {401, 403}:
            raise ConfluencePublishError("auth_failed", "Confluence 인증에 실패했습니다. Access Token 권한을 확인하세요.") from exc
        if exc.code == 404:
            raise ConfluencePublishError("parent_not_found", "Confluence 저장 상위 페이지를 찾지 못했거나 접근 권한이 없습니다.") from exc
        if exc.code == 409:
            raise ConfluencePublishError("duplicate_title", "같은 위치에 동일한 제목의 Confluence 페이지가 이미 있습니다.") from exc
        if exc.code == 400:
            raise ConfluencePublishError("bad_request", "Confluence 페이지 생성 요청이 올바르지 않습니다. 저장 페이지 URL 또는 페이지 제목을 확인하세요.") from exc
        raise ConfluencePublishError("api_error", f"Confluence API 오류가 발생했습니다. HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise ConfluencePublishError("network_error", f"Confluence 서버에 연결하지 못했습니다: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise ConfluencePublishError("invalid_response", "Confluence 응답을 해석하지 못했습니다.") from exc

    page_id = data.get("id")
    links = data.get("_links", {})
    webui = links.get("webui", "")
    page_url = f"{base_url}{webui}" if webui else ""
    if not page_id or not page_url:
        raise ConfluencePublishError("invalid_response", "Confluence 페이지 생성 결과를 확인하지 못했습니다.")

    return {
        "confluence_page_id": str(page_id),
        "confluence_page_url": page_url,
        "confluence_page_title": data.get("title") or title,
        "parent_page_url": parent_page_url,
    }
