"""tscheck: platform owner backup run/list/download + path-traversal + RBAC.

Covers:
 - POST /api/platform/backups/run -> 200, status OK, size_bytes > 0
 - GET /api/platform/backups lists the new file first
 - GET /api/platform/backups/{file}/download -> 200 valid gzip body
 - path-traversal filename -> 404 (not another file on disk)
 - company ADMIN gets 403 on list + download + run

Run: cd /app/backend && python -m pytest tests/test_tscheck_backup_run_and_download.py -q
"""

import os

import httpx

from tests.credentials import env
import pytest

API_URL = os.environ.get(
    "BACKEND_URL", "https://vendas-estoque-12.preview.emergentagent.com"
) + "/api"

PLATFORM_EMAIL = env("PLATFORM_OWNER_EMAIL")
PLATFORM_PASSWORD = env("PLATFORM_OWNER_PASSWORD")
ADMIN_EMAIL = env("COMPANY_ADMIN_EMAIL")
ADMIN_PASSWORD = env("COMPANY_ADMIN_PASSWORD")


def _client() -> httpx.Client:
    return httpx.Client(base_url=API_URL, timeout=60.0)


def _login(email: str, password: str) -> httpx.Client:
    c = _client()
    resp = c.post("/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return c


@pytest.fixture
def owner():
    c = _login(PLATFORM_EMAIL, PLATFORM_PASSWORD)
    yield c
    c.close()


@pytest.fixture
def company_admin():
    c = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    yield c
    c.close()


def test_owner_can_run_list_and_download_backup(owner):
    run_resp = owner.post("/platform/backups/run")
    assert run_resp.status_code == 200, run_resp.text
    body = run_resp.json()
    assert body["status"] == "OK", body
    assert body["size_bytes"] > 0, body
    new_file = body["file"]

    listed = owner.get("/platform/backups")
    assert listed.status_code == 200, listed.text
    rows = listed.json()
    assert len(rows) > 0
    assert rows[0]["file"] == new_file, rows[0]

    download = owner.get(f"/platform/backups/{new_file}/download")
    assert download.status_code == 200, download.text
    assert download.content[:2] == b"\x1f\x8b", "not a gzip body"  # gzip magic number
    assert len(download.content) > 0


@pytest.mark.parametrize(
    "traversal_name",
    [
        "../../etc/passwd",
        "..%2f..%2fetc%2fpasswd",
    ],
)
def test_backup_download_blocks_path_traversal(owner, traversal_name):
    import urllib.parse



    encoded = urllib.parse.quote(traversal_name, safe="")
    resp = owner.get(f"/platform/backups/{encoded}/download")
    assert resp.status_code == 404, resp.text


def test_company_admin_forbidden_on_backup_routes(company_admin):
    assert company_admin.get("/platform/backups").status_code == 403
    assert company_admin.post("/platform/backups/run").status_code == 403
    assert (
        company_admin.get("/platform/backups/auto-20200101-000000.tar.gz/download").status_code
        == 403
    )


def test_anonymous_forbidden_on_backup_routes():
    with _client() as c:
        assert c.get("/platform/backups").status_code == 401
        assert c.post("/platform/backups/run").status_code == 401
