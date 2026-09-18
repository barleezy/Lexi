import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import Stripe from "stripe";

const PACKS = [
  { id: "whisper", label: "Whisper", seconds: 600, amountCents: 200, envPrice: "STRIPE_PRICE_PACK_10" },
  { id: "murmur", label: "Murmur", seconds: 1800, amountCents: 500, envPrice: "STRIPE_PRICE_PACK_30" },
  { id: "echo", label: "Echo", seconds: 3600, amountCents: 900, envPrice: "STRIPE_PRICE_PACK_60" },
];
const PACK_SECONDS = new Set(PACKS.map((pack) => pack.seconds));
const SUBSCRIPTION_SECONDS = 9000;
const ADMIN_EMAIL = "barlow80136@gmail.com";
const ADMIN_IDS = new Set(["ian", "barleezy"]);

function asRows(result) {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && Array.isArray(result.rows)) return result.rows;
  return [];
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
    // optional
  }
}

function envName(name) {
  return String(process.env[name] || "").trim();
}

function loadDatabaseUrl() {
  const url = envName("DATABASE_URL") || envName("NEON_DATABASE_URL");
  if (!url || url === "[SENSITIVE]" || url === "Hidden") return "";
  return url;
}

function packById(raw) {
  const id = String(raw || "")
    .trim()
    .toLowerCase();
  if (!id) return null;
  const legacy = { pack_10: "whisper", pack_30: "murmur", pack_60: "echo" };
  return PACKS.find((pack) => pack.id === (legacy[id] ?? id)) ?? null;
}

function packByPriceId(priceId) {
  const id = String(priceId || "").trim();
  if (!id) return null;
  return PACKS.find((pack) => envName(pack.envPrice) === id) ?? null;
}

function packByAmountCents(amountCents, currency) {
  if (String(currency || "usd").toLowerCase() !== "usd") return null;
  const matches = PACKS.filter((pack) => pack.amountCents === amountCents);
  return matches.length === 1 ? matches[0] : null;
}

function normalizeUserId(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  return ADMIN_IDS.has(trimmed.toLowerCase()) ? "Ian" : trimmed;
}

function walletKey(userId) {
  const id = normalizeUserId(userId);
  return ADMIN_IDS.has(id.toLowerCase()) ? "admin" : id.toLowerCase();
}

function isAdminWallet(userId) {
  return walletKey(userId) === "admin";
}

function isoFromUnix(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

function sessionUserId(session) {
  return (
    (typeof session.metadata?.user_id === "string" && session.metadata.user_id.trim()) ||
    (typeof session.metadata?.userId === "string" && session.metadata.userId.trim()) ||
    (typeof session.client_reference_id === "string" && session.client_reference_id.trim()) ||
    ""
  );
}

function sessionEmail(session) {
  return (
    (typeof session.customer_email === "string" && session.customer_email.trim()) ||
    (typeof session.customer_details?.email === "string" && session.customer_details.email.trim()) ||
    (typeof session.metadata?.email === "string" && session.metadata.email.trim()) ||
    ""
  );
}

function isSubscriptionCheckout(session, subscriptionPriceId) {
  if (session.mode === "subscription") return true;
  if (session.metadata?.plan === "monthly") return true;
  const priceId = session.metadata?.price_id || session.metadata?.priceId || "";
  return Boolean(subscriptionPriceId && priceId && priceId === subscriptionPriceId);
}

async function listAll(fetchPage) {
  const out = [];
  let startingAfter;
  for (let i = 0; i < 50; i += 1) {
    const page = await fetchPage(startingAfter);
    out.push(...(page.data || []));
    if (!page.has_more || !page.data?.length) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return out;
}

async function resolvePack(session, stripe, subscriptionPriceId) {
  if (isSubscriptionCheckout(session, subscriptionPriceId)) return { pack: null, subscription: true };
  const fromMeta = packById(session.metadata?.pack ?? session.metadata?.packId);
  if (fromMeta) return { pack: fromMeta, subscription: false };
  const fromPriceMeta = packByPriceId(session.metadata?.price_id ?? session.metadata?.priceId);
  if (fromPriceMeta) return { pack: fromPriceMeta, subscription: false };
  try {
    const full = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ["line_items.data.price", "payment_intent.latest_charge"],
    });
    const priceId = full.line_items?.data?.[0]?.price?.id;
    const fromLine = packByPriceId(priceId);
    if (fromLine) return { pack: fromLine, subscription: false, session: full };
    if (subscriptionPriceId && priceId === subscriptionPriceId) {
      return { pack: null, subscription: true, session: full };
    }
    const fromAmount = packByAmountCents(full.amount_total, full.currency);
    if (fromAmount) return { pack: fromAmount, subscription: false, session: full };
    return { pack: null, subscription: false, session: full };
  } catch {
    const fromAmount = packByAmountCents(session.amount_total, session.currency);
    return { pack: fromAmount, subscription: false };
  }
}

