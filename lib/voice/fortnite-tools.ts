/** Client-safe Fortnite tool metadata. Keep Node fs/crypto out of this file. */

export function fortniteRealtimeTools() {
  return [
    {
      type: "function",
      name: "fortnite_add_friend",
      description:
        "Send or resend an Epic friend request from Lexi's Fortnite account. Default target is TTBarleezy. Tokens stay on the server. Does not load the game.",
      parameters: {
        type: "object",
        properties: {
          display_name: {
            type: "string",
            description: "Epic / in-game display name to add. Default TTBarleezy.",
          },
        },
      },
    },
    {
      type: "function",
      name: "fortnite_status",
      description:
        "Check Epic HTTP token, whether TTBarleezy (or another name) is a friend, last-online, and whether Lexi is in Ian's party (withFriend/inIanParty/visibleInFortnite). An Epic token is not being in Fortnite and does not make TalkToLexi appear online. Only report being in Fortnite if withFriend is true. Not live in-match presence. This Grok call is the voice chat. Does not play Fortnite.",
      parameters: {
        type: "object",
        properties: {
          display_name: {
            type: "string",
            description: "Whose friend/online status to check. Default TTBarleezy.",
          },
        },
      },
    },
    {
      type: "function",
      name: "fortnite_invite",
      description:
        "Try to send a Fortnite party invite over Epic's party HTTP API. Fails if Lexi is not already in a party — she cannot open the game. Prefer joining Ian's party with fortnite_join_party.",
      parameters: {
        type: "object",
        properties: {
          display_name: {
            type: "string",
            description: "Friend to invite. Default TTBarleezy.",
          },
        },
      },
    },
    {
      type: "function",
      name: "fortnite_sign_in",
      description:
        "Refresh TalkToLexi's Epic HTTP token from stored device auth. This does not load Fortnite, does not sign her into the game, and does not make TalkToLexi appear online or in the lobby. After this tool, say she refreshed the server token and is not visible in-game unless withFriend/inIanParty is true. Tokens stay on the server. Use when Ian says sign in.",
      parameters: { type: "object", properties: {} },
    },
    {
      type: "function",
      name: "fortnite_join_party",
      description:
        "Join Ian's (TTBarleezy) Fortnite Friends lobby party via the fortnitepy sidecar (friend.join_party / !join YourName), then sit out. She lands in the lobby party, not a match. Only report being in Fortnite if the tool says withFriend/inIanParty/visibleInFortnite is true. An Epic token or epicHttpReady alone is not in-game and does not make her appear online. Speak on this Grok voice call. If he has no open party, the tool says to open a party in lobby and ask again. If a join request is waiting, the tool says to accept TalkToLexi in Friends lobby and ask again.",
      parameters: {
        type: "object",
        properties: {
          display_name: {
            type: "string",
            description: "Friend whose party to join. Default TTBarleezy.",
          },
        },
      },
    },
    {
      type: "function",
      name: "fortnite_sit_out",
      description:
        "Set SittingOut on Lexi's party member (LobbyState.gameReadiness and MatchmakingInfo.readyStatus). She stays in lobby and does not ready up. Use if she is already in the party.",
      parameters: {
        type: "object",
        properties: {
          display_name: {
            type: "string",
            description: "Friend to refresh status for. Default TTBarleezy.",
          },
        },
      },
    },
    {
      type: "function",
      name: "fortnite_leave_party",
      description: "Leave Lexi's current Fortnite party over Epic party HTTP. Does not load the game.",
      parameters: { type: "object", properties: {} },
    },
  ] as const;
}

export function sanitizeFortniteToolResult(body: Record<string, unknown>) {
  const party =
    body.party && typeof body.party === "object" && !Array.isArray(body.party)
      ? (body.party as Record<string, unknown>)
      : null;
  const rest = { ...body };
  delete rest.signedIn;
  delete rest.tokenScope;
  delete rest.needsReauth;
  const next: Record<string, unknown> = {
    ...rest,
    canPlayInGame: false,
  };
  if (typeof next.epicHttpReady !== "boolean") next.epicHttpReady = false;
  if (party) {
    const withFriend = party.withFriend === true;
    next.inIanParty = withFriend;
    next.visibleInFortnite = withFriend;
  }
  return next;
}
