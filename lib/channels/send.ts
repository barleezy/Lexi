import {
  CHANNELS,
  channelSetupHint,
  isChannelConfigured,
  parseChannelPlatform,
  parseChannelText,
  type ChannelId,
} from "./config";
import { sendDiscordDm } from "./discord";
import { sendEmail } from "./email";
import { clipOutboundText } from "./safety";
import { sendSms } from "./sms";
import { sendTelegramMessage } from "./telegram";

export type ChannelSendInput = {
  platform?: unknown;
  channel?: unknown;
  text?: unknown;
  message?: unknown;
};

export type ChannelSendResult =
  | { ok: true; status: 200; platform: ChannelId; via?: string }
  | { ok: false; status: number; error: string; configured?: boolean; platform?: ChannelId | null };

export function readChannelSend(input: ChannelSendInput) {
  const platform = parseChannelPlatform(input.platform ?? input.channel);
  const text = parseChannelText(input.text ?? input.message);
  return { platform, text };
}

export async function sendChannelMessage(input: ChannelSendInput): Promise<ChannelSendResult> {
  const { platform, text } = readChannelSend(input);
  if (!platform) {
    return {
      ok: false,
      status: 400,
      error: `platform must be ${CHANNELS.join(", ")}.`,
      platform: null,
    };
  }
  const clipped = clipOutboundText(text);
  if (!clipped) {
    return { ok: false, status: 400, error: "text is required.", platform };
  }
  if (!isChannelConfigured(platform)) {
    return {
      ok: false,
      status: 503,
      error: channelSetupHint(platform),
      configured: false,
      platform,
    };
  }

  const result =
    platform === "discord"
      ? await sendDiscordDm(clipped)
      : platform === "telegram"
        ? await sendTelegramMessage(clipped)
        : platform === "sms"
          ? await sendSms(clipped)
          : await sendEmail(clipped);

  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error: result.error,
      configured: result.status !== 503,
      platform,
    };
  }
  return {
    ok: true,
    status: 200,
    platform,
    via: "via" in result ? result.via : undefined,
  };
}
