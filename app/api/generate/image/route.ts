import {
  IMAGE_GENERATIONS_URL,
  buildImageGenerationBody,
  imageModelFromEnv,
  readGeneratedImages,
  readImageError,
} from "@/lib/generate/media";
import { refuseUnder21Prompt } from "@/lib/generate/safety";

export const maxDuration = 60;

export async function POST(request: Request) {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) {
    return Response.json({ error: "Image generation is not configured.", configured: false }, { status: 503 });
  }

  let body: {
    prompt?: unknown;
    aspect_ratio?: unknown;
    aspectRatio?: unknown;
    resolution?: unknown;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid image request." }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const safety = refuseUnder21Prompt(prompt);
  if (!safety.ok) {
    return Response.json({ error: safety.error }, { status: 400 });
  }

  const model = imageModelFromEnv();
  const upstream = await fetch(IMAGE_GENERATIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      buildImageGenerationBody({
        prompt,
        model,
        aspectRatio:
          typeof body.aspect_ratio === "string"
            ? body.aspect_ratio
            : typeof body.aspectRatio === "string"
              ? body.aspectRatio
              : undefined,
        resolution: typeof body.resolution === "string" ? body.resolution : undefined,
      }),
    ),
  });

  let data: unknown = {};
  try {
    data = await upstream.json();
  } catch {
    data = {};
  }

  const images = readGeneratedImages(data);
  if (!upstream.ok || !images.length) {
    const status = upstream.status === 401 ? 401 : upstream.status >= 400 && upstream.status < 500 ? 400 : 502;
    return Response.json({ error: readImageError(data), configured: true }, { status });
  }

  const image = images[0];
  return Response.json({
    ok: true,
    kind: "image",
    prompt,
    model,
    url: image?.url,
    dataUrl: image?.dataUrl,
  });
}
