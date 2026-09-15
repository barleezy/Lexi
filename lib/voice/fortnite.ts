/**
 * Epic-backed Fortnite companion (HTTP only).
 * Device auth + friends/presence/party endpoints used by fnbr.js / fortnitepy.
 * Lexi cannot run the Unreal client or play in-match.
 */

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const DEFAULT_FRIEND_DISPLAY_NAME = "TTBarleezy";

export const FORTNITE_ACTIONS = [
  "add_friend",
  "status",
  "invite",
  "sign_in",
  "join_party",
  "sit_out",
  "leave_party",
] as const;
export type FortniteAction = (typeof FORTNITE_ACTIONS)[number];

/** Exact user-facing error when Ian is not in a joinable lobby party. */
export const OPEN_PARTY_ERROR = "open a party in lobby and ask again.";

/** Real sit-out fields from fortnitepy / current fnbr — not a fake NotReady that still matchmakes. */
export const LOBBY_STATE_KEY = "Default:LobbyState_j";
export const MATCHMAKING_INFO_KEY = "Default:MatchmakingInfo_j";
export const SIT_OUT_READINESS = "SittingOut";

export const EPIC_ACCOUNT = "https://account-public-service-prod.ol.epicgames.com";
export const EPIC_FRIENDS = "https://friends-public-service-prod.ol.epicgames.com";
export const EPIC_PRESENCE = "https://presence-public-service-prod.ol.epicgames.com";
export const EPIC_PARTY = "https://party-service-prod.ol.epicgames.com";
export const EPIC_USER_SEARCH = "https://user-search-service-prod.ol.epicgames.com";

/** Public Fortnite Android game client (not a user password). iOS client 3446cd… is disabled. */
export const FORTNITE_IOS_CLIENT_ID = "3f69e56c7649492c8cc29f1af08a8a12";
export const FORTNITE_IOS_CLIENT_SECRET = "b51ee9cb12234f50a69efa67ef53812e";

const EPIC_AUTH_CLIENTS = [
  { id: FORTNITE_IOS_CLIENT_ID, secret: FORTNITE_IOS_CLIENT_SECRET },
  { id: "af43dc71dd91452396fcdffbd7a8e8a9", secret: "4YXvSEBLFRPLh1hzGZAkfOi5mqupFohZ" },
  { id: "ec684b8c687f479fadea3cb2ad83f5c6", secret: "e1f31c211f28413186262d37a13fc84d" },
  { id: "3446cd72694c4a4485d81b77adbb2141", secret: "9209d4a5e25a457fb9b07489d313b41a" },
] as const;

const ONLINE_WITHIN_MS = 4 * 60 * 1000;
const ACCOUNT_ID = /^[0-9a-f]{32}$/i;

export type DeviceAuth = {
  accountId: string;
  deviceId: string;
  secret: string;
};

export type FriendRelation = "friends" | "outgoing" | "incoming" | "none";

export type FriendRequestStatus =
  | "sent"
  | "already_friends"
  | "already_sent"
  | "incoming_accepted"
  | "privacy_blocked"
  | "not_found"
  | "failed";

export type PresenceState = "online" | "offline" | "unknown";

export type FortnitePresence = {
  state: PresenceState;
  lastOnline: string | null;
  source: "last-online";
};

type CachedToken = {
  accessToken: string;
  accountId: string;
  displayName: string;
  expiresAt: number;
};

type FriendAttempt = {
  displayName: string;
  accountId: string | null;
  request: FriendRequestStatus;
  relation: FriendRelation;
  error?: string;
};

let tokenCache: CachedToken | null = null;
let createdDeviceAuthOnce = false;
let autoFriend: FriendAttempt | null = null;
let autoFriendInflight: Promise<FriendAttempt> | null = null;

export function friendDisplayName() {
  const override = process.env.FORTNITE_FRIEND_DISPLAY_NAME?.trim();
  return override || DEFAULT_FRIEND_DISPLAY_NAME;
}

export function parseDeviceAuth(raw: unknown): DeviceAuth | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return parseDeviceAuth(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const accountId = readString(row.accountId) || readString(row.account_id);
  const deviceId = readString(row.deviceId) || readString(row.device_id);
  const secret = readString(row.secret);
  if (!accountId || !deviceId || !secret) return null;
  return { accountId, deviceId, secret };
}

export function deviceAuthFromEnv(): DeviceAuth | null {
  const fromJson = parseDeviceAuth(process.env.EPIC_DEVICE_AUTH);
  if (fromJson) return fromJson;
  const accountId = process.env.EPIC_ACCOUNT_ID?.trim() ?? "";
  const deviceId = process.env.EPIC_DEVICE_ID?.trim() ?? "";
  const secret = process.env.EPIC_DEVICE_SECRET?.trim() ?? "";
  if (accountId && deviceId && secret) return { accountId, deviceId, secret };
  return null;
}

export function exchangeCodeFromEnv() {
  return process.env.EPIC_EXCHANGE_CODE?.trim() ?? "";
}

export function emailPasswordFromEnv() {
  const email = process.env.EPIC_EMAIL?.trim() ?? "";
  const password = process.env.EPIC_PASSWORD?.trim() ?? "";
  if (!email || !password) return null;
  return { email, password };
}

export function lexiDisplayNameFromEnv() {
  return process.env.EPIC_DISPLAY_NAME?.trim() || "TalkToLexi";
}

export function isFortniteConfigured() {
  return Boolean(deviceAuthFromEnv() || exchangeCodeFromEnv() || emailPasswordFromEnv());
}

export function fortniteSetupSteps() {
  return [
    "Create or use a real Epic account for Lexi (Ian does this — Lexi will not register one).",
    "Get a device auth JSON (fnbr-style { accountId, deviceId, secret }) or a one-time exchange/authorization code.",
    "Authorization code: sign in at Epic, then open https://www.epicgames.com/id/api/redirect?clientId=3f69e56c7649492c8cc29f1af08a8a12&responseType=code and copy `code`.",
    "Paste EPIC_DEVICE_AUTH='{\"accountId\":\"\",\"deviceId\":\"\",\"secret\":\"\"}' into .env.local (never commit it). Or set EPIC_EXCHANGE_CODE, or local EPIC_EMAIL + EPIC_PASSWORD (may hit captcha/2FA).",
    `Restart the server. First successful login auto-sends a friend request to ${friendDisplayName()}.`,
    "Lexi cannot load Fortnite or play in-match. She can sign in, join Ian's party over HTTP, sit out, report last-online, and try a party invite. Voice stays on this Grok call.",
  ];
}

