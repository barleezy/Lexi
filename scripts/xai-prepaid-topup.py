#!/usr/bin/env python3
"""Manual xAI prepaid top-up helper.

Does nothing on import. A charge is sent only when you pass --top-up USD
on the command line.

Auth: XAI_MANAGEMENT_API_KEY
Team: XAI_TEAM_ID
Amount: --top-up <USD dollars>  (posted as integer cents in amount.val)

Script-local minute rate is $0.10. The live app wallet rate stays 0.08 in
lib/wallet/voice-rate.ts — this file does not change that.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

MANAGEMENT_API_BASE = "https://management-api.x.ai"
SCRIPT_USD_PER_MINUTE = 0.10
ROOT = Path(__file__).resolve().parents[1]


def load_env_files() -> None:
    for name in (".env.local", ".env"):
        path = ROOT / name
        if not path.is_file():
            continue
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            eq = line.find("=")
            if eq <= 0:
                continue
            key = line[:eq].strip()
            value = line[eq + 1 :].strip()
            if (value.startswith("'") and value.endswith("'")) or (
                value.startswith('"') and value.endswith('"')
            ):
                value = value[1:-1]
            if key and not os.environ.get(key, "").strip():
                os.environ[key] = value


def convert(minutes: float) -> dict[str, float | int]:
    """USD and integer cents for remaining minutes at the script-local rate."""
    mins = float(minutes)
    if not math.isfinite(mins) or mins < 0:
        raise ValueError("minutes must be a non-negative number")
    usd = mins * SCRIPT_USD_PER_MINUTE
    cents = int(round(usd * 100))
    return {
        "minutes": mins,
        "usd": usd,
        "cents": cents,
        "usd_per_minute": SCRIPT_USD_PER_MINUTE,
    }


def require_auth() -> tuple[str, str]:
    key = os.environ.get("XAI_MANAGEMENT_API_KEY", "").strip()
    team_id = os.environ.get("XAI_TEAM_ID", "").strip()
    if not key:
        raise SystemExit("XAI_MANAGEMENT_API_KEY is not set")
    if not team_id:
        raise SystemExit("XAI_TEAM_ID is not set")
    return key, team_id


def top_up_url(team_id: str) -> str:
    explicit = os.environ.get("XAI_CREDITS_TOPUP_ENDPOINT", "").strip()
    if explicit:
        return explicit.replace("{team_id}", team_id).replace("{TEAM_ID}", team_id)
    encoded = urllib.parse.quote(team_id, safe="")
    return f"{MANAGEMENT_API_BASE}/v1/billing/teams/{encoded}/prepaid/top-up"


def usd_to_cents(usd: float) -> int:
    amount = float(usd)
    if not math.isfinite(amount) or amount <= 0:
        raise SystemExit("--top-up must be a positive USD amount")
    return int(round(amount * 100))


def post_top_up(usd: float, *, dry_run: bool = False) -> dict[str, Any]:
    cents = usd_to_cents(usd)
    key, team_id = require_auth()
    url = top_up_url(team_id)
    payload = {"amount": {"val": str(cents)}}
    request_body = json.dumps(payload)
    if dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "usd": usd,
            "cents": cents,
            "body": payload,
        }
    request = urllib.request.Request(
        url,
        data=request_body.encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
            status = response.status
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        return {
            "ok": False,
            "status": error.code,
            "error": f"xAI top-up failed ({error.code})",
            "body": _parse_body(raw),
        }
    except urllib.error.URLError as error:
        return {"ok": False, "error": str(error.reason)}
    parsed = _parse_body(raw)
    ok = status == 200
    return {
        "ok": ok,
        "status": status,
        "body": parsed,
        **({} if ok else {"error": f"xAI top-up failed ({status})"}),
    }


def _parse_body(raw: str) -> Any:
    text = raw.strip()
    if not text:
        return ""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Convert remaining minutes or POST an xAI prepaid top-up. "
        "Importing this module never charges."
    )
    parser.add_argument(
        "--convert",
        type=float,
        metavar="MINUTES",
        help="print USD/cents for remaining minutes at $0.10/min (no charge)",
    )
    parser.add_argument(
        "--top-up",
        type=float,
        metavar="USD",
        help="USD dollars to add (posted as cents). Required to charge.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="with --top-up, print the request body and exit without POSTing",
    )
    args = parser.parse_args(argv)
    if args.convert is None and args.top_up is None:
        parser.print_help()
        return 2

    load_env_files()
    if args.convert is not None:
        print(json.dumps(convert(args.convert), indent=2))
    if args.top_up is not None:
        result = post_top_up(args.top_up, dry_run=args.dry_run)
        print(json.dumps(result, indent=2))
        return 0 if result.get("ok") else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
