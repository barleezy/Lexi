const SERVER_COMMAND_URL = "https://api.lovense-api.com/api/lan/v2/command";
const PLATFORM = "Lexi";
const PRESETS = new Set(["pulse", "wave", "fireworks", "earthquake"]);

const FUNCTION_MAX: Record<string, number> = {
  vibrate: 20,
  rotate: 20,
  pump: 3,
  thrusting: 20,
  fingering: 20,
  suction: 20,
  depth: 3,
  stroke: 100,
  oscillate: 20,
  all: 20,
};

const FUNCTION_NAME: Record<string, string> = {
  vibrate: "Vibrate",
  rotate: "Rotate",
  pump: "Pump",
  thrusting: "Thrusting",
  fingering: "Fingering",
  suction: "Suction",
  depth: "Depth",
  stroke: "Stroke",
  oscillate: "Oscillate",
  all: "All",
};

const FUNCTION_PART =
  /^(Vibrate|Rotate|Pump|Thrusting|Fingering|Suction|Depth|Stroke|Oscillate|All)(?::(\d{1,3}(?:-\d{1,3})?))?$/i;

export type LovenseCommandBody = {
  action?: unknown;
  strength?: unknown;
  durationSec?: unknown;
  pattern?: unknown;
  functions?: unknown;
  rule?: unknown;
  toy?: unknown;
  loopRunningSec?: unknown;
  loopPauseSec?: unknown;
  stopPrevious?: unknown;
  position?: unknown;
  command?: unknown;
};

export function lovenseEnv() {
  const token = process.env.LOVENSE_TOKEN?.trim() ?? "";
  const uid = process.env.LOVENSE_UID?.trim() ?? "";
  const connectUrl = normalizeConnectUrl(process.env.LOVENSE_CONNECT_URL);
  const server = Boolean(token && uid);
  return {
    token,
    uid,
    connectUrl,
    server,
    configured: server || Boolean(connectUrl),
    mode: server ? ("server" as const) : connectUrl ? ("connect" as const) : ("off" as const),
  };
}

export function isLovenseConfigured() {
  return lovenseEnv().configured;
}

function normalizeConnectUrl(raw?: string) {
  const value = raw?.trim() ?? "";
  if (!value) return "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  if (!url.pathname || url.pathname === "/") url.pathname = "/command";
  return url.toString();
}

export function parseLovenseCommand(body: LovenseCommandBody) {
  const actionRaw = typeof body.action === "string" ? body.action.trim() : "";
  const action = actionRaw.toLowerCase();
  const commandHint = typeof body.command === "string" ? body.command.trim().toLowerCase() : "";
  const functions = typeof body.functions === "string" ? body.functions.trim() : "";

  if (action === "stop" || (action === "function" && /^stop$/i.test(functions))) {
    return finishPayload({ command: "Function", action: "Stop", timeSec: 0, apiVer: 1 }, body, {
      loops: false,
    });
  }

  if (action === "position" || commandHint === "position") {
    const position = parsePosition(body.position ?? body.strength);
    if (!position.ok) return position;
    return finishPayload({ command: "Position", value: String(position.value), apiVer: 1 }, body, {
      loops: false,
    });
  }

  const combo = parseFunctionActionString(
    functions || (actionRaw.includes(",") || /:\d/.test(actionRaw) ? actionRaw : ""),
  );
  if (combo) {
    if (!combo.ok) return combo;
    const duration = parseDuration(body.durationSec, 8);
    if (!duration.ok) return duration;
    return finishPayload(
      { command: "Function", action: combo.value, timeSec: duration.value, apiVer: 1 },
      body,
    );
  }

  if (action && FUNCTION_NAME[action]) {
    const duration = parseDuration(body.durationSec, 8);
    if (!duration.ok) return duration;
    const strength = parseFunctionLevel(action, body.strength, defaultStrength(action));
    if (!strength.ok) return strength;
    return finishPayload(
      {
        command: "Function",
        action: `${FUNCTION_NAME[action]}:${strength.value}`,
        timeSec: duration.value,
        apiVer: 1,
      },
      body,
    );
  }

  if (action === "function") {
    return { ok: false as const, error: "functions must be a documented Function string such as Vibrate:10,Rotate:5." };
  }

  const duration = parseDuration(body.durationSec, 8);
  if (!duration.ok) return duration;

  const preset = (typeof body.pattern === "string" ? body.pattern : action === "pulse" || action === "preset" ? "pulse" : "")
    .trim()
    .toLowerCase();
  if (action === "pulse" || action === "preset" || PRESETS.has(preset)) {
    if (!PRESETS.has(preset)) {
      return { ok: false as const, error: "preset must be pulse, wave, fireworks, or earthquake." };
    }
    return finishPayload({ command: "Preset", name: preset, timeSec: duration.value, apiVer: 1 }, body, {
      loops: false,
    });
  }

  if (action === "pattern") {
    const strengths = (typeof body.pattern === "string" ? body.pattern : "").trim();
    if (strengths && /^\d+(;\d+){0,49}$/.test(strengths)) {
      const rule =
        typeof body.rule === "string" && body.rule.trim() ? body.rule.trim() : "V:1;F:v;S:1000#";
      return finishPayload(
        { command: "Pattern", rule, strength: strengths, timeSec: duration.value, apiVer: 2 },
        body,
        { loops: false },
      );
    }
    const strength = parseStrength(body.strength, 12);
    if (!strength.ok) return strength;
    return finishPayload(
      {
        command: "Pattern",
        rule: typeof body.rule === "string" && body.rule.trim() ? body.rule.trim() : "V:1;F:v;S:800#",
        strength: `${strength.value};${Math.max(0, strength.value - 6)};${strength.value};${Math.max(2, Math.round(strength.value / 2))}`,
        timeSec: duration.value,
        apiVer: 2,
      },
      body,
      { loops: false },
    );
  }

  if (action === "vibrate") {
    const strength = parseStrength(body.strength, 10);
    if (!strength.ok) return strength;
    return finishPayload(
      { command: "Function", action: `Vibrate:${strength.value}`, timeSec: duration.value, apiVer: 1 },
      body,
    );
  }

  return {
    ok: false as const,
    error:
      "action must be a Lovense Function (Vibrate, Rotate, Pump, Thrusting, Fingering, Suction, Depth, Stroke, Oscillate, All, Stop), Preset, Pattern, or Position.",
  };
}

