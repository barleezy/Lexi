import {
  VIDEO_ACCEPT,
  WATCH_VIDEO_MAX_BYTES,
  formatWatchSize,
  isVideoFile,
  mpegtsMediaType,
  videoExtension,
  watchInputFileName,
  watchPlaybackKind,
  watchPlaysInHomeTab,
  watchShouldRemuxOnNativeError,
  watchSizeError,
  directVideoHref,
} from "../lib/voice/watch-formats.ts";
import { looksLikeVideoContentType } from "../lib/voice/video-proxy.ts";
import {
  adultEmbedUrl,
  extractAdultMediaFromHtml,
  isAdultPageUrl,
  proxiedWatchMedia,
} from "../lib/voice/watch-adult.ts";

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: ${actual} !== ${expected}`);
}

expect(WATCH_VIDEO_MAX_BYTES === 1024 * 1024 * 1024, "1 GB watch cap");
expect(VIDEO_ACCEPT.includes(".flv") && VIDEO_ACCEPT.includes("video/x-flv"), "accept flv");
expect(VIDEO_ACCEPT.includes(".avi") && VIDEO_ACCEPT.includes("video/x-msvideo"), "accept avi");
expect(VIDEO_ACCEPT.includes(".mpeg") && VIDEO_ACCEPT.includes(".mpg"), "accept mpeg");
expect(VIDEO_ACCEPT.includes(".wmv") && VIDEO_ACCEPT.includes("video/x-ms-wmv"), "accept wmv");
expect(VIDEO_ACCEPT.includes(".mkv") && VIDEO_ACCEPT.includes(".mov"), "accept mkv/mov");
expect(VIDEO_ACCEPT.includes(".ts") && VIDEO_ACCEPT.includes(".m2ts"), "accept ts");

expectEqual(videoExtension("clip.AVI"), "avi", "ext from name");
expectEqual(videoExtension("https://cdn.example/a/clip.wmv?dl=1"), "wmv", "ext from url");
expectEqual(videoExtension("https://cdn.example/clip.m2ts"), "m2ts", "m2ts ext");
expectEqual(videoExtension("https://cdn.example/noext"), "", "no ext");

const files = [
  ["clip.mp4", "video/mp4", "native"],
  ["clip.webm", "video/webm", "native"],
  ["clip.mov", "", "native"],
  ["clip.m4v", "video/x-m4v", "native"],
  ["clip.ogv", "", "native"],
  ["clip.3gp", "", "native"],
  ["clip.flv", "video/x-flv", "mpegts"],
  ["live.ts", "", "mpegts"],
  ["show.m2ts", "", "mpegts"],
  ["clip.avi", "video/x-msvideo", "remux"],
  ["clip.wmv", "video/x-ms-wmv", "remux"],
  ["clip.mpeg", "video/mpeg", "remux"],
  ["clip.mpg", "", "remux"],
  ["clip.mpe", "", "remux"],
  ["clip.mkv", "video/x-matroska", "remux"],
];

for (const [name, type, kind] of files) {
  expect(isVideoFile({ name, type }), `recognize ${name}`);
  expectEqual(watchPlaybackKind({ name, type }), kind, `kind ${name}`);
}

expect(isVideoFile({ name: "download", type: "video/x-flv" }), "flv by mime");
expect(!isVideoFile({ name: "shot.jpg", type: "image/jpeg" }), "photo is not watch video");
expect(!isVideoFile({ name: "notes.txt", type: "text/plain" }), "text is not watch video");

expect(watchPlaysInHomeTab({ name: "a.mp4", type: "" }), "mp4 stays on home");
expect(!watchPlaysInHomeTab({ name: "a.avi", type: "" }), "avi goes to watch tab");
expect(!watchPlaysInHomeTab({ name: "a.flv", type: "" }), "flv goes to watch tab");

expect(watchShouldRemuxOnNativeError({ name: "a.mp4", type: "" }), "mp4 can remux on decode error");
expect(watchShouldRemuxOnNativeError({ name: "a.mov", type: "" }), "mov can remux on error");
expect(!watchShouldRemuxOnNativeError({ name: "a.flv", type: "" }), "flv uses mpegts first");
expect(watchShouldRemuxOnNativeError({ name: "https://cdn.example/file", type: "" }), "unknown url remux on error");

expectEqual(mpegtsMediaType({ name: "a.flv", type: "" }), "flv", "flv type");
expectEqual(mpegtsMediaType({ name: "a.ts", type: "" }), "mpegts", "ts type");
expectEqual(watchInputFileName("https://x/c.AVI"), "input.avi", "ffmpeg input name");

expectEqual(watchSizeError(10), null, "small ok");
expect(typeof watchSizeError(WATCH_VIDEO_MAX_BYTES + 1) === "string", "over cap");
expect(watchSizeError(WATCH_VIDEO_MAX_BYTES + 1).includes("1 GB"), "over cap says 1 GB");
expect(formatWatchSize(WATCH_VIDEO_MAX_BYTES).includes("1.0"), "cap label");

expect(looksLikeVideoContentType("video/x-msvideo"), "avi mime");
expect(looksLikeVideoContentType("application/x-matroska"), "mkv app mime");
expect(looksLikeVideoContentType("application/vnd.ms-asf"), "wmv asf mime");
expect(looksLikeVideoContentType("application/x-flv"), "flv app mime");
expect(looksLikeVideoContentType("binary/octet-stream"), "binary octet");
expect(looksLikeVideoContentType("text/plain", "https://cdn.example/clip.mp4"), "plain mp4 allowed");
expect(!looksLikeVideoContentType("text/plain", "https://cdn.example/notes.txt"), "plain text rejected");
expect(!looksLikeVideoContentType("text/html"), "html rejected");

expect(VIDEO_ACCEPT.startsWith("video/*"), "accept includes video/*");
expectEqual(directVideoHref("https://cdn.example/a.mp4"), "https://cdn.example/a.mp4", "direct href");
expectEqual(directVideoHref("not a url"), "", "invalid url");
expectEqual(directVideoHref("https://cdn.example/a.mp4?dl=1"), "https://cdn.example/a.mp4?dl=1", "keeps query");

expect(isAdultPageUrl("https://www.pornhub.com/view_video.php?viewkey=phabc"), "pornhub page");
expect(isAdultPageUrl("https://www.xvideos.com/video12345/clip"), "xvideos page");
expect(isAdultPageUrl("https://www.xnxx.com/video-abc12/clip"), "xnxx page");
expect(isAdultPageUrl("https://xhamster.com/videos/clip-99"), "xhamster page");
expect(isAdultPageUrl("https://www.redtube.com/12345"), "redtube host");
expect(isAdultPageUrl("https://spankbang.com/ab12/video/clip"), "spankbang page");
expect(isAdultPageUrl("https://www.ashemaletube.com/videos/12345/clip/"), "ashemaletube www");
expect(isAdultPageUrl("https://ashemaletube.com/videos/12345/clip/"), "ashemaletube apex");
expect(isAdultPageUrl("https://m.ashemaletube.com/videos/12345/clip/"), "ashemaletube mobile");
expectEqual(
  adultEmbedUrl("https://www.ashemaletube.com/videos/12345/clip/"),
  "https://www.ashemaletube.com/embed/12345",
  "ashemaletube embed",
);
expect(isAdultPageUrl("https://www.transangels.com/en/video/clip/12345"), "transangels www");
expect(isAdultPageUrl("https://transangels.com/en/video/clip/12345"), "transangels apex");
expect(isAdultPageUrl("https://m.transangels.com/en/video/clip/12345"), "transangels mobile");
expect(isAdultPageUrl("https://www.adulttime.com/en/video/clip/12345"), "adulttime player host");
expect(isAdultPageUrl("https://embed.adulttime.com/en/embed/12345"), "adulttime embed host");
expectEqual(
  adultEmbedUrl("https://www.transangels.com/en/video/clip/12345"),
  "https://www.transangels.com/en/embed/12345",
  "transangels embed",
);
expect(isAdultPageUrl("https://www.thegay.com/video?id=12345"), "thegay www");
expect(isAdultPageUrl("https://thegay.com/videos/12345"), "thegay apex");
expect(isAdultPageUrl("https://m.thegay.com/videos/12345"), "thegay mobile");
expectEqual(
  adultEmbedUrl("https://www.thegay.com/video?id=12345"),
  "https://www.thegay.com/embed/12345",
  "thegay embed",
);
expect(!isAdultPageUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "youtube is not adult resolve");
expect(!isAdultPageUrl("https://vimeo.com/123"), "vimeo is not adult resolve");
expectEqual(
  adultEmbedUrl("https://www.pornhub.com/view_video.php?viewkey=phabc"),
  "https://www.pornhub.com/embed/phabc",
  "pornhub embed",
);
expect(
  proxiedWatchMedia("https://cdn.example/a.mp4", "https://www.pornhub.com/view_video.php?viewkey=phabc").includes(
    "referer=",
  ),
  "proxy keeps page referer",
);

const extracted = extractAdultMediaFromHtml(
  `<title>Adult clip</title><script>html5player.setVideoUrlHigh('https://cdn.example/a.mp4');</script>`,
  "https://www.xvideos.com/video123/clip",
);
expectEqual(extracted.title, "Adult clip", "title from page");
expectEqual(extracted.media?.href, "https://cdn.example/a.mp4", "xvideos mp4");
expectEqual(extracted.embedUrl, "https://www.xvideos.com/embedframe/123", "xvideos embed");

expect(looksLikeVideoContentType("application/vnd.apple.mpegurl"), "hls mime");
expect(looksLikeVideoContentType("text/plain", "https://cdn.example/a.m3u8"), "plain m3u8");

console.log("watch format checks ok");
