/**
 * Live server secrets. Always read through env[name] (not process.env.NAME)
 * so Next.js cannot inline a stale build-time copy.
 *
 * Inference (`XAI_API_KEY`) mints realtime tokens.
 * Management (`XAI_MANAGEMENT_API_KEY`) is for prepaid top-up and remaining-balance reads.
 * Never fall back from one to the other.
 */

export function readRuntimeEnv(name: string, env: NodeJS.ProcessEnv = process.env) {
  return env[name]?.trim() || "";
}

export function xaiInferenceKey(env: NodeJS.ProcessEnv = process.env) {
  return readRuntimeEnv("XAI_API_KEY", env);
}

export function xaiManagementApiKey(env: NodeJS.ProcessEnv = process.env) {
  return readRuntimeEnv("XAI_MANAGEMENT_API_KEY", env);
}

export function xaiTeamId(env: NodeJS.ProcessEnv = process.env) {
  return readRuntimeEnv("XAI_TEAM_ID", env);
}

export function stripeSecretKey(env: NodeJS.ProcessEnv = process.env) {
  return readRuntimeEnv("STRIPE_SECRET_KEY", env);
}

export function stripeWebhookSecret(env: NodeJS.ProcessEnv = process.env) {
  return readRuntimeEnv("STRIPE_WEBHOOK_SECRET", env);
}

export function describeSecret(name: string, value: string) {
  if (!value) return { name, set: false as const };
  let kind = "present";
  if (value.startsWith("sk_test")) kind = "stripe_test";
  else if (value.startsWith("sk_live")) kind = "stripe_live";
  else if (value.startsWith("whsec_")) kind = "stripe_webhook";
  else if (value.startsWith("xai-")) kind = "xai";
  return { name, set: true as const, kind, length: value.length };
}

export function voiceEnvStatus(env: NodeJS.ProcessEnv = process.env) {
  const teamId = xaiTeamId(env);
  return {
    XAI_API_KEY: describeSecret("XAI_API_KEY", xaiInferenceKey(env)),
    XAI_MANAGEMENT_API_KEY: describeSecret("XAI_MANAGEMENT_API_KEY", xaiManagementApiKey(env)),
    XAI_TEAM_ID: { name: "XAI_TEAM_ID", set: Boolean(teamId), length: teamId.length },
    STRIPE_SECRET_KEY: describeSecret("STRIPE_SECRET_KEY", stripeSecretKey(env)),
    STRIPE_WEBHOOK_SECRET: describeSecret("STRIPE_WEBHOOK_SECRET", stripeWebhookSecret(env)),
  };
}

export function logVoiceEnv(src: string, env: NodeJS.ProcessEnv = process.env) {
  console.info(`[env] ${src}`, voiceEnvStatus(env));
}

export function readMintError(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const row = data as { error?: unknown; message?: unknown };
  if (typeof row.error === "string" && row.error) return row.error;
  if (row.error && typeof row.error === "object") {
    const nested = row.error as { message?: unknown };
    if (typeof nested.message === "string" && nested.message) return nested.message;
  }
  if (typeof row.message === "string" && row.message) return row.message;
  return "";
}

export function voiceMintFailureMessage(raw: string) {
  if (/credit|spending limit|permission-denied|does not have permission/i.test(raw)) {
    return "xAI is out of credits or at its monthly spend limit. Add credits at console.x.ai, then start voice again.";
  }
  if (/internal error/i.test(raw)) {
    return "xAI rejected the voice session. Confirm XAI_API_KEY is the live inference key, not the management key, then try Connect again.";
  }
  return "Could not start a voice session.";
}
