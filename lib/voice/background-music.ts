import { isBlockedVideoHost } from "@/lib/voice/video-proxy";

const AUDIO_EXT = ["mp3", "m4a", "aac", "ogg", "oga", "wav", "flac", "opus", "weba"] as const;

export function parseAudioSourceUrl(raw: string | null | undefined):
  | { ok: true; href: string }
  | { ok: false; error: string } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, error: "Missing audio URL." };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Invalid audio URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only http and https audio URLs are allowed." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "Audio URLs with credentials are not allowed." };
  }
  if (isBlockedVideoHost(parsed.hostname)) {
    return { ok: false, error: "That audio host is not allowed." };
  }
  return { ok: true, href: parsed.href };
}

export function looksLikeAudioUrl(href: string) {
  const path = (href.split("#")[0] ?? href).split("?")[0] ?? href;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return (AUDIO_EXT as readonly string[]).includes(ext);
}

export class BackgroundAudioPlayer {
  private el: HTMLAudioElement | null = null;
  private onState: ((playing: boolean, title: string) => void) | null = null;
  private title = "";

  setListener(listener: ((playing: boolean, title: string) => void) | null) {
    this.onState = listener;
  }

  get playing() {
    return Boolean(this.el && !this.el.paused);
  }

  get currentTitle() {
    return this.title;
  }

  async playUrl(href: string, title = "") {
    const parsed = parseAudioSourceUrl(href);
    if (!parsed.ok) throw new Error(parsed.error);
    this.stop();
    const audio = new Audio();
    audio.preload = "auto";
    audio.src = parsed.href;
    this.title = title.trim() || titleFromAudioUrl(parsed.href);
    audio.addEventListener("ended", () => this.stop(), { once: true });
    audio.addEventListener("error", () => {
      this.stop();
    });
    this.el = audio;
    await audio.play();
    this.onState?.(true, this.title);
  }

  stop() {
    const audio = this.el;
    this.el = null;
    this.title = "";
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    this.onState?.(false, "");
  }
}

export function titleFromAudioUrl(href: string) {
  try {
    const name = decodeURIComponent(new URL(href).pathname.split("/").pop() || "");
    return name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim() || "Audio";
  } catch {
    return "Audio";
  }
}
