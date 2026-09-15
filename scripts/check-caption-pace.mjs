import {
  CaptionPacer,
  prefixWords,
  readWordStartsMs,
  wordUnits,
} from "../lib/voice/caption-pace.ts";

function expectEqual(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label}: ${left} !== ${right}`);
}

expectEqual(wordUnits("Hello there friend"), ["Hello ", "there ", "friend"], "word units");
expectEqual(prefixWords("Hello there friend", 1), "Hello ", "first word");
expectEqual(prefixWords("Hello there friend", 3), "Hello there friend", "all words");
expectEqual(
  readWordStartsMs({ words: [{ text: "Hi", start: 0.25 }, { text: "there", start: 0.5 }] }),
  [250, 500],
  "word starts seconds",
);
expectEqual(readWordStartsMs({ delta: "Hello there" }), null, "plain delta has no stamps");

const seen = [];
const pacer = new CaptionPacer((text) => seen.push(text));
pacer.append("Hello there friend");
expectEqual(seen, ["Hello "], "first word shows immediately");
pacer.flush();
expectEqual(seen.at(-1), "Hello there friend", "flush matches full transcript");

const empty = [];
const idle = new CaptionPacer((text) => empty.push(text));
idle.flush();
expectEqual(empty, [], "empty flush does not emit");

console.log("caption-pace ok");
