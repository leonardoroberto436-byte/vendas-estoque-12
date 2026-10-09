"""Brute-force throttling for the public auth endpoints.

In-memory, per-process sliding window — enough for a single-pod deploy and it
costs no extra infrastructure. Keyed by client IP + the identifier being tried,
so one attacker cannot lock every account out by spraying a single IP.
"""

import time
from collections import defaultdict

from fastapi import HTTPException, Request

_hits: dict[str, list[float]] = defaultdict(list)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def throttle(request: Request, bucket: str, identifier: str, limit: int, window: int) -> None:
    """Allow `limit` attempts per `window` seconds, else 429."""
    key = f"{bucket}:{_client_ip(request)}:{identifier.lower().strip()}"
    now = time.monotonic()
    recent = [t for t in _hits[key] if now - t < window]
    if len(recent) >= limit:
        retry = int(window - (now - recent[0])) + 1
        _hits[key] = recent
        raise HTTPException(
            status_code=429,
            detail="Muitas tentativas. Tente novamente em alguns minutos.",
            headers={"Retry-After": str(retry)},
        )
    recent.append(now)
    _hits[key] = recent
    if len(_hits) > 10_000:  # keep the dict from growing without bound
        for stale, stamps in list(_hits.items()):
            if not stamps or now - stamps[-1] > window:
                _hits.pop(stale, None)


def clear_throttle(bucket: str, request: Request, identifier: str) -> None:
    """Called after a successful login so honest users are never punished."""
    _hits.pop(f"{bucket}:{_client_ip(request)}:{identifier.lower().strip()}", None)