export function parseFortniteAction(raw: unknown): FortniteAction | null {
  if (raw === undefined || raw === null || raw === "") return "status";
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase().replace(/-/g, "_");
  if (value === "add_friend" || value === "addfriend" || value === "friend") return "add_friend";
  if (value === "status" || value === "presence") return "status";
  if (value === "invite" || value === "party_invite") return "invite";
  if (value === "sign_in" || value === "signin" || value === "login") return "sign_in";
  if (value === "join_party" || value === "join" || value === "hop_in" || value === "hop_in_lobby") {
    return "join_party";
  }
  if (value === "sit_out" || value === "sitout" || value === "sitting_out") return "sit_out";
  if (value === "leave_party" || value === "leave") return "leave_party";
  return null;
}

export function isEpicAccountId(value: string) {
  return ACCOUNT_ID.test(value.trim());
}

export function displayNameLookupUrl(displayName: string) {
  return `${EPIC_ACCOUNT}/account/api/public/account/displayName/${encodeURIComponent(displayName)}`;
}

export function userSearchUrl(accountId: string, prefix: string) {
  const params = new URLSearchParams({ prefix });
  return `${EPIC_USER_SEARCH}/api/v1/search/${encodeURIComponent(accountId)}?${params}`;
}

export function friendAddUrl(accountId: string, friendId: string) {
  return `${EPIC_FRIENDS}/friends/api/v1/${accountId}/friends/${friendId}`;
}

export function friendsSummaryUrl(accountId: string) {
  return `${EPIC_FRIENDS}/friends/api/v1/${accountId}/summary?displayNames=true`;
}

export function lastOnlineUrl(accountId: string) {
  return `${EPIC_PRESENCE}/presence/api/v1/_/${accountId}/last-online`;
}

export function partyUserUrl(accountId: string) {
  return `${EPIC_PARTY}/party/api/v1/Fortnite/user/${accountId}`;
}

export function partyInviteUrl(partyId: string, userId: string) {
  return `${EPIC_PARTY}/party/api/v1/Fortnite/parties/${encodeURIComponent(partyId)}/invites/${userId}`;
}

export function partyLookupUrl(partyId: string) {
  return `${EPIC_PARTY}/party/api/v1/Fortnite/parties/${encodeURIComponent(partyId)}`;
}

export function partyJoinUrl(partyId: string, accountId: string) {
  return `${EPIC_PARTY}/party/api/v1/Fortnite/parties/${encodeURIComponent(partyId)}/members/${encodeURIComponent(accountId)}/join`;
}

export function partyMemberUrl(partyId: string, accountId: string) {
  return `${EPIC_PARTY}/party/api/v1/Fortnite/parties/${encodeURIComponent(partyId)}/members/${encodeURIComponent(accountId)}`;
}

export function partyMemberMetaUrl(partyId: string, accountId: string) {
  return `${EPIC_PARTY}/party/api/v1/Fortnite/parties/${encodeURIComponent(partyId)}/members/${encodeURIComponent(accountId)}/meta`;
}

export function partyIntentionUrl(friendId: string, accountId: string) {
  return `${EPIC_PARTY}/party/api/v1/Fortnite/members/${encodeURIComponent(friendId)}/intentions/${encodeURIComponent(accountId)}`;
}

export function partyPingsUrl(accountId: string, friendId: string) {
  return `${EPIC_PARTY}/party/api/v1/Fortnite/user/${encodeURIComponent(accountId)}/pings/${encodeURIComponent(friendId)}/parties`;
}

export function partyConnectionId(accountId: string, resource = randomUUID()) {
  return `${accountId}@prod.ol.epicgames.com/V2:Fortnite:WIN::${resource}`;
}

export function oauthTokenUrl() {
  return `${EPIC_ACCOUNT}/account/api/oauth/token`;
}

export function createDeviceAuthUrl(accountId: string) {
  return `${EPIC_ACCOUNT}/account/api/public/account/${accountId}/deviceAuth`;
}

export function parseAccountLookup(data: unknown): { accountId: string; displayName: string } | null {
  const row = asRecord(data);
  if (!row) return null;
  const accountId = readString(row.id) || readString(row.accountId);
  const displayName = readString(row.displayName) || readString(row.display_name);
  if (!accountId) return null;
  return { accountId, displayName: displayName || accountId };
}

export function parseUserSearch(data: unknown, prefix: string): { accountId: string; displayName: string } | null {
  if (!Array.isArray(data)) return null;
  const needle = prefix.trim().toLowerCase();
  let fallback: { accountId: string; displayName: string } | null = null;
  for (const item of data) {
    const row = asRecord(item);
    if (!row) continue;
    const accountId = readString(row.accountId);
    if (!accountId) continue;
    const matches = Array.isArray(row.matches) ? row.matches : [];
    let displayName = "";
    for (const match of matches) {
      const value = readString(asRecord(match)?.value);
      if (value) {
        displayName = value;
        break;
      }
    }
    const hit = { accountId, displayName: displayName || prefix };
    const matchType = readString(row.matchType).toLowerCase();
    if (matchType === "exact" || hit.displayName.toLowerCase() === needle) return hit;
    if (!fallback) fallback = hit;
  }
  return fallback;
}

export function readLastOnline(data: unknown, accountId: string): string | null {
  const row = asRecord(data);
  if (!row) return null;
  return lastOnlineFromEntry(row[accountId]) ?? lastOnlineFromEntry(row[accountId.toLowerCase()]);
}

function lastOnlineFromEntry(entry: unknown): string | null {
  if (typeof entry === "string" && entry.trim()) return entry.trim();
  if (Array.isArray(entry) && entry[0]) return lastOnlineFromEntry(entry[0]);
  const row = asRecord(entry);
  if (!row) return null;
  return readString(row.last_online) || readString(row.lastOnline) || null;
}

/** Last-online / friends — not live in-match. Used for companion voice, not the Unreal client. */
export function isFriendAround(
  presence: PresenceState | string | null | undefined,
  relation?: FriendRelation | string | null,
) {
  if (presence === "online") return true;
  return relation === "friends";
}

export function presenceFromLastOnline(lastOnline: string | null, now = Date.now()): FortnitePresence {
  if (!lastOnline) return { state: "unknown", lastOnline: null, source: "last-online" };
  const at = Date.parse(lastOnline);
  if (!Number.isFinite(at)) return { state: "unknown", lastOnline, source: "last-online" };
  return {
    state: now - at < ONLINE_WITHIN_MS ? "online" : "offline",
    lastOnline,
    source: "last-online",
  };
}

export function relationFromSummary(summary: unknown, accountId: string): FriendRelation {
  const row = asRecord(summary);
  if (!row) return "none";
  if (listHasAccount(row.friends, accountId)) return "friends";
  if (listHasAccount(row.outgoing, accountId)) return "outgoing";
  if (listHasAccount(row.incoming, accountId)) return "incoming";
  return "none";
}

export function friendAddStatus(httpStatus: number, data: unknown): FriendRequestStatus {
  if (httpStatus === 204 || httpStatus === 200) return "sent";
  const code = epicErrorCode(data);
  if (code.includes("duplicate_friendship")) return "already_friends";
  if (code.includes("friend_request_already_sent")) return "already_sent";
  if (code.includes("cannot_friend_due_to_target_settings")) return "privacy_blocked";
  if (code.includes("account_not_found") || httpStatus === 404) return "not_found";
  return "failed";
}

