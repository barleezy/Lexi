"""TalkToLexi fortnitepy sidecar — Friends lobby party join, not in-match play."""

from __future__ import annotations

import asyncio
import json
import os
import re
import traceback
from functools import partial
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

OPEN_PARTY_ERROR = "open a party in lobby and ask again."
ACCEPT_JOIN_ERROR = "accept TalkToLexi in Friends lobby and ask again."
ACCEPT_JOIN_SAY = (
    "I sent a join request. Stay in Friends lobby, accept TalkToLexi, then ask me again."
)
NEEDS_REAUTH = (
    "Device auth is missing friends/presence scopes or is invalid. "
    "Paste a fresh Android-client authorization code as EPIC_EXCHANGE_CODE from "
    "https://www.epicgames.com/id/api/redirect?clientId=3f69e56c7649492c8cc29f1af08a8a12"
    "&responseType=code&scope=basic_profile%20friends_list%20presence "
    "then restart the sidecar. Do not commit the code."
)
DEFAULT_FRIEND = "TTBarleezy"
DEFAULT_DISPLAY = "TalkToLexi"
JOIN_RE = re.compile(r"^!join(?:\s+(.+))?$", re.I)
SIT_RE = re.compile(r"^!(?:sit[_ -]?out)$", re.I)
LEAVE_RE = re.compile(r"^!leave(?:[_ -]?party)?$", re.I)

ROOT = Path(__file__).resolve().parents[2]


def log(message: str) -> None:
    print(f"[fortnitepy] {message}", flush=True)


def load_env_local() -> None:
    path = ROOT / ".env.local"
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        eq = line.find("=")
        if eq <= 0:
            continue
        key = line[:eq]
        value = line[eq + 1 :]
        if (value.startswith("'") and value.endswith("'")) or (
            value.startswith('"') and value.endswith('"')
        ):
            value = value[1:-1]
        if key not in os.environ or os.environ.get(key, "") == "":
            os.environ[key] = value


def parse_device_auth(raw: Any) -> dict[str, str] | None:
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return None
        try:
            return parse_device_auth(json.loads(text))
        except json.JSONDecodeError:
            return None
    if not isinstance(raw, dict):
        return None
    account_id = str(raw.get("accountId") or raw.get("account_id") or "").strip()
    device_id = str(raw.get("deviceId") or raw.get("device_id") or "").strip()
    secret = str(raw.get("secret") or "").strip()
    if not account_id or not device_id or not secret:
        return None
    return {"account_id": account_id, "device_id": device_id, "secret": secret}


def device_auth_from_env() -> dict[str, str] | None:
    parsed = parse_device_auth(os.environ.get("EPIC_DEVICE_AUTH", ""))
    if parsed:
        return parsed
    account_id = os.environ.get("EPIC_ACCOUNT_ID", "").strip()
    device_id = os.environ.get("EPIC_DEVICE_ID", "").strip()
    secret = os.environ.get("EPIC_DEVICE_SECRET", "").strip()
    if account_id and device_id and secret:
        return {"account_id": account_id, "device_id": device_id, "secret": secret}
    return None


def friend_display_name() -> str:
    return os.environ.get("FORTNITE_FRIEND_DISPLAY_NAME", "").strip() or DEFAULT_FRIEND


def sidecar_bind() -> tuple[str, int]:
    raw = os.environ.get("FORTNITEPY_SIDECAR_URL", "").strip() or "http://127.0.0.1:8765"
    parsed = urlparse(raw)
    host = os.environ.get("FORTNITEPY_SIDECAR_HOST", "").strip() or parsed.hostname or "127.0.0.1"
    try:
        port = int(os.environ.get("FORTNITEPY_SIDECAR_PORT", "").strip() or parsed.port or 8765)
    except ValueError:
        port = 8765
    return host, port


