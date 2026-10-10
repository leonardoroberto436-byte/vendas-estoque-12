"""tscheck: sessions are stored as token_hash (never clear text), auth still
works end to end, and logout kills the session server-side.

Covers: login sets ev_session + works on a follow-up request; every document
in `sessions` has token_hash and no `token` field; the raw cookie value never
appears in the DB; logout deletes the session row and the old cookie 401s.

Run: cd /app/backend && python -m pytest tests/test_tscheck_session_token_hashed.py -q
"""

import hashlib
import os

import httpx
import pymongo
import pytest

from tests.credentials import env

API_URL = os.environ.get(
    "BACKEND_URL", "https://vendas-estoque-12.preview.emergentagent.com"
) + "/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "app")

# Uses the platform owner (not the company admin) deliberately: this
# criterion is about session storage, not password rotation, and keeping the
# two independent means this test is unaffected if the admin credential
# finding below ever flips while re-run.
OWNER_EMAIL = env("PLATFORM_OWNER_EMAIL")
OWNER_PASSWORD = env("PLATFORM_OWNER_PASSWORD")


def _client() -> httpx.Client:
    return httpx.Client(base_url=API_URL, timeout=30.0)


def _mongo_db():
    return pymongo.MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)[DB_NAME]


def test_session_is_hashed_auth_works_and_logout_revokes():
    with _client() as c:
        login = c.post(
            "/auth/login",
            json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD},
        )
        assert login.status_code == 200, login.text
        raw_cookie = c.cookies.get("ev_session")
        assert raw_cookie, "login did not set ev_session cookie"

        # the authenticated session works on a subsequent request
        me = c.get("/auth/me")
        assert me.status_code == 200, me.text
        assert me.json()["email"] == OWNER_EMAIL

        # every sessions doc stores only token_hash, never a clear token, and
        # the raw cookie value is never persisted anywhere in the collection
        db = _mongo_db()
        expected_hash = hashlib.sha256(raw_cookie.encode()).hexdigest()
        matching = db.sessions.find_one({"token_hash": expected_hash})
        assert matching is not None, "no session document matches this login's token_hash"
        assert "token" not in matching, f"clear-text token field leaked: {matching.keys()}"

        for doc in db.sessions.find({}):
            assert "token" not in doc, f"clear-text token field found in session {doc.get('id')}"
            assert doc.get("token_hash"), f"session {doc.get('id')} missing token_hash"
            assert doc["token_hash"] != raw_cookie
            assert raw_cookie not in str(doc.values())

        # logout deletes the session and the cookie stops working
        logout = c.post("/auth/logout")
        assert logout.status_code == 204, logout.text

        assert db.sessions.find_one({"token_hash": expected_hash}) is None

        dead = c.get("/auth/me")
        assert dead.status_code == 401, dead.text
