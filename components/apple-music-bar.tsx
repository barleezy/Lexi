type AppleMusicBarProps = {
  connected: boolean;
  playing: boolean;
  title: string;
  query: string;
  busy?: boolean;
  hint?: string | null;
  showOurSong?: boolean;
  onQueryChange: (value: string) => void;
  onPlayPause: () => void;
  onNext: () => void;
};

const musicControlClassName =
  "shrink-0 rounded-full px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800";

export function AppleMusicBar({
  connected,
  playing,
  title,
  query,
  busy,
  hint,
  showOurSong,
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
          placeholder="Play a song, playlist, or paste an Apple Music link"
          autoComplete="off"
          className="min-h-8 min-w-0 flex-1 bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-zinc-500"
        />
        <button
          type="button"
          disabled={busy}
          aria-label="Play Song"
          title="Play Song"
          onClick={onPlayPause}
          className={musicControlClassName}
        >
          Play Song
        </button>
        <button
          type="button"
          disabled={busy}
          aria-label="Skip"
          title="Skip"
          onClick={onNext}
          className={musicControlClassName}
        >
          Skip
        </button>
      </div>
      {playing || title ? (
        <p className="px-1 text-[11px] text-zinc-500">
          {playing ? "Playing" : "Paused"}: {title || "Apple Music"}
        </p>
      ) : (
        <p className="px-1 text-[11px] text-zinc-500">
          {showOurSong
            ? "Play starts from your tap. Empty play is our song."
            : "Play starts from your tap. Search a song or playlist first."}
        </p>
      )}
      {hint ? <p className="px-1 text-[11px] text-zinc-500">{hint}</p> : null}
    </div>
  );
}
