import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { neon } from "@neondatabase/serverless";

function asRows(result) {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && Array.isArray(result.rows)) return result.rows;
  return [];
}

function loadDatabaseUrl() {
  const url = (process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "").trim();
  if (!url || url === "[SENSITIVE]" || url === "Hidden") return "";
  return url;
}

function sqlStatements(source) {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function loadEnvFile(path) {
  try {
    const text = readFileSync(path, "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env) || !String(process.env[key] || "").trim()) {
        process.env[key] = value;
      }
    }
  } catch {
    // optional local env for session signing
  }
}

function signAdminSession() {
  loadEnvFile(new URL("../.env.local", import.meta.url));
  const secret = (
    process.env.AUTH_SESSION_SECRET ||
    process.env.IOS_SESSION_SECRET ||
    process.env.XAI_API_KEY ||
    ""
  ).trim();
  if (!secret || secret === "[SENSITIVE]") return null;
  const body = {
    userId: "Ian",
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
    v: 1,
  };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = createHmac("sha256", secret).update(`web:${payload}`).digest("base64url");
  return `${payload}.${sig}`;
}

const dryRun = process.env.DRY_RUN === "1";
const url = loadDatabaseUrl();
if (!url) {
  console.error("NO_DATABASE_URL");
  process.exit(1);
}

const sql = neon(url);
const file = new URL("./zero-unearned-voice-seconds.sql", import.meta.url);
const statements = sqlStatements(readFileSync(file, "utf8")).filter((statement) => {
  if (!dryRun) return true;
  return !/^\s*UPDATE\b/i.test(statement);
});

console.log("dry_run", dryRun);
console.log("statement_count", statements.length);

const credits = asRows(
  await sql.query(
    `
    SELECT
      user_id,
      seconds,
      source,
      CASE
        WHEN stripe_event_id LIKE 'evt_%' THEN 'evt_'
        WHEN stripe_event_id LIKE 'cs:%' THEN 'cs:'
        WHEN stripe_event_id IS NULL OR btrim(stripe_event_id) = '' THEN 'none'
        ELSE 'other'
      END AS event_kind,
      (stripe_session_id IS NOT NULL AND btrim(stripe_session_id) <> '') AS has_session,
      created_at
    FROM voice_credits
    ORDER BY created_at
  `,
  ),
);
console.log("voice_credits", JSON.stringify(credits, null, 2));

for (const statement of statements) {
  const rows = asRows(await sql.query(statement));
  const label = statement.split("\n").find((line) => line.trim())?.slice(0, 80);
  console.log("\n---", label);
  console.log(JSON.stringify(rows, null, 2));
}

const token = signAdminSession();
if (!token) {
  console.log("\nbalance_fetch skipped: no session secret");
  process.exit(0);
}

const response = await fetch("https://www.talktolexi.app/api/billing/balance", {
  headers: {
    cookie: `lexi_session=${token}`,
    "cache-control": "no-store",
  },
});
const text = await response.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = { raw: text.slice(0, 400) };
}
const summary = {
  status: response.status,
  ok: body.ok,
  userId: body.userId,
  voiceSeconds: body.voiceSeconds,
  subscribed: body.subscribed,
  label: body.label,
};
console.log("\nGET /api/billing/balance", JSON.stringify(summary, null, 2));
