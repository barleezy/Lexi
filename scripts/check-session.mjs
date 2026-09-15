import { formatSessionIdLine, parseSessionId } from "../lib/memory/session-id.ts";
import {
  formatPriorChat,
  parseChatTurns,
  PRIOR_TURN_CAP,
  turnsToTranscripts,
} from "../lib/memory/turns.ts";
import {
  clearVoiceSessionStore,
  parseTranscripts,
  readVoiceSessionStore,
  VOICE_STORAGE_KEYS,
  writeVoiceSessionStore,
} from "../lib/voice/persist.ts";

function expectEqual(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label}: ${left} !== ${right}`);
}

expectEqual(VOICE_STORAGE_KEYS.sessionId, "lexi.sessionId", "sessionId key");
expectEqual(VOICE_STORAGE_KEYS.started, "lexi.started", "started key");
expectEqual(VOICE_STORAGE_KEYS.userId, "lexi.userId", "userId key");
expectEqual(VOICE_STORAGE_KEYS.caption, "lexi.caption", "caption key");
expectEqual(VOICE_STORAGE_KEYS.transcripts, "lexi.transcripts", "transcripts key");

const uuid = "2f1c8a6e-4b0d-4a11-9c3e-7a1b2c3d4e5f";
expectEqual(parseSessionId(uuid), uuid, "parse uuid");
expectEqual(parseSessionId(` ${uuid} `), uuid, "parse padded uuid");
expectEqual(parseSessionId("abc123"), null, "reject log id");
expectEqual(parseSessionId(""), null, "reject empty");
expectEqual(parseSessionId(null), null, "reject null");
expectEqual(formatSessionIdLine(uuid), `SESSION ID: ${uuid}`, "session line");
expectEqual(formatSessionIdLine("abc123"), "", "no line for log id");

expectEqual(parseTranscripts(null), [], "empty raw");
expectEqual(
  parseTranscripts(JSON.stringify([{ id: "1", role: "user", text: "hi" }])),
  [{ id: "1", role: "user", text: "hi" }],
  "valid row",
);
expectEqual(
  parseTranscripts(JSON.stringify([{ id: "1", role: "bot", text: "no" }, { role: "user" }])),
  [],
  "reject bad rows",
);

const memory = {};
globalThis.sessionStorage = {
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
  },
  setItem(key, value) {
    memory[key] = String(value);
  },
  removeItem(key) {
    delete memory[key];
  },
};

writeVoiceSessionStore({
  sessionId: uuid,
  started: true,
  userId: "Ian",
  caption: "hello",
  rows: [{ id: "1", role: "user", text: "hello" }],
});
expectEqual(
  readVoiceSessionStore(),
  {
    sessionId: uuid,
    started: true,
    userId: "Ian",
    caption: "hello",
    rows: [{ id: "1", role: "user", text: "hello" }],
  },
  "roundtrip store",
);
expectEqual(memory["lexi.started"], "1", "started flag");
clearVoiceSessionStore();
expectEqual(readVoiceSessionStore().sessionId, null, "cleared session");
expectEqual(readVoiceSessionStore().started, false, "cleared started");
expectEqual(readVoiceSessionStore().userId, "", "cleared user is not Ian");

expectEqual(PRIOR_TURN_CAP, 32, "prior turn cap");
const turns = parseChatTurns([
  { id: "a", user_text: "hi", assistant_text: "hello" },
  { id: "b", user_text: "later", assistant_text: "ok" },
]);
expectEqual(turns.length, 2, "parse two turns");
expectEqual(
  formatPriorChat(turns),
  "PRIOR CHAT\n\nUser: hi\nAssistant: hello\nUser: later\nAssistant: ok",
  "prior chat block",
);
expectEqual(formatPriorChat([]), "", "empty prior chat");
expectEqual(
  turnsToTranscripts(turns),
  [
    { id: "a:user", role: "user", text: "hi" },
    { id: "a:assistant", role: "assistant", text: "hello" },
    { id: "b:user", role: "user", text: "later" },
    { id: "b:assistant", role: "assistant", text: "ok" },
  ],
  "turns to transcripts",
);

console.log("check-session ok");
