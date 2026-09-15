type AppleMusicBarProps = {
  connected: boolean;
  playing: boolean;
  title: string;
  query: string;
  busy?: boolean;
  hint?: string | null;
  onQueryChange: (value: string) => void;
  onPlayPause: () => void;
  onNext: () => void;
};

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
      <path d="M7 5h3.5v14H7V5Zm6.5 0H17v14h-3.5V5Z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
      <path d="M6 5.5v13l8.5-6.5L6 5.5Zm10 0h2v13h-2V5.5Z" />
    </svg>
  );
}

export function AppleMusicBar({
  connected,
  playing,
  title,
  query,
  busy,
  hint,
  onQueryChange,
  onPlayPause,
  onNext,
}: AppleMusicBarProps) {
  if (!connected) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 rounded-full border border-zinc-400 bg-background px-2 py-1.5 dark:border-zinc-500">
        <label className="sr-only" htmlFor="lexi-apple-music-query">
          Play a song
        </label>
        <input
          id="lexi-apple-music-query"
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Play a song or paste an Apple Music link"
          autoComplete="off"
          className="min-h-8 min-w-0 flex-1 bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-zinc-500"
        />
        <button
          type="button"
          disabled={busy}
          aria-label={playing ? "Pause Apple Music" : "Play Apple Music"}
          title={playing ? "Pause" : "Play"}
          onClick={onPlayPause}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          type="button"
          disabled={busy}
          aria-label="Next song"
          title="Next"
          onClick={onNext}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
        >
          <NextIcon />
        </button>
      </div>
      {playing || title ? (
        <p className="px-1 text-[11px] text-zinc-500">
          {playing ? "Playing" : "Paused"}: {title || "Apple Music"}
        </p>
      ) : (
        <p className="px-1 text-[11px] text-zinc-500">
          Play starts from your tap. Empty play is our song.
        </p>
      )}
      {hint ? <p className="px-1 text-[11px] text-zinc-500">{hint}</p> : null}
    </div>
  );
}