function defaultStrength(action: string) {
  if (action === "pump" || action === "depth") return 1;
  if (action === "stroke") return 20;
  return 10;
}

function parseFunctionActionString(raw: string) {
  const value = raw.trim();
  if (!value) return null;
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const normalized: string[] = [];
  for (const part of parts) {
    if (/^stop$/i.test(part)) {
      normalized.push("Stop");
      continue;
    }
    const match = part.match(FUNCTION_PART);
    if (!match) return { ok: false as const, error: `Unsupported Lovense function: ${part}.` };
    const name = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
    const canonical = name === "All" ? "All" : FUNCTION_NAME[name.toLowerCase()];
    if (!canonical) return { ok: false as const, error: `Unsupported Lovense function: ${part}.` };
    const level = match[2];
    if (!level) {
      normalized.push(`${canonical}:${defaultStrength(canonical.toLowerCase())}`);
      continue;
    }
    if (level.includes("-")) {
      if (canonical !== "Stroke") {
        return { ok: false as const, error: "Only Stroke accepts a min-max range." };
      }
      const [min, max] = level.split("-").map(Number);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 100) {
        return { ok: false as const, error: "Stroke range must stay between 0 and 100." };
      }
      normalized.push(`${canonical}:${min}-${max}`);
      continue;
    }
    const parsed = parseFunctionLevel(canonical.toLowerCase(), Number(level), defaultStrength(canonical.toLowerCase()));
    if (!parsed.ok) return parsed;
    normalized.push(`${canonical}:${parsed.value}`);
  }
  return { ok: true as const, value: normalized.join(",") };
}

function parseFunctionLevel(action: string, raw: unknown, fallback: number) {
  if (action === "stroke" && typeof raw === "string" && /^\d{1,3}-\d{1,3}$/.test(raw.trim())) {
    return { ok: true as const, value: raw.trim() };
  }
  const max = FUNCTION_MAX[action] ?? 20;
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true as const, value: fallback };
  }
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > max) {
    return { ok: false as const, error: `${action} strength must be a number from 0 to ${max}.` };
  }
  return { ok: true as const, value: Math.round(value) };
}

function finishPayload(
  payload: Record<string, unknown>,
  body: LovenseCommandBody,
  options?: { loops?: boolean },
) {
  const extras = collectExtras(body, options);
  if (!extras.ok) return extras;
  return { ok: true as const, payload: { ...payload, ...extras.value } };
}

function collectExtras(body: LovenseCommandBody, options?: { loops?: boolean }) {
  const next: Record<string, unknown> = {};
  const toy = parseToyId(body.toy);
  if (toy !== undefined) next.toy = toy;
  if (options?.loops !== false) {
    const loopRunningSec = parseLoopSec(body.loopRunningSec, "loopRunningSec");
    if (loopRunningSec && !loopRunningSec.ok) return loopRunningSec;
    if (loopRunningSec?.ok) next.loopRunningSec = loopRunningSec.value;
    const loopPauseSec = parseLoopSec(body.loopPauseSec, "loopPauseSec");
    if (loopPauseSec && !loopPauseSec.ok) return loopPauseSec;
    if (loopPauseSec?.ok) next.loopPauseSec = loopPauseSec.value;
  }
  const stopPrevious = parseStopPrevious(body.stopPrevious);
  if (stopPrevious && !stopPrevious.ok) return stopPrevious;
  if (stopPrevious?.ok) next.stopPrevious = stopPrevious.value;
  return { ok: true as const, value: next };
}

