/**
 * Prefer the car / CarPlay / HFP microphone when that route is active.
 *
 * There is no CarPlay JavaScript API and no AVAudioSession.setPreferredInput
 * from this web app. Do not invent entitlements. The best path in Safari:
 * play-and-record (already applied), enumerate audioinputs, and pass
 * deviceId when iOS actually lists a car/HFP input.
 *
 * iOS Safari limits (not bugs in Lexi):
 * - enumerateDevices() often returns one audioinput; labels may be empty
 *   until after getUserMedia.
 * - Bluetooth / CarPlay / HFP inputs are frequently omitted. The OS may
 *   still route the default capture to HFP if play-and-record already won.
 * - deviceId { exact } often throws OverconstrainedError; { ideal } may
 *   be ignored. We try ideal, then exact, then the unconstrained default.
 * - getUserMedia while document.hidden fails (NotAllowedError). Hidden
 *   CarPlay must keep the live track (PR #4 / #5) and retry in foreground.
 *
 * 48 kHz + AEC/AGC/NS stay. facingMode is a camera constraint and is never
 * used for the user mic.
 */

export type AudioInputKind = "car" | "phone" | "earbuds" | "hfp" | "headset" | "wired" | "unknown";

export type AudioInputInfo = {
  deviceId: string;
  label: string;
  groupId?: string;
  kind: AudioInputKind;
};

export type CarMicPickReason =
  | "os-default"
  | "label-match"
  | "car-not-listed"
  | "overconstrained"
  | "hidden-cannot-switch"
  | "live-track-already-car"
  | "single-system-route";

export type CarMicRoute = {
  kind: AudioInputKind;
  label: string;
  deviceId?: string;
  preferCar: boolean;
  reason: CarMicPickReason;
  fallback?: string | null;
  constraint?: "ideal" | "exact" | "default";
  listed?: number;
};

export type MediaDeviceLike = {
  deviceId: string;
  kind: string;
  label?: string;
  groupId?: string;
};

const CARPLAY_RE = /carplay|car play|car-play|car audio|car mic|car microphone|\bvehicle\b/;
const EARBUD_RE = /airpods|beats|earbud|earphone/;
const PHONE_RE = /iphone microphone|ipad microphone|built-in|internal microphone|macbook|macintosh/;
const HFP_RE = /\bhfp\b|hands-?free|hands free/;
const HEADSET_RE = /bluetooth|headset/;
const WIRED_RE = /usb|lightning|wired/;

export function classifyAudioInputLabel(label: string): AudioInputKind {
  const n = label.toLowerCase().trim();
  if (!n) return "unknown";
  if (EARBUD_RE.test(n)) return "earbuds";
  if (CARPLAY_RE.test(n)) return "car";
  if (PHONE_RE.test(n)) return "phone";
  if (HFP_RE.test(n)) return "hfp";
  if (WIRED_RE.test(n)) return "wired";
  if (HEADSET_RE.test(n)) return "headset";
  return "unknown";
}

export function isExplicitCarplayLabel(label: string) {
  return CARPLAY_RE.test(label.toLowerCase());
}

export function carMicScore(info: AudioInputInfo, preferCar: boolean) {
  if (info.kind === "car") return isExplicitCarplayLabel(info.label) ? 100 : 90;
  if (info.kind === "hfp" && preferCar) return 70;
  if (info.kind === "wired" && preferCar) return 60;
  if (info.kind === "headset" && preferCar && HFP_RE.test(info.label.toLowerCase())) return 50;
  return 0;
}

export function readAudioInputs(devices: MediaDeviceLike[]): AudioInputInfo[] {
  return devices
    .filter((device) => device.kind === "audioinput")
    .map((device) => ({
      deviceId: device.deviceId,
      label: device.label ?? "",
      groupId: device.groupId,
      kind: classifyAudioInputLabel(device.label ?? ""),
    }));
}

export function listedHasCarInput(inputs: AudioInputInfo[], preferCar = true) {
  return inputs.some((input) => carMicScore(input, preferCar) > 0);
}

export function listedHasExplicitCarplay(inputs: AudioInputInfo[]) {
  return inputs.some((input) => isExplicitCarplayLabel(input.label));
}

/**
 * Seek the car HFP input when CarPlay / in-car heuristics say so.
 * Do not steal AirPods on a couch just because a generic BT headset exists.
 */
export function shouldPreferCarMic(opts: {
  ios?: boolean;
  voiceOnly?: boolean;
  carInputPresent?: boolean;
  explicitCarplayLabel?: boolean;
} = {}) {
  if (opts.explicitCarplayLabel) return true;
  if (opts.carInputPresent && opts.ios) return true;
  if (opts.carInputPresent && opts.voiceOnly) return true;
  // Hidden iOS ≈ CarPlay / lock screen even if Safari hid the HFP device.
  return Boolean(opts.voiceOnly && opts.ios);
}