def persist_device_auth(details: dict[str, Any]) -> None:
    parsed = parse_device_auth(details)
    if not parsed:
        return
    value = json.dumps(
        {
            "accountId": parsed["account_id"],
            "deviceId": parsed["device_id"],
            "secret": parsed["secret"],
        },
        separators=(",", ":"),
    )
    os.environ["EPIC_DEVICE_AUTH"] = value
    os.environ["EPIC_EXCHANGE_CODE"] = ""
    path = ROOT / ".env.local"
    try:
        text = path.read_text(encoding="utf-8") if path.is_file() else ""
        line = f"EPIC_DEVICE_AUTH='{value}'"
        if re.search(r"^EPIC_DEVICE_AUTH=", text, flags=re.M):
            text = re.sub(r"^EPIC_DEVICE_AUTH=.*$", line, text, flags=re.M)
        else:
            text = f"{text.rstrip()}\n{line}\n"
        if re.search(r"^EPIC_EXCHANGE_CODE=", text, flags=re.M):
            text = re.sub(r"^EPIC_EXCHANGE_CODE=.*$", "EPIC_EXCHANGE_CODE=", text, flags=re.M)
        path.write_text(text, encoding="utf-8")
        log("Wrote EPIC_DEVICE_AUTH to .env.local and cleared the one-shot code.")
    except OSError:
        log("Created device auth but could not write .env.local.")


def parse_join_chat_command(raw: str) -> dict[str, str] | None:
    text = (raw or "").strip()
    match = JOIN_RE.match(text)
    if match:
        return {"action": "join_party", "displayName": (match.group(1) or "").strip()}
    if SIT_RE.match(text):
        return {"action": "sit_out", "displayName": ""}
    if LEAVE_RE.match(text):
        return {"action": "leave_party", "displayName": ""}
    return None


def _ready_name(value: Any) -> str:
    if value is None:
        return ""
    name = getattr(value, "name", None)
    if isinstance(name, str) and name.strip():
        return name
    text = str(value)
    return text.split(".")[-1] if text else ""


def is_sitting_out(value: Any) -> bool:
    return _ready_name(value).replace("_", "").replace(" ", "").lower() == "sittingout"


class LexiClient:
    """Wrapper so import errors still serve HTTP."""

    def __init__(self, inner: Any):
        self.inner = inner
        self.auth_error: str | None = None
        self.needs_reauth = False
        self._join_lock = asyncio.Lock()

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)


def build_auth():
    import fortnitepy

    device = device_auth_from_env()
    exchange = os.environ.get("EPIC_EXCHANGE_CODE", "").strip()
    email = os.environ.get("EPIC_EMAIL", "").strip()
    password = os.environ.get("EPIC_PASSWORD", "").strip()
    if not device and not exchange and not (email and password):
        raise RuntimeError("Fortnite/Epic is not configured.")
    kwargs: dict[str, Any] = {
        "prompt_exchange_code": False,
        "prompt_authorization_code": False,
        "prompt_code_if_invalid": False,
        "prompt_code_if_throttled": False,
    }
    if device:
        kwargs.update(device)
    if email and password:
        kwargs["email"] = email
        kwargs["password"] = password
        two_factor = os.environ.get("EPIC_2FA_CODE", "").strip()
        if two_factor:
            kwargs["two_factor_code"] = two_factor
    if exchange:
        kwargs["authorization_code"] = exchange
        kwargs["exchange_code"] = exchange
    return fortnitepy.AdvancedAuth(**kwargs)


def build_client():
    import fortnitepy

    auth = build_auth()
    member_config = fortnitepy.DefaultPartyMemberConfig(
        yield_leadership=True,
        meta=[
            partial(
                fortnitepy.ClientPartyMember.set_ready,
                state=fortnitepy.ReadyState.SITTING_OUT,
            )
        ],
    )
    client = fortnitepy.Client(
        auth=auth,
        default_party_member_config=member_config,
        leave_party_at_shutdown=False,
    )
    wrapper = LexiClient(client)

    @client.event
    async def event_device_auth_generate(details, email=None):
        persist_device_auth(details if isinstance(details, dict) else {})

    @client.event
    async def event_ready():
        name = getattr(getattr(client, "user", None), "display_name", "") or DEFAULT_DISPLAY
        log(f"Ready as {name}. Party bot is connected; not in Ian's lobby until join.")

    @client.event
    async def event_friend_request(request):
        display = getattr(request, "display_name", "") or ""
        if display.lower() == friend_display_name().lower():
            await request.accept()

    @client.event
    async def event_party_invite(invitation):
        sender = getattr(invitation, "sender", None)
        display = getattr(sender, "display_name", "") or ""
        allowed = {friend_display_name().lower(), "ttbarleezy", "barleezy"}
        if display.lower() in allowed:
            await invitation.accept()
            await sit_out(client)

    @client.event
    async def event_friend_message(message):
        content = getattr(message, "content", "") or ""
        parsed = parse_join_chat_command(content)
        if not parsed:
            return
        author = getattr(message, "author", None)
        fallback = getattr(author, "display_name", "") or friend_display_name()
        display = parsed["displayName"] or fallback
        log(f"Chat command {parsed['action']} for {display}")
        if parsed["action"] == "join_party":
            await join_friend_party(client, display, None)
        elif parsed["action"] == "sit_out":
            await sit_out(client)
        elif parsed["action"] == "leave_party":
            await leave_party(client)

    return wrapper