async function paymentIds(session, stripe) {
  let paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || "";
  let chargeId = "";
  const latest =
    typeof session.payment_intent === "object" && session.payment_intent
      ? session.payment_intent.latest_charge
      : null;
  if (typeof latest === "string") chargeId = latest;
  else if (latest && typeof latest === "object" && latest.id) chargeId = latest.id;
  let refunded = false;
  let amountCents = Number(session.amount_total) || 0;
  if (paymentIntentId && !chargeId) {
    try {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      const charge = intent.latest_charge;
      chargeId = typeof charge === "string" ? charge : charge?.id || "";
    } catch {
      // session id is enough
    }
  }
  if (chargeId) {
    try {
      const charge = await stripe.charges.retrieve(chargeId);
      refunded = charge.refunded === true || (charge.amount_refunded ?? 0) >= (charge.amount ?? 0);
      amountCents = Number(charge.amount) || amountCents;
    } catch {
      refunded = false;
    }
  }
  return { paymentIntentId, chargeId, refunded, amountCents };
}

function eventIdForPurchase(eventId, chargeId, sessionId) {
  if (eventId && String(eventId).startsWith("evt_")) return eventId;
  if (chargeId) return `backfill:${chargeId}`;
  return `backfill:cs:${sessionId}`;
}

function creditMatchesPurchase(row, purchase) {
  const eventId = String(row.stripe_event_id || "");
  const sessionId = String(row.stripe_session_id || "");
  if (purchase.sessionId && sessionId === purchase.sessionId) return true;
  if (purchase.sessionId && eventId === purchase.sessionId) return true;
  if (purchase.sessionId && eventId === `cs:${purchase.sessionId}`) return true;
  if (purchase.sessionId && eventId === `backfill:cs:${purchase.sessionId}`) return true;
  if (purchase.eventId && eventId === purchase.eventId) return true;
  if (purchase.chargeId && eventId.includes(purchase.chargeId)) return true;
  if (purchase.chargeId && sessionId.includes(purchase.chargeId)) return true;
  return false;
}

function uniqueEarnedPacks(rows) {
  const ordered = [...rows].sort((left, right) => {
    const leftEvt = String(left.stripe_event_id || "").startsWith("evt_") ? 0 : 1;
    const rightEvt = String(right.stripe_event_id || "").startsWith("evt_") ? 0 : 1;
    return leftEvt - rightEvt;
  });
  const seen = new Map();
  for (const row of ordered) {
    const seconds = Math.max(0, Math.floor(Number(row.seconds) || 0));
    if (!PACK_SECONDS.has(seconds)) continue;
    const eventId = String(row.stripe_event_id || "");
    if (!eventId.startsWith("evt_") && !eventId.startsWith("backfill:")) continue;
    const session = String(row.stripe_session_id || "").trim();
    let key = session ? `sid:${session}` : "";
    if (!key && eventId.startsWith("cs:")) key = `sid:${eventId.slice(3)}`;
    if (!key && eventId) key = `eid:${eventId}`;
    if (!key) key = `id:${row.id}`;
    if (!seen.has(key)) seen.set(key, { ...row, seconds });
  }
  return [...seen.values()];
}

