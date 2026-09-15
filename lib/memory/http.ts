import { formatDecayState, isMemoryStoreConfigured, recallForUser } from "@/lib/memory/store";
import { resolveUserId } from "@/lib/memory/user";

export async function memoryFactsResponse(request: Request, rawUserId?: string | null) {
  const userId = resolveUserId(request, rawUserId);
  if (!isMemoryStoreConfigured()) {
    return Response.json({ error: "Memory store is not configured." }, { status: 503 });
  }
  const facts = await recallForUser(userId);
  return Response.json({ userId, facts });
}

export async function memoryDecayResponse(request: Request, rawUserId?: string | null) {
  const userId = resolveUserId(request, rawUserId);
  if (!isMemoryStoreConfigured()) {
    return Response.json({ error: "Memory store is not configured." }, { status: 503 });
  }
  const state = formatDecayState(await recallForUser(userId));
  return Response.json({ userId, state });
}
