"use client";

import { FormEvent, RefObject } from "react";
import { VIDEO_ACCEPT } from "@/lib/voice/video";

function FilmIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M8 5v14M16 5v14M3 9h5M3 15h5M16 9h5M16 15h5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

type WatchFeedBarProps = {
  draft: string;
  onDraft: (value: string) => void;
  onSubmitUrl: (raw: string) => void;
  onPickFile: (file: File) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  hint?: string | null;
  title?: string;
  linked?: boolean;
  hasPlayer?: boolean;
  onClose?: () => void;
  tone?: "dark" | "light";
};

export function WatchFeedBar({
  draft,
  onDraft,
  onSubmitUrl,
  onPickFile,
  fileInputRef,
  hint,
  title,
  linked,
  hasPlayer,
  onClose,
  tone = "dark",
}: WatchFeedBarProps) {
  const dark = tone === "dark";
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmitUrl(draft);
  }

  return (
    <div
      data-watch-feed-bar
      className="mx-auto flex w-full max-w-xl flex-col gap-2"
      aria-label="Video feed"
    >
      <form
        className={`flex items-center gap-2 rounded-full border px-2 py-1.5 ${
          dark
            ? "border-zinc-600 bg-zinc-950"
            : "border-zinc-400 bg-background dark:border-zinc-500"
        }`}
        onSubmit={onSubmit}
      >
        <input
          ref={fileInputRef}
          id="lexi-watch-file"
          type="file"
          accept={VIDEO_ACCEPT}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onPickFile(file);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          aria-label="Upload a video"
          title="Upload a video"
          onClick={() => fileInputRef.current?.click()}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
            dark ? "text-white" : "text-foreground"
          }`}
        >
          <FilmIcon />
        </button>
        <label className="sr-only" htmlFor="lexi-watch-url">
          Paste video URL
        </label>
        <input
          id="lexi-watch-url"
          type="text"
          inputMode="url"
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          placeholder="Paste video URL"
          autoComplete="off"
          className={`min-w-0 flex-1 bg-transparent px-1 text-base outline-none ${
            dark ? "text-white placeholder:text-zinc-500" : "text-foreground placeholder:text-zinc-500"
          }`}
        />
        <button
          type="submit"
          className={`flex h-10 shrink-0 items-center rounded-full px-3 text-sm ${
            dark ? "text-zinc-300" : "text-zinc-600 dark:text-zinc-300"
          }`}
        >
          Load
        </button>
      </form>
      {hasPlayer ? (
        <div className="flex items-center justify-between gap-3 px-1">
          <p className={`min-w-0 truncate text-xs ${dark ? "text-zinc-400" : "text-zinc-500"}`}>
            {title || "Watch together"}
            {linked ? " · sending frames to Lexi" : ""}
          </p>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className={`shrink-0 text-xs ${dark ? "text-zinc-400" : "text-zinc-500"}`}
            >
              Close
            </button>
          ) : null}
        </div>
      ) : null}
      {hint ? (
        <p className={`px-1 text-xs ${dark ? "text-zinc-300" : "text-zinc-500"}`}>{hint}</p>
      ) : null}
    </div>
  );
}