def client_ready(client: Any) -> bool:
    inner = getattr(client, "inner", client)
    check = getattr(inner, "is_ready", None)
    return bool(check()) if callable(check) else False


def lexi_user(client: Any) -> dict[str, str]:
    user = getattr(getattr(client, "inner", client), "user", None)
    return {
        "displayName": getattr(user, "display_name", None)
        or os.environ.get("EPIC_DISPLAY_NAME", "").strip()
        or DEFAULT_DISPLAY,
        "accountId": getattr(user, "id", None) or "",
    }


def iter_friends(client: Any) -> list[Any]:
    friends = getattr(getattr(client, "inner", client), "friends", None) or []
    if isinstance(friends, dict):
        return list(friends.values())
    try:
        return list(friends)
    except TypeError:
        return []


async def resolve_friend(client: Any, display_name: str) -> Any | None:
    needle = (display_name or friend_display_name()).strip()
    if not needle:
        return None
    inner = getattr(client, "inner", client)
    get_friend = getattr(inner, "get_friend", None)
    if callable(get_friend) and re.fullmatch(r"[0-9a-f]{32}", needle, flags=re.I):
        found = get_friend(needle)
        if found:
            return found
    for friend in iter_friends(client):
        name = getattr(friend, "display_name", "") or ""
        if name.lower() == needle.lower():
            return friend
    fetch = getattr(inner, "fetch_user_by_display_name", None)
    if callable(fetch):
        try:
            user = await fetch(needle)
        except Exception:
            user = None
        account_id = getattr(user, "id", None)
        if account_id and callable(get_friend):
            return get_friend(account_id)
    return None


def friend_presence(friend: Any) -> dict[str, Any]:
    if friend is None:
        return {"state": "unknown", "lastOnline": None, "source": "xmpp"}
    online = getattr(friend, "is_online", None)
    if callable(online):
        online = online()
    last = getattr(friend, "last_presence", None)
    if online is True or last is not None:
        return {"state": "online" if online is not False else "unknown", "lastOnline": None, "source": "xmpp"}
    return {"state": "unknown", "lastOnline": None, "source": "xmpp"}


def party_id_of(party: Any) -> str | None:
    if party is None:
        return None
    value = getattr(party, "id", None) or getattr(party, "party_id", None)
    return str(value) if value else None


def member_ids(party: Any) -> list[str]:
    members = getattr(party, "members", None) or []
    if isinstance(members, dict):
        members = members.values()
    ids: list[str] = []
    for member in members:
        account_id = getattr(member, "id", None) or getattr(member, "account_id", None)
        if account_id:
            ids.append(str(account_id))
    return ids


def with_friend(client: Any, friend: Any) -> bool:
    if friend is None:
        return False
    party = getattr(getattr(client, "inner", client), "party", None)
    friend_id = getattr(friend, "id", None)
    return bool(friend_id and str(friend_id) in member_ids(party))


def friend_party_id(friend: Any) -> str | None:
    presence = getattr(friend, "last_presence", None)
    party = getattr(presence, "party", None)
    return party_id_of(party)


async def sit_out(client: Any) -> dict[str, Any]:
    import fortnitepy

    party = getattr(getattr(client, "inner", client), "party", None)
    me = getattr(party, "me", None)
    if me is None:
        return {"ok": False, "error": OPEN_PARTY_ERROR}
    await me.set_ready(fortnitepy.ReadyState.SITTING_OUT)
    return {"ok": True, "sittingOut": True}


