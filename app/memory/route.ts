import { memoryFactsResponse } from "@/lib/memory/http";

export async function GET(request: Request) {
  return memoryFactsResponse(request);
}