function parseToyId(raw: unknown) {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (Array.isArray(raw) && raw.every((item) => typeof item === "string" && item.trim())) {
    return raw.map((item) => item.trim());
  }
  return undefined;
}

function parseLoopSec(raw: unknown, label: string) {
  if (raw === undefined || raw === null || raw === "") return null;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 1) {
    return { ok: false as const, error: `${label} must be greater than 1.` };
  }
  return { ok: true as const, value };
}

function parseStopPrevious(raw: unknown) {
  if (raw === undefined || raw === null || raw === "") return null;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (value !== 0 && value !== 1) {
    return { ok: false as const, error: "stopPrevious must be 0 or 1." };
  }
  return { ok: true as const, value };
}

function parsePosition(raw: unknown) {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: false as const, error: "position value must be 0 to 100." };
  }
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return { ok: false as const, error: "position value must be 0 to 100." };
  }
  return { ok: true as const, value: Math.round(value) };
}

function parseStrength(raw: unknown, fallback: number) {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true as const, value: fallback };
  }
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 20) {
    return { ok: false as const, error: "strength must be a number from 0 to 20." };
  }
  return { ok: true as const, value: Math.round(value) };
}

function parseDuration(raw: unknown, fallback: number) {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true as const, value: fallback };
  }
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false as const, error: "durationSec must be 0 or greater." };
  }
  if (value > 0 && value < 1) {
    return { ok: false as const, error: "durationSec must be 0 (until stop) or at least 1." };
  }
  return { ok: true as const, value };
}

export async function lovenseGetStatus() {
  const env = lovenseEnv();
  if (!env.configured) {
    return { configured: false, mode: env.mode, toys: [] as unknown[] };
  }
  const result = await lovenseRequest({ command: "GetToys" });
  return {
    configured: true,
    mode: env.mode,
    toys: readToys(result.body),
    online: result.ok,
    error: result.ok ? undefined : result.error,
  };
}

export async function lovenseSendCommand(body: LovenseCommandBody) {
  const parsed = parseLovenseCommand(body);
  if (!parsed.ok) return parsed;
  const result = await lovenseRequest(parsed.payload);
  if (!result.ok) return { ok: false as const, error: result.error, status: result.status };
  return { ok: true as const, provider: "lovense" as const, mode: result.mode, result: result.body };
}

async function lovenseRequest(command: Record<string, unknown>) {
  const env = lovenseEnv();
  if (!env.configured) {
    return { ok: false as const, status: 503, error: "Lovense is not configured.", mode: env.mode };
  }

  const url = env.server ? SERVER_COMMAND_URL : env.connectUrl;
  const payload = env.server ? { token: env.token, uid: env.uid, ...command } : command;

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-platform": PLATFORM,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    let body: unknown = {};
    try {
      body = await upstream.json();
    } catch {
      body = {};
    }
    const code = readCode(body);
    if (!upstream.ok || (code !== null && code !== 200 && code !== 0)) {
      return {
        ok: false as const,
        status: mapLovenseStatus(code, upstream.status),
        error: readMessage(body) || `Lovense returned ${upstream.status}.`,
        mode: env.mode,
        body,
      };
    }
    return { ok: true as const, status: 200, mode: env.mode, body };
  } catch (error) {
    return {
      ok: false as const,
      status: 502,
      error: error instanceof Error ? error.message : "Lovense request failed.",
      mode: env.mode,
    };
  }
}

function readCode(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const code = (body as { code?: unknown }).code;
  if (typeof code === "number") return code;
  if (typeof code === "string" && /^\d+$/.test(code)) return Number(code);
  return null;
}

function readMessage(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const row = body as { message?: unknown; msg?: unknown; type?: unknown };
  if (typeof row.message === "string" && row.message.trim()) return row.message;
  if (typeof row.msg === "string" && row.msg.trim()) return row.msg;
  if (typeof row.type === "string" && row.type.trim()) return row.type;
  return "";
}

function readToys(body: unknown) {
  if (!body || typeof body !== "object") return [];
  const data = (body as { data?: unknown }).data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const toys = (data as { toys?: unknown }).toys;
    if (typeof toys === "string") {
      try {
        const parsed = JSON.parse(toys) as unknown;
        if (parsed && typeof parsed === "object") return Object.values(parsed as Record<string, unknown>);
      } catch {
        return [];
      }
    }
    if (toys && typeof toys === "object") return Object.values(toys as Record<string, unknown>);
  }
  return [];
}

function mapLovenseStatus(code: number | null, httpStatus: number) {
  if (code === 400 || code === 404) return 400;
  if (code === 501 || code === 502 || code === 503 || code === 507) return 502;
  if (httpStatus >= 400 && httpStatus < 600) return httpStatus === 401 ? 502 : httpStatus;
  return 502;
}
