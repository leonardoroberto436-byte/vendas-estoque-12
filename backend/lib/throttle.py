"""Brute-force throttling for the public auth endpoints.

In-memory, per-process sliding window — enough for a single-pod deploy and it
costs no extra infrastructure. Keyed by client IP + the identifier being tried,
so one attacker cannot lock every account out by spraying a single IP.

The client IP must come from a hop the app trusts. `X-Forwarded-For` is a list
the client can pre-fill with anything ("1.2.3.4, <real ip>"), so its FIRST entry
is attacker-controlled: keying on it would let anyone dodge every limit by
sending a new fake address per request. Each proxy in front of the app APPENDS
the address it saw, so the trustworthy value is the one added by the outermost
proxy we control — `TRUSTED_PROXY_HOPS` entries from the right (default 1: the
ingress right in front of the app).
"""

import os
import time
from collections import defaultdict

from fastapi import HTTPException, Request

_hits: dict[str, list[float]] = defaultdict(list)


def _trusted_hops() -> int:
    try:
        return max(0, int(os.environ.get("TRUSTED_PROXY_HOPS", "1")))
    except ValueError:
        return 1


def client_ip(request: Request) -> str:
    """Best non-spoofable client address available to the app."""
    hops = _trusted_hops()
    forwarded = [part.strip() for part in request.headers.get("x-forwarded-for", "").split(",")]
    forwarded = [part for part in forwarded if part]
    if hops and forwarded:
        # the entry appended by the outermost trusted proxy
        return forwarded[-hops] if len(forwarded) >= hops else forwarded[0]
    return request.client.host if request.client else "unknown"


# kept for older imports
_client_ip = client_ip


def throttle(request: Request, bucket: str, identifier: str, limit: int, window: int) -> None:
    """Allow `limit` attempts per `window` seconds, else 429."""
    key = f"{bucket}:{client_ip(request)}:{identifier.lower().strip()}"
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
    _hits.pop(f"{bucket}:{client_ip(request)}:{identifier.lower().strip()}", None)
