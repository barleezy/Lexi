import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

const SESSION_ID = /^[a-z0-9]{4,64}$/;
const MAX_LINE = 16_000;

export function isVoiceLogEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.VOICE_LOG === "1";
}

export function isValidSessionId(id: string) {
  return SESSION_ID.test(id);
}

export async function appendVoiceLog(
  sessionId: string,
  entries: Record<string, unknown>[],
) {
  if (!isValidSessionId(sessionId)) return;
  const dir = path.join(process.cwd(), ".voice-logs");
  await mkdir(dir, { recursive: true });
  const lines = entries
    .slice(0, 500)
    .map((entry) => JSON.stringify(entry))
    .filter((line) => line.length < MAX_LINE);
  if (lines.length === 0) return;
  await appendFile(path.join(dir, `${sessionId}.ndjson`), `${lines.join("\n")}\n`);
}
