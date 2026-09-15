import { memoryDecayResponse } from "@/lib/memory/http";

export async function GET(request: Request) {
  const url = new URL(request.url);
  return memoryDecayResponse(request, url.searchParams.get("userId"));
}
