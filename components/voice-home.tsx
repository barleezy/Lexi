"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  VoiceSession,
  type TranscriptRow,
  type VoicePhase,
} from "@/lib/voice/session";

const HINTS: Record<VoicePhase, string> = {
  idle: "Talk to Lexi",
  connecting: "Connecting…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

function StrokedWaveformIcon() {
  return (
    <svg
      viewBox="0 0 256 256"
      className="h-4 w-4"
      fill="none"
      aria-hidden
    >
      <path
        d="M48 96v64M88 32v192M128 64v128M168 96v64M208 80v96"
        stroke="currentColor"
        strokeWidth="24"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SendArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LiveWaveform({ phase }: { phase: VoicePhase }) {
  const tempo =
    phase === "speaking" ? "0.28s" : phase === "listening" ? "0.9s" : "1.4s";
  const dimmed = phase === "connecting" || phase === "thinking";

  return (
    <span
      className="inline-flex h-4 items-end gap-0.5"
      style={{ opacity: dimmed ? 0.8 : 1 }}
      aria-hidden
    >
      {[0, 1, 2, 3].map((index) => (
        <span
          key={index}
          className="w-[3px] origin-bottom rounded-full bg-current motion-reduce:animate-none"
          style={{
            height: 16,
            animation: `lexi-wave ${tempo} ease-in-out ${index * 0.12}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

function ComposerButton({
  live,
  hasText,
  phase,
}: {
  live: boolean;
  hasText: boolean;
  phase: VoicePhase;
}) {
  if (hasText) return <SendArrowIcon />;
  if (live) return <LiveWaveform phase={phase} />;
  return <StrokedWaveformIcon />;
}

export function VoiceHome() {
  const sessionRef = useRef<VoiceSession | null>(null);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<TranscriptRow[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    return () => {
      sessionRef.current?.stop();
    };
  }, []);

  function attach(session: VoiceSession) {
    sessionRef.current = session;
    setSessionId(session.id);
    setError(null);
  }

  function clearSession() {
    sessionRef.current = null;
    setPhase("idle");
    setSessionId(null);
  }

  async function startSession() {
    const session = new VoiceSession({
      onPhase: setPhase,
      onTranscripts: setRows,
      onError: (message) => {
        setError(message);
        clearSession();
      },
    });
    attach(session);
    await session.start();
    return session;
  }

  async function stopSession() {
    sessionRef.current?.stop();
    clearSession();
  }

  async function onComposerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();

    if (text) {
      setDraft("");
      setError(null);
      let session = sessionRef.current;
      if (!session) {
        setRows([]);
        session = await startSession();
      }
      session.sendText(text);
      return;
    }

    if (sessionRef.current) {
      await stopSession();
      return;
    }

    setRows([]);
    await startSession();
  }

  const live = phase !== "idle";
  const hasText = draft.trim().length > 0;
  const latest = [...rows].reverse().find((row) => row.text.trim());
  const placeholder = live ? HINTS[phase] : HINTS.idle;
  const status = error
    ? error
    : live
      ? sessionId
        ? `${HINTS[phase]} · session ${sessionId}`
        : HINTS[phase]
      : HINTS.idle;
  const buttonLabel = hasText
    ? live
      ? "Send to Lexi"
      : "Send and start talking"
    : live
      ? "Stop talking"
      : "Start talking";

  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-background font-sans text-foreground">
      <style>{`
        @keyframes lexi-wave {
          0%, 100% { transform: scaleY(0.4); }
          50% { transform: scaleY(1); }
        }
      `}</style>
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <p className="text-sm font-medium uppercase tracking-[0.22em]">Lexi</p>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-6">
        <p className="mb-4 font-mono text-xs uppercase tracking-[0.28em] text-zinc-500">
          /ˈlek.si/
        </p>
        <h1 className="text-6xl font-semibold tracking-tight sm:text-7xl">Lexi</h1>
        <p className="mt-6 min-h-8 max-w-md text-center text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          {error ?? (latest ? latest.text : "A voice-first companion.")}
        </p>
      </main>
      <div className="w-full px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] sm:px-6">
        <form
          onSubmit={(event) => void onComposerSubmit(event)}
          className="mx-auto flex min-h-14 w-full max-w-xl items-center gap-2 rounded-full border border-zinc-400 bg-background px-4 py-2 shadow-md dark:border-zinc-500"
        >
          <label className="sr-only" htmlFor="lexi-composer">
            Message Lexi
          </label>
          <input
            id="lexi-composer"
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            className="min-h-11 min-w-0 flex-1 bg-transparent px-2 text-base text-foreground outline-none placeholder:text-zinc-600 dark:placeholder:text-zinc-300"
          />
          <p className="sr-only" role="status">
            {status}
          </p>
          <button
            type="submit"
            aria-pressed={live && !hasText}
            aria-label={buttonLabel}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <ComposerButton live={live} hasText={hasText} phase={phase} />
          </button>
        </form>
      </div>
    </div>
  );
}
