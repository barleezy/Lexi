import { createHmac, timingSafeEqual } from "node:crypto";
import { readEnv } from "./config";
import { samePhone, twilioMessagesUrl, twilioSignatureBase } from "./parse";
import { clipOutboundText } from "./safety";

export {
  TWILIO_API,
  normalizePhone,
  parseTwilioInbound,
  samePhone,
  twilioMessagesUrl,
  twilioSignatureBase,
  twimlEmpty,
  twimlMessage,
} from "./parse";

export function twilioFrom(env: NodeJS.ProcessEnv = process.env) {
  return readEnv("TWILIO_FROM", env);
}

export function twilioTo(env: NodeJS.ProcessEnv = process.env) {
  return readEnv("TWILIO_TO", env);
}

export function isIanSmsNumber(from: string, env: NodeJS.ProcessEnv = process.env) {
  return samePhone(from, twilioTo(env));
}

export function verifyTwilioSignature(input: {
  authToken: string;
  signature: string;
  url: string;
  params: Record<string, string>;
}) {
  if (!input.authToken || !input.signature || !input.url) return false;
  const expected = createHmac("sha1", input.authToken)
    .update(twilioSignatureBase(input.url, input.params), "utf8")
    .digest("base64");
  const left = Buffer.from(expected);
  const right = Buffer.from(input.signature);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function sendSms(text: string, env: NodeJS.ProcessEnv = process.env) {
  const sid = readEnv("TWILIO_ACCOUNT_SID", env);
  const token = readEnv("TWILIO_AUTH_TOKEN", env);
  const from = twilioFrom(env);
  const to = twilioTo(env);
  if (!sid || !token || !from || !to) {
    return { ok: false as const, status: 503, error: "SMS is not configured." };
  }
  const body = clipOutboundText(text, 1500);
  if (!body) return { ok: false as const, status: 400, error: "Message is empty." };

  const params = new URLSearchParams({ From: from, To: to, Body: body });
  const response = await fetch(twilioMessagesUrl(sid), {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  let data: unknown = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (!response.ok) {
    const message = typeof record?.message === "string" ? record.message : "Twilio send failed.";
    return { ok: false as const, status: response.status >= 400 ? response.status : 502, error: message };
  }
  return { ok: true as const, status: 200, platform: "sms" as const, sid: record?.sid };
}
