export const PRIOR_TURN_CAP = 16;
const LINE_CAP = 500;

export type ChatTurn = {
  id: string;
  user_text: string;
  assistant_text: string;
};

export type ChatTranscriptRow = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

function clip(text: string) {
  const trimmed = text.trim();
  if (trimmed.length <= LINE_CAP) return trimmed;
  return `${trimmed.slice(0, LINE_CAP)}…`;
}

export function parseChatTurns(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: ChatTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const userText = typeof row.user_text === "string" ? row.user_text : "";
    const assistantText = typeof row.assistant_text === "string" ? row.assistant_text : "";
    if (!id || (!userText.trim() && !assistantText.trim())) continue;
    turns.push({ id, user_text: userText, assistant_text: assistantText });
  }
  return turns.slice(-PRIOR_TURN_CAP);
}

export function formatPriorChat(turns: ChatTurn[]) {
  const lines: string[] = [];
  for (const turn of turns) {
    const user = clip(turn.user_text);
    const assistant = clip(turn.assistant_text);
    if (user) lines.push(`User: ${user}`);
    if (assistant) lines.push(`Assistant: ${assistant}`);
  }
  if (lines.length === 0) return "";
  return `PRIOR CHAT\n\n${lines.join("\n")}`;
}

export function turnsToTranscripts(turns: ChatTurn[]): ChatTranscriptRow[] {
  const rows: ChatTranscriptRow[] = [];
  for (const turn of turns) {
    const user = turn.user_text.trim();
    const assistant = turn.assistant_text.trim();
    if (user) rows.push({ id: `${turn.id}:user`, role: "user", text: user });
    if (assistant) rows.push({ id: `${turn.id}:assistant`, role: "assistant", text: assistant });
  }
  return rows;
}
