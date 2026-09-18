/** Stored PlayStation identity for server PSN scripts. Not an unofficial Sony client. */

export const DEFAULT_PSN_LOGIN_NAME = "barleezyfbaby";
export const DEFAULT_PSN_ONLINE_ID = "Barleezybaby";
export const PSN_BACKUP_ALIASES = ["barleezybaby", "barleezyfbaby"] as const;

const TOKEN_KEYS = ["PSN_ACCESS_TOKEN", "PSN_REFRESH_TOKEN", "PSN_SSO", "PSN_NPSSO"] as const;

export type PsnSession = {
  loginName: string;
  onlineId: string;
  accountName: string;
  hasSonyToken: boolean;
  tokenAccount: string;
  belongsToBackup: boolean;
  needsSonyAuth: boolean;
};

function trimEnv(name: string) {
  return process.env[name]?.trim() || "";
}

export function psnLoginName() {
  return trimEnv("PSN_LOGIN_NAME") || DEFAULT_PSN_LOGIN_NAME;
}

export function psnOnlineId() {
  return trimEnv("PSN_ONLINE_ID") || trimEnv("PSN_ACCOUNT_NAME") || DEFAULT_PSN_ONLINE_ID;
}

export function psnAccountName() {
  return trimEnv("PSN_ACCOUNT_NAME") || psnOnlineId();
}

export function hasSonySessionToken() {
  return TOKEN_KEYS.some((key) => Boolean(trimEnv(key)));
}

export function normalizePsnName(raw?: string | null) {
  return (raw || "").trim();
}

export function isBackupPsnAccount(name?: string | null) {
  const normalized = normalizePsnName(name).toLowerCase();
  return (PSN_BACKUP_ALIASES as readonly string[]).includes(normalized);
}

export function getPsnSession(): PsnSession {
  const loginName = psnLoginName();
  const onlineId = psnOnlineId();
  const accountName = psnAccountName();
  const tokenAccount = trimEnv("PSN_TOKEN_ACCOUNT");
  const hasSonyToken = hasSonySessionToken();
  const named = tokenAccount || accountName;
  const belongsToBackup = isBackupPsnAccount(named) && isBackupPsnAccount(onlineId);
  return {
    loginName,
    onlineId,
    accountName,
    hasSonyToken,
    tokenAccount: tokenAccount || "",
    belongsToBackup,
    needsSonyAuth: !hasSonyToken,
  };
}
