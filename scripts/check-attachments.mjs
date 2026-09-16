import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_VIDEO_FIRST_LOOK_FRAMES,
  ATTACHMENT_VIDEO_MAX_BYTES,
  ATTACHMENT_VIDEO_MAX_FRAMES,
  ATTACHMENT_VIDEO_MIN_FRAMES,
  isAttachmentVideoFile,
  uploadVideoFirstLookCount,
  uploadVideoSampleTimes,
} from "../lib/voice/upload-frames.ts";

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

expect(ATTACHMENT_MAX_BYTES === 4 * 1024 * 1024, "photo/file cap stays 4 MB");
expect(ATTACHMENT_VIDEO_MAX_BYTES === 40 * 1024 * 1024, "video cap is 40 MB");
expect(ATTACHMENT_VIDEO_MIN_FRAMES === 6, "min frames");
expect(ATTACHMENT_VIDEO_MAX_FRAMES === 12, "max frames");
expect(ATTACHMENT_VIDEO_FIRST_LOOK_FRAMES === 3, "first look is a prefix, not a skim cap");
expect(uploadVideoFirstLookCount(12) === 3, "first look from a full sample");
expect(uploadVideoFirstLookCount(2) === 2, "short clip first look uses what it has");
expect(uploadVideoFirstLookCount(1) === 1, "single-frame first look");

expect(isAttachmentVideoFile({ name: "clip.mov", type: "" }), "mov by ext");
expect(isAttachmentVideoFile({ name: "clip.mp4", type: "video/mp4" }), "mp4");
expect(isAttachmentVideoFile({ name: "clip.webm", type: "video/webm" }), "webm");
expect(!isAttachmentVideoFile({ name: "shot.jpg", type: "image/jpeg" }), "photo is not video");

const zero = uploadVideoSampleTimes(0);
expect(zero.length === 1 && zero[0] === 0, "zero duration samples 0");

const short = uploadVideoSampleTimes(2);
expect(short.length >= 1 && short.length <= ATTACHMENT_VIDEO_MAX_FRAMES, "short count");
expect(short[0] >= 0 && short[short.length - 1] <= 2, "short range");

const mid = uploadVideoSampleTimes(20);
expect(mid.length >= ATTACHMENT_VIDEO_MIN_FRAMES && mid.length <= ATTACHMENT_VIDEO_MAX_FRAMES, "mid count");
for (let i = 1; i < mid.length; i += 1) {
  expect(mid[i] > mid[i - 1], "mid increasing");
}

const long = uploadVideoSampleTimes(120);
expect(long.length === ATTACHMENT_VIDEO_MAX_FRAMES, "long cap");
expect(long[0] > 0 && long[long.length - 1] < 120, "long avoids exact ends");
for (let i = 1; i < long.length; i += 1) {
  expect(long[i] > long[i - 1], "long increasing");
}

console.log("attachment checks ok");
