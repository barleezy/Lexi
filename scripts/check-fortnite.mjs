import {
  DEFAULT_FRIEND_DISPLAY_NAME,
  EPIC_ACCOUNT,
  EPIC_FRIENDS,
  EPIC_PARTY,
  EPIC_PRESENCE,
  EPIC_USER_SEARCH,
  FORTNITE_IOS_CLIENT_ID,
  LOBBY_STATE_KEY,
  MATCHMAKING_INFO_KEY,
  OPEN_PARTY_ERROR,
  SIT_OUT_READINESS,
  buildPartyIntentionPayload,
  buildPartyInvitePayload,
  buildPartyJoinPayload,
  buildSitOutMemberMeta,
  createDeviceAuthUrl,
  currentPartyId,
  displayNameLookupUrl,
  findPartyMember,
  friendAddStatus,
  friendAddUrl,
  friendDisplayName,
  fortniteSetupSteps,
  isFriendAround,
  friendsSummaryUrl,
  isEpicAccountId,
  isFortniteConfigured,
  isSittingOut,
  lexiDisplayNameFromEnv,
  lastOnlineUrl,
  oauthTokenUrl,
  parseAccountLookup,
  parseDeviceAuth,
  parseFortniteAction,
  parseFortniteDisplayName,
  parseUserSearch,
  partyConnectionId,
  partyIdFromInvites,
  partyIntentionUrl,
  partyInviteUrl,
  partyJoinUrl,
  partyLookupUrl,
  partyMemberMetaUrl,
  partyMemberUrl,
  partyPingsUrl,
  partyUserUrl,
  presenceFromLastOnline,
  readLastOnline,
  readinessFromMemberMeta,
  relationFromSummary,
  userSearchUrl,
} from "../lib/voice/fortnite.ts";

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

expect(DEFAULT_FRIEND_DISPLAY_NAME === "TTBarleezy", "default friend is TTBarleezy");
expect(friendDisplayName() === "TTBarleezy", "env default friend is TTBarleezy");
expect(parseFortniteDisplayName(undefined) === "TTBarleezy", "missing name falls back");
expect(parseFortniteDisplayName("  ") === "TTBarleezy", "blank name falls back");
expect(parseFortniteDisplayName("Other") === "Other", "override display name");

expect(parseFortniteAction(undefined) === "status", "default action is status");
expect(parseFortniteAction("add_friend") === "add_friend", "add_friend");
expect(parseFortniteAction("add-friend") === "add_friend", "kebab add-friend");
expect(parseFortniteAction("invite") === "invite", "invite");
expect(parseFortniteAction("sign_in") === "sign_in", "sign_in");
expect(parseFortniteAction("login") === "sign_in", "login is sign_in");
expect(parseFortniteAction("join_party") === "join_party", "join_party");
expect(parseFortniteAction("hop_in_lobby") === "join_party", "hop in lobby is join");
expect(parseFortniteAction("sit_out") === "sit_out", "sit_out");
expect(parseFortniteAction("sitting_out") === "sit_out", "sitting_out");
expect(parseFortniteAction("leave_party") === "leave_party", "leave_party");
expect(parseFortniteAction("explode") === null, "unknown action");

expect(!isFortniteConfigured(), "empty env is not configured");
expect(lexiDisplayNameFromEnv() === "TalkToLexi", "default Epic display name is TalkToLexi");

const jsonAuth = parseDeviceAuth(
  '{"accountId":"aaa","deviceId":"bbb","secret":"ccc"}',
);
expect(jsonAuth?.accountId === "aaa" && jsonAuth.deviceId === "bbb" && jsonAuth.secret === "ccc", "json device auth");
expect(
  parseDeviceAuth({ account_id: "a", device_id: "b", secret: "c" })?.accountId === "a",
  "snake_case device auth",
);
expect(parseDeviceAuth("") === null, "empty device auth");
expect(parseDeviceAuth("{") === null, "invalid json device auth");
expect(parseDeviceAuth({ accountId: "a" }) === null, "incomplete device auth");

expect(isEpicAccountId("94b1569506b04f9f8557af611e8c5e47"), "32-hex account id");
expect(!isEpicAccountId("TTBarleezy"), "display name is not an account id");

