export const MUSICKIT_SCRIPT = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";

type MusicKitInstance = {
  authorize: () => Promise<string>;
  unauthorize: () => Promise<void> | void;
  setQueue: (opts: { song?: string; songs?: string[] }) => Promise<unknown>;
  play: () => Promise<void>;
  stop: () => Promise<void> | void;
  pause?: () => Promise<void> | void;
  isAuthorized?: boolean;
};

type MusicKitGlobal = {
  configure: (opts: {
    developerToken: string;
    app: { name: string; build: string };
  }) => Promise<MusicKitInstance> | MusicKitInstance | void;
  getInstance: () => MusicKitInstance;
};

declare global {
  interface Window {
    MusicKit?: MusicKitGlobal;
  }
}

let configuredToken = "";

export async function loadMusicKitScript() {
  if (typeof window === "undefined") {
    throw new Error("MusicKit only runs in the browser.");
  }
  if (window.MusicKit) return;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${MUSICKIT_SCRIPT}"]`);
    if (existing) {
      if (window.MusicKit) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load MusicKit JS.")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.src = MUSICKIT_SCRIPT;
    script.async = true;
    script.dataset.token = "configured";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load MusicKit JS from Apple."));
    document.head.appendChild(script);
  });
}

export async function configureMusicKit(developerToken: string) {
  await loadMusicKitScript();
  const kit = window.MusicKit;
  if (!kit) throw new Error("MusicKit JS did not load.");
  if (configuredToken !== developerToken) {
    await kit.configure({
      developerToken,
      app: { name: "Lexi", build: "1" },
    });
    configuredToken = developerToken;
  }
  return kit.getInstance();
}

export async function authorizeAppleMusic(developerToken: string) {
  const music = await configureMusicKit(developerToken);
  const userToken = await music.authorize();
  if (!userToken || typeof userToken !== "string") {
    throw new Error("Apple Music sign-in was cancelled.");
  }
  return userToken;
}

export async function unauthorizeAppleMusic(developerToken: string) {
  try {
    const music = await configureMusicKit(developerToken);
    await music.unauthorize();
  } catch {
    // already signed out
  }
}

export async function playAppleMusicSong(developerToken: string, songId: string) {
  const music = await configureMusicKit(developerToken);
  if (!music.isAuthorized) {
    throw new Error("Connect Apple Music first — tap Connect Apple Music and sign in.");
  }
  await music.setQueue({ song: songId });
  await music.play();
}

export async function stopAppleMusicPlayback(developerToken: string) {
  try {
    const music = await configureMusicKit(developerToken);
    await music.stop();
  } catch {
    // nothing playing
  }
}
