import {
  PENDING_SPEECH_ID,
  claimExclusiveSpeech,
  decidePlaybackHandoff,
  decideResponseCreate,
  lockSpeechId,
  shouldClearExpectAfterDone,
  normalizeResponseId,
  readResponseId,
  shouldPlayOutputAudio,
} from "../lib/voice/exclusive-speech.ts";

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