export function currentPartyId(data: unknown): string | null {
  const row = asRecord(data);
  const current = Array.isArray(row?.current) ? row.current : Array.isArray(data) ? data : [];
  for (const item of current) {
    const party = asRecord(item);
    const id = readString(party?.id) || readString(party?.party_id) || readString(party?.partyId);
    if (id) return id;
  }
  return null;
}

export function partyIdFromInvites(data: unknown, fromAccountId?: string | null) {
  const row = asRecord(data);
  const invites = Array.isArray(row?.invites) ? row.invites : Array.isArray(data) ? data : [];
  const needle = fromAccountId?.trim().toLowerCase() ?? "";
  let fallback: string | null = null;
  for (const item of invites) {
    const invite = asRecord(item);
    if (!invite) continue;
    const id = readString(invite.party_id) || readString(invite.partyId) || readString(invite.id);
    if (!id) continue;
    const sentBy =
      readString(invite.sent_by) ||
      readString(invite.sentBy) ||
      readString(invite.inviter_id) ||
      readString(invite.inviterId);
    if (needle && sentBy && sentBy.toLowerCase() === needle) return id;
    if (!fallback) fallback = id;
  }
  return fallback;
}

export function findPartyMember(data: unknown, accountId: string) {
  const needle = accountId.trim().toLowerCase();
  if (!needle) return null;
  for (const party of partyRecords(data)) {
    const members = Array.isArray(party.members) ? party.members : [];
    const partyId = readString(party.id) || readString(party.party_id) || readString(party.partyId);
    for (const item of members) {
      const member = asRecord(item);
      if (!member) continue;
      const id =
        readString(member.account_id) || readString(member.accountId) || readString(member.id);
      if (id.toLowerCase() !== needle) continue;
      const revision = Number(member.revision);
      return {
        partyId: partyId || null,
        accountId: id,
        revision: Number.isFinite(revision) ? revision : 0,
        meta: asRecord(member.meta) ?? {},
        role: readString(member.role),
      };
    }
  }
  return null;
}

export function partyHasMember(data: unknown, accountId: string) {
  return Boolean(findPartyMember(data, accountId));
}

export function parseJsonField(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" ? value : null;
}

export function readinessFromMemberMeta(meta: unknown) {
  const row = asRecord(meta);
  if (!row) return "";
  const lobby = asRecord(parseJsonField(row[LOBBY_STATE_KEY]));
  const fromLobby = readString(asRecord(lobby?.LobbyState)?.gameReadiness);
  if (fromLobby) return fromLobby;
  const matchmaking = asRecord(parseJsonField(row[MATCHMAKING_INFO_KEY]));
  return readString(asRecord(matchmaking?.MatchmakingInfo)?.readyStatus);
}

export function isSittingOut(readiness: string | null | undefined) {
  const value = (readiness ?? "").trim().toLowerCase().replace(/[_\s]/g, "");
  return value === "sittingout";
}

export function buildSitOutMemberMeta(existing?: Record<string, unknown> | null) {
  const lobby = asRecord(parseJsonField(existing?.[LOBBY_STATE_KEY]));
  const lobbyState = asRecord(lobby?.LobbyState) ?? {};
  const matchmaking = asRecord(parseJsonField(existing?.[MATCHMAKING_INFO_KEY]));
  const matchmakingInfo = asRecord(matchmaking?.MatchmakingInfo) ?? {};
  return {
    [LOBBY_STATE_KEY]: JSON.stringify({
      LobbyState: {
        inGameReadyCheckStatus: lobbyState.inGameReadyCheckStatus ?? null,
        gameReadiness: SIT_OUT_READINESS,
        readyInputType: lobbyState.readyInputType ?? "MouseAndKeyboard",
        currentInputType: lobbyState.currentInputType ?? "MouseAndKeyboard",
        hiddenMatchmakingDelayMax: lobbyState.hiddenMatchmakingDelayMax ?? 0,
        hasPreloadedAthena: lobbyState.hasPreloadedAthena ?? false,
      },
    }),
    [MATCHMAKING_INFO_KEY]: JSON.stringify({
      MatchmakingInfo: {
        ...matchmakingInfo,
        readyStatus: SIT_OUT_READINESS,
        readyStatusMMId: "",
      },
    }),
  };
}

export function buildPartyInvitePayload(inviterDisplayName: string) {
  return {
    "urn:epic:cfg:build-id_s": "1:1:",
    "urn:epic:conn:platform_s": "WIN",
    "urn:epic:conn:type_s": "game",
    "urn:epic:invite:platformdata_s": "",
    "urn:epic:member:dn_s": inviterDisplayName,
  };
}

export function buildPartyJoinPayload(accountId: string, displayName: string) {
  return {
    connection: {
      id: partyConnectionId(accountId),
      meta: {
        "urn:epic:conn:platform_s": "WIN",
        "urn:epic:conn:type_s": "game",
      },
      yield_leadership: true,
      offline_ttl: 300,
    },
    meta: {
      "urn:epic:member:dn_s": displayName,
      "urn:epic:member:joinrequestusers_j": JSON.stringify({
        users: [
          {
            id: accountId,
            dn: displayName,
            plat: "WIN",
            data: JSON.stringify({
              CrossplayPreference: "1",
              SubGame_u: "1",
            }),
          },
        ],
      }),
    },
  };
}

export function buildPartyLeavePayload(accountId: string, displayName: string) {
  return {
    connection: {
      id: partyConnectionId(accountId),
      meta: {
        "urn:epic:conn:platform_s": "WIN",
        "urn:epic:conn:type_s": "game",
      },
    },
    meta: {
      "urn:epic:member:dn_s": displayName,
      "urn:epic:member:type_s": "game",
      "urn:epic:member:platform_s": "WIN",
      "urn:epic:member:joinrequest_j": JSON.stringify({
        CrossplayPreference_i: "1",
      }),
    },
  };
}

export function buildPartyIntentionPayload() {
  return { "urn:epic:invite:platformdata_s": "" };
}

function partyRecords(data: unknown): Record<string, unknown>[] {
  const row = asRecord(data);
  const current = Array.isArray(row?.current)
    ? row.current
    : Array.isArray(row?.parties)
      ? row.parties
      : Array.isArray(data)
        ? data
        : row
          ? [row]
          : [];
  return current.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item));
}

export function parseFortniteDisplayName(raw: unknown, fallback = friendDisplayName()) {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  return value || fallback;
}

export type FortniteCommandInput = {
  action?: unknown;
  displayName?: unknown;
  autoFriend?: unknown;
};

