import { readFile } from "node:fs/promises";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run voice:logs -- .voice-logs/<id>.ndjson");
  process.exit(1);
}

const lines = (await readFile(file, "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const milestones = new Set([
  "start",
  "token.ok",
  "mic.ok",
  "env",
  "ws.open",
  "ws.close",
  "server.token",
  "stop",
  "error",
]);

console.log("Milestones");
for (const entry of lines.filter((item) => milestones.has(item.kind))) {
  console.log(
    `${entry.t ?? entry.ts}ms ${entry.kind} ${entry.type ?? ""} ${entry.message ?? ""}`.trim(),
  );
}

const counts = new Map();
for (const entry of lines.filter((item) => item.kind === "server")) {
  const type = entry.type ?? "unknown";
  counts.set(type, (counts.get(type) ?? 0) + 1);
}
console.log("\nServer events");
for (const [type, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${count} ${type}`);
}

console.log("\nTurns");
for (const entry of lines.filter((item) => item.kind === "audio.out")) {
  const first = lines.find(
    (item) => item.kind === "audio.out.first" && item.response_id === entry.response_id,
  );
  console.log(
    `${entry.response_id ?? ""} status=${entry.status ?? ""} first=${first?.since_speech_stopped_ms ?? "?"}ms underruns=${entry.underruns ?? 0}`,
  );
}

const mic = lines.filter((item) => item.kind === "audio.in");
const micBytes = mic.reduce((sum, item) => sum + (item.bytes ?? 0), 0);
console.log(`\nMic windows ${mic.length} bytes ${micBytes}`);

const errors = lines.filter((item) => item.kind === "error" || item.kind === "ws.close");
console.log("\nErrors and closes");
for (const entry of errors) console.log(JSON.stringify(entry));

console.log("\nLast 25");
for (const entry of lines.slice(-25)) console.log(JSON.stringify(entry));
