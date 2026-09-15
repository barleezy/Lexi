import { scoreSalience } from "@/lib/memory/decay";
import {
  assistantTextFromBlob,
  extractFacts,
  parseFactKey,
  userTextFromBlob,
} from "@/lib/memory/extract";
import { memoryFactsResponse } from "@/lib/memory/http";
import {
  endSession,
  isMemoryStoreConfigured,
  recordExchange,
  setFactAffect,
  writeFactFromTool,
} from "@/lib/memory/store";
import { resolveUserId } from "@/lib/memory/user";

function parseOptionalAffect(raw: unknown): { ok: true; value?: number } | { ok: false } {
  if (raw === undefined || raw === null || raw === "") return { ok: true };
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return { ok: false };
  return { ok: true, value };
}

async function factToolResponse(
  request: Request,
  body: {
    tool?: unknown;
    userId?: unknown;
    sessionId?: unknown;
    memory_key?: unknown;
    memoryKey?: unknown;
    value?: unknown;
    affect?: unknown;
  },
) {
  const tool = body.tool === "upsert_fact" || body.tool === "set_affect" ? body.tool : null;
  if (!tool) return null;

  const userId = resolveUserId(
    request,
    typeof body.userId === "string" ? body.userId : null,
  );
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
  const memoryKey = parseFactKey(body.memory_key ?? body.memoryKey);
  if (!memoryKey) {
    return Response.json({ error: "memory_key must be name, pets, location, or commitments." }, { status: 400 });
  }

  if (tool === "upsert_fact") {
    const value = typeof body.value === "string" ? body.value.trim() : "";
    if (!value) {
      return Response.json({ error: "value is required." }, { status: 400 });
    }
    const affect = parseOptionalAffect(body.affect);
    if (!affect.ok) {
      return Response.json({ error: "affect must be a number from 1 to 10." }, { status: 400 });
    }
    if (!isMemoryStoreConfigured()) {
      return Response.json({ error: "Memory store is not configured." }, { status: 503 });
    }
    const fact = await writeFactFromTool({
      userId,
      memoryKey,
      value,
      affect: affect.value,
      sessionId,
    });
    if (!fact) {
      return Response.json({ error: "Memory store is not configured." }, { status: 503 });
    }
    return Response.json({ ok: true, userId, tool, sessionId: fact.session_id, fact });
  }

  const affect = parseOptionalAffect(body.affect);
  if (!affect.ok || affect.value === undefined) {
    return Response.json({ error: "affect must be a number from 1 to 10." }, { status: 400 });
  }
  if (!isMemoryStoreConfigured()) {
    return Response.json({ error: "Memory store is not configured." }, { status: 503 });
  }
  const fact = await setFactAffect({
    userId,
    memoryKey,
    affect: affect.value,
    sessionId,
  });
  if (!fact) {
    return Response.json({ error: "No fact for that memory_key." }, { status: 404 });
  }
  return Response.json({ ok: true, userId, tool, sessionId: fact.session_id, fact });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return memoryFactsResponse(request, url.searchParams.get("userId"));
}

export async function POST(request: Request) {
  let body: {
    tool?: unknown;
    userId?: unknown;
    userText?: unknown;
    assistantText?: unknown;
    rawText?: unknown;
    startSalience?: unknown;
    sessionId?: unknown;
    endSession?: unknown;
    memory_key?: unknown;
    memoryKey?: unknown;
    value?: unknown;
    affect?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const toolReply = await factToolResponse(request, body);
  if (toolReply) return toolReply;

  const userId = resolveUserId(
    request,
    typeof body.userId === "string" ? body.userId : null,
  );
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
  if (body.endSession === true) {
    if (!sessionId) {
      return Response.json({ error: "sessionId is required." }, { status: 400 });
    }
    if (!isMemoryStoreConfigured()) {
      return Response.json({ error: "Memory store is not configured." }, { status: 503 });
    }
    const ended = await endSession(userId, sessionId);
    return Response.json({ userId, sessionId, ended: Boolean(ended), session: ended });
  }
  const rawText = typeof body.rawText === "string" ? body.rawText.trim() : "";
  const userText =
    typeof body.userText === "string" && body.userText.trim()
      ? body.userText.trim()
      : userTextFromBlob(rawText);
  const assistantText =
    typeof body.assistantText === "string" && body.assistantText.trim()
      ? body.assistantText.trim()
      : assistantTextFromBlob(rawText);
  if (!userText) {
    return Response.json({ error: "userText or rawText is required." }, { status: 400 });
  }

  const startSalience = Number(body.startSalience);
  const affect = Number.isFinite(startSalience)
    ? startSalience
    : scoreSalience(userText, assistantText);
  const extracted = extractFacts(userText, assistantText);
  const recorded = await recordExchange({
    userId,
    userText,
    assistantText,
    facts: extracted,
    affect,
    sessionId,
  });
  if (!recorded.turn) {
    return Response.json({ error: "Memory store is not configured." }, { status: 503 });
  }
  return Response.json({
    userId,
    sessionId: recorded.turn.session_id,
    facts: recorded.facts,
    extracted,
    turn: recorded.turn,
  });
}