async function computeRemaining(sql, userIds, firstPackFallbackIso) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return { packSeconds: 0, used: 0, held: 0, remaining: 0, firstPackAt: null };
  const credits = asRows(
    await sql.query(
      `
      SELECT id, user_id, seconds, source, stripe_event_id, stripe_session_id, created_at
      FROM voice_credits
      WHERE lower(user_id) = ANY($1::text[])
    `,
      [ids.map((id) => id.toLowerCase())],
    ),
  );
  const earned = uniqueEarnedPacks(credits);
  const packSeconds = earned.reduce((sum, row) => sum + row.seconds, 0);
  const firstFromRows = earned
    .map((row) => row.created_at)
    .filter(Boolean)
    .sort()[0];
  const firstPackAt = firstFromRows || firstPackFallbackIso || null;
  if (packSeconds <= 0) return { packSeconds: 0, used: 0, held: 0, remaining: 0, firstPackAt: null };

  const usedRows = asRows(
    await sql.query(
      firstPackAt
        ? `
        SELECT coalesce(sum(used_seconds), 0)::int AS used
        FROM voice_sessions
        WHERE lower(user_id) = ANY($1::text[])
          AND settled_at IS NOT NULL
          AND started_at >= $2::timestamptz
      `
        : `
        SELECT coalesce(sum(used_seconds), 0)::int AS used
        FROM voice_sessions
        WHERE lower(user_id) = ANY($1::text[])
          AND settled_at IS NOT NULL
      `,
      firstPackAt ? [ids.map((id) => id.toLowerCase()), firstPackAt] : [ids.map((id) => id.toLowerCase())],
    ),
  );
  const holdRows = asRows(
    await sql.query(
      `
      SELECT coalesce(sum(hold_seconds), 0)::int AS held
      FROM voice_sessions
      WHERE lower(user_id) = ANY($1::text[])
        AND settled_at IS NULL
    `,
      [ids.map((id) => id.toLowerCase())],
    ),
  );
  const used = Math.max(0, Math.floor(Number(usedRows[0]?.used) || 0));
  const held = Math.max(0, Math.floor(Number(holdRows[0]?.held) || 0));
  return {
    packSeconds,
    used,
    held,
    remaining: Math.max(0, packSeconds - used - held),
    firstPackAt,
  };
}