export function pickPreferredAudioInput(
  inputs: AudioInputInfo[],
  opts: { preferCar?: boolean } = {},
) {
  const preferCar = Boolean(opts.preferCar);
  if (!preferCar) {
    return { chosen: null as AudioInputInfo | null, reason: "os-default" as CarMicPickReason, score: 0 };
  }
  let best: AudioInputInfo | null = null;
  let score = 0;
  for (const input of inputs) {
    if (!input.deviceId || input.deviceId === "default") continue;
    const next = carMicScore(input, true);
    if (next > score) {
      best = input;
      score = next;
    }
  }
  if (best) return { chosen: best, reason: "label-match" as CarMicPickReason, score };
  if (inputs.length === 1) {
    return { chosen: null, reason: "single-system-route" as CarMicPickReason, score: 0 };
  }
  return { chosen: null, reason: "car-not-listed" as CarMicPickReason, score: 0 };
}

export function shouldReplaceMicForCar(opts: {
  preferCar?: boolean;
  currentKind?: AudioInputKind;
  currentDeviceId?: string;
  carInput?: AudioInputInfo | null;
}) {
  if (!opts.preferCar || !opts.carInput) return false;
  if (opts.currentKind === "car") return false;
  if (opts.currentDeviceId && opts.currentDeviceId === opts.carInput.deviceId) return false;
  return true;
}

export function shouldDeferCarMicSwitch(opts: {
  pageHidden?: boolean;
  preferCar?: boolean;
  currentKind?: AudioInputKind;
  hasCarDevice?: boolean;
}) {
  if (!opts.pageHidden) return false;
  if (!opts.preferCar) return false;
  if (opts.currentKind === "car") return false;
  return Boolean(opts.hasCarDevice || opts.preferCar);
}

export function carMicFallbackMessage(
  reason: CarMicPickReason,
  opts: { ios?: boolean; currentKind?: AudioInputKind } = {},
) {
  switch (reason) {
    case "label-match":
    case "live-track-already-car":
    case "os-default":
      return null;
    case "hidden-cannot-switch":
      return "Car mic switch deferred — Safari cannot open a new mic while hidden. Retry when Lexi is in front.";
    case "overconstrained":
      return "Safari rejected the car deviceId. Using the default input.";
    case "single-system-route":
      if (opts.currentKind === "car" || opts.currentKind === "hfp") return null;
      return opts.ios
        ? "Phone mic (car input not listed — iOS Safari usually exposes one input, the system route)."
        : "Default mic (only one input is listed).";
    case "car-not-listed":
    default:
      if (opts.currentKind === "car" || opts.currentKind === "hfp") return null;
      return opts.ios
        ? "Phone/AirPods mic — CarPlay input is not listed in Safari (iOS web limit)."
        : "Default mic — no CarPlay/HFP input was listed.";
  }
}

export function carMicStatusLine(route: CarMicRoute) {
  if (route.kind === "car" || (route.kind === "hfp" && route.preferCar)) return "Car mic";
  if (route.fallback) return route.fallback;
  return null;
}

export function describeOpenedTrack(
  track: { label?: string; getSettings?: () => { deviceId?: string; groupId?: string } } | null | undefined,
  inputs: AudioInputInfo[] = [],
): AudioInputInfo {
  const settings = track?.getSettings?.() ?? {};
  const deviceId = settings.deviceId ?? "";
  const fromList = inputs.find((input) => input.deviceId && input.deviceId === deviceId);
  const label = track?.label || fromList?.label || "";
  return {
    deviceId: deviceId || fromList?.deviceId || "",
    label,
    groupId: settings.groupId || fromList?.groupId,
    kind: classifyAudioInputLabel(label),
  };
}

export function buildCarMicRoute(opts: {
  preferCar: boolean;
  current: AudioInputInfo;
  pickReason: CarMicPickReason;
  ios?: boolean;
  constraint?: CarMicRoute["constraint"];
  listed?: number;
  fallbackReason?: CarMicPickReason;
}): CarMicRoute {
  const reason = opts.fallbackReason ?? opts.pickReason;
  return {
    kind: opts.current.kind,
    label: opts.current.label,
    deviceId: opts.current.deviceId || undefined,
    preferCar: opts.preferCar,
    reason,
    constraint: opts.constraint,
    listed: opts.listed,
    fallback: opts.preferCar ? carMicFallbackMessage(reason, { ios: opts.ios, currentKind: opts.current.kind }) : null,
  };
}

export async function listMediaAudioInputs(): Promise<AudioInputInfo[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return readAudioInputs(devices);
  } catch {
    return [];
  }
}
