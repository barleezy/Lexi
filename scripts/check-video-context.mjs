import {
  VIDEO_CONTEXT_CHAT_ENDPOINT,
  VIDEO_CONTEXT_ENDPOINT,
  VIDEO_CONTEXT_MODEL,
  VIDEO_CONTEXT_REASONING_EFFORT,
  buildVideoContextChatRequest,
  buildVideoContextRequest,
  readChatCompletionsText,
  readResponsesError,
  readResponsesText,
  readVideoContextCache,
  videoContextCacheKey,
  writeVideoContextCache,
} from "../lib/voice/video-context.ts";
import { isBlockedVideoHost, parseVideoSourceUrl } from "../lib/voice/video-proxy.ts";

if (VIDEO_CONTEXT_ENDPOINT !== "https://api.x.ai/v1/responses") {
  throw new Error("video context must use the documented xAI responses API");
}
if (VIDEO_CONTEXT_MODEL !== "grok-4.6") {
  throw new Error("video context must use documented grok-4.6 image understanding");
}

const text = readResponsesText({
  output: [
    {
      type: "message",
      content: [{ type: "output_text", text: "A red car turns left." }],
    },
  ],
});
if (text !== "A red car turns left.") throw new Error("readResponsesText failed");

if (readResponsesError({ error: { message: "nope" } }) !== "nope") {
  throw new Error("readResponsesError failed");
}

const request = buildVideoContextRequest(
  [{ dataUrl: "data:image/jpeg;base64,abc", timeSec: 12.4 }],
  "What's happening?",
);
if (request.model !== "grok-4.6") throw new Error("request model");
if (request.store !== false) throw new Error("must not store image history");
if (request.reasoning?.effort !== VIDEO_CONTEXT_REASONING_EFFORT) {
  throw new Error("grok-4.6 frame analysis must use a valid reasoning effort");
}
if (VIDEO_CONTEXT_REASONING_EFFORT === "none") {
  throw new Error("reasoning none 400s grok-4.6 image understanding");
}
if (request.search_parameters) throw new Error("frame analysis must not web-search");
if (VIDEO_CONTEXT_CHAT_ENDPOINT !== "https://api.x.ai/v1/chat/completions") {
  throw new Error("chat fallback endpoint");
}
const chat = buildVideoContextChatRequest(
  [{ dataUrl: "data:image/jpeg;base64,abc", timeSec: 12.4 }],
  "What's happening?",
);
if (chat.messages[0].content[0].type !== "image_url") throw new Error("chat image_url missing");
if (readChatCompletionsText({ choices: [{ message: { content: "A red car turns left." } }] }) !== "A red car turns left.") {
  throw new Error("readChatCompletionsText failed");
}
if (!String(request.input[0].content.at(-1)?.text ?? "").includes("under 18")) {
  throw new Error("video context porn frames refuse under 18");
}
if (!Array.isArray(request.input[0].content)) throw new Error("input content");
if (request.input[0].content[0].type !== "input_image") throw new Error("input_image missing");

if (parseVideoSourceUrl("https://example.com/a.mp4").ok !== true) throw new Error("public url");
if (parseVideoSourceUrl("http://127.0.0.1/a.mp4").ok !== false) throw new Error("localhost blocked");
if (parseVideoSourceUrl("https://192.168.1.4/a.mp4").ok !== false) throw new Error("lan blocked");
if (parseVideoSourceUrl("file:///tmp/a.mp4").ok !== false) throw new Error("file blocked");
if (!isBlockedVideoHost("169.254.169.254")) throw new Error("metadata blocked");

const cacheKey = videoContextCacheKey({
  title: "clip.mp4",
  question: "What's happening?",
  currentTime: 12.4,
  frames: [{ dataUrl: "data:image/jpeg;base64,abc", timeSec: 12.4 }],
});
writeVideoContextCache(cacheKey, "A red car turns left.");
const cached = readVideoContextCache(cacheKey);
if (cached?.description !== "A red car turns left.") throw new Error("video context cache miss");
if (readVideoContextCache(cacheKey + "|other")) throw new Error("cache must be key-scoped");

console.log("video context checks ok");
