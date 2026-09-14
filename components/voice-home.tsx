"use client";

import { useEffect, useRef, useState } from "react";
import {
  VoiceSession,
  type TranscriptRow,
  type VoicePhase,
} from "@/lib/voice/session";

const HINTS: Record<VoicePhase, string> = {
  idle: "Tap to talk",
  connecting: "Connecting…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

function Waveform({ live, phase }: { live: boolean; phase: VoicePhase }) {
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
            transform: live ? undefined : "scaleY(0.4)",
            animation: live ? `lexi-wave ${tempo} ease-in-out ${index * 0.12}s infinite` : undefined,
          }}
        />
      ))}
    </span>
  );
}

export function VoiceHome() {
  const sessionRef = useRef<VoiceSession | null>(null);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<TranscriptRow[]>([]);

  useEffect(() => {
    return () => {
      sessionRef.current?.stop();
    };
  }, []);

  async function toggle() {
    if (sessionRef.current) {
      sessionRef.current.stop();
      sessionRef.current = null;
      setPhase("idle");
      setSessionId(null);
      return;
    }

    setError(null);
    setRows([]);
    const session = new VoiceSession({
      onPhase: setPhase,
      onTranscripts: setRows,
      onError: (message) => {
        setError(message);
        sessionRef.current = null;
        setPhase("idle");
      },
    });
    sessionRef.current = session;
    setSessionId(session.id);
    await session.start();
  }

  const live = phase !== "idle";
  const latest = [...rows].reverse().find((row) => row.text.trim());
  const status = live
    ? sessionId
      ? `${HINTS[phase]} · session ${sessionId}`
      : HINTS[phase]
    : HINTS.idle;

  return (
    <div className="flex flex-1 flex-col bg-background font-sans text-foreground">
      <style>{`
        @keyframes lexi-wave {
          0%, 100% { transform: scaleY(0.4); }
          50% { transform: scaleY(1); }
        }
      `}</style>
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <p className="text-sm font-medium uppercase tracking-[0.22em]">Lexi</p>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-28">
        <p className="mb-4 font-mono text-xs uppercase tracking-[0.28em] text-zinc-500">
          /ˈlek.si/
        </p>
        <h1 className="text-6xl font-semibold tracking-tight sm:text-7xl">Lexi</h1>
        <p
          className="mt-6 min-h-8 max-w-md text-center text-lg leading-8 text-zinc-600 dark:text-zinc-400"
          aria-live="polite"
        >
          {error ?? (latest && live ? latest.text : status)}
        </p>
        <p className="sr-only" role="status">
          {error ?? status}
        </p>
      </main>
      <div className="fixed inset-x-0 bottom-0 flex justify-center px-6 pb-10 pt-6">
        <button
          type="button"
          onClick={() => void toggle()}
          aria-pressed={live}
          aria-label={live ? "Stop talking" : "Start talking"}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
        >
          <Waveform live={live} phase={phase} />
        </button>
      </div>
    </div>
  );
}
