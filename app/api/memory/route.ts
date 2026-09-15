import { scoreSalience } from "@/lib/memory/decay";
import {
  assistantTextFromBlob,
  extractFacts,
  userTextFromBlob,
} from "@/lib/memory/extract";
import { endSession, isMemoryStoreConfigured, recallForUser, recordExchange } from "@/lib/memory/store";
import { readUserId, resolveUserId } from "@/lib/memory/user";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = readUserId(request, url.searchParams.get("userId"));
  if (!userId) {
    return Response.json({ error: "userId is required." }, { status: 400 });
  }
  if (!isMemoryStoreConfigured()) {
    return Response.json({ error: "Memory store is not configured." }, { status: 503 });
  }
  const facts = await recallForUser(userId);
  return Response.json({ userId, facts });
}

export async function POST(request: Request) {
  let body: {
    userId?: unknown;
    userText?: unknown;
    assistantText?: unknown;
    rawText?: unknown;
    startSalience?: unknown;
    sessionId?: unknown;
    endSession?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

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
