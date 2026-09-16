/**
 * Web-only mic routing. Cannot become a native CarPlay app — pick the
 * hands-free / HFP input when the OS exposes it, fall back to the phone mic.
 */

export const HANDS_FREE_INPUT_RE =
  /carplay|car\s*play|iphone hands-?free|bluetooth hfp|\bhfp\b|hands-?free|car bluetooth|car audio|\bvehicle\b/i;

export const PHONE_BUILTIN_INPUT_RE =
  /iphone microphone|ipad microphone|built-?in|internal microphone|macbook|imac microphone/i;

export const BLUETOOTH_INPUT_RE = /bluetooth|airpods|beats/i;

export const MIC_RECLAIM_RETRY_MS = 180;
export const MIC_RECLAIM_ATTEMPTS = 3;
export const MIC_MUTE_RECLAIM_MS = 400;
/** Car HFP mute/unmute is a route blip — do not sit 400ms before retrying. */
export const CAR_MIC_MUTE_RECLAIM_MS = 120;

export type AudioInputDevice = {
  deviceId: string;
  kind: string;
  label: string;
};

export function isCarLikeAudioInput(label: string) {
  return HANDS_FREE_INPUT_RE.test(label);
}

export function isPhoneBuiltinAudioInput(label: string) {
  return PHONE_BUILTIN_INPUT_RE.test(label);
}

export function scoreAudioInputLabel(label: string, kind = "audioinput") {
  if (kind !== "audioinput") return -1;
  const text = label.trim();
  if (!text) return 8;
  if (isCarLikeAudioInput(text)) return 100;
  if (PHONE_BUILTIN_INPUT_RE.test(text)) return 1;
  if (/airpods|beats/i.test(text)) return 40;
  if (/bluetooth/i.test(text)) return 60;
  return 10;
}

export function pickPreferredAudioInput(devices: AudioInputDevice[]) {
  const inputs = devices.filter((device) => device.kind === "audioinput" && device.deviceId);
  if (!inputs.length) return null;
  let best = inputs[0];
  let bestScore = scoreAudioInputLabel(best.label, best.kind);
  for (const device of inputs.slice(1)) {
    const score = scoreAudioInputLabel(device.label, device.kind);
    if (score > bestScore) {
      best = device;
      bestScore = score;
    }
  }
  return best;
}

export function micNeedsReroute(
  track: MediaStreamTrack | null | undefined,
  preferredDeviceId?: string | null,
) {
  if (!track) return Boolean(preferredDeviceId);
  const current = track.getSettings().deviceId;
  if (preferredDeviceId && current && preferredDeviceId !== current) return true;
  if (preferredDeviceId && !current && isPhoneBuiltinAudioInput(track.label)) return true;
  return false;
}

export async function listAudioInputs(): Promise<AudioInputDevice[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "audioinput")
      .map((device) => ({
        deviceId: device.deviceId,
        kind: device.kind,
        label: device.label ?? "",
      }));
  } catch {
    return [];
  }
}

export async function resolvePreferredAudioInput() {
  return pickPreferredAudioInput(await listAudioInputs());
}

export function muteReclaimDelayMs(carAudio: boolean) {
  return carAudio ? CAR_MIC_MUTE_RECLAIM_MS : MIC_MUTE_RECLAIM_MS;
}
