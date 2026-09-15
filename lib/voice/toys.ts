import {
  isJoyhubConfigured,
  joyhubGetStatus,
  joyhubSendCommand,
  type JoyhubCommandBody,
} from "./joyhub";
import {
  isLovenseConfigured,
  lovenseGetStatus,
  lovenseSendCommand,
  type LovenseCommandBody,
} from "./lovense";

export { parseToyControlIntent, resolveToyControlRequest } from "./toy-control";
export type { ToyControlIntent } from "./toy-control";

export const TOY_PROVIDERS = ["lovense", "joyhub"] as const;
export type ToyProvider = (typeof TOY_PROVIDERS)[number];

export const TOY_ACTIONS = [
  "vibrate",
  "rotate",
  "pump",
  "thrusting",
  "fingering",
  "suction",
  "depth",
  "stroke",
  "oscillate",
  "all",
  "stop",
  "pattern",
  "pulse",
  "preset",
  "function",
  "position",
] as const;
export type ToyAction = (typeof TOY_ACTIONS)[number];

export type ToyCommandInput = {
  provider?: unknown;
  action?: unknown;
  strength?: unknown;
  durationSec?: unknown;
  pattern?: unknown;
  intensity?: unknown;
  functions?: unknown;
  rule?: unknown;
  toy?: unknown;
  loopRunningSec?: unknown;
  loopPauseSec?: unknown;
  stopPrevious?: unknown;
  position?: unknown;
  command?: unknown;
  controlGranted?: unknown;
};

export function toyProvidersStatus() {
  return {
    lovense: isLovenseConfigured(),
    joyhub: isJoyhubConfigured(),
  };
}

export function isAnyToyConfigured() {
  const status = toyProvidersStatus();
  return status.lovense || status.joyhub;
}

export function parseToyProvider(raw: unknown): ToyProvider | "all" | null {
  if (raw === undefined || raw === null || raw === "") return "all";
  if (raw === "all" || raw === "lovense" || raw === "joyhub") return raw;
  return null;
}

export function parseToyAction(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  if ((TOY_ACTIONS as readonly string[]).includes(lower)) return lower;
  if (/^(?:vibrate|rotate|pump|thrusting|fingering|suction|depth|stroke|oscillate|all):\d/i.test(value)) {
    return value;
  }
  if (/^[a-z][a-z0-9_:,-]{0,120}$/i.test(value)) return value.includes(",") ? value : lower;
  return null;
}

export function isToyStopAction(action: string) {
  return action.toLowerCase() === "stop";
}

export function isControlGranted(raw: unknown) {
  return raw === true || raw === "true" || raw === 1;
}

function asFiniteNumber(raw: unknown) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function asTrimmedString(raw: unknown) {
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

export function toyCommandFields(input: ToyCommandInput) {
  return {
    action: typeof input.action === "string" ? input.action : undefined,
    strength: asFiniteNumber(input.strength),
    durationSec: asFiniteNumber(input.durationSec),
    pattern: asTrimmedString(input.pattern),
    intensity: asFiniteNumber(input.intensity),
    functions: asTrimmedString(input.functions),
    rule: asTrimmedString(input.rule),
    toy: input.toy,
    loopRunningSec: asFiniteNumber(input.loopRunningSec),
    loopPauseSec: asFiniteNumber(input.loopPauseSec),
    stopPrevious: asFiniteNumber(input.stopPrevious),
    position: input.position,
    command: asTrimmedString(input.command),
  };
}

export async function getToyStatus(provider: ToyProvider | "all" = "all") {
  if (provider === "lovense") {
    const lovense = await lovenseGetStatus();
    return { providers: { lovense: lovense.configured, joyhub: isJoyhubConfigured() }, lovense };
  }
  if (provider === "joyhub") {
    const joyhub = await joyhubGetStatus();
    return { providers: { lovense: isLovenseConfigured(), joyhub: joyhub.configured }, joyhub };
  }
  const [lovense, joyhub] = await Promise.all([lovenseGetStatus(), joyhubGetStatus()]);
  return {
    providers: { lovense: lovense.configured, joyhub: joyhub.configured },
    lovense,
    joyhub,
  };
}

export async function sendToyCommand(input: ToyCommandInput) {
  const action = parseToyAction(input.action);
  if (!action) {
    return {
      ok: false as const,
      status: 400,
      error: "action must be a documented toy function, stop, pattern, pulse, preset, or position.",
    };
  }

  const provider = parseToyProvider(input.provider);
  if (!provider) {
    return { ok: false as const, status: 400, error: "provider must be lovense, joyhub, or all." };
  }

  if (!isToyStopAction(action) && !isControlGranted(input.controlGranted)) {
    return {
      ok: false as const,
      status: 403,
      error: "Toy control is not granted. The user must request it first.",
    };
  }

  const targets =
    provider === "all"
      ? ([
          isLovenseConfigured() ? "lovense" : null,
          isJoyhubConfigured() ? "joyhub" : null,
        ].filter(Boolean) as ToyProvider[])
      : [provider];

  if (!targets.length) {
    return { ok: false as const, status: 503, error: "No toy provider is configured." };
  }

  const command = toyCommandFields({ ...input, action });

  const results: Array<Record<string, unknown>> = [];
  for (const name of targets) {
    if (name === "lovense") {
      if (!isLovenseConfigured()) {
        return { ok: false as const, status: 503, error: "Lovense is not configured." };
      }
      const result = await lovenseSendCommand(command as LovenseCommandBody);
      if (!result.ok) {
        return { ok: false as const, status: "status" in result ? result.status : 400, error: result.error };
      }
      results.push(result);
      continue;
    }
    if (!isJoyhubConfigured()) {
      return { ok: false as const, status: 503, error: "Joyhub is not configured." };
    }
    const result = await joyhubSendCommand(command as JoyhubCommandBody);
    if (!result.ok) {
      return { ok: false as const, status: "status" in result ? result.status : 400, error: result.error };
    }
    results.push(result);
  }

  return { ok: true as const, results };
}
