/** Capture and send rate. 48 kHz keeps high-frequency consonants. */
export const LISTEN_SAMPLE_RATE = 48_000;

/** Absolute floor: hush / room hiss is not user speech. Soft mumble sits above this. */
export const MIC_RMS_ABS_FLOOR = 0.008;
/** Frames below this multiple of the slow noise floor are treated as non-primary. */
export const MIC_RMS_NOISE_RATIO = 2.0;

/**
 * User-mic constraints only. Shared-tab soundtrack is mixed in Web Audio as a
 * separate source — never added to this mic MediaStream.
 *
 * Intelligibility over aggressive isolation: keep AEC so Fortnite/TV is not “Ian”,
 * but do not stack voiceIsolation + Chrome NS extras — those clip consonants when
 * game audio is playing. One light noiseSuppression layer + AGC for quiet speech.
 * 48 kHz ideal keeps high-frequency consonants. voiceIsolation is omitted on
 * purpose (fallback already had no isolation).
 */
export const MIC_AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: { ideal: LISTEN_SAMPLE_RATE },
  channelCount: 1,
  googEchoCancellation: true,
  googAutoGainControl: true,
} as MediaTrackConstraints;

export const MIC_AUDIO_CONSTRAINTS_FALLBACK: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: { ideal: LISTEN_SAMPLE_RATE },
  channelCount: 1,
};

/**
 * Car Bluetooth / HFP: same AEC+NS+AGC, try 48 kHz, then drop sampleRate.
 * HFP often only does 8/16 kHz — exact 48k OverconstrainedError is common.
 */
export const MIC_AUDIO_CONSTRAINTS_CAR = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: { ideal: LISTEN_SAMPLE_RATE },
  channelCount: 1,
  googEchoCancellation: true,
  googAutoGainControl: true,
} as MediaTrackConstraints;

export const MIC_AUDIO_CONSTRAINTS_CAR_FALLBACK: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};

export function micConstraintChain(
  deviceId?: string,
  car = false,
): Array<MediaTrackConstraints | boolean> {
  const withDevice = (base: MediaTrackConstraints): MediaTrackConstraints =>
    deviceId ? { ...base, deviceId: { ideal: deviceId } } : base;
  if (car) {
    return [
      withDevice(MIC_AUDIO_CONSTRAINTS_CAR),
      withDevice(MIC_AUDIO_CONSTRAINTS_CAR_FALLBACK),
      withDevice(MIC_AUDIO_CONSTRAINTS_FALLBACK),
      deviceId ? { deviceId: { ideal: deviceId } } : true,
    ];
  }
  return [
    withDevice(MIC_AUDIO_CONSTRAINTS),
    withDevice(MIC_AUDIO_CONSTRAINTS_FALLBACK),
    deviceId ? { deviceId: { ideal: deviceId } } : true,
  ];
}

export function isPrimaryMicEnergy(rms: number, noiseFloor: number) {
  return rms >= Math.max(MIC_RMS_ABS_FLOOR, noiseFloor * MIC_RMS_NOISE_RATIO);
}

/** Only documented xAI realtime transcribe model. Captions require this id. */
export const TRANSCRIBE_MODEL = "grok-transcribe";
/** Supported-languages table uses `en` (not a regional variant). */
export const TRANSCRIBE_LANGUAGE_HINT = "en";

/**
 * ASR bias for names and game talk the model otherwise mangles.
 * Max 100 terms × 50 chars. Do not add generic words (W, L) that steal other intent.
 */
export const TRANSCRIBE_KEYTERMS = [
  "Ian",
  "daddy",
  "barleezy",
  "menace",
  "barleezus",
  "leezy",
  "TTBarleezy",
  "TalkToLexi",
  "Lexi",
  "Fortnite",
  "Battle Royale",
  "zero build",
  "builds",
  "lobby",
  "squad",
  "rotate",
  "third party",
  "storm",
  "box fight",
  "piece control",
  "ranked",
  "pubs",
  "Epic",
] as const;

export function buildInputAudio(rate: number) {
  return {
    format: { type: "audio/pcm" as const, rate },
    transcription: {
      model: TRANSCRIBE_MODEL,
      language_hint: TRANSCRIBE_LANGUAGE_HINT,
      keyterms: [...TRANSCRIBE_KEYTERMS],
    },
  };
}

/** Typed composer / captions: trim only. Never case-fold, expand slang, or rewrite intent. */
export function sanitizeUserText(raw: string) {
  return raw.trim();
}

export function readUserTranscript(event: Record<string, unknown>) {
  const itemId = typeof event.item_id === "string" ? event.item_id : "";
  const transcript = sanitizeUserText(typeof event.transcript === "string" ? event.transcript : "");
  return { itemId, transcript };
}