function signAdminSession() {
  const secret = envName("AUTH_SESSION_SECRET") || envName("IOS_SESSION_SECRET") || envName("XAI_API_KEY");
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

loadEnvFile(process.env.ENV_FILE || "");
loadEnvFile(new URL("../.env.local", import.meta.url));
loadEnvFile(new URL("../.env", import.meta.url));

const dryRun = process.env.DRY_RUN === "1";
const dbUrl = loadDatabaseUrl();
const stripeKey = envName("STRIPE_SECRET_KEY");
if (!dbUrl) {
  console.error("NO_DATABASE_URL");
  process.exit(1);
}
const stripeReady = Boolean(stripeKey && stripeKey !== "[SENSITIVE]" && stripeKey !== "Hidden");

const sql = neon(dbUrl);
const stripe = stripeReady ? new Stripe(stripeKey, { apiVersion: "2025-02-24.acacia" }) : null;
const subscriptionPriceId = envName("STRIPE_PRICE_SUBSCRIPTION");

console.log("dry_run", dryRun);
console.log(
  "stripe_mode",
  stripeReady
    ? stripeKey.startsWith("sk_live")
      ? "live"
      : stripeKey.startsWith("sk_test")
        ? "test"
        : "other"
    : "unavailable_using_xai_topups",
);
console.log(
  "pack_prices",
  PACKS.map((pack) => ({ id: pack.id, configured: Boolean(envName(pack.envPrice)) })),
);

const accounts = asRows(
  await sql.query(
    `
    SELECT user_id, email, voice_seconds, subscribed, paid, stripe_customer_id
    FROM accounts
    ORDER BY user_id
  `,
  ),
);
const creditsPre = asRows(
  await sql.query(
    `
    SELECT id, user_id, seconds, source, stripe_event_id, stripe_session_id, created_at
    FROM voice_credits
    ORDER BY created_at
  `,
  ),
);

const adminPre = accounts.filter(
  (row) => ADMIN_IDS.has(String(row.user_id || "").toLowerCase()) || String(row.email || "").toLowerCase() === ADMIN_EMAIL,
);
console.log("\n=== PRE accounts ===");
console.log("account_count", accounts.length);
console.log("voice_seconds_gt_0", accounts.filter((row) => Number(row.voice_seconds) > 0).length);
console.log("admin", JSON.stringify(adminPre, null, 2));
console.log("\n=== PRE voice_credits ===");
console.log(JSON.stringify(creditsPre, null, 2));

const byUserId = new Map();
const byEmail = new Map();
const byCustomer = new Map();
for (const row of accounts) {
  if (row.user_id) byUserId.set(String(row.user_id).toLowerCase(), row);
  const email = String(row.email || "").trim().toLowerCase();
  if (email) byEmail.set(email, row);
  const customer = String(row.stripe_customer_id || "").trim();
  if (customer) byCustomer.set(customer, row);
}

function matchAccount(purchase) {
  const owner = normalizeUserId(purchase.userId);
  if (owner && byUserId.has(owner.toLowerCase())) return byUserId.get(owner.toLowerCase());
  if (owner && ADMIN_IDS.has(owner.toLowerCase())) {
    return byUserId.get("ian") || byUserId.get("barleezy") || null;
  }
  const email = String(purchase.email || "").trim().toLowerCase();
  if (email && byEmail.has(email)) return byEmail.get(email);
  if (email === ADMIN_EMAIL) return byUserId.get("ian") || byUserId.get("barleezy") || null;
  const customer = String(purchase.customerId || "").trim();
  if (customer && byCustomer.has(customer)) return byCustomer.get(customer);
  return null;
}

function walletUserIds(account) {
  if (!account) return [];
  if (isAdminWallet(account.user_id) || String(account.email || "").toLowerCase() === ADMIN_EMAIL) {
    return [...new Set(accounts.filter((row) => isAdminWallet(row.user_id) || String(row.email || "").toLowerCase() === ADMIN_EMAIL).map((row) => row.user_id))];
  }
  return [account.user_id];
}

const eventBySession = new Map();
const purchases = [];
const skippedSubscription = [];
const skippedUnmatched = [];
const skippedNotPack = [];
const skippedRefunded = [];
let sessions = [];

if (stripe) {
try {
  const events = await listAll((startingAfter) =>
    stripe.events.list({
      type: "checkout.session.completed",
      limit: 100,
      starting_after: startingAfter,
    }),
  );
  for (const event of events) {
    const session = event.data?.object;
    if (session?.id && event.id) eventBySession.set(session.id, event.id);
  }
  console.log("\ncheckout.session.completed events listed", events.length, "(Stripe retains ~30 days)");
} catch (error) {
  console.warn("event_list_failed", error instanceof Error ? error.message : error);
}

sessions = await listAll((startingAfter) =>
  stripe.checkout.sessions.list({
    limit: 100,
    status: "complete",
    starting_after: startingAfter,
    expand: ["data.payment_intent"],
  }),
);
console.log("complete checkout sessions", sessions.length);
} else {
  console.log("\nStripe secret not available locally; using xai_credit_topups evt_/cs_/amount as the paid-pack source.");
}

for (const session of sessions) {
  const resolved = await resolvePack(session, stripe, subscriptionPriceId);
  const full = resolved.session || session;
  if (resolved.subscription) {
    skippedSubscription.push({
      sessionId: full.id,
      amountCents: full.amount_total,
      email: sessionEmail(full),
      created: isoFromUnix(full.created),
    });
    continue;
  }
  if (!resolved.pack) {
    skippedNotPack.push({
      sessionId: full.id,
      amountCents: full.amount_total,
      currency: full.currency,
      email: sessionEmail(full),
      userId: sessionUserId(full),
      created: isoFromUnix(full.created),
      mode: full.mode,
    });
    continue;
  }
  const paid = await paymentIds(full, stripe);
  if (full.payment_status && full.payment_status !== "paid") {
    skippedNotPack.push({
      sessionId: full.id,
      reason: `payment_status=${full.payment_status}`,
      pack: resolved.pack.id,
    });
    continue;
  }
  if (paid.refunded) {
    skippedRefunded.push({
      sessionId: full.id,
      chargeId: paid.chargeId,
      pack: resolved.pack.id,
      email: sessionEmail(full),
    });
    continue;
  }
  const purchase = {
    sessionId: full.id,
    chargeId: paid.chargeId || "",
    paymentIntentId: paid.paymentIntentId || "",
    eventId: eventBySession.get(full.id) || "",
    amountCents: paid.amountCents || Number(full.amount_total) || 0,
    currency: full.currency || "usd",
    pack: resolved.pack.id,
    label: resolved.pack.label,
    seconds: resolved.pack.seconds,
    userId: sessionUserId(full),
    email: sessionEmail(full),
    customerId: typeof full.customer === "string" ? full.customer : full.customer?.id || "",
    created: isoFromUnix(full.created),
    createdUnix: full.created || 0,
  };
  const account = matchAccount(purchase);
  if (!account) {
    skippedUnmatched.push(purchase);
    continue;
  }
  purchases.push({ ...purchase, accountId: account.user_id, accountEmail: account.email || "" });
}

try {
  const topups = asRows(
    await sql.query(
      `
      SELECT stripe_event_id, stripe_session_id, user_id, email, amount_cents, status, created_at
      FROM xai_credit_topups
      WHERE status = 'succeeded'
      ORDER BY created_at
    `,
    ),
  );
  console.log("xai_credit_topups succeeded", topups.length);
  for (const topup of topups) {
    const amountCents = Math.max(0, Math.floor(Number(topup.amount_cents) || 0));
    const sessionId = String(topup.stripe_session_id || "").trim();
    const eventId = String(topup.stripe_event_id || "").trim();
    const createdAt = topup.created_at ? new Date(topup.created_at).toISOString() : null;
    if (amountCents === 999 || (subscriptionPriceId && amountCents === 999)) {
      skippedSubscription.push({
        sessionId,
        eventId,
        amountCents,
        email: topup.email,
        created: createdAt,
        source: "xai_credit_topups",
      });
      continue;
    }
    const pack = packByAmountCents(amountCents, "usd");
    if (!pack) {
      skippedNotPack.push({
        sessionId,
        eventId,
        amountCents,
        email: topup.email,
        userId: topup.user_id,
        created: createdAt,
        source: "xai_credit_topups",
      });
      continue;
    }
    if (purchases.some((row) => row.sessionId && row.sessionId === sessionId)) {
      const existing = purchases.find((row) => row.sessionId === sessionId);
      if (existing && !existing.eventId && eventId.startsWith("evt_")) existing.eventId = eventId;
      continue;
    }
    const purchase = {
      sessionId,
      chargeId: "",
      paymentIntentId: "",
      eventId: eventId.startsWith("evt_") ? eventId : "",
      amountCents,
      currency: "usd",
      pack: pack.id,
      label: pack.label,
      seconds: pack.seconds,
      userId: topup.user_id || "",
      email: topup.email || "",
      customerId: "",
      created: createdAt,
      createdUnix: createdAt ? Math.floor(Date.parse(createdAt) / 1000) : 0,
      source: "xai_credit_topups",
    };
    const account = matchAccount(purchase);
    if (!account) {
      skippedUnmatched.push(purchase);
      continue;
    }
    purchases.push({ ...purchase, accountId: account.user_id, accountEmail: account.email || "" });
  }
} catch (error) {
  console.warn("xai_credit_topups_failed", error instanceof Error ? error.message : error);
}

purchases.sort((left, right) => (left.createdUnix || 0) - (right.createdUnix || 0));

console.log("\n=== Stripe pack purchases (matched to accounts) ===");
console.log(
  JSON.stringify(
    purchases.map((row) => ({
      sessionId: row.sessionId,
      chargeId: row.chargeId || null,
      paymentIntentId: row.paymentIntentId || null,
      eventId: row.eventId || null,
      amountCents: row.amountCents,
      pack: row.pack,
      seconds: row.seconds,
      userId: row.userId || row.accountId,
      email: row.email || row.accountEmail,
      customerId: row.customerId || null,
      created: row.created,
    })),
    null,
    2,
  ),
);
console.log("purchases_found", purchases.length);
console.log("skipped_subscription", skippedSubscription.length);
console.log("skipped_not_pack", skippedNotPack.length);
console.log("skipped_refunded", skippedRefunded.length);
console.log("skipped_unmatched", skippedUnmatched.length);
if (skippedUnmatched.length) console.log("unmatched", JSON.stringify(skippedUnmatched, null, 2));
if (skippedNotPack.length) console.log("not_pack", JSON.stringify(skippedNotPack, null, 2));
if (skippedRefunded.length) console.log("refunded", JSON.stringify(skippedRefunded, null, 2));

if (!purchases.length) {
  console.log("\nNo real pack charges found. Not inventing ledger rows.");
}

let inserted = 0;
let upgraded = 0;
let skippedPresent = 0;
const insertRows = [];
const upgradeRows = [];
const skipRows = [];

const knownCredits = [...creditsPre];
for (const purchase of purchases) {
  const existing = knownCredits.filter((row) => creditMatchesPurchase(row, purchase));
  const eventId = eventIdForPurchase(purchase.eventId, purchase.chargeId, purchase.sessionId);
  const createdAt = purchase.created;
  if (existing.length) {
    const row = existing[0];
    const event = String(row.stripe_event_id || "");
    const needsUpgrade =
      !event.startsWith("evt_") &&
      !event.startsWith("backfill:") &&
      (Boolean(purchase.chargeId) || Boolean(purchase.eventId) || Boolean(purchase.sessionId));
    if (needsUpgrade) {
      upgradeRows.push({
        id: row.id,
        from: event,
        to: eventId,
        sessionId: purchase.sessionId,
        chargeId: purchase.chargeId,
        createdAt,
      });
      if (!dryRun) {
        await sql.query(
          `
          UPDATE voice_credits
          SET
            stripe_event_id = $2,
            stripe_session_id = COALESCE(NULLIF(stripe_session_id, ''), $3),
            created_at = COALESCE($4::timestamptz, created_at)
          WHERE id = $1
        `,
          [row.id, eventId, purchase.sessionId, createdAt],
        );
      }
      row.stripe_event_id = eventId;
      row.stripe_session_id = row.stripe_session_id || purchase.sessionId;
      if (createdAt) row.created_at = createdAt;
      upgraded += 1;
    } else {
      skippedPresent += 1;
      skipRows.push({
        sessionId: purchase.sessionId,
        chargeId: purchase.chargeId,
        eventId: event,
        reason: "already_present",
      });
    }
    continue;
  }

  insertRows.push({
    userId: purchase.accountId,
    seconds: purchase.seconds,
    eventId,
    sessionId: purchase.sessionId,
    chargeId: purchase.chargeId,
    createdAt,
    pack: purchase.pack,
  });
  if (!dryRun) {
    try {
      await sql.query(
        `
        INSERT INTO voice_credits (user_id, seconds, source, stripe_event_id, stripe_session_id, created_at)
        VALUES ($1, $2, 'stripe', $3, $4, COALESCE($5::timestamptz, now()))
      `,
        [purchase.accountId, purchase.seconds, eventId, purchase.sessionId, createdAt],
      );
      knownCredits.push({
        user_id: purchase.accountId,
        seconds: purchase.seconds,
        source: "stripe",
        stripe_event_id: eventId,
        stripe_session_id: purchase.sessionId,
        created_at: createdAt,
      });
      inserted += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/unique|duplicate/i.test(message)) {
        skippedPresent += 1;
        skipRows.push({
          sessionId: purchase.sessionId,
          chargeId: purchase.chargeId,
          reason: "unique_conflict",
        });
      } else {
        throw error;
      }
    }
  } else {
    inserted += 1;
  }
}