expect(
  displayNameLookupUrl("TTBarleezy") ===
    `${EPIC_ACCOUNT}/account/api/public/account/displayName/TTBarleezy`,
  "displayName lookup URL",
);
expect(
  displayNameLookupUrl("A B") ===
    `${EPIC_ACCOUNT}/account/api/public/account/displayName/A%20B`,
  "displayName is encoded",
);
expect(
  userSearchUrl("abc", "TTBarleezy") ===
    `${EPIC_USER_SEARCH}/api/v1/search/abc?prefix=TTBarleezy`,
  "user-search URL",
);
expect(
  friendAddUrl("me", "them") === `${EPIC_FRIENDS}/friends/api/v1/me/friends/them`,
  "friend add URL",
);
expect(friendsSummaryUrl("me").includes("/friends/api/v1/me/summary"), "summary URL");
expect(lastOnlineUrl("me") === `${EPIC_PRESENCE}/presence/api/v1/_/me/last-online`, "last-online URL");
expect(partyUserUrl("me") === `${EPIC_PARTY}/party/api/v1/Fortnite/user/me`, "party user URL");
expect(
  partyInviteUrl("party1", "them") ===
    `${EPIC_PARTY}/party/api/v1/Fortnite/parties/party1/invites/them`,
  "party invite URL",
);
expect(
  partyJoinUrl("party1", "me") ===
    `${EPIC_PARTY}/party/api/v1/Fortnite/parties/party1/members/me/join`,
  "party join URL",
);
expect(
  partyMemberUrl("party1", "me") ===
    `${EPIC_PARTY}/party/api/v1/Fortnite/parties/party1/members/me`,
  "party member URL",
);
expect(
  partyMemberMetaUrl("party1", "me") ===
    `${EPIC_PARTY}/party/api/v1/Fortnite/parties/party1/members/me/meta`,
  "party member meta URL",
);
expect(
  partyIntentionUrl("them", "me") ===
    `${EPIC_PARTY}/party/api/v1/Fortnite/members/them/intentions/me`,
  "party intention URL",
);
expect(
  partyPingsUrl("me", "them") ===
    `${EPIC_PARTY}/party/api/v1/Fortnite/user/me/pings/them/parties`,
  "party pings URL",
);
expect(
  partyLookupUrl("party1") === `${EPIC_PARTY}/party/api/v1/Fortnite/parties/party1`,
  "party lookup URL",
);
expect(
  partyConnectionId("me", "res") === "me@prod.ol.epicgames.com/V2:Fortnite:WIN::res",
  "party connection id",
);
expect(oauthTokenUrl() === `${EPIC_ACCOUNT}/account/api/oauth/token`, "oauth token URL");
expect(
  createDeviceAuthUrl("me") === `${EPIC_ACCOUNT}/account/api/public/account/me/deviceAuth`,
  "create device auth URL",
);
expect(FORTNITE_IOS_CLIENT_ID === "3f69e56c7649492c8cc29f1af08a8a12", "documented Android client id");

const lookup = parseAccountLookup({ id: "94b1569506b04f9f8557af611e8c5e47", displayName: "TTBarleezy" });
expect(lookup?.accountId === "94b1569506b04f9f8557af611e8c5e47", "lookup account id");
expect(lookup?.displayName === "TTBarleezy", "lookup display name");
expect(parseAccountLookup({}) === null, "empty lookup");

const search = parseUserSearch(
  [
    {
      accountId: "94b1569506b04f9f8557af611e8c5e47",
      matchType: "exact",
      matches: [{ value: "TTBarleezy" }],
    },
  ],
  "TTBarleezy",
);
expect(search?.accountId === "94b1569506b04f9f8557af611e8c5e47", "user search exact id");
expect(search?.displayName === "TTBarleezy", "user search exact name");

expect(
  relationFromSummary(
    { friends: [{ accountId: "94b1569506b04f9f8557af611e8c5e47" }], outgoing: [], incoming: [] },
    "94b1569506b04f9f8557af611e8c5e47",
  ) === "friends",
  "summary friends",
);
expect(
  relationFromSummary({ friends: [], outgoing: [{ accountId: "them" }], incoming: [] }, "them") ===
    "outgoing",
  "summary outgoing",
);
expect(relationFromSummary({ friends: [], outgoing: [], incoming: [] }, "them") === "none", "summary none");

