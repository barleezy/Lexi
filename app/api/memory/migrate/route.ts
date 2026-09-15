import { migrateMemories } from "@/lib/memory/store";

export async function POST() {
  const result = await migrateMemories();
  if (!result.ok) {
    return Response.json({ error: "Memory store is not configured." }, { status: 503 });
  }
  return Response.json(result);
}