console.log("\n=== Ledger writes ===");
console.log("inserted", inserted);
console.log("upgraded_cs_to_earned", upgraded);
console.log("skipped_already_present", skippedPresent);
if (insertRows.length) console.log("inserts", JSON.stringify(insertRows, null, 2));
if (upgradeRows.length) console.log("upgrades", JSON.stringify(upgradeRows, null, 2));
if (skipRows.length) console.log("skips", JSON.stringify(skipRows, null, 2));

const firstPackByWallet = new Map();
for (const purchase of purchases) {
  const key = walletKey(purchase.accountId);
  const current = firstPackByWallet.get(key);
  if (!current || (purchase.createdUnix || 0) < current.unix) {
    firstPackByWallet.set(key, { iso: purchase.created, unix: purchase.createdUnix || 0 });
  }
}

const seenWallets = new Set();
const recomputes = [];
for (const account of accounts) {
  const key = walletKey(account.user_id);
  if (seenWallets.has(key)) continue;
  seenWallets.add(key);
  const ids = walletUserIds(account);
  const before = ids
    .map((id) => accounts.find((row) => row.user_id === id)?.voice_seconds)
    .map((value) => Math.max(0, Math.floor(Number(value) || 0)));
  const computed = await computeRemaining(sql, ids, firstPackByWallet.get(key)?.iso || null);
  if (!dryRun) {
    await sql.query(
      `
      UPDATE accounts
      SET voice_seconds = $1, updated_at = now()
      WHERE lower(user_id) = ANY($2::text[])
    `,
      [computed.remaining, ids.map((id) => String(id).toLowerCase())],
    );
  }
  recomputes.push({
    wallet: key,
    userIds: ids,
    voiceSecondsBefore: before,
    ...computed,
  });
}

