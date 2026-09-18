-- One-off: zero unearned accounts.voice_seconds.
-- Reviewable / idempotent: SELECT targets, then UPDATE the same predicate.
-- Touches accounts only. Re-run is a no-op once those rows are already 0.
--
-- Matching purchase record (real paid pack webhook, not leftover / reconcile):
--   voice_credits.seconds IN (600, 1800, 3600)   -- Whisper / Murmur / Echo
--   AND source = 'stripe'
--   AND stripe_event_id LIKE 'evt_%'             -- webhook only
-- Excludes leftover Lexi Pro 150 (9000s), cs: reconcile rows (150 or
-- phantom Echo 3600), source=test, and the Echo cap with no evt_ pack.
--
-- Ian / Barleezy share one wallet (lib/auth/accounts.ts, WALLET_USER_SQL).

-- PRE: every row still showing minutes
SELECT 'PRE voice_seconds > 0' AS label, COUNT(*)::int AS count
FROM accounts
WHERE voice_seconds > 0;

-- PRE: Ian / Barleezy / admin email
SELECT
  'PRE admin' AS label,
  user_id,
  voice_seconds,
  subscribed,
  paid,
  email
FROM accounts
WHERE lower(user_id) IN ('ian', 'barleezy')
   OR lower(email) = 'barlow80136@gmail.com'
ORDER BY user_id;

-- PRE: rows that will be zeroed
SELECT
  'PRE will zero' AS label,
  a.user_id,
  a.voice_seconds,
  a.subscribed,
  a.email
FROM accounts a
WHERE a.voice_seconds > 0
  AND NOT EXISTS (
    SELECT 1
    FROM voice_credits c
    WHERE (
      lower(c.user_id) = lower(a.user_id)
      OR (
        lower(a.user_id) IN ('ian', 'barleezy')
        AND lower(c.user_id) IN ('ian', 'barleezy')
      )
    )
      AND c.seconds IN (600, 1800, 3600)
      AND c.source = 'stripe'
      AND c.stripe_event_id LIKE 'evt_%'
  )
ORDER BY a.user_id;

SELECT 'PRE will zero count' AS label, COUNT(*)::int AS count
FROM accounts a
WHERE a.voice_seconds > 0
  AND NOT EXISTS (
    SELECT 1
    FROM voice_credits c
    WHERE (
      lower(c.user_id) = lower(a.user_id)
      OR (
        lower(a.user_id) IN ('ian', 'barleezy')
        AND lower(c.user_id) IN ('ian', 'barleezy')
      )
    )
      AND c.seconds IN (600, 1800, 3600)
      AND c.source = 'stripe'
      AND c.stripe_event_id LIKE 'evt_%'
  );

-- PRE: rows left alone because they have a real paid pack
SELECT
  'PRE kept (has paid pack)' AS label,
  a.user_id,
  a.voice_seconds,
  a.subscribed,
  a.email
FROM accounts a
WHERE a.voice_seconds > 0
  AND EXISTS (
    SELECT 1
    FROM voice_credits c
    WHERE (
      lower(c.user_id) = lower(a.user_id)
      OR (
        lower(a.user_id) IN ('ian', 'barleezy')
        AND lower(c.user_id) IN ('ian', 'barleezy')
      )
    )
      AND c.seconds IN (600, 1800, 3600)
      AND c.source = 'stripe'
      AND c.stripe_event_id LIKE 'evt_%'
  )
ORDER BY a.user_id;

-- UPDATE the same target set
UPDATE accounts AS a
SET voice_seconds = 0, updated_at = now()
WHERE a.voice_seconds > 0
  AND NOT EXISTS (
    SELECT 1
    FROM voice_credits c
    WHERE (
      lower(c.user_id) = lower(a.user_id)
      OR (
        lower(a.user_id) IN ('ian', 'barleezy')
        AND lower(c.user_id) IN ('ian', 'barleezy')
      )
    )
      AND c.seconds IN (600, 1800, 3600)
      AND c.source = 'stripe'
      AND c.stripe_event_id LIKE 'evt_%'
  )
RETURNING a.user_id, a.voice_seconds;

-- POST
SELECT 'POST voice_seconds > 0' AS label, COUNT(*)::int AS count
FROM accounts
WHERE voice_seconds > 0;

SELECT
  'POST admin' AS label,
  user_id,
  voice_seconds,
  subscribed,
  paid,
  email
FROM accounts
WHERE lower(user_id) IN ('ian', 'barleezy')
   OR lower(email) = 'barlow80136@gmail.com'
ORDER BY user_id;

SELECT 'POST still unearned > 0 (should be 0)' AS label, COUNT(*)::int AS count
FROM accounts a
WHERE a.voice_seconds > 0
  AND NOT EXISTS (
    SELECT 1
    FROM voice_credits c
    WHERE (
      lower(c.user_id) = lower(a.user_id)
      OR (
        lower(a.user_id) IN ('ian', 'barleezy')
        AND lower(c.user_id) IN ('ian', 'barleezy')
      )
    )
      AND c.seconds IN (600, 1800, 3600)
      AND c.source = 'stripe'
      AND c.stripe_event_id LIKE 'evt_%'
  );
