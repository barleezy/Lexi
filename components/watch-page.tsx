"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  captureVideoShot,
  directVideoHref,
  isPageLikeVideoUrl,
  isVideoFile,
  nextWatchPlaybackSrc,
  playableVideoSrc,
  titleFromVideoUrl,
  VIDEO_ACCEPT,
  WATCH_CAPTURE_INTERVAL_MS,
  WATCH_SEND_GAP_MS,
  type VideoSourceKind,
} from "@/lib/voice/video";
import {
  mpegtsMediaType,
  watchPlaybackKind,
  watchShouldRemuxOnNativeError,
  watchSizeError,
} from "@/lib/voice/watch-formats";
import {
  adultEmbedCanFrame,
  CLOUDFLARE_DIRECT_HINT,
  DIRECT_STREAM_HINT,
  extractAdultMediaFromHtml,
  isAdultPageUrl,
  isCloudflareChallenge,
  isDirectWatchMediaUrl,
  isWatchHlsUrl,
  normalizeAdultWatchInput,
  proxiedWatchMedia,
  shouldProxyWatchMedia,
} from "@/lib/voice/watch-adult";
import { iosLacksMsePlayback } from "@/lib/voice/watch-mpegts";
import {
  openWatchChannel,
  videoElementHasAudio,
  type WatchChannelMessage,
} from "@/lib/voice/watch-channel";

type WatchSource =
  | { kind: "file"; file: File; title: string }
  | { kind: "url"; raw: string; playable: string; title: string };

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

