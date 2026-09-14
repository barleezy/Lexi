const AUDIO_TYPES = new Set([
  "response.output_audio.delta",
  "response.audio.delta",
  "input_audio_buffer.append",
]);

export type VoiceLogEntry = Record<string, unknown> & {
  t: number;
  ts: number;
  kind: string;
};

function cutString(value: string) {
  return value.length > 400 ? `${value.slice(0, 400)}…[${value.length} chars]` : value;
}

function decodedBytes(value: unknown) {
  if (typeof value !== "string") return 0;
  try {
    return atob(value).length;
  } catch {
    return value.length;
  }
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (typeof value === "string") return cutString(value);
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, depth + 1));
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (AUDIO_TYPES.has(type) && (key === "delta" || key === "audio")) {
      out.bytes = decodedBytes(item);
      continue;
    }
    out[key] = redact(item, depth + 1);
  }
  return out;
}

export function createVoiceLogger(sessionId: string, sink = "/api/voice/log") {
  const buffer: VoiceLogEntry[] = [];
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  function schedule() {
    if (timer || closed) return;
    timer = setTimeout(() => {
      timer = null;
      void flush(false);
    }, 1000);
  }

  function log(kind: string, data: Record<string, unknown> = {}) {
    if (closed) return;
    buffer.push({
      ...(redact(data) as Record<string, unknown>),
      t: Date.now() - started,
      ts: Date.now(),
      kind,
    });
    if (buffer.length >= 200) {
      void flush(false);
      return;
    }
    schedule();
  }

  async function flush(final = false) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (buffer.length === 0) return;
    const entries = buffer.splice(0, buffer.length);
    if (process.env.NODE_ENV !== "production") {
      for (const entry of entries) console.debug("[voice]", entry);
    }
    try {
      await fetch(sink, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "1",
        },
        body: JSON.stringify({ sessionId, entries }),
        keepalive: final,
      });
    } catch {
      // Logging must never throw into the voice path.
    }
  }

  return {
    log,
    server(event: Record<string, unknown>, extra: Record<string, unknown> = {}) {
      const type = typeof event.type === "string" ? event.type : "";
      if (AUDIO_TYPES.has(type)) return;
      log("server", { ...(redact(event) as Record<string, unknown>), ...extra });
    },
    client(event: Record<string, unknown>) {
      const type = typeof event.type === "string" ? event.type : "";
      if (AUDIO_TYPES.has(type)) return;
      log("client", redact(event) as Record<string, unknown>);
    },
    error(where: string, err: unknown, extra: Record<string, unknown> = {}) {
      const caught = err instanceof Error ? err : new Error(String(err));
      log("error", { where, name: caught.name, message: cutString(caught.message), ...extra });
    },
    flush,
    close() {
      closed = true;
      void flush(true);
    },
  };
}

export type VoiceLogger = ReturnType<typeof createVoiceLogger>;
