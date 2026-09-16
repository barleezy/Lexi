CREATE TABLE IF NOT EXISTS call_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  memory_key text NOT NULL,
  raw_text text NOT NULL,
  weighted_text text,
  start_salience double precision NOT NULL,
  salience double precision NOT NULL,
  band text NOT NULL CHECK (band IN ('low', 'medium', 'high')),
  rate double precision NOT NULL,
  t0 timestamptz NOT NULL,
  last_decay timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, memory_key)
);

CREATE INDEX IF NOT EXISTS call_memories_user_id_idx ON call_memories (user_id);