export function WatchPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const objectUrl = useRef<string | null>(null);
  const remuxUrl = useRef<string | null>(null);
  const mpegtsHandle = useRef<{ destroy: () => void } | null>(null);
  const hlsHandle = useRef<{ destroy: () => void } | null>(null);
  const sourceRef = useRef<WatchSource | null>(null);
  const copiedRemux = useRef(false);
  const remuxAttempted = useRef(false);
  const urlStage = useRef<"direct" | "proxy" | "blob" | null>(null);
  const loadGen = useRef(0);
  const stopCapture = useRef<(() => void) | null>(null);
  const meta = useRef<{ title: string; source: VideoSourceKind | null }>({
    title: "",
    source: null,
  });
  const [draft, setDraft] = useState("");
  const [nativeSrc, setNativeSrc] = useState<string | null>(null);
  const [mpegtsSrc, setMpegtsSrc] = useState<{ url: string; type: "flv" | "mpegts" } | null>(
    null,
  );
  const [hlsSrc, setHlsSrc] = useState<string | null>(null);
  const [embedSrc, setEmbedSrc] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasPlayer = Boolean(nativeSrc || mpegtsSrc || hlsSrc || embedSrc);

  function post(message: WatchChannelMessage) {
    try {
      channelRef.current?.postMessage(message);
    } catch {
      // BroadcastChannel can throw if the other tab closed mid-send.
    }
  }

  function startCapture() {
    stopCapture.current?.();
    const video = videoRef.current;
    if (!video || !meta.current.source || embedSrc) return;
    let lastSend = 0;
    const timer = setInterval(() => {
      if (video.paused || video.ended || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return;
      }
      const now = Date.now();
      if (now - lastSend < WATCH_SEND_GAP_MS) return;
      const shot = captureVideoShot(video);
      if (!shot) return;
      lastSend = now;
      post({
        type: "frame",
        dataUrl: shot.dataUrl,
        timeSec: shot.timeSec,
        title: meta.current.title,
        playing: !video.paused && !video.ended,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
      });
    }, WATCH_CAPTURE_INTERVAL_MS);
    stopCapture.current = () => {
      clearInterval(timer);
      stopCapture.current = null;
    };
  }

  function announceStart() {
    if (!meta.current.source) return;
    const video = videoRef.current;
    post({
      type: "start",
      title: meta.current.title,
      source: meta.current.source,
      hasAudio: video ? videoElementHasAudio(video) : true,
    });
  }

  function revokeLocals() {
    mpegtsHandle.current?.destroy();
    mpegtsHandle.current = null;
    hlsHandle.current?.destroy();
    hlsHandle.current = null;
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    }
    if (remuxUrl.current) {
      URL.revokeObjectURL(remuxUrl.current);
      remuxUrl.current = null;
    }
  }

  function clearVideo(notify = true) {
    loadGen.current += 1;
    stopCapture.current?.();
    revokeLocals();
    sourceRef.current = null;
    copiedRemux.current = false;
    remuxAttempted.current = false;
    urlStage.current = null;
    meta.current = { title: "", source: null };
    setNativeSrc(null);
    setMpegtsSrc(null);
    setHlsSrc(null);
    setEmbedSrc(null);
    setTitle("");
    setHint(null);
    setBusy(false);
    if (notify) post({ type: "stop" });
  }

  function showNative(next: string, nextTitle: string, source: VideoSourceKind) {
    setMpegtsSrc(null);
    setHlsSrc(null);
    setEmbedSrc(null);
    meta.current = { title: nextTitle, source };
    setNativeSrc(next);
    setTitle(nextTitle);
    setBusy(false);
    setHint("Tap play if it does not start. Keep the Lexi tab open.");
  }

  function showMpegts(url: string, type: "flv" | "mpegts", nextTitle: string, source: VideoSourceKind) {
    setNativeSrc(null);
    setHlsSrc(null);
    setEmbedSrc(null);
    meta.current = { title: nextTitle, source };
    setMpegtsSrc({ url, type });
    setTitle(nextTitle);
    setBusy(false);
    setHint("Tap play if it does not start. Keep the Lexi tab open.");
  }

  async function convertAndPlay(source: WatchSource, forceTranscode = false) {
    const gen = loadGen.current;
    remuxAttempted.current = true;
    setBusy(true);
    setHint(forceTranscode ? "Converting video…" : "Preparing video…");
    try {
      const { remuxWatchVideo, fetchWatchSource } = await import("@/lib/voice/watch-transcode");
      const input =
        source.kind === "file" ? source.file : await fetchWatchSource(source.raw, source.playable);
      if (gen !== loadGen.current) return;
      const name = source.kind === "file" ? source.file.name : source.raw;
      const result = await remuxWatchVideo(input, name, setHint, forceTranscode);
      if (gen !== loadGen.current) return;
      if (remuxUrl.current) URL.revokeObjectURL(remuxUrl.current);
      const url = URL.createObjectURL(result.blob);
      remuxUrl.current = url;
      copiedRemux.current = result.copied;
      showNative(url, source.title, source.kind === "file" ? "file" : "url");
    } catch (caught) {
      if (gen !== loadGen.current) return;
      setBusy(false);
      setHint(
        caught instanceof Error
          ? caught.message
          : "Could not convert that video. Try a smaller file or another format.",
      );
    }
  }

  function playIdentified(source: WatchSource, href: string) {
    const file = { name: source.kind === "file" ? source.file.name : source.raw, type: source.kind === "file" ? source.file.type : "" };
    const kind = watchPlaybackKind(file);
    const origin = source.kind === "file" ? "file" : "url";
    if (source.kind === "url" && isWatchHlsUrl(source.raw)) {
      showHls(href, source.title, origin);
      return;
    }
    if (kind === "mpegts" && !iosLacksMsePlayback()) {
      showMpegts(href, mpegtsMediaType(file), source.title, origin);
      return;
    }
    if (kind === "remux" || (kind === "mpegts" && iosLacksMsePlayback())) {
      void convertAndPlay(source);
      return;
    }
    showNative(href, source.title, origin);
  }

  function playResolvedMedia(raw: string, media: string, kind: string, nextTitle: string, pageUrl: string) {
    const playable = proxiedWatchMedia(media, pageUrl) || playableVideoSrc(media) || media;
    const source: WatchSource = { kind: "url", raw, playable, title: nextTitle };
    sourceRef.current = source;
    if (kind === "hls" || isWatchHlsUrl(media)) {
      urlStage.current = "proxy";
      showHls(playable, nextTitle, "url");
      return;
    }
    if (shouldProxyWatchMedia(media)) {
      urlStage.current = "proxy";
      playIdentified(source, playable);
      return;
    }
    urlStage.current = "direct";
    playIdentified(source, media);
  }

  function playDirectStream(raw: string) {
    const href = directVideoHref(raw);
    if (!href) return false;
    playResolvedMedia(raw, href, isWatchHlsUrl(href) ? "hls" : "mp4", titleFromVideoUrl(raw), raw);
    return true;
  }

  function showHls(url: string, nextTitle: string, source: VideoSourceKind) {
    setNativeSrc(null);
    setMpegtsSrc(null);
    setEmbedSrc(null);
    meta.current = { title: nextTitle, source };
    setHlsSrc(url);
    setTitle(nextTitle);
    setBusy(false);
    setHint("Tap play if it does not start. Keep the Lexi tab open.");
  }

  function showEmbed(url: string, nextTitle: string, blockedEyes: boolean) {
    setNativeSrc(null);
    setMpegtsSrc(null);
    setHlsSrc(null);
    meta.current = { title: nextTitle, source: "url" };
    setEmbedSrc(url);
    setTitle(nextTitle);
    setBusy(false);
    setHint(
      blockedEyes
        ? "Playing the site embed. Lexi cannot see these frames — upload a file or try another video."
        : "Tap play if it does not start. Keep the Lexi tab open.",
    );
  }

  async function tryBrowserExtract(pageUrl: string) {
    try {
      const response = await fetch(pageUrl, {
        mode: "cors",
        credentials: "omit",
        headers: { Accept: "text/html,application/xhtml+xml" },
      });
      if (!response.ok) return null;
      const html = (await response.text()).slice(0, 1_500_000);
      if (!html || isCloudflareChallenge(html)) return null;
      const extracted = extractAdultMediaFromHtml(html, response.url || pageUrl);
      if (!extracted.media) return null;
      return {
        title: extracted.title || titleFromVideoUrl(pageUrl),
        mediaUrl: extracted.media.href,
        kind: extracted.media.kind,
        pageUrl: response.url || pageUrl,
      };
    } catch {
      return null;
    }
  }

  async function loadAdultPage(raw: string) {
    const gen = loadGen.current + 1;
    loadGen.current = gen;
    stopCapture.current?.();
    revokeLocals();
    copiedRemux.current = false;
    remuxAttempted.current = false;
    urlStage.current = "direct";
    setBusy(true);
    setHint("Opening video page…");
    try {
      const response = await fetch(`/api/video/resolve?url=${encodeURIComponent(raw)}`);
      let body: {
        error?: string;
        title?: string;
        mediaUrl?: string;
        kind?: string;
        embedUrl?: string;
        pageUrl?: string;
      } = {};
      try {
        body = (await response.json()) as typeof body;
      } catch {
        body = {};
      }
      if (gen !== loadGen.current) return;
      const title = body.title || titleFromVideoUrl(raw);
      const media = typeof body.mediaUrl === "string" ? body.mediaUrl : "";
      const pageUrl = body.pageUrl || raw;
      if (response.ok && media) {
        playResolvedMedia(raw, media, body.kind || "mp4", title, pageUrl);
        return;
      }
      if (response.ok && body.embedUrl && adultEmbedCanFrame(body.embedUrl)) {
        sourceRef.current = { kind: "url", raw, playable: "", title };
        showEmbed(body.embedUrl, title, true);
        return;
      }
      setHint("Trying this browser…");
      const extracted = await tryBrowserExtract(raw);
      if (gen !== loadGen.current) return;
      if (extracted) {
        playResolvedMedia(raw, extracted.mediaUrl, extracted.kind, extracted.title, extracted.pageUrl);
        return;
      }
      if (body.embedUrl && adultEmbedCanFrame(body.embedUrl)) {
        sourceRef.current = { kind: "url", raw, playable: "", title };
        showEmbed(body.embedUrl, title, true);
        return;
      }
      setBusy(false);
      setHint(
        typeof body.error === "string" && body.error.trim()
          ? body.error
          : `${CLOUDFLARE_DIRECT_HINT}`,
      );
    } catch {
      if (gen !== loadGen.current) return;
      const extracted = await tryBrowserExtract(raw);
      if (gen !== loadGen.current) return;
      if (extracted) {
        playResolvedMedia(raw, extracted.mediaUrl, extracted.kind, extracted.title, extracted.pageUrl);
        return;
      }
      setBusy(false);
      setHint(CLOUDFLARE_DIRECT_HINT);
    }
  }

  function loadUrl(raw: string) {
    const trimmed = normalizeAdultWatchInput(raw);
    if (isPageLikeVideoUrl(trimmed)) {
      setHint("YouTube and similar pages will not play here. Upload a file or paste a direct video URL.");
      return;
    }
    if (isDirectWatchMediaUrl(trimmed) || (!isAdultPageUrl(trimmed) && directVideoHref(trimmed))) {
      loadGen.current += 1;
      stopCapture.current?.();
      revokeLocals();
      copiedRemux.current = false;
      remuxAttempted.current = false;
      if (!playDirectStream(trimmed)) {
        setHint(DIRECT_STREAM_HINT);
      }
      return;
    }
    if (isAdultPageUrl(trimmed)) {
      void loadAdultPage(trimmed);
      return;
    }
    setHint(DIRECT_STREAM_HINT);
  }

  async function playUrlBlob(source: Extract<WatchSource, { kind: "url" }>) {
    const gen = loadGen.current;
    urlStage.current = "blob";
    setBusy(true);
    setHint("Loading video…");
    try {
      const { resolveWatchMediaUrl } = await import("@/lib/voice/watch-transcode");
      const href = await resolveWatchMediaUrl(source.raw, source.playable);
      if (gen !== loadGen.current) {
        if (href.startsWith("blob:")) URL.revokeObjectURL(href);
        return;
      }
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = href;
      playIdentified({ ...source, playable: href }, href);
    } catch (caught) {
      if (gen !== loadGen.current) return;
      setBusy(false);
      setHint(
        caught instanceof Error
          ? caught.message
          : "Could not load that video. Upload the file instead.",
      );
    }
  }

  function loadFile(file: File) {
    if (!isVideoFile(file)) {
      setHint("Use a video file (mp4, webm, mov, mkv, avi, flv, wmv, mpeg, and similar).");
      return;
    }
    const tooBig = watchSizeError(file.size);
    if (tooBig) {
      setHint(tooBig);
      return;
    }
    loadGen.current += 1;
    stopCapture.current?.();
    revokeLocals();
    copiedRemux.current = false;
    remuxAttempted.current = false;
    urlStage.current = null;
    const url = URL.createObjectURL(file);
    objectUrl.current = url;
    const source: WatchSource = { kind: "file", file, title: file.name };
    sourceRef.current = source;
    playIdentified(source, url);
  }

  function onNativeError() {
    const mediaError = videoRef.current?.error;
    if (mediaError?.code === MediaError.MEDIA_ERR_ABORTED) return;
    const source = sourceRef.current;
    if (!source || busy || !nativeSrc) return;
    if (source.kind === "url") {
      const fallback = nextWatchPlaybackSrc(source.raw, nativeSrc);
      if (fallback && urlStage.current === "direct") {
        urlStage.current = "proxy";
        showNative(fallback, source.title, "url");
        return;
      }
      if (urlStage.current === "direct" || urlStage.current === "proxy") {
        void playUrlBlob(source);
        return;
      }
    }
    const identity = {
      name: source.kind === "file" ? source.file.name : source.raw,
      type: source.kind === "file" ? source.file.type : "",
    };
    if (copiedRemux.current) {
      copiedRemux.current = false;
      void convertAndPlay(source, true);
      return;
    }
    if (!remuxAttempted.current && watchShouldRemuxOnNativeError(identity)) {
      void convertAndPlay(source);
      return;
    }
    setHint(
      "Could not play that video. Paste a direct mp4, webm, or m3u8 URL, or upload a file. YouTube pages will not play here.",
    );
  }

  useEffect(() => {
    const channel = openWatchChannel((message) => {
      if (message.type === "ready") {
        setLinked(true);
        announceStart();
      }
    });
    channelRef.current = channel;
    channel?.postMessage({ type: "hello" });
    const raw = new URLSearchParams(window.location.search).get("url");
    if (raw) {
      setDraft(raw);
      loadUrl(raw);
    }
    return () => {
      loadGen.current += 1;
      stopCapture.current?.();
      revokeLocals();
      post({ type: "stop" });
      channel?.close();
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only channel + optional ?url=
  }, []);

  useEffect(() => {
    if (!hasPlayer || embedSrc) return;
    startCapture();
    announceStart();
    return () => {
      stopCapture.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recapture when the video src changes
  }, [nativeSrc, mpegtsSrc, hlsSrc, embedSrc]);

  useEffect(() => {
    if (!mpegtsSrc) return;
    const video = videoRef.current;
    if (!video) return;
    let dead = false;
    let handle: { destroy: () => void } | null = null;
    void import("@/lib/voice/watch-mpegts").then(({ attachMpegtsPlayer }) => {
      if (dead || !videoRef.current) return;
      return attachMpegtsPlayer(videoRef.current, mpegtsSrc.url, mpegtsSrc.type, () => {
        if (dead) return;
        const source = sourceRef.current;
        if (source) void convertAndPlay(source);
      }).then((next) => {
        if (dead) {
          next.destroy();
          return;
        }
        handle = next;
        mpegtsHandle.current = next;
      });
    });
    return () => {
      dead = true;
      handle?.destroy();
      if (mpegtsHandle.current === handle) mpegtsHandle.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- attach when the mpegts url changes
  }, [mpegtsSrc]);

  useEffect(() => {
    if (!hlsSrc) return;
    const video = videoRef.current;
    if (!video) return;
    let dead = false;
    let handle: { destroy: () => void } | null = null;
    void import("@/lib/voice/watch-hls").then(({ attachHlsPlayer }) => {
      if (dead || !videoRef.current) return;
      return attachHlsPlayer(videoRef.current, hlsSrc, () => {
        if (dead) return;
        setHint("Could not play that stream. Paste another direct m3u8/mp4 URL or upload the file.");
      }).then((next) => {
        if (dead) {
          next.destroy();
          return;
        }
        handle = next;
        hlsHandle.current = next;
      });
    });
    return () => {
      dead = true;
      handle?.destroy();
      if (hlsHandle.current === handle) hlsHandle.current = null;
    };
  }, [hlsSrc]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loadUrl(draft);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-black font-sans text-white">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <p className="text-sm font-medium uppercase tracking-[0.22em]">Watch</p>
        <a
          href="/"
          className="rounded-full px-3 py-1 text-xs text-zinc-400 hover:text-white"
        >
          Lexi tab
        </a>
      </header>
      <main className="flex flex-1 flex-col">
        {embedSrc ? (
          <iframe
            src={embedSrc}
            title={title ? `Watch together: ${title}` : "Watch together embed"}
            className="max-h-[min(70dvh,100vw)] w-full bg-black"
            style={{ aspectRatio: "16 / 9", border: 0 }}
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : hasPlayer ? (
          <video
            ref={videoRef}
            src={nativeSrc ?? undefined}
            controls
            playsInline
            preload="metadata"
            className="max-h-[min(70dvh,100vw)] w-full bg-black object-contain"
            aria-label={title ? `Watch together: ${title}` : "Watch together video"}
            onPlay={() => {
              announceStart();
              const video = videoRef.current;
              if (video) {
                post({
                  type: "audio-state",
                  hasAudio: videoElementHasAudio(video),
                });
              }
            }}
            onLoadedData={() => {
              const video = videoRef.current;
              if (!video) return;
              announceStart();
              const shot = captureVideoShot(video);
              if (shot) {
                post({
                  type: "frame",
                  dataUrl: shot.dataUrl,
                  timeSec: shot.timeSec,
                  title: meta.current.title,
                  playing: !video.paused && !video.ended,
                  duration: Number.isFinite(video.duration) ? video.duration : 0,
                });
              }
            }}
            onError={onNativeError}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <p className="text-lg font-medium">Play a video for Lexi</p>
            <p className="mt-2 max-w-sm text-sm text-zinc-400">
              Paste a direct file or stream URL (mp4, webm, m3u8, get_file) — it plays in this feed,
              not an embed. Upload a file, or a page URL if we can open it. Keep talktolexi.app open
              in the other tab. She sees stills; soundtrack stays here.
            </p>
          </div>
        )}
        <div className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] pt-4">
          <form
            className="mx-auto flex w-full max-w-xl items-center gap-2 rounded-full border border-zinc-600 bg-zinc-950 px-2 py-1.5"
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
                if (file) loadFile(file);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              aria-label="Upload a video"
              title="Upload a video"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white"
            >
              <FilmIcon />
            </button>
            <label className="sr-only" htmlFor="lexi-watch-url">
              Video URL
            </label>
            <input
              id="lexi-watch-url"
              type="text"
              inputMode="url"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="mp4, m3u8, get_file, or page URL"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent px-1 text-base text-white outline-none placeholder:text-zinc-500"
            />
            <button
              type="submit"
              className="flex h-10 shrink-0 items-center rounded-full px-3 text-sm text-zinc-300"
            >
              Load
            </button>
          </form>
          {hasPlayer ? (
            <div className="mx-auto mt-3 flex max-w-xl items-center justify-between gap-3 px-1">
              <p className="min-w-0 truncate text-xs text-zinc-400">
                {title || "Watch together"}
                {linked ? " · sending frames to Lexi" : " · open the Lexi tab"}
              </p>
              <button
                type="button"
                onClick={() => clearVideo(true)}
                className="shrink-0 text-xs text-zinc-400"
              >
                Close
              </button>
            </div>
          ) : null}
          {hint ? <p className="mx-auto mt-2 max-w-xl px-1 text-xs text-zinc-300">{hint}</p> : null}
        </div>
      </main>
    </div>
  );
}
