import { DEFAULT_PSN_ONLINE_ID, isBackupPsnAccount } from "./session.ts";

const AUTH_BASE = "https://ca.account.sony.com/api/authz/v3/oauth";
const CLIENT_ID = "09515159-7237-4370-9b40-3806e67c0891";
const REDIRECT = "com.scee.psxandroid.scecompcall://redirect";
const BASIC =
  "Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=";
const PROFILE_URL =
  "https://us-prof.np.community.playstation.net/userProfile/v1/users/me/profile2?fields=npId,onlineId,accountId";

export type PsnAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshTokenExpiresIn: number;
};

export type PsnAuthResult = {
  tokens: PsnAuthTokens;
  onlineId: string;
  accountId: string;
  belongsToBackup: boolean;
};

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Sony auth did not return ${label}.`);
  }
  return value.trim();
}

export async function exchangeNpssoForAccessCode(npsso: string) {
  const query = new URLSearchParams({
    access_type: "offline",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: "psn:mobile.v2.core psn:clientapp",
  });
  const response = await fetch(`${AUTH_BASE}/authorize?${query}`, {
    headers: { Cookie: `npsso=${npsso}` },
    redirect: "manual",
  });
  const location = response.headers.get("location") || "";
  const code = new URLSearchParams(location.split("redirect/")[1] || location.split("?")[1] || "").get(
    "code",
  );
  if (!location.includes("code=") || !code) {
    throw new Error(
      "Sony did not return an access code. The NPSSO is invalid or expired. Get a new one from https://ca.account.sony.com/api/v1/ssocookie while signed in as BarleezyFBaby.",
    );
  }
  return code;
}

export async function exchangeAccessCodeForAuthTokens(accessCode: string): Promise<PsnAuthTokens> {
  const response = await fetch(`${AUTH_BASE}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: BASIC,
    },
    body: new URLSearchParams({
      code: accessCode,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
      token_format: "jwt",
    }).toString(),
  });
  const raw = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error("Sony token exchange failed. Get a fresh NPSSO and try again.");
  }
  return {
    accessToken: requireString(raw.access_token, "access_token"),
    refreshToken: requireString(raw.refresh_token, "refresh_token"),
    expiresIn: Number(raw.expires_in) || 0,
    refreshTokenExpiresIn: Number(raw.refresh_token_expires_in) || 0,
  };
}

export async function fetchPsnOnlineId(accessToken: string) {
  const response = await fetch(PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const raw = (await response.json()) as {
    profile?: { onlineId?: string; accountId?: string };
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(raw.error?.message || "Sony profile lookup failed.");
  }
  const onlineId = requireString(raw.profile?.onlineId, "onlineId");
  return {
    onlineId,
    accountId: typeof raw.profile?.accountId === "string" ? raw.profile.accountId : "",
    belongsToBackup: isBackupPsnAccount(onlineId),
  };
}

export async function authenticatePsnWithNpsso(npsso: string): Promise<PsnAuthResult> {
  const code = await exchangeNpssoForAccessCode(npsso.trim());
  const tokens = await exchangeAccessCodeForAuthTokens(code);
  const profile = await fetchPsnOnlineId(tokens.accessToken);
  return { tokens, ...profile };
}

export function expectedBackupOnlineId() {
  return DEFAULT_PSN_ONLINE_ID;
}
