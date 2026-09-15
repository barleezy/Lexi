import { bumpAffect } from "../lib/memory/decay.ts";
import { extractFacts, IDENTITY_KEYS, isIdentityKey } from "../lib/memory/extract.ts";
import { DEFAULT_USER_ID, normalizeUserId } from "../lib/memory/user.ts";

function storedAffect(key, incoming, existing) {
  if (isIdentityKey(key)) return 10;
  return existing != null ? bumpAffect(existing, incoming) : incoming;
}

function keys(user) {
  return extractFacts(user, "Got it.").map((fact) => `${fact.memoryKey}=${fact.value}`);
}

function expectEqual(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label}: ${left} !== ${right}`);
}

expectEqual(DEFAULT_USER_ID, "Ian", "default user id");
expectEqual(normalizeUserId("ian"), "Ian", "normalize ian");
expectEqual(normalizeUserId("IAN"), "Ian", "normalize IAN");
expectEqual(normalizeUserId(" Ian "), "Ian", "normalize padded");
expectEqual(normalizeUserId(""), "Ian", "normalize empty");
expectEqual(normalizeUserId(null), "Ian", "normalize null");

expectEqual(keys("my name is Ian"), ["name=Ian"], "my name is");
expectEqual(keys("I'm Ian"), ["name=Ian"], "I'm");
expectEqual(keys("I am Ian"), ["name=Ian"], "I am");
expectEqual(keys("call me Ian"), ["name=Ian"], "call me");
expectEqual(keys("my name is ian"), ["name=Ian"], "lowercase name");

expectEqual(keys("I have a dog named Rex"), ["pets=Rex (dog)"], "named dog");
expectEqual(keys("my cat is Whiskers"), ["pets=Whiskers (cat)"], "named cat");
expectEqual(keys("I have a cat"), ["pets=cat"], "unowned-name cat");

expectEqual(keys("I live in Boston"), ["location=Boston"], "live in");
expectEqual(keys("I'm in New York"), ["location=New York"], "I'm in place");
expectEqual(keys("I'm from chicago"), ["location=Chicago"], "from city");

expectEqual(keys("I will finish the paper"), ["commitments=finish the paper"], "I will");
expectEqual(keys("I promised to call mom"), ["commitments=call mom"], "promised");
expectEqual(keys("I need to buy groceries"), ["commitments=buy groceries"], "need to");
expectEqual(keys("remember my goal is to sleep more"), ["commitments=sleep more"], "goal");
expectEqual(keys("I remember when I was a kid"), [], "no commitment from I remember");

expectEqual(keys("hi"), [], "greeting hi");
expectEqual(keys("hello!"), [], "greeting hello");
expectEqual(keys("thanks"), [], "greeting thanks");
expectEqual(keys("I'm going to the store"), [], "no name from going");
expectEqual(keys("I'm in a meeting"), [], "no location from meeting");
expectEqual(keys("I'm tired"), [], "no name from tired");
expectEqual(keys("I'm a dog person"), [], "no pets from dog person");

const mixed = extractFacts("My name is Ian. I live in Boston and I have a dog named Rex. I will call mom.", "Nice.");
expectEqual(
  mixed.map((fact) => fact.memoryKey),
  ["name", "pets", "location", "commitments"],
  "multiple facts",
);

expectEqual(bumpAffect(5, 3), 6, "bump raises even if incoming lower");
expectEqual(bumpAffect(5, 8), 8, "bump takes higher incoming");
expectEqual(bumpAffect(10, 9), 10, "bump caps at 10");

expectEqual([...IDENTITY_KEYS], ["name"], "identity keys");
expectEqual(isIdentityKey("name"), true, "name is identity");
expectEqual(isIdentityKey("pets"), false, "pets is not identity");
expectEqual(isIdentityKey("location"), false, "location is not identity");
expectEqual(isIdentityKey("commitments"), false, "commitments is not identity");
expectEqual(storedAffect("name", 5), 10, "name insert is 10");
expectEqual(storedAffect("name", 6, 6), 10, "name upsert is 10 not bump 7");
expectEqual(storedAffect("pets", 5), 5, "pets insert uses scorer");
expectEqual(storedAffect("pets", 3, 5), 6, "pets upsert still bumps");
expectEqual(storedAffect("location", 4), 4, "location insert uses scorer");

console.log("extract + identity ok");
