import {
  getToyStatus,
  isAnyToyConfigured,
  parseToyProvider,
  sendToyCommand,
  type ToyCommandInput,
} from "@/lib/voice/toys";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const provider = parseToyProvider(url.searchParams.get("provider"));
  if (!provider) {
    return Response.json({ error: "provider must be lovense, joyhub, or all." }, { status: 400 });
  }
  if (provider !== "all" && !isAnyToyConfigured()) {
    return Response.json({ error: "No toy provider is configured.", configured: false }, { status: 503 });
  }
  const status = await getToyStatus(provider);
  if (provider === "lovense" && !status.providers.lovense) {
    return Response.json({ error: "Lovense is not configured.", ...status }, { status: 503 });
  }
  if (provider === "joyhub" && !status.providers.joyhub) {
    return Response.json({ error: "Joyhub is not configured.", ...status }, { status: 503 });
  }
  if (provider === "all" && !status.providers.lovense && !status.providers.joyhub) {
    return Response.json({ error: "No toy provider is configured.", ...status }, { status: 503 });
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

  const result = await sendToyCommand(body);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ok: true, results: result.results });
}
