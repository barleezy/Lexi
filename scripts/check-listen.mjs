import { readFileSync } from "node:fs";
import {
  LISTEN_SAMPLE_RATE,
  MIC_AUDIO_CONSTRAINTS,
  MIC_AUDIO_CONSTRAINTS_CAR,
  MIC_AUDIO_CONSTRAINTS_CAR_FALLBACK,
  MIC_AUDIO_CONSTRAINTS_FALLBACK,
  micConstraintChain,
  MIC_RMS_ABS_FLOOR,
  MIC_RMS_NOISE_RATIO,
  TRANSCRIBE_KEYTERMS,
  TRANSCRIBE_LANGUAGE_HINT,
  TRANSCRIBE_MODEL,
  buildInputAudio,
  isPrimaryMicEnergy,
  readUserTranscript,
  sanitizeUserText,
} from "../lib/voice/listen.ts";
import {
  CAR_VAD_SILENCE_DURATION_MS,
  VAD_PREFIX_PADDING_MS,
  VAD_SILENCE_DURATION_MS,
  VAD_THRESHOLD,
  VAD_TYPE,
  buildTurnDetection,
} from "../lib/voice/realtime-latency.ts";

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

function expectEqual(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label}: ${left} !== ${right}`);
}

expect(LISTEN_SAMPLE_RATE === 48_000, "capture/send at 48k for consonants");
expect(MIC_AUDIO_CONSTRAINTS.echoCancellation === true, "keep AEC so game/TV is not Ian");
expect(MIC_AUDIO_CONSTRAINTS.autoGainControl === true, "AGC for quiet speech");
expect(MIC_AUDIO_CONSTRAINTS.noiseSuppression === true, "one light NS layer");
expect(MIC_AUDIO_CONSTRAINTS.sampleRate.ideal === LISTEN_SAMPLE_RATE, "ideal 48k");
expect(!("voiceIsolation" in MIC_AUDIO_CONSTRAINTS), "no voiceIsolation — clips consonants with Fortnite");
expect(!("googNoiseSuppression" in MIC_AUDIO_CONSTRAINTS), "no stacked Chrome NS");
expect(!("googNoiseReduction" in MIC_AUDIO_CONSTRAINTS), "no extra Chrome noise reduction");
expect(!("googHighpassFilter" in MIC_AUDIO_CONSTRAINTS), "no highpass that eats consonants");
expect(MIC_AUDIO_CONSTRAINTS_FALLBACK.echoCancellation === true, "fallback keeps AEC");
expect(!("voiceIsolation" in MIC_AUDIO_CONSTRAINTS_FALLBACK), "fallback has no isolation");

expect(MIC_RMS_ABS_FLOOR === 0.008, "soft mumble above hush floor");
expect(MIC_RMS_NOISE_RATIO === 2.0, "energy gate lets quiet speech through");
expect(MIC_RMS_ABS_FLOOR < 0.012, "floor is below the old clip-mumble value");
expect(isPrimaryMicEnergy(0.009, 0.004) === true, "quiet speech still primary");
expect(isPrimaryMicEnergy(0.006, 0.004) === false, "hush still gated");
expect(isPrimaryMicEnergy(0.02, 0.01) === true, "normal speech primary");

expect(VAD_TYPE === "server_vad", "server VAD");
expect(VAD_THRESHOLD === 0.4, "0.4 catches quiet speech");
expect(VAD_THRESHOLD < 0.5, "below default so mumble commits");
expect(MIC_AUDIO_CONSTRAINTS_CAR.echoCancellation === true, "car AEC");
expect(MIC_AUDIO_CONSTRAINTS_CAR.noiseSuppression === true, "car NS");
expect(MIC_AUDIO_CONSTRAINTS_CAR.autoGainControl === true, "car AGC");
expect(MIC_AUDIO_CONSTRAINTS_CAR.sampleRate.ideal === LISTEN_SAMPLE_RATE, "car tries 48k");
expect(!("sampleRate" in MIC_AUDIO_CONSTRAINTS_CAR_FALLBACK), "car fallback drops sampleRate for HFP");
expect(!("voiceIsolation" in MIC_AUDIO_CONSTRAINTS_CAR), "car has no voiceIsolation");
const carChain = micConstraintChain("car-hfp", true);
expect(carChain[0].deviceId.ideal === "car-hfp", "car chain binds deviceId");
expect(carChain[carChain.length - 1] === true || carChain[carChain.length - 1].deviceId, "car chain ends loose");

expect(VAD_SILENCE_DURATION_MS === 300, "300ms end-of-speech — do not steal the turn");
expect(CAR_VAD_SILENCE_DURATION_MS === 300, "car does not add extra VAD silence");
expect(VAD_PREFIX_PADDING_MS >= 300, "prefix keeps first consonants");
expect(VAD_PREFIX_PADDING_MS === 350, "350ms prefix for mumbled onsets");
const vad = buildTurnDetection();
expectEqual(
  vad,
  {
    type: "server_vad",
    threshold: 0.4,
    silence_duration_ms: 300,
    prefix_padding_ms: 350,
  },
  "turn detection payload",
);

expect(TRANSCRIBE_MODEL === "grok-transcribe", "only documented transcribe model");
expect(TRANSCRIBE_LANGUAGE_HINT === "en", "language hint en");
expect(TRANSCRIBE_KEYTERMS.length > 0, "keyterms present");
expect(TRANSCRIBE_KEYTERMS.length <= 100, "keyterms cap 100");
expect(
  TRANSCRIBE_KEYTERMS.every((term) => term.length > 0 && term.length <= 50),
  "each keyterm <= 50 chars",
);
expect(TRANSCRIBE_KEYTERMS.includes("barleezy"), "nickname keyterm");
expect(TRANSCRIBE_KEYTERMS.includes("Fortnite"), "game keyterm");

const audio = buildInputAudio(LISTEN_SAMPLE_RATE);
expectEqual(audio.format, { type: "audio/pcm", rate: 48_000 }, "pcm 48k input");
expectEqual(
  audio.transcription,
  {
    model: "grok-transcribe",
    language_hint: "en",
    keyterms: [...TRANSCRIBE_KEYTERMS],
  },
  "transcription fields",
);
expect(!("noise_reduction" in audio), "xAI has no input noise_reduction field");

expectEqual(sanitizeUserText("  gonna drop 90s  "), "gonna drop 90s", "trim only");
expectEqual(sanitizeUserText("IAN"), "IAN", "do not case-fold");
expectEqual(sanitizeUserText("barleezy"), "barleezy", "do not rewrite slang");
expectEqual(sanitizeUserText("yo    what"), "yo    what", "do not collapse meaning spaces");

expectEqual(
  readUserTranscript({ item_id: "u1", transcript: "  leezy rotate  " }),
  { itemId: "u1", transcript: "leezy rotate" },
  "captions trim only",
);
expectEqual(
  readUserTranscript({ item_id: "u2", transcript: "gonna third party" }),
  { itemId: "u2", transcript: "gonna third party" },
  "keep dictation wording",
);

const persona = readFileSync(new URL("../lib/voice/persona.ts", import.meta.url), "utf8");
expect(persona.includes("Do not interrupt by default."), "voice rule: do not interrupt by default");
expect(persona.includes("Interruption is counterproductive — it draws attention to itself instead of the subject of the speaker."), "interrupt draws attention to itself");
expect(persona.includes("Do not barge in on casual, emotional, or storytelling talk"), "no barge-in on casual talk");
expect(persona.includes("Jump in when they are debating or in the middle of something intellectual"), "interrupt on debate or intellectual work");
expect(persona.includes("a back-and-forth argument, unpacking an idea, a rigorous discussion"), "intellectual interrupt examples");
expect(persona.includes("Then interrupting is OK and expected."), "debate interrupt is expected");
expect(!/inferior|not (his |their )?equal|beneath/i.test(persona), "do not frame her as inferior");
expect(!/\bmetrics\b/i.test(persona), "no KPI metrics wording");
expect(persona.includes("If he asks you to jump in, cut in, interrupt him, talk over him, or keep interrupting"), "interrupt also on request");
expect(persona.includes("If he starts talking and it is not debate or intellectual work and he did not ask you to talk over him, stop and let him finish."), "she yields unless debate or he asked");

console.log("listen ok");
