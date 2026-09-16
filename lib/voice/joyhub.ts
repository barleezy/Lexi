export type JoyhubCommandBody = {
  action?: unknown;
  strength?: unknown;
  durationSec?: unknown;
  pattern?: unknown;
  intensity?: unknown;
  functions?: unknown;
  command?: unknown;
  toy?: unknown;
  loopRunningSec?: unknown;
  loopPauseSec?: unknown;
  stopPrevious?: unknown;
  position?: unknown;
  rule?: unknown;
};

const MAPPED_ACTIONS = new Set(["vibrate", "stop", "pattern", "pulse"]);

export function joyhubEnv() {
  const token = process.env.JOYHUB_TOKEN?.trim() ?? "";
  const deviceId = process.env.JOYHUB_DEVICE_ID?.trim() ?? "";
  const apiUrl = normalizeHttpUrl(process.env.JOYHUB_API_URL);
  return {
    token,
    deviceId,
    apiUrl,
    configured: Boolean(apiUrl && token),
  };
}

export function isJoyhubConfigured() {
  return joyhubEnv().configured;
}

function normalizeHttpUrl(raw?: string) {
  const value = raw?.trim() ?? "";
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function parseJoyhubCommand(body: JoyhubCommandBody) {
  const action = typeof body.action === "string" ? body.action.trim() : "";
  if (!action && !hasPassThrough(body)) {
    return { ok: false as const, error: "action is required." };
  }
  if (action && !/^[a-z][a-z0-9_:-]{0,79}$/i.test(action)) {
    return { ok: false as const, error: "action must be a documented partner command name." };
  }

  const lower = action.toLowerCase();
  if (lower === "stop") {
    return {
      ok: true as const,
      payload: withPassThrough(
        {
          command: "stop",
          action: "stop",
        },
        body,
      ),
    };
  }

  const duration = parseDuration(body.durationSec, 8);
  if (!duration.ok) return duration;

  const intensity = parseIntensity(body.intensity ?? scaleStrength(body.strength), 50);
  if (!intensity.ok) return intensity;

  if (lower === "vibrate") {
    return {
      ok: true as const,
      payload: withPassThrough(
        {
          command: "vibrate",
          action: "vibrate",
          intensity: intensity.value,
          durationSec: duration.value,
        },
        body,
      ),
    };
  }

  if (lower === "pulse") {
    return {
      ok: true as const,
      payload: withPassThrough(
        {
          command: "pulse",
          action: "pulse",
          intensity: intensity.value,
          durationSec: duration.value,
        },
        body,
      ),
    };
  }

  if (lower === "pattern") {
    const pattern = (typeof body.pattern === "string" ? body.pattern : "pulse").trim();
    if (!pattern) {
      return { ok: false as const, error: "pattern is required for pattern commands." };
    }
    return {
      ok: true as const,
      payload: withPassThrough(
        {
          command: "pattern",
          action: "pattern",
          pattern,
          intensity: intensity.value,
          durationSec: duration.value,
        },
        body,
      ),
    };
  }

  return {
    ok: true as const,
    payload: withPassThrough(
      {
        command: typeof body.command === "string" && body.command.trim() ? body.command.trim() : action,
        action,
        intensity: intensity.value,
        durationSec: duration.value,
      },
      body,
    ),
  };
}

function hasPassThrough(body: JoyhubCommandBody) {
  return Boolean(
    (typeof body.command === "string" && body.command.trim()) ||
      (typeof body.functions === "string" && body.functions.trim()),
  );
}

function withPassThrough(base: Record<string, unknown>, body: JoyhubCommandBody) {
  const extras: Record<string, unknown> = {};
  copyIfPresent(extras, body, [
    "functions",
    "command",
    "toy",
    "loopRunningSec",
    "loopPauseSec",
    "stopPrevious",
    "position",
    "rule",
    "pattern",
    "strength",
  ]);
  if (MAPPED_ACTIONS.has(String(base.action))) {
    delete extras.command;
    delete extras.pattern;
  }
  return { ...extras, ...base, ...(extras.functions ? { functions: extras.functions } : {}) };
}

function copyIfPresent(target: Record<string, unknown>, body: JoyhubCommandBody, keys: Array<keyof JoyhubCommandBody>) {
  for (const key of keys) {
    const value = body[key];
    if (value === undefined || value === null || value === "") continue;
    target[key] = value;
  }
}

function scaleStrength(raw: unknown) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return raw;
  if (value <= 20) return Math.round((value / 20) * 100);
  return value;
}

function parseIntensity(raw: unknown, fallback: number) {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true as const, value: fallback };
  }
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return { ok: false as const, error: "intensity must be a number from 0 to 100." };
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
  return { ok: true as const, value };
}

export async function joyhubGetStatus() {
  const env = joyhubEnv();
  if (!env.configured) {
    return {
      configured: false,
      partnerDocs: "https://business.joyhub.net/",
      toys: [] as unknown[],
    };
  }

  const result = await joyhubRequest("GET");
  return {
    configured: true,
    deviceId: env.deviceId || undefined,
    toys: readDevices(result.body, env.deviceId),
    online: result.ok,
    error: result.ok ? undefined : result.error,
  };
}

export async function joyhubSendCommand(body: JoyhubCommandBody) {
  const parsed = parseJoyhubCommand(body);
  if (!parsed.ok) return parsed;
  const env = joyhubEnv();
  const result = await joyhubRequest("POST", {
    ...parsed.payload,
    ...(env.deviceId ? { deviceId: env.deviceId } : {}),
  });
  if (!result.ok) return { ok: false as const, error: result.error, status: result.status };
  return { ok: true as const, provider: "joyhub" as const, result: result.body };
}

async function joyhubRequest(method: "GET" | "POST", payload?: Record<string, unknown>) {
  const env = joyhubEnv();
  if (!env.configured) {
    return {
      ok: false as const,
      status: 503,
      error:
        "Joyhub is not configured. Set JOYHUB_API_URL and JOYHUB_TOKEN from official partner docs.",
    };
  }

  try {
    const upstream = await fetch(env.apiUrl, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.token}`,
        "X-Joyhub-Token": env.token,
        ...(env.deviceId ? { "X-Joyhub-Device-Id": env.deviceId } : {}),
      },
      body: method === "POST" ? JSON.stringify(payload ?? {}) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    let body: unknown = {};
    try {
      body = await upstream.json();
    } catch {
      body = {};
    }
    if (!upstream.ok) {
      return {
        ok: false as const,
        status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
        error: readMessage(body) || `Joyhub returned ${upstream.status}.`,
        body,
      };
    }
    return { ok: true as const, status: 200, body };
  } catch (error) {
    return {
      ok: false as const,
      status: 502,
      error: error instanceof Error ? error.message : "Joyhub request failed.",
    };
  }
}

function readMessage(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const row = body as { message?: unknown; error?: unknown; msg?: unknown };
  if (typeof row.message === "string" && row.message.trim()) return row.message;
  if (typeof row.error === "string" && row.error.trim()) return row.error;
  if (typeof row.msg === "string" && row.msg.trim()) return row.msg;
  return "";
}

function readDevices(body: unknown, deviceId: string) {
  if (body && typeof body === "object") {
    const row = body as { devices?: unknown; toys?: unknown; data?: unknown };
    if (Array.isArray(row.devices)) return row.devices;
    if (Array.isArray(row.toys)) return row.toys;
    if (row.data && typeof row.data === "object" && Array.isArray((row.data as { devices?: unknown }).devices)) {
      return (row.data as { devices: unknown[] }).devices;
    }
  }
  return deviceId ? [{ id: deviceId }] : [];
}