export async function getFortniteStatus(options: { autoFriend?: boolean } = {}) {
  if (!isFortniteConfigured()) {
    return {
      ok: false as const,
      status: 503,
      configured: false,
      canPlayInGame: false,
      error: "Fortnite/Epic is not configured.",
      setup: fortniteSetupSteps(),
      friendDisplayName: friendDisplayName(),
    };
  }

  const session = await loginEpic();
  const targetName = friendDisplayName();
  const friendAttempt =
    options.autoFriend === false ? autoFriend : await ensureDefaultFriend(session, targetName);
  const snapshot = await loadFriendSnapshot(session, targetName, friendAttempt?.accountId ?? null);
  const request = friendAttempt?.request ?? inferRequest(snapshot.relation);

  return {
    ok: true as const,
    status: 200,
    configured: true,
    canPlayInGame: false,
    lexi: { displayName: session.displayName, accountId: session.accountId },
    friend: {
      displayName: snapshot.displayName,
      accountId: snapshot.accountId,
      relation: snapshot.relation,
      request,
      presence: snapshot.presence,
      error: friendAttempt?.error,
    },
    signedIn: true,
    party: partyStateFromSnapshot(snapshot),
    autoFriend: Boolean(friendAttempt),
    deviceAuthCreated: createdDeviceAuthOnce,
  };
}

export async function runFortniteCommand(input: FortniteCommandInput) {
  const action = parseFortniteAction(input.action);
  if (!action) {
    return {
      ok: false as const,
      status: 400,
      configured: isFortniteConfigured(),
      canPlayInGame: false,
      error: "action must be add_friend, status, invite, sign_in, join_party, sit_out, or leave_party.",
    };
  }
  if (!isFortniteConfigured()) {
    return {
      ok: false as const,
      status: 503,
      configured: false,
      canPlayInGame: false,
      error: "Fortnite/Epic is not configured.",
      setup: fortniteSetupSteps(),
      friendDisplayName: friendDisplayName(),
    };
  }

  if (action === "status") return getFortniteStatus({ autoFriend: true });

  const session = await loginEpic({ refresh: action === "sign_in" || action === "join_party" });
  const displayName = parseFortniteDisplayName(input.displayName);
  if (action === "sign_in") {
    const snapshot = await loadFriendSnapshot(session, displayName, null);
    return {
      ok: true as const,
      status: 200,
      configured: true,
      canPlayInGame: false,
      signedIn: true,
      lexi: { displayName: session.displayName, accountId: session.accountId },
      friend: friendStateFromSnapshot(snapshot),
      party: partyStateFromSnapshot(snapshot),
    };
  }
  if (action === "join_party") {
    const join = await joinFriendParty(session, displayName);
    return {
      ok: join.joined,
      status: join.joined ? 200 : join.status,
      configured: true,
      canPlayInGame: false,
      signedIn: true,
      lexi: { displayName: session.displayName, accountId: session.accountId },
      friend: join.friend,
      party: join.party,
      error: join.error,
    };
  }
  if (action === "sit_out") {
    const sit = await sitOutOfParty(session, displayName);
    return {
      ok: sit.sittingOut,
      status: sit.sittingOut ? 200 : sit.status,
      configured: true,
      canPlayInGame: false,
      signedIn: true,
      lexi: { displayName: session.displayName, accountId: session.accountId },
      friend: sit.friend,
      party: sit.party,
      error: sit.error,
    };
  }
  if (action === "leave_party") {
    const leave = await leaveCurrentParty(session, displayName);
    return {
      ok: leave.ok,
      status: leave.ok ? 200 : leave.status,
      configured: true,
      canPlayInGame: false,
      signedIn: true,
      lexi: { displayName: session.displayName, accountId: session.accountId },
      friend: leave.friend,
      party: leave.party,
      error: leave.error,
    };
  }
  if (action === "add_friend") {
    const attempt = await addFriend(session, displayName);
    if (displayName.toLowerCase() === friendDisplayName().toLowerCase()) autoFriend = attempt;
    const snapshot = await loadFriendSnapshot(session, displayName, attempt.accountId);
    return {
      ok: attempt.request !== "failed" && attempt.request !== "not_found",
      status: attempt.request === "not_found" ? 404 : attempt.request === "failed" ? 502 : 200,
      configured: true,
      canPlayInGame: false,
      lexi: { displayName: session.displayName, accountId: session.accountId },
      friend: {
        displayName: snapshot.displayName,
        accountId: snapshot.accountId ?? attempt.accountId,
        relation: snapshot.relation,
        request: attempt.request,
        presence: snapshot.presence,
        error: attempt.error,
      },
    };
  }

  const invite = await inviteFriend(session, displayName);
  return {
    ok: invite.invited,
    status: invite.invited ? 200 : invite.status,
    configured: true,
    canPlayInGame: false,
    lexi: { displayName: session.displayName, accountId: session.accountId },
    friend: invite.friend,
    party: {
      inParty: invite.inParty,
      invited: invite.invited,
      error: invite.error,
    },
  };
}

async function loginEpic(options: { refresh?: boolean } = {}): Promise<CachedToken> {
  if (!options.refresh && tokenCache && tokenCache.expiresAt > Date.now() + 15_000) return tokenCache;

  const device = deviceAuthFromEnv();
  const exchange = exchangeCodeFromEnv();
  const emailPassword = emailPasswordFromEnv();
  let token: CachedToken;
  if (device) {
    token = await grantWithClients({
      grant_type: "device_auth",
      account_id: device.accountId,
      device_id: device.deviceId,
      secret: device.secret,
    });
  } else if (exchange) {
    token = await grantFromCode(exchange);
    await maybeCreateDeviceAuth(token);
  } else if (emailPassword) {
    token = await grantFromEmailPassword(emailPassword);
    await maybeCreateDeviceAuth(token);
  } else {
    throw new FortniteHttpError(503, "Fortnite/Epic is not configured.");
  }
  if (!token.displayName || token.displayName === token.accountId) {
    token.displayName = lexiDisplayNameFromEnv();
  }
  tokenCache = token;
  return token;
}

async function grantFromCode(code: string) {
  const android = { id: FORTNITE_IOS_CLIENT_ID, secret: FORTNITE_IOS_CLIENT_SECRET };
  try {
    return await grantToken({ grant_type: "authorization_code", code }, android);
  } catch (error) {
    if (!(error instanceof FortniteHttpError) || error.status < 400 || error.status >= 500) {
      throw error;
    }
    return grantToken({ grant_type: "exchange_code", exchange_code: code }, android);
  }
}

async function grantWithClients(
  fallbackBody: Record<string, string>,
  attempts?: Array<{ grant_type: string; extra: Record<string, string> }>,
) {
  const bodies = attempts
    ? attempts.map((attempt) => ({ grant_type: attempt.grant_type, ...attempt.extra }))
    : [fallbackBody];
  let lastError: unknown;
  for (const client of epicAuthClients()) {
    for (const body of bodies) {
      try {
        return await grantToken(body, client);
      } catch (error) {
        lastError = error;
        if (!(error instanceof FortniteHttpError) || error.status < 400 || error.status >= 500) {
          throw error;
        }
      }
    }
  }
  throw lastError instanceof Error ? lastError : new FortniteHttpError(502, "Epic login failed.");
}