console.log("\n=== Recompute voice_seconds ===");
console.log(
  "formula",
  "max(0, unique earned pack seconds (evt_ or backfill:) − sum(voice_sessions.used_seconds where settled and started_at >= first pack) − sum(open hold_seconds))",
);
console.log(JSON.stringify(recomputes, null, 2));

const accountsPost = asRows(
  await sql.query(
    `
    SELECT user_id, email, voice_seconds, subscribed, paid
    FROM accounts
    ORDER BY user_id
  `,
  ),
);
const creditsPost = asRows(
  await sql.query(
    `
    SELECT id, user_id, seconds, source, stripe_event_id, stripe_session_id, created_at
    FROM voice_credits
    ORDER BY created_at
  `,
  ),
);
const adminPost = accountsPost.filter(
  (row) => ADMIN_IDS.has(String(row.user_id || "").toLowerCase()) || String(row.email || "").toLowerCase() === ADMIN_EMAIL,
);

console.log("\n=== POST admin ===");
console.log(JSON.stringify(adminPost, null, 2));
console.log("POST voice_seconds > 0", accountsPost.filter((row) => Number(row.voice_seconds) > 0).length);
console.log("POST voice_credits", creditsPost.length);
console.log(
  "POST earned_pack_credits",
  creditsPost.filter((row) => {
    const event = String(row.stripe_event_id || "");
    return PACK_SECONDS.has(Math.max(0, Math.floor(Number(row.seconds) || 0))) && (event.startsWith("evt_") || event.startsWith("backfill:"));
  }).length,
);

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
console.log(
  "\nGET /api/billing/balance",
  JSON.stringify(
    {
      status: response.status,
      ok: body.ok,
      userId: body.userId,
      voiceSeconds: body.voiceSeconds,
      subscribed: body.subscribed,
      label: body.label,
    },
    null,
    2,
  ),
);
