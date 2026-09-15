import {
  fortniteErrorMessage,
  fortniteErrorStatus,
  getFortniteStatus,
  runFortniteCommand,
  type FortniteCommandInput,
} from "@/lib/voice/fortnite";

export async function GET() {
  try {
    const result = await getFortniteStatus({ autoFriend: true });
    const { status, ...body } = result;
    return Response.json(body, { status });
  } catch (error) {
    return Response.json(
      {
        error: fortniteErrorMessage(error),
        configured: true,
        canPlayInGame: false,
      },
      { status: fortniteErrorStatus(error) },
    );
  }
}

export async function POST(request: Request) {
  let body: FortniteCommandInput;
  try {
    body = (await request.json()) as FortniteCommandInput;
  } catch {
    return Response.json({ error: "Invalid JSON", canPlayInGame: false }, { status: 400 });
  }

  try {
    const result = await runFortniteCommand(body);
    const { status, ...payload } = result;
    return Response.json(payload, { status });
  } catch (error) {
    return Response.json(
      {
        error: fortniteErrorMessage(error),
        configured: true,
        canPlayInGame: false,
      },
      { status: fortniteErrorStatus(error) },
    );
  }
}
