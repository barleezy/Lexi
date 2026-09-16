import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_FORTNITEPY_SIDECAR_URL = "http://127.0.0.1:8765";
export const SIDECAR_UNAVAILABLE = "fortnitepy sidecar is not running.";

const START_WAIT_MS = 45_000;
const READY_POLL_MS = 1_000;

let startInflight: Promise<boolean> | null = null;
let startedChild: ChildProcess | null = null;

export function fortnitepySidecarUrl() {
  return process.env.FORTNITEPY_SIDECAR_URL?.trim() || DEFAULT_FORTNITEPY_SIDECAR_URL;
}

export function fortnitepyAutostartEnabled() {
  const raw = process.env.FORTNITEPY_AUTOSTART?.trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

export function parseJoinChatCommand(raw: unknown) {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  const join = text.match(/^!join(?:\s+(.+))?$/i);
  if (join) return { action: "join_party" as const, displayName: (join[1] ?? "").trim() };
  if (/^!(?:sit[_ -]?out)$/i.test(text)) return { action: "sit_out" as const, displayName: "" };
  if (/^!leave(?:[_ -]?party)?$/i.test(text)) return { action: "leave_party" as const, displayName: "" };
  return null;
}

export type SidecarParty = {
  inParty?: boolean;
  inIanParty?: boolean;
  partyId?: string | null;
  sittingOut?: boolean;
  readiness?: string | null;
  withFriend?: boolean;
  friendPartyId?: string | null;
  comms?: string;
  inUnrealClient?: boolean;
  visibleInFortnite?: boolean;
  error?: string;
};

export type SidecarResult = {
  ok: boolean;
  status: number;
  source: "fortnitepy" | "unavailable";
  ready?: boolean;
  configured?: boolean;
  canPlayInGame?: boolean;
  epicHttpReady?: boolean;
  inIanParty?: boolean;
  visibleInFortnite?: boolean;
  needsReauth?: boolean;
  error?: string;
  say?: string;
  message?: string;
  joined?: boolean;
  lexi?: { displayName?: string; accountId?: string };
  friend?: {
    displayName?: string;
    accountId?: string | null;
    relation?: string;
    request?: string | null;
    presence?: { state?: string; lastOnline?: string | null; source?: string };
  };
  party?: SidecarParty;
};

function sidecarHeaders() {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = process.env.FORTNITEPY_SIDECAR_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function unavailable(error = SIDECAR_UNAVAILABLE): SidecarResult {
  return {
    ok: false,
    status: 503,
    source: "unavailable",
    ready: false,
    configured: false,
    canPlayInGame: false,
    inIanParty: false,
    visibleInFortnite: false,
    error,
  };
}

function isLocalSidecarUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

export async function fortnitepySidecarHealth() {
  const url = fortnitepySidecarUrl();
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/health`, {
      headers: sidecarHeaders(),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      reachable: true,
      ready: body.ready === true,
      needsReauth: body.needsReauth === true,
      status: response.status,
      body,
    };
  } catch {
    return { reachable: false, ready: false, needsReauth: false, status: 0, body: {} };
  }
}

export async function callFortnitepySidecar(input: {
  action: string;
  displayName?: string;
  partyId?: string;
}): Promise<SidecarResult> {
  const url = fortnitepySidecarUrl();
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/command`, {
      method: "POST",
      headers: { ...sidecarHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        action: input.action,
        displayName: input.displayName,
        partyId: input.partyId,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ...(body as SidecarResult),
      ok: body.ok === true,
      status: response.status,
      source: "fortnitepy",
      canPlayInGame: false,
      error: typeof body.error === "string" ? body.error : undefined,
      say: typeof body.say === "string" ? body.say : undefined,
    };
  } catch {
    return unavailable();
  }
}

export async function waitForFortnitepySidecar(timeoutMs = START_WAIT_MS) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const health = await fortnitepySidecarHealth();
    if (health.reachable && (health.ready || health.needsReauth)) return health;
    if (health.reachable && !health.ready) {
      await new Promise((resolveWait) => setTimeout(resolveWait, READY_POLL_MS));
      continue;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, READY_POLL_MS));
  }
  return fortnitepySidecarHealth();
}

function repoRoot() {
  const fromCwd = resolve(process.cwd());
  if (existsSync(resolve(fromCwd, "sidecars/fortnite/sidecar.py"))) return fromCwd;
  try {
    return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  } catch {
    return fromCwd;
  }
}

function sidecarPythonBin() {
  const root = repoRoot();
  const venv = resolve(root, "sidecars/fortnite/.venv/bin/python");
  if (existsSync(venv)) return venv;
  return process.env.FORTNITEPY_PYTHON?.trim() || "python3";
}

function sidecarScript() {
  return resolve(repoRoot(), "sidecars/fortnite/sidecar.py");
}

export async function ensureFortnitepySidecar() {
  const health = await fortnitepySidecarHealth();
  if (health.reachable) return health.ready || health.needsReauth;
  if (!fortnitepyAutostartEnabled()) return false;
  if (!isLocalSidecarUrl(fortnitepySidecarUrl())) return false;
  if (!existsSync(sidecarScript())) return false;
  if (!startInflight) startInflight = startSidecarProcess().finally(() => {
    startInflight = null;
  });
  return startInflight;
}

async function startSidecarProcess() {
  const python = sidecarPythonBin();
  const script = sidecarScript();
  let exited = false;
  try {
    const child = spawn(python, [script], {
      cwd: repoRoot(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    startedChild = child;
    child.unref();
    child.stdout?.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) console.info(text);
    });
    child.stderr?.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) console.info(text);
    });
    child.on("exit", (code) => {
      exited = true;
      if (startedChild === child) startedChild = null;
      if (code && code !== 0) {
        console.info(`[fortnitepy] sidecar exited ${code}`);
      }
    });
  } catch {
    return false;
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < START_WAIT_MS) {
    if (exited) return false;
    const health = await fortnitepySidecarHealth();
    if (health.reachable) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, READY_POLL_MS));
  }
  return false;
}

export async function preferFortnitepySidecar(input: {
  action: string;
  displayName?: string;
  partyId?: string;
}): Promise<SidecarResult> {
  let result = await callFortnitepySidecar(input);
  if (result.source === "unavailable") {
    const started = await ensureFortnitepySidecar();
    if (started) {
      await waitForFortnitepySidecar();
      result = await callFortnitepySidecar(input);
    }
  } else if (result.ready === false && result.source === "fortnitepy") {
    const health = await waitForFortnitepySidecar(20_000);
    if (health.ready) result = await callFortnitepySidecar(input);
  }
  return result;
}

export function sidecarJoinSucceeded(result: SidecarResult) {
  return result.source === "fortnitepy" && (result.joined === true || result.party?.withFriend === true);
}

export function sidecarIsAuthoritative(result: SidecarResult) {
  return result.source === "fortnitepy" && result.ready === true;
}
