import {
  GENERATE_REFUSAL,
  PORN_MIN_AGE,
  ROLEPLAY_MIN_AGE,
  looksLikeGenerateRequest,
  readGeneratePrompt,
  refusePornSubject,
} from "../lib/generate/safety.ts";
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  IMAGE_GENERATIONS_URL,
  VIDEO_GENERATIONS_URL,
  VIDEO_REQUEST_ID,
  buildImageGenerationBody,
  buildVideoGenerationBody,
  imageDataUrl,
  imageModelFromEnv,
  parseVideoRequestId,
  readGeneratedImages,
  readImageError,
  readVideoRequestId,
  readVideoResult,
  videoModelFromEnv,
  videoStatusUrl,
} from "../lib/generate/media.ts";

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

expect(IMAGE_GENERATIONS_URL === "https://api.x.ai/v1/images/generations", "image generations URL");
expect(VIDEO_GENERATIONS_URL === "https://api.x.ai/v1/videos/generations", "video generations URL");
expect(DEFAULT_IMAGE_MODEL === "grok-imagine-image-2.0", "current image model");
expect(DEFAULT_VIDEO_MODEL === "grok-imagine-video-1.5", "current video model");
expect(imageModelFromEnv({}) === DEFAULT_IMAGE_MODEL, "image model default");
expect(imageModelFromEnv({ XAI_IMAGE_MODEL: "grok-imagine-image" }) === "grok-imagine-image", "image override");
expect(videoModelFromEnv({ XAI_VIDEO_MODEL: "grok-imagine-video" }) === "grok-imagine-video", "video override");
expect(
  videoStatusUrl("a3d1008e-4544-40d4-d075-11527e794e4a") ===
    "https://api.x.ai/v1/videos/a3d1008e-4544-40d4-d075-11527e794e4a",
  "video status URL",
);

expect(PORN_MIN_AGE === 18, "porn media cutoff is 18");
expect(ROLEPLAY_MIN_AGE === 21, "voice roleplay cutoff stays 21");
expect(refusePornSubject("").ok === false, "empty prompt refused");
expect(refusePornSubject("Lexi in a black dress, looking at the camera").ok === true, "adult portrait allowed");
expect(refusePornSubject("explicit adult sex, two consenting adults").ok === true, "adult sex allowed");
expect(refusePornSubject("hey baby, come here").ok === true, "baby as endearment allowed");
expect(refusePornSubject("a 17 year old girl").ok === false, "17 year old refused");
expect(refusePornSubject("20-year-old boy").ok === true, "20 year old allowed for porn/media");
expect(refusePornSubject("18 year old woman").ok === true, "18 year old allowed");
expect(refusePornSubject("21 year old woman").ok === true, "21 year old allowed");
expect(refusePornSubject("a child sitting on a bench").ok === false, "child refused");
expect(refusePornSubject("teen in lingerie").ok === false, "teen refused");
expect(refusePornSubject("kidney-shaped pool at dusk").ok === true, "kidney is not kid");
expect(refusePornSubject("baby girl in a crib").ok === false, "infant subject refused");
expect(refusePornSubject("looks like a child").ok === false, "looks like a child refused");
expect(refusePornSubject("high school locker room").ok === false, "high school refused");
expect(refusePornSubject("a teenager").error === GENERATE_REFUSAL, "refusal copy");
expect(GENERATE_REFUSAL.includes("under 18"), "generate refusal says 18");

expect(looksLikeGenerateRequest("send me a pic", "image") === true, "pic request");
expect(looksLikeGenerateRequest("make a video of that", "video") === true, "video request");
expect(looksLikeGenerateRequest("what time is it") === false, "unrelated is not generate");
expect(looksLikeGenerateRequest("yes", "image") === true, "agreement counts");
expect(readGeneratePrompt({ prompt: "  full request here  " }) === "full request here", "prompt reader");
expect(readGeneratePrompt({ description: "alt" }) === "alt", "description fallback");

const imageBody = buildImageGenerationBody({
  prompt: "A collage of London landmarks in a stenciled street-art style",
  aspectRatio: "16:9",
  resolution: "2k",
});
expect(imageBody.model === DEFAULT_IMAGE_MODEL, "image body model");
expect(imageBody.prompt.includes("London landmarks"), "full prompt kept");
expect(imageBody.response_format === "b64_json", "image requests embedded stills");
expect(imageBody.aspect_ratio === "16:9", "aspect ratio");
expect(imageBody.resolution === "2k", "resolution");
expect(imageBody.n === 1, "single image");

const images = readGeneratedImages({
  data: [{ b64_json: "abc", mime_type: "image/jpeg" }, { url: "https://example.com/x.jpg" }],
});
expect(images[0].dataUrl === imageDataUrl("abc", "image/jpeg"), "b64 image");
expect(images[1].url === "https://example.com/x.jpg", "url image");
expect(readImageError({ error: { message: "nope" } }) === "nope", "image error");

const videoBody = buildVideoGenerationBody({
  prompt: "A serene lake at sunrise with mist rolling over the water",
  duration: 10,
  aspectRatio: "16:9",
  resolution: "720p",
  silent: true,
});
expect(videoBody.model === DEFAULT_VIDEO_MODEL, "video body model");
expect(videoBody.prompt.includes("serene lake"), "video prompt kept");
expect(videoBody.duration === 10, "video duration");
expect(videoBody.generate_audio === false, "silent video");
expect(buildVideoGenerationBody({ prompt: "x", duration: 99 }).duration === undefined, "duration clamp");
expect(parseVideoRequestId("a3d1008e-4544-40d4-d075-11527e794e4a"), "valid request id");
expect(!parseVideoRequestId("../etc/passwd"), "reject path id");
expect(!VIDEO_REQUEST_ID.test("short"), "reject short id");
expect(readVideoRequestId({ request_id: "a3d1008e-4544-40d4-d075-11527e794e4a" }), "read request id");

const pending = readVideoResult({ status: "pending", progress: 40 });
expect(pending.status === "pending", "pending video");
const done = readVideoResult({
  status: "done",
  model: DEFAULT_VIDEO_MODEL,
  video: { url: "https://vidgen.x.ai/clip.mp4", duration: 8, respect_moderation: true },
});
expect(done.status === "done" && done.url?.includes("vidgen.x.ai"), "done video url");
const blocked = readVideoResult({
  status: "done",
  video: { url: "", respect_moderation: false },
});
expect(blocked.status === "failed", "moderation empty url is failed");

console.log("generate checks ok");