async def leave_party(client: Any) -> dict[str, Any]:
    party = getattr(getattr(client, "inner", client), "party", None)
    if party is None:
        return {"ok": True}
    leave = getattr(party, "leave", None)
    if callable(leave):
        await leave()
    return {"ok": True}


async def wait_with_friend(client: Any, friend: Any, seconds: int = 20) -> bool:
    for _ in range(seconds):
        if with_friend(client, friend):
            return True
        await asyncio.sleep(1)
    return False


def classify_join_error(exc: BaseException) -> tuple[str, str | None, bool]:
    name = type(exc).__name__
    text = str(exc).lower()
    if name in {"FriendOffline", "PartyError"} and (
        "party not found" in text or "offline" in text or "not found" in text
    ):
        return OPEN_PARTY_ERROR, None, False
    if name == "Forbidden" or "private" in text:
        return ACCEPT_JOIN_ERROR, ACCEPT_JOIN_SAY, True
    if "user_has_no_party" in text or "party_not_found" in text:
        return OPEN_PARTY_ERROR, None, False
    return str(exc) or OPEN_PARTY_ERROR, None, "private" in text or "forbidden" in text


async def join_friend_party(client: Any, display_name: str, party_id: str | None) -> dict[str, Any]:
    inner = getattr(client, "inner", client)
    target = (display_name or "").strip() or friend_display_name()
    if party_id:
        try:
            await inner.join_party(party_id)
            await sit_out(inner)
            friend = await resolve_friend(inner, target)
            return {"joined": True, "friend": friend, "error": None, "say": None}
        except Exception as exc:
            error, say, _ = classify_join_error(exc)
            return {"joined": False, "friend": None, "error": error, "say": say}

    friend = await resolve_friend(inner, target)
    if friend is None:
        return {
            "joined": False,
            "friend": None,
            "error": f"{target} is not on Lexi's friends list yet. Accept the request, then open a party in lobby and ask again.",
            "say": None,
        }

    if with_friend(inner, friend):
        await sit_out(inner)
        return {"joined": True, "friend": friend, "error": None, "say": None}

    try:
        await friend.join_party()
        await sit_out(inner)
        return {"joined": True, "friend": friend, "error": None, "say": None}
    except Exception as exc:
        error, say, request = classify_join_error(exc)
        if not request and error == OPEN_PARTY_ERROR:
            request = True
        if not request:
            return {"joined": False, "friend": friend, "error": error, "say": say}

    try:
        await friend.request_to_join()
    except Exception as exc:
        name = type(exc).__name__
        if name == "PartyError" and "already" in str(exc).lower():
            await sit_out(inner)
            return {"joined": True, "friend": friend, "error": None, "say": None}
        if name == "FriendOffline":
            return {"joined": False, "friend": friend, "error": OPEN_PARTY_ERROR, "say": None}
        error, say, _ = classify_join_error(exc)
        if "user_has_no_party" in str(exc).lower():
            return {"joined": False, "friend": friend, "error": OPEN_PARTY_ERROR, "say": None}
        if error == ACCEPT_JOIN_ERROR or "already" in str(exc).lower():
            pass
        else:
            return {"joined": False, "friend": friend, "error": error or OPEN_PARTY_ERROR, "say": say}

    if await wait_with_friend(inner, friend):
        await sit_out(inner)
        return {"joined": True, "friend": friend, "error": None, "say": None}
    return {"joined": False, "friend": friend, "error": ACCEPT_JOIN_ERROR, "say": ACCEPT_JOIN_SAY}


def snapshot(client: Any, display_name: str, friend: Any | None = None) -> dict[str, Any]:
    target = (display_name or "").strip() or friend_display_name()
    party = getattr(getattr(client, "inner", client), "party", None)
    me = getattr(party, "me", None)
    readiness = _ready_name(getattr(me, "ready", None) or getattr(me, "readiness", None))
    sitting = is_sitting_out(getattr(me, "ready", None))
    friend_id = getattr(friend, "id", None)
    relation = "friends" if friend is not None else "none"
    in_party = with_friend(client, friend)
    own_id = party_id_of(party) if in_party else None
    return {
        "friend": {
            "displayName": getattr(friend, "display_name", None) or target,
            "accountId": friend_id,
            "relation": relation,
            "request": "already_friends" if friend is not None else None,
            "presence": friend_presence(friend),
        },
        "party": {
            "inParty": in_party,
            "inIanParty": in_party,
            "partyId": own_id,
            "sittingOut": sitting if in_party else False,
            "readiness": readiness or None if in_party else None,
            "withFriend": in_party,
            "friendPartyId": friend_party_id(friend),
            "comms": "grok_voice",
            "inUnrealClient": False,
            "visibleInFortnite": in_party,
        },
    }


