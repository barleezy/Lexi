import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CALL_MEMORY_CAP = 10;

function formatCallMemories(rows) {
  const lines = rows.map((row) => row.summary.trim()).filter(Boolean).slice(0, CALL_MEMORY_CAP);
  if (!lines.length) return "";
  return `RECENT CALL MEMORIES (newest first — brief context only, do not recite verbatim unless asked)\n\n${lines
    .map((line, index) => `${index + 1}. ${line}`)
    .join("\n")}`;
}

function mergeMemoryInstructions(factsBlock, callMemoriesBlock) {
  const facts = factsBlock.trim();
  const calls = callMemoriesBlock.trim();
  if (facts && calls) return `${facts}\n\n${calls}`;
  return facts || calls;
}

assert.equal(formatCallMemories([]), "");
assert.equal(
  formatCallMemories([
    { summary: "Talked about dogs." },
    { summary: "Planned a call later." },
  ]),
  "RECENT CALL MEMORIES (newest first — brief context only, do not recite verbatim unless asked)\n\n1. Talked about dogs.\n2. Planned a call later.",
);
assert.equal(mergeMemoryInstructions("RECALLED FACTS\n\nname: Ian", ""), "RECALLED FACTS\n\nname: Ian");
assert.equal(mergeMemoryInstructions("", "RECENT CALL MEMORIES\n\n1. Hi"), "RECENT CALL MEMORIES\n\n1. Hi");
assert.ok(mergeMemoryInstructions("FACTS", "CALLS").includes("FACTS"));
assert.ok(mergeMemoryInstructions("FACTS", "CALLS").includes("CALLS"));

const storeSrc = readFileSync(new URL("../lib/memory/store.ts", import.meta.url), "utf8");
assert.ok(storeSrc.includes("listTurnsForSession"), "session-scoped turns helper");

const summariesSrc = readFileSync(new URL("../lib/memory/call-summaries.ts", import.meta.url), "utf8");
assert.ok(summariesSrc.includes("CREATE TABLE IF NOT EXISTS call_memories"), "call_memories table");
assert.ok(summariesSrc.includes("user_id text NOT NULL"), "user_id column");
assert.ok(summariesSrc.includes("summary text NOT NULL"), "summary column");
assert.ok(summariesSrc.includes("created_at timestamptz"), "created_at column");
assert.ok(summariesSrc.includes("CALL_MEMORY_CAP = 10"), "keep last 10");
assert.ok(summariesSrc.includes("2 to 4"), "2-4 sentence prompt");
assert.ok(summariesSrc.includes("generateCallSummary"), "summary generator");
assert.ok(summariesSrc.includes("textFastModelFromEnv"), "text model");
assert.ok(
  /INSERT INTO call_memories \(user_id, summary\)/.test(summariesSrc),
  "insert summary only (no transcript columns)",
);
assert.ok(
  !/CREATE TABLE IF NOT EXISTS call_memories \([^)]*user_text/.test(summariesSrc),
  "call_memories schema has no transcript columns",
);
assert.ok(summariesSrc.includes("listTurnsForSession"), "reads session turns via store helper");
assert.ok(
  summariesSrc.includes("Never writes the raw transcript into call_memories") ||
    summariesSrc.includes("never writes the raw transcript"),
  "docs: summaries only, not transcript",
);

const settleSrc = readFileSync(new URL("../app/api/voice/settle/route.ts", import.meta.url), "utf8");
assert.ok(settleSrc.includes("summarizeSettledCall"), "settle writes summary");
assert.ok(settleSrc.includes("sessionId"), "settle accepts memory sessionId");

const mintSrc = readFileSync(new URL("../app/api/realtime/session/route.ts", import.meta.url), "utf8");
assert.ok(mintSrc.includes("listCallMemories"), "mint loads call memories");
assert.ok(mintSrc.includes("formatCallMemories"), "mint formats call memories");
assert.ok(mintSrc.includes("mergeMemoryInstructions"), "mint merges facts + summaries");

const iosSrc = readFileSync(new URL("../lib/ios/session.ts", import.meta.url), "utf8");
assert.ok(iosSrc.includes("listCallMemories"), "iOS mint loads call memories");
assert.ok(iosSrc.includes("mergeMemoryInstructions"), "iOS merges facts + summaries");

const voiceClient = readFileSync(new URL("../lib/voice/session.ts", import.meta.url), "utf8");
assert.ok(
  /JSON\.stringify\(\{\s*voiceSessionId,\s*sessionId,\s*userId\s*\}\)/.test(voiceClient) ||
    voiceClient.includes("sessionId, userId") ||
    voiceClient.includes("voiceSessionId, sessionId, userId"),
  "web settle sends memory sessionId",
);

const iosApi = readFileSync(
  new URL("../ios/TalkToLexi/TalkToLexi/Shared/API/LexiAPIClient.swift", import.meta.url),
  "utf8",
);
assert.ok(iosApi.includes("memorySessionId"), "iOS settle can send memory sessionId");

console.log("call memories checks ok");
