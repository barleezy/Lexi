import { bumpAffect } from "../lib/memory/decay.ts";
import { extractFacts, FACT_KEYS, IDENTITY_KEYS, isFactKey, isIdentityKey } from "../lib/memory/extract.ts";
import { DEFAULT_USER_ID, normalizeUserId, resolveUserId } from "../lib/memory/user.ts";

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

const bare = new Request("http://localhost/api/memory");
expectEqual(resolveUserId(bare, null), "Ian", "GET defaults to Ian");
expectEqual(resolveUserId(bare, "ian"), "Ian", "query ian");
expectEqual(resolveUserId(bare, "IAN"), "Ian", "query IAN");
expectEqual(
  resolveUserId(new Request("http://localhost/api/memory", { headers: { "x-lexi-user-id": "ian" } }), null),
  "Ian",
  "header ian",
);
expectEqual(
  resolveUserId(new Request("http://localhost/api/memory", { headers: { cookie: "lexi_user_id=IAN" } }), null),
  "Ian",
  "cookie IAN",
);

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

expectEqual(keys("my birthday is March 3"), ["birthday=March 3"], "birthday is");
expectEqual(keys("I was born on March 3"), ["birthday=March 3"], "born on");
expectEqual(keys("I turn 28 on March 3"), ["birthday=March 3"], "turn on");
expectEqual(keys("our anniversary is June 12"), ["anniversary=June 12"], "anniversary");
expectEqual(keys("the deadline is Friday"), ["deadline=Friday"], "deadline");
expectEqual(keys("remember this date: March 3"), ["date=March 3"], "remember this date");
expectEqual(keys("I work as a designer"), ["job=designer"], "job as");
expectEqual(keys("I'm 28"), ["age=28"], "adult age");
expectEqual(keys("I'm 16"), [], "no age under 21");
expectEqual(keys("my wife is Ada"), ["partner=Ada"], "partner");
expectEqual(keys("my timezone is EST"), ["timezone=EST"], "timezone");
expectEqual(keys("my favorite food is pizza"), ["food=pizza"], "food");
expectEqual(keys("I listen to jazz"), ["music=jazz"], "music listen");
expectEqual(keys("my favorite music is Radiohead"), ["music=Radiohead"], "favorite music");
expectEqual(keys("my favorite sport is basketball"), ["sport=basketball"], "favorite sport");
expectEqual(keys("I play soccer"), ["sport=soccer"], "play sport not game");
expectEqual(keys("my hobby is painting"), ["hobby=painting"], "hobby");
expectEqual(keys("I like to cook"), ["hobby=cook"], "like to hobby");
expectEqual(keys("in my free time I paint"), ["leisure=paint"], "leisure");
expectEqual(keys("I want to go to Japan"), ["vacation=Japan"], "vacation go to");
expectEqual(keys("my favorite vacation is Hawaii"), ["vacation=Hawaii"], "favorite vacation");
expectEqual(keys("I'm gay"), ["sexual_preference=gay"], "sexual orientation");
expectEqual(keys("I'm into men"), ["sexual_preference=men"], "sexual into");
expectEqual(keys("I'm into hiking"), [], "no sexual from hiking");
expectEqual(keys("I'm 17 and I'm gay"), [], "no sexual under 21");
expectEqual(keys("I'm trans"), ["transexual=trans"], "trans self-id");
expectEqual(keys("I'm transexual"), ["transexual=transexual"], "transexual self-id");
expectEqual(keys("I'm a trans woman"), ["transexual=trans woman"], "trans woman");
expectEqual(keys("I'm a trans man"), ["transexual=trans man"], "trans man");
expectEqual(keys("she's trans"), [], "no trans about someone else");
expectEqual(keys("I'm 17 and I'm trans"), [], "no trans under 21");
expectEqual(keys("my favorite game is Zelda"), ["game=Zelda"], "favorite game");
expectEqual(keys("I play Elden Ring on Steam"), ["game=Elden Ring"], "play game on platform");
expectEqual(keys("my favorite movie is Inception"), ["movie=Inception"], "movie");
expectEqual(keys("my favorite show is Severance"), ["tv=Severance"], "tv show");
expectEqual(keys("my favorite book is Dune"), ["book=Dune"], "book");
expectEqual(keys("I like to listen to jazz"), ["music=jazz"], "like listening not hobby");
expectEqual(keys("I want to go to the store"), [], "no vacation from store");

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

expectEqual(
  [...FACT_KEYS],
  [
    "name",
    "transexual",
    "pets",
    "location",
    "commitments",
    "birthday",
    "anniversary",
    "deadline",
    "date",
    "job",
    "age",
    "partner",
    "timezone",
    "food",
    "music",
    "sport",
    "hobby",
    "leisure",
    "vacation",
    "sexual_preference",
    "game",
    "movie",
    "tv",
    "book",
  ],
  "fact key pool",
);
expectEqual(isFactKey("birthday"), true, "birthday is fact key");
expectEqual(isFactKey("music"), true, "music is fact key");
expectEqual(isFactKey("transexual"), true, "transexual is fact key");
expectEqual(isFactKey("dates"), false, "dates blob is not a key");
expectEqual([...IDENTITY_KEYS], ["name", "transexual"], "identity keys");
expectEqual(isIdentityKey("name"), true, "name is identity");
expectEqual(isIdentityKey("transexual"), true, "transexual is identity");
expectEqual(isIdentityKey("pets"), false, "pets is not identity");
expectEqual(isIdentityKey("location"), false, "location is not identity");
expectEqual(isIdentityKey("commitments"), false, "commitments is not identity");
expectEqual(isIdentityKey("birthday"), false, "birthday is not identity");
expectEqual(storedAffect("name", 5), 10, "name insert is 10");
expectEqual(storedAffect("name", 6, 6), 10, "name upsert is 10 not bump 7");
expectEqual(storedAffect("transexual", 5), 10, "transexual insert is 10");
expectEqual(storedAffect("transexual", 6, 6), 10, "transexual upsert is 10 not bump 7");
expectEqual(storedAffect("pets", 5), 5, "pets insert uses scorer");
expectEqual(storedAffect("pets", 3, 5), 6, "pets upsert still bumps");
expectEqual(storedAffect("location", 4), 4, "location insert uses scorer");

console.log("extract + identity ok");