function epicAuthClients() {
  const overrideId = process.env.EPIC_CLIENT_ID?.trim();
  const overrideSecret = process.env.EPIC_CLIENT_SECRET?.trim();
  if (overrideId && overrideSecret) return [{ id: overrideId, secret: overrideSecret }, ...EPIC_AUTH_CLIENTS];
  return EPIC_AUTH_CLIENTS;
}

const EPIC_WEB = "https://www.epicgames.com";
const EPIC_WEB_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function grantFromEmailPassword(creds: { email: string; password: string }) {
  const jar = new Map<string, string>();
  const xsrf = async () => {
    const response = await epicWebFetch(jar, `${EPIC_WEB}/id/api/csrf`, { method: "GET" });
    const token = jar.get("XSRF-TOKEN") || jar.get("xsrf-token");
    if (!token) {
      throw new FortniteHttpError(502, "Epic login did not return an XSRF token.", await readJson(response));
    }
    return token;
  };

  let token = await xsrf();
  await epicWebFetch(jar, `${EPIC_WEB}/id/api/reputation`, {
    method: "GET",
    headers: { "x-xsrf-token": token },
  });

  token = jar.get("XSRF-TOKEN") || token;
  const login = await epicWebFetch(jar, `${EPIC_WEB}/id/api/login`, {
    method: "POST",
    headers: {
      "x-xsrf-token": token,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      email: creds.email,
      password: creds.password,
      rememberMe: "true",
      captcha: "",
    }).toString(),
  });
  const loginBody = await readJson(login);
  const loginCode = epicErrorCode(loginBody);
  if (!login.ok) {
    if (loginCode.includes("two_factor_authentication.required")) {
      const method = readString(asRecord(asRecord(loginBody)?.metadata)?.twoFactorMethod) || "email";
      const otp = process.env.EPIC_2FA_CODE?.trim() ?? "";
      if (!otp) {
        throw new FortniteHttpError(
          401,
          `Epic requires 2FA (${method}). Set EPIC_2FA_CODE in .env.local with the current code and retry.`,
          loginBody,
        );
      }
      token = (await xsrf()) || token;
      const mfa = await epicWebFetch(jar, `${EPIC_WEB}/id/api/login/mfa`, {
        method: "POST",
        headers: {
          "x-xsrf-token": token,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          code: otp,
          method,
          rememberDevice: "false",
        }).toString(),
      });
      const mfaBody = await readJson(mfa);
      if (!mfa.ok) {
        throw new FortniteHttpError(
          401,
          epicErrorMessage(mfaBody) || "Epic 2FA code was rejected.",
          mfaBody,
        );
      }
    } else if (loginCode.includes("captcha_invalid") || loginCode.includes("captcha")) {
      throw new FortniteHttpError(
        403,
        "Epic blocked email/password with a captcha. Ian must sign in in a browser and paste an authorization code as EPIC_EXCHANGE_CODE.",
        loginBody,
      );
    } else if (loginCode.includes("invalid_account_credentials")) {
      throw new FortniteHttpError(401, "Epic rejected the email/password login.", loginBody);
    } else if (loginCode.includes("throttled")) {
      throw new FortniteHttpError(429, "Epic throttled the login. Wait and retry, or use an authorization code.", loginBody);
    } else {
      throw new FortniteHttpError(
        login.status >= 400 && login.status < 600 ? login.status : 502,
        epicErrorMessage(loginBody) || "Epic email/password login failed.",
        loginBody,
      );
    }
  }

  token = jar.get("XSRF-TOKEN") || token;
  await epicWebFetch(jar, `${EPIC_WEB}/id/api/redirect`, {
    method: "GET",
    headers: { "x-xsrf-token": token },
  });
  token = (await xsrf()) || token;
  const exchange = await epicWebFetch(jar, `${EPIC_WEB}/id/api/exchange/generate`, {
    method: "POST",
    headers: { "x-xsrf-token": token },
  });
  const exchangeBody = await readJson(exchange);
  const code = readString(asRecord(exchangeBody)?.code);
  if (!exchange.ok || !code) {
    throw new FortniteHttpError(
      exchange.status >= 400 && exchange.status < 600 ? exchange.status : 502,
      epicErrorMessage(exchangeBody) || "Epic did not return an exchange code after login.",
      exchangeBody,
    );
  }
  return grantFromCode(code);
}

async function epicWebFetch(jar: Map<string, string>, url: string, init: RequestInit) {
  const headers = new Headers(init.headers);
  headers.set("User-Agent", EPIC_WEB_UA);
  const cookie = cookieHeader(jar);
  if (cookie) headers.set("Cookie", cookie);
  if (!headers.has("Accept")) headers.set("Accept", "application/json, text/plain, */*");
  const response = await fetch(url, { ...init, headers, redirect: "manual" });
  applySetCookies(jar, response);
  return response;
}

function applySetCookies(jar: Map<string, string>, response: Response) {
  const cookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : headerAll(response.headers, "set-cookie");
  for (const raw of cookies) {
    const part = raw.split(";")[0] ?? "";
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    jar.set(part.slice(0, eq), part.slice(eq + 1));
  }
}

function headerAll(headers: Headers, name: string) {
  const single = headers.get(name);
  return single ? [single] : [];
}

