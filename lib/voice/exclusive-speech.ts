/**
 * One spoken assistant response at a time. User barge-in is separate:
 * it cancels Lexi, then she answers once. Keepalive tones are not speech.
 */

export type ResponseCreateDecision = "skip" | "create" | "replace";
export type PlaybackHandoff = "reset" | "continue" | "replace";

/** Floor reserved on response.created when the event has no id yet. */
export const PENDING_SPEECH_ID = "pending";

/** response.create sent but no response.created — retry, then release. Not a happy-path delay. */
export const RESPONSE_CREATE_STALL_MS = 1800;
/** Expecting a reply with nothing in flight. Recovery only. */
export const EXPECT_STALL_MS = 4500;
/** Client tools must not hold the spoken turn open forever. */
export const TOOL_CALL_TIMEOUT_MS = 12_000;

export function normalizeResponseId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id ? id : null;
}

/** Later response takes the floor. Same id keeps playing. */
export function claimExclusiveSpeech(
  activeId: string | null,
  incomingId: string | null,
): { activeId: string | null; takeFloor: boolean } {
  if (!incomingId) return { activeId, takeFloor: false };
  if (activeId === incomingId) return { activeId, takeFloor: false };
  return { activeId: incomingId, takeFloor: true };
}

/** Drop leftover / stale TTS. Unlabeled deltas belong to the active floor only. */
export function shouldPlayOutputAudio(opts: {
  ignore: boolean;
  activeId: string | null;
  incomingId: string | null;
}): boolean {
  if (opts.ignore) return false;
  if (!opts.activeId) return false;
  if (opts.activeId === PENDING_SPEECH_ID) return true;
  if (!opts.incomingId) return true;
  return opts.incomingId === opts.activeId;
}

/** First real id after response.created locks the floor. */
export function lockSpeechId(activeId: string | null, incomingId: string | null): string | null {
  if (incomingId && (!activeId || activeId === PENDING_SPEECH_ID)) return incomingId;
  return activeId;
}

/**
 * Guard double response.create.
 * skip: already waiting for the server to start one, or a follow-up already began.
 * replace: cancel the in-flight spoken response, then create.
 * create: floor is free.
 */
export function decideResponseCreate(opts: {
  createInFlight: boolean;
  hasActiveResponse: boolean;
  ifActive?: "skip" | "replace";
}): ResponseCreateDecision {
  if (opts.createInFlight) return "skip";
  if (opts.hasActiveResponse) return opts.ifActive === "skip" ? "skip" : "replace";
  return "create";
}

/**
 * After tools: create immediately if the floor is free or still the finished
 * tool-bearing response. Skip only when a *new* follow-up already began.
 * Treating the finished id as "active" skips forever (hang + dead air).
 */
export function decideToolFollowUpCreate(opts: {
  createInFlight: boolean;
  activeId: string | null;
  finishedId: string | null;
}): ResponseCreateDecision {
  if (opts.createInFlight) return "skip";
  if (!opts.activeId) return "create";
  if (opts.activeId === PENDING_SPEECH_ID) return "skip";
  if (opts.finishedId && opts.activeId === opts.finishedId) return "create";
  return "skip";
}

/** Do not treat a just-finished response as still generating. */
export function previousIdForHandoff(activeId: string | null, finishedId: string | null) {
  if (activeId && finishedId && activeId === finishedId) return null;
  return activeId;
}

/** Missing or matching done id must release — a held floor skips the next create. */
export function shouldReleaseSpeechFloor(opts: {
  activeId: string | null;
  doneId: string | null;
}) {
  if (!opts.activeId || opts.activeId === PENDING_SPEECH_ID) return true;
  if (!opts.doneId) return true;
  return opts.doneId === opts.activeId;
}

/**
 * Sequential assistant audio (tool follow-up, second utterance) should append
 * to whatever is still draining. Only flush when a different live response
 * is still generating — that is talking over herself.
 */
export function decidePlaybackHandoff(opts: {
  takeFloor: boolean;
  previousActiveId: string | null;
  incomingId: string | null;
  queuedMs: number;
}): PlaybackHandoff {
  if (!opts.takeFloor) return "continue";
  const previousLive =
    Boolean(opts.previousActiveId) &&
    opts.previousActiveId !== PENDING_SPEECH_ID &&
    opts.previousActiveId !== opts.incomingId;
  if (previousLive) return "replace";
  if (opts.queuedMs > 0) return "continue";
  return "reset";
}

/** User-initiated turn stays open through tool follow-ups. Idle chatter does not. */
export function shouldClearExpectAfterDone(opts: {
  toolsThisResponse: boolean;
  inflightTools: number;
  toolResponseWaiting: boolean;
  status: string;
}) {
  if (opts.status === "cancelled" || opts.status === "failed" || opts.status === "error") return true;
  if (opts.inflightTools > 0 || opts.toolResponseWaiting) return false;
  return !opts.toolsThisResponse;
}

export function isIgnorableRealtimeError(message: string) {
  return /cancel|no (active|in[- ]progress) response|nothing to cancel|response not found/i.test(
    message,
  );
}

/** Cancel / already-active errors must not kill the socket. */
export function isRecoverableRealtimeError(message: string) {
  return (
    isIgnorableRealtimeError(message) ||
    /already.{0,40}(active|in[- ]progress)|active response|conversation_already/i.test(message)
  );
}

export function raceTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([
    work.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    timeout,
  ]);
}

export function readResponseId(event: Record<string, unknown>): string | null {
  const nested = event.response && typeof event.response === "object" && !Array.isArray(event.response)
    ? (event.response as Record<string, unknown>)
    : null;
  return (
    normalizeResponseId(event.response_id) ??
    normalizeResponseId(nested?.id) ??
    normalizeResponseId(event.id)
  );
}
