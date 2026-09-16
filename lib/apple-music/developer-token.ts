import { createPrivateKey, sign } from "node:crypto";
import {
  appleMusicKeyId,
  appleMusicPrivateKey,
  appleMusicTeamId,
  isAppleMusicConfigured,
} from "./config";

const DEFAULT_TTL_SEC = 12 * 60 * 60;

export function normalizeMusicKitPem(raw: string) {
  let key = raw.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\n/g, "\n").trim();
  if (!key.includes("BEGIN")) {
    const body = key.replace(/\s+/g, "");
    return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
  }
  return key;
}

function b64urlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function mintAppleMusicDeveloperToken(
  env: NodeJS.ProcessEnv = process.env,
  now = Math.floor(Date.now() / 1000),
) {
  if (!isAppleMusicConfigured(env)) {
    return { ok: false as const, error: "Apple Music is not configured." };
  }
  const teamId = appleMusicTeamId(env);
  const keyId = appleMusicKeyId(env);
  const pem = normalizeMusicKitPem(appleMusicPrivateKey(env));
  const exp = now + DEFAULT_TTL_SEC;
  const encoded = `${b64urlJson({ alg: "ES256", kid: keyId })}.${b64urlJson({
    iss: teamId,
    iat: now,
    exp,
  })}`;
  try {
    const key = createPrivateKey(pem);
    const signature = sign("SHA256", Buffer.from(encoded), {
      key,
      dsaEncoding: "ieee-p1363",
    });
    return { ok: true as const, token: `${encoded}.${signature.toString("base64url")}`, exp };
  } catch {
    return {
      ok: false as const,
      error: "APPLE_MUSIC_PRIVATE_KEY is not a valid MusicKit .p8 key.",
    };
  }
}
