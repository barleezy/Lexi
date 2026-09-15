import { formatDecayState, isMemoryStoreConfigured, recallForUser } from "@/lib/memory/store";
import { requireSignedInUserId } from "@/lib/memory/user";

export async function memoryFactsResponse(request: Request, rawUserId?: string | null) {
  const userId = requireSignedInUserId(request, rawUserId);
  if (!userId) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }
  if (!isMemoryStoreConfigured()) {
    return Response.json({ error: "Memory store is not configured." }, { status: 503 });
  }
  const facts = await recallForUser(userId);
  return Response.json({ userId, facts });
}

export async function memoryDecayResponse(request: Request, rawUserId?: string | null) {
  const userId = requireSignedInUserId(request, rawUserId);
  if (!userId) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }
  if (!isMemoryStoreConfigured()) {
    return Response.json({ error: "Memory store is not configured." }, { status: 503 });
  }
  const state = formatDecayState(await recallForUser(userId));
  return Response.json({ userId, state });
}
