import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { authenticatePsnWithNpsso } from "../lib/psn/auth.ts";
import {
  DEFAULT_PSN_LOGIN_NAME,
  DEFAULT_PSN_ONLINE_ID,
  getPsnSession,
} from "../lib/psn/session.ts";

const ENV_PATH = resolve(process.cwd(), ".env.local");

function loadEnvLocal() {
  const text = readFileSync(ENV_PATH, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq);
    let value = trimmed.slice(eq + 1);
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function parseEnv(text) {
  const lines = text.split(/\r?\n/);
  const keys = new Map();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    let value = trimmed.slice(eq + 1);
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    keys.set(trimmed.slice(0, eq), value);
  }
  return { lines, keys };
}

function upsertEnv(text, updates) {
  const { lines } = parseEnv(text);
  const seen = new Set();
  const next = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const eq = trimmed.indexOf("=");
    const key = eq > 0 && !trimmed.startsWith("#") ? trimmed.slice(0, eq) : "";
    if (key && key in updates) {
      next.push(`${key}=${updates[key]}`);
      seen.add(key);
      continue;
    }
    next.push(line);
  }
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }
  return `${next.filter((line, i, arr) => !(line === "" && arr[i - 1] === "")).join("\n").replace(/\n*$/, "\n")}`;
}

loadEnvLocal();

const LOGIN = process.env.PSN_LOGIN_NAME?.trim() || DEFAULT_PSN_LOGIN_NAME;
const EXPECTED_ONLINE_ID = process.env.PSN_ONLINE_ID?.trim() || DEFAULT_PSN_ONLINE_ID;
const npsso = process.env.PSN_NPSSO?.trim() || "";

const updates = {
  PSN_LOGIN_NAME: LOGIN,
  PSN_ONLINE_ID: EXPECTED_ONLINE_ID,
  PSN_ACCOUNT_NAME: EXPECTED_ONLINE_ID,
  PSN_TOKEN_ACCOUNT: EXPECTED_ONLINE_ID,
};

let authError = "";
let verifiedOnlineId = "";
let belongsToBackup = false;
let minted = false;

if (npsso) {
  try {
    const auth = await authenticatePsnWithNpsso(npsso);
    verifiedOnlineId = auth.onlineId;
    belongsToBackup = auth.belongsToBackup;
    updates.PSN_ONLINE_ID = auth.onlineId;
    updates.PSN_ACCOUNT_NAME = auth.onlineId;
    updates.PSN_TOKEN_ACCOUNT = auth.onlineId;
    updates.PSN_ACCESS_TOKEN = auth.tokens.accessToken;
    updates.PSN_REFRESH_TOKEN = auth.tokens.refreshToken;
    updates.PSN_NPSSO = "";
    minted = true;
  } catch (error) {
    authError = error instanceof Error ? error.message : "Sony auth failed.";
  }
}

const previous = readFileSync(ENV_PATH, "utf8");
writeFileSync(ENV_PATH, upsertEnv(previous, updates));
for (const [key, value] of Object.entries(updates)) {
  process.env[key] = value;
}

const session = getPsnSession();
const publicResult = {
  ok: minted ? belongsToBackup : session.belongsToBackup && !authError,
  loginName: session.loginName,
  onlineId: verifiedOnlineId || session.onlineId,
  tokenAccount: session.tokenAccount,
  belongsToBackup: minted ? belongsToBackup : session.belongsToBackup,
  mintedSonySession: minted,
  hasSonyToken: session.hasSonyToken,
  needsSonyAuth: session.needsSonyAuth,
  expectedOnlineId: EXPECTED_ONLINE_ID,
  error: authError,
  message: minted
    ? belongsToBackup
      ? `Sony session token belongs to ${verifiedOnlineId}.`
      : `Sony session is for ${verifiedOnlineId}, not the backup account. Sign in as barleezyfbaby and get a new NPSSO.`
    : authError ||
      "Stored PSN identity is Barleezybaby. Paste PSN_NPSSO and re-run to mint a Sony session.",
};

console.log(JSON.stringify(publicResult, null, 2));
if (!publicResult.ok) process.exit(1);