function cookieHeader(jar: Map<string, string>) {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function persistDeviceAuthToEnvLocal(auth: DeviceAuth) {
  const value = JSON.stringify(auth);
  process.env.EPIC_DEVICE_AUTH = value;
  try {
    const path = resolve(process.cwd(), ".env.local");
    let text = "";
    try {
      text = readFileSync(path, "utf8");
    } catch {
      text = "";
    }
    const line = `EPIC_DEVICE_AUTH='${value}'`;
    if (/^EPIC_DEVICE_AUTH=/m.test(text)) {
      text = text.replace(/^EPIC_DEVICE_AUTH=.*$/m, line);
    } else {
      text = `${text.replace(/\s*$/, "")}\n${line}\n`;
    }
    if (/^EPIC_EXCHANGE_CODE=/m.test(text)) {
      text = text.replace(/^EPIC_EXCHANGE_CODE=.*$/m, "EPIC_EXCHANGE_CODE=");
    }
    process.env.EPIC_EXCHANGE_CODE = "";
    writeFileSync(path, text);
    console.info("[fortnite] Wrote EPIC_DEVICE_AUTH to .env.local and cleared the one-shot code.");
  } catch {
    console.info("[fortnite] Logged in and created device auth, but could not write .env.local.");
  }
}

async function grantToken(
  body: Record<string, string>,
  client = epicAuthClients()[0],
): Promise<CachedToken> {
  const clientId = client.id;
  const clientSecret = client.secret;
  const response = await epicFetch(oauthTokenUrl(), {
    method: "POST",
    headers: {
      Authorization: `basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new FortniteHttpError(response.status, epicErrorMessage(data) || "Epic login failed.", data);
  }
  const accessToken = readString(asRecord(data)?.access_token);
  const accountId = readString(asRecord(data)?.account_id);
  const displayName = readString(asRecord(data)?.displayName) || readString(asRecord(data)?.display_name);
  const expiresIn = Number(asRecord(data)?.expires_in);
  if (!accessToken || !accountId) {
    throw new FortniteHttpError(502, "Epic token response was missing access_token or account_id.", data);
  }
  return {
    accessToken,
    accountId,
    displayName: displayName || accountId,
    expiresAt: Date.now() + Math.max(30, Number.isFinite(expiresIn) ? expiresIn : 300) * 1000,
  };
}

async function maybeCreateDeviceAuth(session: CachedToken) {
  if (createdDeviceAuthOnce || deviceAuthFromEnv()) return;
  const response = await epicFetch(createDeviceAuthUrl(session.accountId), {
    method: "POST",
    headers: { Authorization: `bearer ${session.accessToken}` },
  });
  const data = await readJson(response);
  if (!response.ok) return;
  const created = parseDeviceAuth(data);
  if (!created) return;
  createdDeviceAuthOnce = true;
  persistDeviceAuthToEnvLocal(created);
}

async function ensureDefaultFriend(session: CachedToken, displayName: string) {
  if (autoFriend && isSettledFriend(autoFriend)) return autoFriend;
  if (!autoFriendInflight) {
    autoFriendInflight = addFriend(session, displayName)
      .then((attempt) => {
        autoFriend = attempt;
        return attempt;
      })
      .finally(() => {
        autoFriendInflight = null;
      });
  }
  return autoFriendInflight;
}

async function addFriend(session: CachedToken, displayName: string): Promise<FriendAttempt> {
  const resolved = await resolveAccount(session, displayName);
  if (!resolved) {
    return {
      displayName,
      accountId: null,
      request: "not_found",
      relation: "none",
      error: `Could not resolve Epic account ${displayName}.`,
    };
  }

  const summary = await fetchJson(
    session,
    friendsSummaryUrl(session.accountId),
    "GET",
  ).catch(() => null);
  const existing = relationFromSummary(summary, resolved.accountId);
  if (existing === "friends") {
    return { displayName: resolved.displayName, accountId: resolved.accountId, request: "already_friends", relation: "friends" };
  }
  if (existing === "outgoing") {
    return { displayName: resolved.displayName, accountId: resolved.accountId, request: "already_sent", relation: "outgoing" };
  }

  const response = await epicFetch(friendAddUrl(session.accountId, resolved.accountId), {
    method: "POST",
    headers: { Authorization: `bearer ${session.accessToken}` },
  });
  const data = response.status === 204 ? {} : await readJson(response);
  const request = friendAddStatus(response.status, data);
  const acceptedIncoming =
    existing === "incoming" && (request === "sent" || request === "already_friends");
  const relation: FriendRelation = acceptedIncoming
    ? "friends"
    : request === "already_friends"
      ? "friends"
      : request === "already_sent" || request === "sent"
        ? "outgoing"
        : existing;
  return {
    displayName: resolved.displayName,
    accountId: resolved.accountId,
    request: acceptedIncoming ? "incoming_accepted" : request,
    relation,
    error: request === "failed" || request === "privacy_blocked" || request === "not_found"
      ? epicErrorMessage(data) || `Friend request to ${resolved.displayName} failed.`
      : undefined,
  };
}

async function inviteFriend(session: CachedToken, displayName: string) {
  const snapshot = await loadFriendSnapshot(session, displayName, null);
  if (!snapshot.accountId) {
    return {
      invited: false,
      inParty: false,
      status: 404,
      error: `Could not resolve Epic account ${displayName}.`,
      friend: snapshot,
    };
  }
  if (snapshot.relation !== "friends") {
    return {
      invited: false,
      inParty: Boolean(snapshot.partyId),
      status: 409,
      error: `${snapshot.displayName} is not on Lexi's friends list yet. Accept the request, then invite from lobby.`,
      friend: snapshot,
    };
  }
  if (!snapshot.partyId) {
    return {
      invited: false,
      inParty: false,
      status: 409,
      error:
        "Lexi is not in a Fortnite party. She cannot open the game client. Invite her when you are in lobby.",
      friend: snapshot,
    };
  }

  const response = await epicFetch(partyInviteUrl(snapshot.partyId, snapshot.accountId), {
    method: "POST",
    headers: {
      Authorization: `bearer ${session.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildPartyInvitePayload(session.displayName)),
  });
  const data = response.status === 204 ? {} : await readJson(response);
  if (!response.ok) {
    return {
      invited: false,
      inParty: true,
      status: response.status >= 400 && response.status < 500 ? response.status : 502,
      error: epicErrorMessage(data) || "Party invite failed.",
      friend: snapshot,
    };
  }
  return { invited: true, inParty: true, status: 200, friend: snapshot };
}

async function joinFriendParty(session: CachedToken, displayName: string) {
  const snapshot = await loadFriendSnapshot(session, displayName, null);
  if (!snapshot.accountId) {
    return failParty(404, `Could not resolve Epic account ${displayName}.`, snapshot);
  }
  if (snapshot.relation !== "friends") {
    return failParty(
      409,
      `${snapshot.displayName} is not on Lexi's friends list yet. Accept the request, then open a party in lobby and ask again.`,
      snapshot,
    );
  }

  if (snapshot.withFriend && snapshot.partyId) {
    const sit = await applySitOut(session, snapshot.partyId);
    const next = await loadFriendSnapshot(session, displayName, snapshot.accountId);
    if (!sit.ok) {
      return {
        joined: true,
        status: 200,
        friend: friendStateFromSnapshot(next),
        party: { ...partyStateFromSnapshot(next), error: sit.error },
        error: sit.error,
      };
    }
    return {
      joined: true,
      status: 200,
      friend: friendStateFromSnapshot(next),
      party: partyStateFromSnapshot(next),
      error: undefined,
    };
  }

  const target = await findJoinableParty(session, snapshot.accountId, snapshot.partyId);
  if (!target) {
    await requestToJoin(session, snapshot.accountId).catch(() => null);
    const retry = await findJoinableParty(session, snapshot.accountId, null);
    if (!retry) {
      return failParty(409, OPEN_PARTY_ERROR, snapshot);
    }
    return completeJoin(session, displayName, snapshot.accountId, retry.partyId, snapshot.partyId);
  }

  return completeJoin(session, displayName, snapshot.accountId, target.partyId, snapshot.partyId);
}

async function completeJoin(
  session: CachedToken,
  displayName: string,
  friendId: string,
  partyId: string,
  currentPartyIdValue: string | null,
) {
  if (currentPartyIdValue && currentPartyIdValue !== partyId) {
    await deletePartyMembership(session, currentPartyIdValue);
  }

  const joined = await postPartyJoin(session, partyId);
  if (!joined.ok) {
    if (joined.code.includes("user_already_in_party")) {
      const sit = await applySitOut(session, partyId);
      const next = await loadFriendSnapshot(session, displayName, friendId);
      return {
        joined: true,
        status: 200,
        friend: friendStateFromSnapshot(next),
        party: sit.ok ? partyStateFromSnapshot(next) : { ...partyStateFromSnapshot(next), error: sit.error },
        error: sit.ok ? undefined : sit.error,
      };
    }
    if (joined.code.includes("user_has_party") && currentPartyIdValue) {
      await deletePartyMembership(session, currentPartyIdValue);
      const retry = await postPartyJoin(session, partyId);
      if (retry.ok) {
        return finishJoined(session, displayName, friendId, partyId);
      }
    }
    if (
      joined.status === 403 ||
      joined.code.includes("party_query_forbidden") ||
      joined.code.includes("cannot_join") ||
      joined.code.includes("user_has_no_party") ||
      joined.code.includes("party_not_found")
    ) {
      const snapshot = await loadFriendSnapshot(session, displayName, friendId);
      return failParty(409, OPEN_PARTY_ERROR, snapshot);
    }
    const snapshot = await loadFriendSnapshot(session, displayName, friendId);
    return failParty(
      joined.status >= 400 && joined.status < 500 ? joined.status : 502,
      joined.error || "Party join failed.",
      snapshot,
    );
  }

  return finishJoined(session, displayName, friendId, partyId);
}

async function finishJoined(session: CachedToken, displayName: string, friendId: string, partyId: string) {
  const sit = await applySitOut(session, partyId);
  const next = await loadFriendSnapshot(session, displayName, friendId);
  return {
    joined: true,
    status: 200,
    friend: friendStateFromSnapshot(next),
    party: sit.ok ? partyStateFromSnapshot(next) : { ...partyStateFromSnapshot(next), error: sit.error },
    error: sit.ok ? undefined : sit.error,
  };
}

async function sitOutOfParty(session: CachedToken, displayName: string) {
  const snapshot = await loadFriendSnapshot(session, displayName, null);
  if (!snapshot.partyId) {
    return {
      sittingOut: false,
      status: 409,
      error: OPEN_PARTY_ERROR,
      friend: friendStateFromSnapshot(snapshot),
      party: partyStateFromSnapshot(snapshot),
    };
  }
  const sit = await applySitOut(session, snapshot.partyId);
  const next = await loadFriendSnapshot(session, displayName, snapshot.accountId);
  return {
    sittingOut: sit.ok,
    status: sit.ok ? 200 : sit.status,
    error: sit.error,
    friend: friendStateFromSnapshot(next),
    party: partyStateFromSnapshot(next),
  };
}

async function leaveCurrentParty(session: CachedToken, displayName: string) {
  const snapshot = await loadFriendSnapshot(session, displayName, null);
  if (!snapshot.partyId) {
    return {
      ok: true,
      status: 200,
      friend: friendStateFromSnapshot(snapshot),
      party: partyStateFromSnapshot(snapshot),
    };
  }
  const left = await deletePartyMembership(session, snapshot.partyId);
  const next = await loadFriendSnapshot(session, displayName, snapshot.accountId);
  return {
    ok: left.ok,
    status: left.ok ? 200 : left.status,
    error: left.error,
    friend: friendStateFromSnapshot(next),
    party: partyStateFromSnapshot(next),
  };
}

async function findJoinableParty(session: CachedToken, friendId: string, selfPartyId: string | null) {
  const friendParty = await fetchJson(session, partyUserUrl(friendId), "GET").catch(() => null);
  const friendPartyId = currentPartyId(friendParty);
  if (friendPartyId) return { partyId: friendPartyId, source: "friend_current" as const };

  if (selfPartyId && friendParty && partyHasMember(friendParty, session.accountId)) {
    return { partyId: selfPartyId, source: "already_in" as const };
  }

  const selfParty = await fetchJson(session, partyUserUrl(session.accountId), "GET").catch(() => null);
  const inviteId = partyIdFromInvites(selfParty, friendId);
  if (inviteId) return { partyId: inviteId, source: "invite" as const };

  const pings = await fetchJson(session, partyPingsUrl(session.accountId, friendId), "GET").catch(() => null);
  const pingId = currentPartyId(pings);
  if (pingId) return { partyId: pingId, source: "ping" as const };

  return null;
}

async function requestToJoin(session: CachedToken, friendId: string) {
  const response = await epicFetch(partyIntentionUrl(friendId, session.accountId), {
    method: "POST",
    headers: {
      Authorization: `bearer ${session.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildPartyIntentionPayload()),
  });
  const data = response.status === 204 ? {} : await readJson(response);
  if (!response.ok) {
    throw new FortniteHttpError(
      response.status,
      epicErrorMessage(data) || "Party join request failed.",
      data,
    );
  }
  return data;
}

async function postPartyJoin(session: CachedToken, partyId: string) {
  const response = await epicFetch(partyJoinUrl(partyId, session.accountId), {
    method: "POST",
    headers: {
      Authorization: `bearer ${session.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildPartyJoinPayload(session.accountId, session.displayName)),
  });
  const data = response.status === 204 ? {} : await readJson(response);
  if (!response.ok) {
    return {
      ok: false as const,
      status: response.status,
      code: epicErrorCode(data),
      error: epicErrorMessage(data) || "Party join failed.",
    };
  }
  return { ok: true as const, status: response.status, code: "", error: undefined };
}

async function applySitOut(session: CachedToken, partyId: string, revisionHint?: number) {
  const payload = await fetchJson(session, partyUserUrl(session.accountId), "GET").catch(() => null);
  const member = findPartyMember(payload, session.accountId);
  if (!member?.partyId) {
    const lookedUp = await fetchJson(session, partyLookupUrl(partyId), "GET").catch(() => null);
    const fromParty = findPartyMember(lookedUp, session.accountId);
    if (!fromParty) {
      return { ok: false as const, status: 409, error: OPEN_PARTY_ERROR };
    }
    return patchSitOut(session, fromParty.partyId || partyId, fromParty.revision, fromParty.meta);
  }
  return patchSitOut(session, member.partyId || partyId, revisionHint ?? member.revision, member.meta);
}

async function patchSitOut(
  session: CachedToken,
  partyId: string,
  revision: number,
  meta: Record<string, unknown>,
) {
  const response = await epicFetch(partyMemberMetaUrl(partyId, session.accountId), {
    method: "PATCH",
    headers: {
      Authorization: `bearer ${session.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      delete: [],
      update: buildSitOutMemberMeta(meta),
      override: {},
      revision,
    }),
  });
  const data = response.status === 204 ? {} : await readJson(response);
  if (response.ok) return { ok: true as const, status: 200, error: undefined };
  if (epicErrorCode(data).includes("stale_revision")) {
    const nextRevision = staleRevision(data);
    if (nextRevision !== null && nextRevision !== revision) {
      return patchSitOut(session, partyId, nextRevision, meta);
    }
  }
  return {
    ok: false as const,
    status: response.status >= 400 && response.status < 500 ? response.status : 502,
    error: epicErrorMessage(data) || "Could not set SittingOut.",
  };
}

async function deletePartyMembership(session: CachedToken, partyId: string) {
  const response = await epicFetch(partyMemberUrl(partyId, session.accountId), {
    method: "DELETE",
    headers: {
      Authorization: `bearer ${session.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildPartyLeavePayload(session.accountId, session.displayName)),
  });
  const data = response.status === 204 ? {} : await readJson(response);
  if (!response.ok && !epicErrorCode(data).includes("party_not_found")) {
    return {
      ok: false as const,
      status: response.status >= 400 && response.status < 500 ? response.status : 502,
      error: epicErrorMessage(data) || "Could not leave the party.",
    };
  }
  return { ok: true as const, status: 200, error: undefined };
}

function failParty(status: number, error: string, snapshot: FriendSnapshot) {
  return {
    joined: false,
    status,
    error,
    friend: friendStateFromSnapshot(snapshot),
    party: { ...partyStateFromSnapshot(snapshot), error },
  };
}

function friendStateFromSnapshot(snapshot: FriendSnapshot) {
  return {
    displayName: snapshot.displayName,
    accountId: snapshot.accountId,
    relation: snapshot.relation,
    request: inferRequest(snapshot.relation),
    presence: snapshot.presence,
  };
}

function partyStateFromSnapshot(snapshot: FriendSnapshot) {
  return {
    inParty: Boolean(snapshot.partyId),
    partyId: snapshot.partyId,
    sittingOut: snapshot.sittingOut,
    readiness: snapshot.readiness,
    withFriend: snapshot.withFriend,
    friendPartyId: snapshot.friendPartyId,
    comms: "grok_voice" as const,
  };
}

function staleRevision(data: unknown) {
  const row = asRecord(data);
  const vars = Array.isArray(row?.messageVars) ? row.messageVars : [];
  const n = Number(vars[1] ?? vars[0]);
  return Number.isFinite(n) ? n : null;
}

type FriendSnapshot = {
  displayName: string;
  accountId: string | null;
  relation: FriendRelation;
  presence: FortnitePresence;
  partyId: string | null;
  friendPartyId: string | null;
  sittingOut: boolean;
  readiness: string | null;
  withFriend: boolean;
};

async function loadFriendSnapshot(session: CachedToken, displayName: string, knownId: string | null) {
  const resolved =
    knownId && isEpicAccountId(knownId)
      ? { accountId: knownId, displayName }
      : await resolveAccount(session, displayName);
  const summary = await fetchJson(session, friendsSummaryUrl(session.accountId), "GET").catch(() => null);
  const lastOnlinePayload = await fetchJson(session, lastOnlineUrl(session.accountId), "GET").catch(() => null);
  const selfPartyPayload = await fetchJson(session, partyUserUrl(session.accountId), "GET").catch(() => null);
  const accountId = resolved?.accountId ?? null;
  const friendPartyPayload = accountId
    ? await fetchJson(session, partyUserUrl(accountId), "GET").catch(() => null)
    : null;
  const lastOnline = accountId ? readLastOnline(lastOnlinePayload, accountId) : null;
  const partyId = currentPartyId(selfPartyPayload);
  const friendPartyId = currentPartyId(friendPartyPayload);
  const selfMember = findPartyMember(selfPartyPayload, session.accountId);
  const readiness = readinessFromMemberMeta(selfMember?.meta) || null;
  const withFriend = Boolean(
    (partyId && friendPartyId && partyId === friendPartyId) ||
      (accountId && partyHasMember(selfPartyPayload, accountId)),
  );
  return {
    displayName: resolved?.displayName || displayName,
    accountId,
    relation: accountId ? relationFromSummary(summary, accountId) : ("none" as FriendRelation),
    presence: presenceFromLastOnline(lastOnline),
    partyId,
    friendPartyId,
    sittingOut: isSittingOut(readiness),
    readiness,
    withFriend,
  };
}

async function resolveAccount(session: CachedToken, nameOrId: string) {
  const value = nameOrId.trim();
  if (!value) return null;
  if (isEpicAccountId(value)) {
    return { accountId: value, displayName: value };
  }
  const byName = await fetchJson(session, displayNameLookupUrl(value), "GET").catch(() => null);
  const parsed = parseAccountLookup(byName);
  if (parsed) return parsed;
  const search = await fetchJson(session, userSearchUrl(session.accountId, value), "GET").catch(() => null);
  return parseUserSearch(search, value);
}

async function fetchJson(
  session: CachedToken,
  url: string,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
  body?: unknown,
) {
  const headers: Record<string, string> = { Authorization: `bearer ${session.accessToken}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await epicFetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = response.status === 204 ? {} : await readJson(response);
  if (!response.ok) {
    throw new FortniteHttpError(response.status, epicErrorMessage(data) || `Epic request failed (${response.status}).`, data);
  }
  return data;
}

function epicFetch(url: string, init: RequestInit) {
  const headers = new Headers(init.headers);
  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", "Fortnite/++Fortnite+Release-32.00-CL-00000000 Windows/10");
  }
  return fetch(url, { ...init, headers });
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { errorMessage: text.slice(0, 200) };
  }
}

function listHasAccount(list: unknown, accountId: string) {
  if (!Array.isArray(list)) return false;
  const needle = accountId.toLowerCase();
  return list.some((item) => {
    const row = asRecord(item);
    const id = readString(row?.accountId) || readString(row?.account_id) || readString(row?.id);
    return id.toLowerCase() === needle;
  });
}

function inferRequest(relation: FriendRelation): FriendRequestStatus | undefined {
  if (relation === "friends") return "already_friends";
  if (relation === "outgoing") return "already_sent";
  return undefined;
}

function isSettledFriend(attempt: FriendAttempt) {
  return (
    attempt.request === "sent" ||
    attempt.request === "already_friends" ||
    attempt.request === "already_sent" ||
    attempt.request === "incoming_accepted" ||
    attempt.request === "privacy_blocked"
  );
}

function epicErrorCode(data: unknown) {
  return readString(asRecord(data)?.errorCode).toLowerCase();
}

function epicErrorMessage(data: unknown) {
  const row = asRecord(data);
  return (
    readString(row?.errorMessage) ||
    readString(row?.error_description) ||
    readString(row?.message) ||
    readString(asRecord(row?.error)?.message)
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

class FortniteHttpError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export function fortniteErrorStatus(error: unknown) {
  if (error instanceof FortniteHttpError) return error.status >= 400 && error.status < 600 ? error.status : 502;
  return 502;
}

export function fortniteErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Fortnite request failed.";
}