def public_result(
    client: Any | None,
    action: str,
    display_name: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    extra = extra or {}
    ready = bool(client and client_ready(client))
    body: dict[str, Any] = {
        "ok": extra.get("ok", ready and not extra.get("error")),
        "source": "fortnitepy",
        "ready": ready,
        "configured": True,
        "canPlayInGame": False,
        "epicHttpReady": False,
        "inIanParty": False,
        "visibleInFortnite": False,
        "action": action,
    }
    if client and getattr(client, "auth_error", None):
        body["ok"] = False
        body["error"] = client.auth_error
        body["needsReauth"] = bool(getattr(client, "needs_reauth", False))
        return body
    if not client:
        body["ok"] = False
        body["error"] = extra.get("error") or "fortnitepy sidecar is not authenticated."
        body["needsReauth"] = True
        return body
    if not ready:
        body["ok"] = False
        body["error"] = extra.get("error") or "fortnitepy sidecar is still connecting."
        return body

    friend = extra.get("friend")
    body.update(snapshot(client, display_name, friend))
    party = body.get("party") or {}
    with_friend_flag = party.get("withFriend") is True
    body["inIanParty"] = with_friend_flag
    body["visibleInFortnite"] = with_friend_flag
    body["lexi"] = lexi_user(client)
    if extra.get("error"):
        body["ok"] = False
        body["error"] = extra["error"]
        if extra.get("say"):
            body["say"] = extra["say"]
        party = dict(party)
        party["error"] = extra["error"]
        body["party"] = party
    elif extra.get("ok") is False:
        body["ok"] = False
        if extra.get("error"):
            body["error"] = extra["error"]
    else:
        body["ok"] = True
    if "joined" in extra:
        body["joined"] = extra["joined"]
        body["ok"] = bool(extra["joined"])
    if extra.get("say") and "say" not in body:
        body["say"] = extra["say"]
    return body


async def handle_command(client: Any | None, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    raw_action = payload.get("action")
    raw_display = payload.get("displayName") or payload.get("display_name") or ""
    chat = parse_join_chat_command(str(raw_action or "")) or parse_join_chat_command(
        str(raw_display or "")
    )
    action = (chat or {}).get("action") or str(raw_action or "status").strip().lower()
    display = (chat or {}).get("displayName") or str(raw_display or "").strip() or friend_display_name()
    party_id = str(payload.get("partyId") or payload.get("party_id") or "").strip() or None

    if action in {"join", "hop_in", "hop_in_lobby"}:
        action = "join_party"
    if action in {"sitout", "sitting_out"}:
        action = "sit_out"
    if action in {"leave"}:
        action = "leave_party"
    if action in {"signin", "login"}:
        action = "sign_in"

    if client is None:
        return 503, {
            "ok": False,
            "source": "fortnitepy",
            "ready": False,
            "configured": False,
            "canPlayInGame": False,
            "inIanParty": False,
            "visibleInFortnite": False,
            "error": "Fortnite/Epic is not configured.",
            "needsReauth": True,
        }

    if getattr(client, "auth_error", None):
        return 401, public_result(client, action, display)

    if not client_ready(client) and action != "status":
        return 503, public_result(
            client, action, display, {"ok": False, "error": "fortnitepy sidecar is still connecting."}
        )

    if action in {"status", "sign_in"}:
        friend = await resolve_friend(client, display) if client_ready(client) else None
        body = public_result(client, action, display, {"ok": client_ready(client), "friend": friend})
        if action == "sign_in" and not body.get("party", {}).get("withFriend"):
            body["message"] = "fortnitepy sidecar is connected. TalkToLexi is not visible in Fortnite."
        return 200 if body.get("ok") else 503, body

    if action == "join_party":
        async with client._join_lock:
            result = await join_friend_party(client, display, party_id)
        body = public_result(client, action, display, result)
        return 200 if result.get("joined") else 409, body

    if action == "sit_out":
        friend = await resolve_friend(client, display)
        if not with_friend(client, friend):
            body = public_result(
                client,
                action,
                display,
                {"ok": False, "friend": friend, "error": OPEN_PARTY_ERROR},
            )
            return 409, body
        sit = await sit_out(client)
        body = public_result(
            client,
            action,
            display,
            {"ok": sit.get("ok"), "friend": friend, "error": sit.get("error")},
        )
        return 200 if sit.get("ok") else 409, body

    if action == "leave_party":
        friend = await resolve_friend(client, display)
        left = await leave_party(client)
        body = public_result(client, action, display, {"ok": left.get("ok"), "friend": friend})
        return 200, body

    return 400, {
        "ok": False,
        "source": "fortnitepy",
        "error": "action must be status, sign_in, join_party, sit_out, or leave_party.",
        "canPlayInGame": False,
    }


def require_token(request) -> bool:
    expected = os.environ.get("FORTNITEPY_SIDECAR_TOKEN", "").strip()
    if not expected:
        return True
    header = request.headers.get("Authorization", "")
    token = header[7:].strip() if header.lower().startswith("bearer ") else header
    query = request.rel_url.query.get("token", "")
    return token == expected or query == expected


async def serve(client_holder: dict[str, Any]) -> Any:
    from aiohttp import web

    async def health(request):
        if not require_token(request):
            return web.json_response({"ok": False, "error": "unauthorized"}, status=401)
        client = client_holder.get("client")
        return web.json_response(
            {
                "ok": True,
                "source": "fortnitepy",
                "ready": bool(client and client_ready(client) and not getattr(client, "auth_error", None)),
                "configured": client is not None,
                "needsReauth": bool(client and getattr(client, "needs_reauth", False)),
                "error": getattr(client, "auth_error", None) if client else client_holder.get("error"),
                "lexi": lexi_user(client) if client and client_ready(client) else None,
                "canPlayInGame": False,
            }
        )

    async def status(request):
        if not require_token(request):
            return web.json_response({"ok": False, "error": "unauthorized"}, status=401)
        display = request.rel_url.query.get("displayName") or friend_display_name()
        status_code, body = await handle_command(client_holder.get("client"), {"action": "status", "displayName": display})
        return web.json_response(body, status=status_code)

    async def command(request):
        if not require_token(request):
            return web.json_response({"ok": False, "error": "unauthorized"}, status=401)
        try:
            payload = await request.json()
        except Exception:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        status_code, body = await handle_command(client_holder.get("client"), payload)
        return web.json_response(body, status=status_code)

    app = web.Application()
    app.router.add_get("/health", health)
    app.router.add_get("/status", status)
    app.router.add_post("/command", command)
    app.router.add_post("/", command)
    runner = web.AppRunner(app)
    await runner.setup()
    host, port = sidecar_bind()
    site = web.TCPSite(runner, host, port)
    await site.start()
    log(f"Listening on http://{host}:{port} (Friends lobby party only).")
    return runner


async def run() -> None:
    load_env_local()
    holder: dict[str, Any] = {"client": None, "error": None}
    await serve(holder)
    try:
        holder["client"] = build_client()
    except RuntimeError as exc:
        holder["error"] = str(exc)
        log(str(exc))
        await asyncio.Future()
        return
    except Exception as exc:
        holder["error"] = f"{exc}"
        holder["needsReauth"] = True
        log(f"Could not start fortnitepy client: {exc}")
        log(NEEDS_REAUTH)
        await asyncio.Future()
        return

    client = holder["client"]
    try:
        await client.inner.start()
    except Exception as exc:
        client.auth_error = NEEDS_REAUTH
        client.needs_reauth = True
        log(f"Auth failed: {type(exc).__name__}")
        log(NEEDS_REAUTH)
        traceback.print_exc()
        await asyncio.Future()


def main() -> None:
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        log("Stopped.")


if __name__ == "__main__":
    main()
