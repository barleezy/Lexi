import {
  EXPECT_STALL_MS,
  PENDING_SPEECH_ID,
  RESPONSE_CREATE_STALL_MS,
  responseCreateDelayMs,
  TOOL_CALL_TIMEOUT_MS,
  claimExclusiveSpeech,
  decidePlaybackHandoff,
  decideResponseCreate,
  decideToolFollowUpCreate,
  isIgnorableRealtimeError,
  isRecoverableRealtimeError,
  lockSpeechId,
  previousIdForHandoff,
  raceTimeout,
  shouldClearExpectAfterDone,
  shouldReleaseSpeechFloor,
  normalizeResponseId,
  readResponseId,
  shouldPlayOutputAudio,
} from "../lib/voice/exclusive-speech.ts";

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

function expectEqual(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label}: ${left} !== ${right}`);
}

expectEqual(normalizeResponseId(" resp_1 "), "resp_1", "trim response id");
expectEqual(normalizeResponseId(""), null, "empty id");
expectEqual(normalizeResponseId(1), null, "reject non-string");

expectEqual(
  claimExclusiveSpeech(null, "r1"),
  { activeId: "r1", takeFloor: true },
  "first response takes the floor",
);
expectEqual(
  claimExclusiveSpeech("r1", "r1"),
  { activeId: "r1", takeFloor: false },
  "same response keeps the floor",
);
expectEqual(
  claimExclusiveSpeech("r1", "r2"),
  { activeId: "r2", takeFloor: true },
  "later response replaces the floor",
);
expectEqual(
  claimExclusiveSpeech("r1", null),
  { activeId: "r1", takeFloor: false },
  "missing id does not steal the floor",
);

expectEqual(
  shouldPlayOutputAudio({ ignore: true, activeId: "r1", incomingId: "r1" }),
  false,
  "barge-in drops her leftover audio",
);
expectEqual(
  shouldPlayOutputAudio({ ignore: false, activeId: "r1", incomingId: "r1" }),
  true,
  "active response plays",
);
expectEqual(
  shouldPlayOutputAudio({ ignore: false, activeId: "r1", incomingId: "r2" }),
  false,
  "stale response id is dropped",
);
expectEqual(
  shouldPlayOutputAudio({ ignore: false, activeId: "r1", incomingId: null }),
  true,
  "unlabeled delta belongs to the active floor",
);
expectEqual(
  shouldPlayOutputAudio({ ignore: false, activeId: null, incomingId: "r1" }),
  false,
  "no floor means no speech",
);

expectEqual(
  decideResponseCreate({ createInFlight: true, hasActiveResponse: false }),
  "skip",
  "do not double-create on the same turn",
);
expectEqual(
  decideResponseCreate({ createInFlight: false, hasActiveResponse: true }),
  "replace",
  "cancel the in-flight spoken response before a new reply",
);
expectEqual(
  decideResponseCreate({ createInFlight: false, hasActiveResponse: false }),
  "create",
  "free floor may create",
);
expectEqual(
  decideResponseCreate({ createInFlight: true, hasActiveResponse: true }),
  "skip",
  "in-flight create wins over a second create",
);
expectEqual(
  decideResponseCreate({ createInFlight: false, hasActiveResponse: true, ifActive: "skip" }),
  "skip",
  "tool follow-up does not cancel a response the server already started",
);
expectEqual(
  decideResponseCreate({ createInFlight: false, hasActiveResponse: true, ifActive: "replace" }),
  "replace",
  "a new user message still replaces the in-flight reply",
);

expectEqual(
  decidePlaybackHandoff({
    takeFloor: true,
    previousActiveId: "r1",
    incomingId: "r2",
    queuedMs: 400,
  }),
  "replace",
  "overlapping live responses flush so she does not talk over herself",
);
expectEqual(
  decidePlaybackHandoff({
    takeFloor: true,
    previousActiveId: null,
    incomingId: "r2",
    queuedMs: 400,
  }),
  "continue",
  "sequential follow-up keeps draining audio",
);
expectEqual(
  decidePlaybackHandoff({
    takeFloor: true,
    previousActiveId: null,
    incomingId: "r2",
    queuedMs: 0,
  }),
  "reset",
  "cold start still uses playback lead",
);
expectEqual(
  decidePlaybackHandoff({
    takeFloor: false,
    previousActiveId: "r1",
    incomingId: "r1",
    queuedMs: 0,
  }),
  "continue",
  "same response id keeps the scheduler",
);
expectEqual(
  decidePlaybackHandoff({
    takeFloor: true,
    previousActiveId: PENDING_SPEECH_ID,
    incomingId: "r1",
    queuedMs: 80,
  }),
  "continue",
  "pending floor with queued audio is the same turn",
);

expectEqual(
  shouldClearExpectAfterDone({
    toolsThisResponse: false,
    inflightTools: 0,
    toolResponseWaiting: false,
    status: "completed",
  }),
  true,
  "plain reply closes the spoken turn — no idle chatter",
);
expectEqual(
  shouldClearExpectAfterDone({
    toolsThisResponse: true,
    inflightTools: 0,
    toolResponseWaiting: true,
    status: "completed",
  }),
  false,
  "keep the turn open while tools still need a spoken follow-up",
);
expectEqual(
  shouldClearExpectAfterDone({
    toolsThisResponse: true,
    inflightTools: 1,
    toolResponseWaiting: false,
    status: "completed",
  }),
  false,
  "keep the turn open while a tool is in flight",
);
expectEqual(
  shouldClearExpectAfterDone({
    toolsThisResponse: true,
    inflightTools: 0,
    toolResponseWaiting: false,
    status: "cancelled",
  }),
  true,
  "cancelled reply is not a follow-up window",
);
expectEqual(
  shouldClearExpectAfterDone({
    toolsThisResponse: true,
    inflightTools: 1,
    toolResponseWaiting: true,
    status: "error",
  }),
  true,
  "error status always closes the spoken turn",
);

expectEqual(
  shouldReleaseSpeechFloor({ activeId: "r1", doneId: "r1" }),
  true,
  "matching done id releases the floor",
);
expectEqual(
  shouldReleaseSpeechFloor({ activeId: "r1", doneId: "" }),
  true,
  "missing done id still releases — do not hold the lock",
);
expectEqual(
  shouldReleaseSpeechFloor({ activeId: PENDING_SPEECH_ID, doneId: "r2" }),
  true,
  "pending floor releases on done",
);
expectEqual(
  shouldReleaseSpeechFloor({ activeId: "r2", doneId: "r1" }),
  false,
  "a newer live response is not cleared by an older done",
);
expectEqual(
  shouldReleaseSpeechFloor({ activeId: null, doneId: "r1" }),
  true,
  "empty floor stays free",
);

expectEqual(previousIdForHandoff("r1", "r1"), null, "finished id is not still generating");
expectEqual(previousIdForHandoff("r2", "r1"), "r2", "a newer live id stays previous");
expectEqual(previousIdForHandoff(PENDING_SPEECH_ID, "r1"), PENDING_SPEECH_ID, "pending is same turn");

expectEqual(
  decideToolFollowUpCreate({ createInFlight: false, activeId: null, finishedId: "r1" }),
  "create",
  "free floor after tools must create — server will not idle-talk",
);
expectEqual(
  decideToolFollowUpCreate({ createInFlight: false, activeId: "r1", finishedId: "r1" }),
  "create",
  "stale finished id must not skip the spoken follow-up",
);
expectEqual(
  decideToolFollowUpCreate({ createInFlight: false, activeId: "r2", finishedId: "r1" }),
  "skip",
  "a follow-up the server already started is not created again",
);
expectEqual(
  decideToolFollowUpCreate({ createInFlight: true, activeId: null, finishedId: "r1" }),
  "skip",
  "in-flight create is enough",
);
expectEqual(
  decideToolFollowUpCreate({ createInFlight: false, activeId: PENDING_SPEECH_ID, finishedId: "r1" }),
  "skip",
  "pending created event is the follow-up landing",
);

expectEqual(
  decidePlaybackHandoff({
    takeFloor: true,
    previousActiveId: previousIdForHandoff("r1", "r1"),
    incomingId: "r2",
    queuedMs: 400,
  }),
  "continue",
  "sequential follow-up after a finished line appends — no flush+lead gap",
);

expect(responseCreateDelayMs({ carAudio: true }) === 0, "no client wait before response.create on car");
expect(responseCreateDelayMs() === 0, "no extra create delay");
expect(RESPONSE_CREATE_STALL_MS <= 2000, "create stall is recovery, not a stacked pause");
expect(EXPECT_STALL_MS <= 5000, "expect stall is recovery");
expect(TOOL_CALL_TIMEOUT_MS <= 12_000, "tools cannot hold the turn open indefinitely");
expect(TOOL_CALL_TIMEOUT_MS >= 4000, "tools get a few seconds before timeout");

expect(isIgnorableRealtimeError("Cancellation failed: no active response") === true, "cancel error is ignorable");
expect(isIgnorableRealtimeError("no in-progress response") === true, "no in-progress is ignorable");
expect(isRecoverableRealtimeError("already has an active response") === true, "already-active is recoverable");
expect(isRecoverableRealtimeError("conversation_already has a response") === true, "conversation_already is recoverable");
expect(isRecoverableRealtimeError("upstream 500") === false, "real failures still fail the session");

await raceTimeout(new Promise((resolve) => setTimeout(() => resolve("slow"), 50)), 5, "fallback").then((value) => {
  expectEqual(value, "fallback", "tool timeout wins over a hung promise");
});
await raceTimeout(Promise.resolve("fast"), 50, "fallback").then((value) => {
  expectEqual(value, "fast", "finished tool is not delayed by the timeout");
});

expectEqual(
  shouldPlayOutputAudio({ ignore: false, activeId: PENDING_SPEECH_ID, incomingId: "r2" }),
  true,
  "pending floor accepts the first real id",
);
expectEqual(lockSpeechId(PENDING_SPEECH_ID, "r2"), "r2", "lock pending to first real id");
expectEqual(lockSpeechId("r1", "r2"), "r1", "lock does not switch to a stale id");
expectEqual(lockSpeechId(null, "r2"), "r2", "first delta may claim an empty floor");

expectEqual(readResponseId({ response_id: "r2" }), "r2", "audio delta id");
expectEqual(readResponseId({ response: { id: "r3" } }), "r3", "created/done id");
expectEqual(readResponseId({ type: "response.created" }), null, "no id");

console.log("exclusive-speech ok");
