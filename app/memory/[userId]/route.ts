import { memoryFactsResponse } from "@/lib/memory/http";

export async function GET(request: Request, context: { params: Promise<{ userId: string }> }) {
  const { userId } = await context.params;
  return memoryFactsResponse(request, userId);
}
