import { getToyStatus, sendToyCommand, type ToyCommandInput } from "@/lib/voice/toys";

export async function GET() {
  const status = await getToyStatus("joyhub");
  if (!status.providers.joyhub) {
    return Response.json({ error: "Joyhub is not configured.", ...status }, { status: 503 });
  }
  return Response.json({ ok: true, ...status });
}

export async function POST(request: Request) {
  let body: ToyCommandInput;
  try {
    body = (await request.json()) as ToyCommandInput;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await sendToyCommand({ ...body, provider: "joyhub" });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ok: true, results: result.results });
}