expect(friendAddStatus(204, {}) === "sent", "204 is sent");
expect(
  friendAddStatus(400, { errorCode: "errors.com.epicgames.friends.duplicate_friendship" }) ===
    "already_friends",
  "duplicate friendship",
);
expect(
  friendAddStatus(400, { errorCode: "errors.com.epicgames.friends.friend_request_already_sent" }) ===
    "already_sent",
  "already sent",
);
expect(
  friendAddStatus(400, {
    errorCode: "errors.com.epicgames.friends.cannot_friend_due_to_target_settings",
  }) === "privacy_blocked",
  "privacy blocked",
);

const lastOnline = "2026-09-15T12:00:00.000Z";
expect(readLastOnline({ them: [{ last_online: lastOnline }] }, "them") === lastOnline, "last-online array");
expect(readLastOnline({ them: lastOnline }, "them") === lastOnline, "last-online string");
const online = presenceFromLastOnline(lastOnline, Date.parse(lastOnline) + 30_000);
expect(online.state === "online" && online.source === "last-online", "recent last-online is online");
const offline = presenceFromLastOnline(lastOnline, Date.parse(lastOnline) + 10 * 60 * 1000);
expect(offline.state === "offline", "stale last-online is offline");
expect(presenceFromLastOnline(null).state === "unknown", "missing last-online is unknown");
expect(isFriendAround("online", "none") === true, "online is around");
expect(isFriendAround("offline", "friends") === true, "friends stay companion");
expect(isFriendAround("unknown", "none") === false, "unknown non-friend is not around");
expect(isFriendAround("offline", "outgoing") === false, "outgoing offline is not around");

expect(currentPartyId({ current: [{ id: "party-1" }] }) === "party-1", "current party id");
expect(currentPartyId({ current: [] }) === null, "no party");
expect(
  partyIdFromInvites({ invites: [{ party_id: "inv-1", sent_by: "them" }] }, "them") === "inv-1",
  "invite from friend",
);
expect(partyIdFromInvites({ invites: [] }, "them") === null, "no invites");
const member = findPartyMember(
  {
    current: [
      {
        id: "party-1",
        members: [
          {
            account_id: "me",
            revision: 3,
            meta: {
              [LOBBY_STATE_KEY]: JSON.stringify({ LobbyState: { gameReadiness: "NotReady" } }),
            },
          },
        ],
      },
    ],
  },
  "me",
);
expect(member?.partyId === "party-1" && member.revision === 3, "find self member");
expect(readinessFromMemberMeta(member?.meta) === "NotReady", "read NotReady");
expect(!isSittingOut("NotReady"), "NotReady is not sit-out");
expect(isSittingOut("SittingOut"), "SittingOut is sit-out");
expect(isSittingOut("sitting_out"), "sitting_out normalizes");
expect(SIT_OUT_READINESS === "SittingOut", "real sit-out value");
expect(OPEN_PARTY_ERROR === "open a party in lobby and ask again.", "open-party error copy");

const sitOut = buildSitOutMemberMeta(member?.meta);
const lobby = JSON.parse(sitOut[LOBBY_STATE_KEY]);
const matchmaking = JSON.parse(sitOut[MATCHMAKING_INFO_KEY]);
expect(lobby.LobbyState.gameReadiness === "SittingOut", "LobbyState.gameReadiness SittingOut");
expect(matchmaking.MatchmakingInfo.readyStatus === "SittingOut", "MatchmakingInfo.readyStatus SittingOut");
expect(matchmaking.MatchmakingInfo.readyStatusMMId === "", "sit-out clears matchmaking id");

const invite = buildPartyInvitePayload("Lexi");
expect(invite["urn:epic:member:dn_s"] === "Lexi", "invite payload display name");
expect(invite["urn:epic:conn:platform_s"] === "WIN", "invite payload platform");
const join = buildPartyJoinPayload("me", "TalkToLexi");
expect(join.connection.yield_leadership === true, "join yields leadership");
expect(join.meta["urn:epic:member:dn_s"] === "TalkToLexi", "join payload display name");
expect(join.connection.meta["urn:epic:conn:type_s"] === "game", "join connection is game");
expect(buildPartyIntentionPayload()["urn:epic:invite:platformdata_s"] === "", "intention payload");

const setup = fortniteSetupSteps().join(" ");
expect(setup.includes("EPIC_DEVICE_AUTH"), "setup mentions device auth");
expect(setup.includes("TTBarleezy"), "setup mentions default friend");
expect(setup.includes("cannot load Fortnite"), "setup is honest about in-game play");
expect(setup.includes("sit out"), "setup mentions sit out");

console.log("fortnite check ok");
