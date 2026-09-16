import { parseJoyhubCommand } from "../lib/voice/joyhub.ts";
import { parseLovenseCommand } from "../lib/voice/lovense.ts";
import { parseToyControlIntent, resolveToyControlRequest } from "../lib/voice/toy-control.ts";

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

expect(parseToyControlIntent("take control") === "grant", "take control grants");
expect(parseToyControlIntent("you can control the toys") === "grant", "you can control the toys grants");
expect(parseToyControlIntent("Lexi take over the toys") === "grant", "Lexi take over the toys grants");
expect(parseToyControlIntent("Give Lexi toy control") === "grant", "Give Lexi toy control grants");
expect(parseToyControlIntent("you have control") === "grant", "you have control grants");
expect(parseToyControlIntent("you can use the toy") === "grant", "you can use the toy grants");
expect(parseToyControlIntent("stop controlling") === "revoke", "stop controlling revokes");
expect(parseToyControlIntent("no more toy control") === "revoke", "no more toy control revokes");
expect(parseToyControlIntent("take your hands off") === "revoke", "take your hands off revokes");
expect(parseToyControlIntent("Revoke toy control") === "revoke", "Revoke toy control revokes");
expect(parseToyControlIntent("don't take control") === null, "negated grant does not grant");
expect(parseToyControlIntent("make it stronger") === null, "unrelated talk does not grant");
expect(parseToyControlIntent("stop") === null, "bare stop is not a revoke");

const selfApprove = resolveToyControlRequest({
  requested: true,
  lastUserUtterance: "make it stronger",
  alreadyGranted: false,
});
expect(!selfApprove.ok && selfApprove.granted === false, "model tool cannot self-approve");
expect(selfApprove.error.includes("until the user asks"), "self-approve tells Lexi to wait");

const userGrant = resolveToyControlRequest({
  requested: true,
  lastUserUtterance: "take control",
  alreadyGranted: false,
});
expect(userGrant.ok && userGrant.granted, "matching user grant is accepted");

const already = resolveToyControlRequest({
  requested: true,
  lastUserUtterance: "make it stronger",
  alreadyGranted: true,
});
expect(already.ok && already.granted, "already-granted stays granted");

const modelRevoke = resolveToyControlRequest({
  requested: false,
  lastUserUtterance: "make it stronger",
  alreadyGranted: true,
});
expect(!modelRevoke.ok && modelRevoke.granted === true, "model cannot revoke without user");

const userRevoke = resolveToyControlRequest({
  requested: false,
  lastUserUtterance: "revoke toy control",
  alreadyGranted: true,
});
expect(userRevoke.ok && userRevoke.granted === false, "matching user revoke is accepted");

const vibrate = parseLovenseCommand({ action: "vibrate", strength: 10, durationSec: 8 });
if (!vibrate.ok) throw new Error(vibrate.error);
if (vibrate.payload.action !== "Vibrate:10") throw new Error("lovense vibrate action");

const stop = parseLovenseCommand({ action: "stop" });
if (!stop.ok) throw new Error(stop.error);
if (stop.payload.action !== "Stop") throw new Error("lovense stop");

const pulse = parseLovenseCommand({ action: "pulse", durationSec: 9 });
if (!pulse.ok) throw new Error(pulse.error);
if (pulse.payload.command !== "Preset" || pulse.payload.name !== "pulse") {
  throw new Error("lovense pulse preset");
}

const rotate = parseLovenseCommand({ action: "rotate", strength: 8, durationSec: 6 });
if (!rotate.ok) throw new Error(rotate.error);
expect(rotate.payload.command === "Function" && rotate.payload.action === "Rotate:8", "lovense rotate");

const pump = parseLovenseCommand({ action: "pump", strength: 2 });
if (!pump.ok) throw new Error(pump.error);
expect(pump.payload.action === "Pump:2", "lovense pump 0-3");

const combo = parseLovenseCommand({
  action: "function",
  functions: "Vibrate:10,Rotate:5,Thrusting:12",
  durationSec: 20,
  loopRunningSec: 9,
  loopPauseSec: 4,
  stopPrevious: 0,
});
if (!combo.ok) throw new Error(combo.error);
expect(combo.payload.command === "Function", "combo is Function");
expect(combo.payload.action === "Vibrate:10,Rotate:5,Thrusting:12", "combo functions");
expect(combo.payload.loopRunningSec === 9 && combo.payload.loopPauseSec === 4, "loop fields");
expect(combo.payload.stopPrevious === 0, "stopPrevious 0");
expect(combo.payload.apiVer === 1, "function apiVer 1");

const stroke = parseLovenseCommand({
  action: "function",
  functions: "Stroke:0-20,Thrusting:10",
  durationSec: 20,
});
if (!stroke.ok) throw new Error(stroke.error);
expect(stroke.payload.action === "Stroke:0-20,Thrusting:10", "stroke range + thrusting");

const pattern = parseLovenseCommand({
  action: "pattern",
  pattern: "20;10;5;20",
  rule: "V:1;F:v,r;S:1000#",
  durationSec: 9,
});
if (!pattern.ok) throw new Error(pattern.error);
expect(pattern.payload.command === "Pattern" && pattern.payload.apiVer === 2, "pattern apiVer 2");
expect(pattern.payload.rule === "V:1;F:v,r;S:1000#" && pattern.payload.strength === "20;10;5;20", "custom pattern");

const position = parseLovenseCommand({ action: "position", position: 38 });
if (!position.ok) throw new Error(position.error);
expect(position.payload.command === "Position" && position.payload.value === "38", "position command");

const badStrength = parseLovenseCommand({ action: "vibrate", strength: 99 });
if (badStrength.ok) throw new Error("lovense should reject strength 99");

const badPump = parseLovenseCommand({ action: "pump", strength: 9 });
if (badPump.ok) throw new Error("lovense should reject pump 9");

const joyVibe = parseJoyhubCommand({ action: "vibrate", strength: 10, durationSec: 5 });
if (!joyVibe.ok) throw new Error(joyVibe.error);
if (joyVibe.payload.command !== "vibrate" || joyVibe.payload.intensity !== 50) {
  throw new Error("joyhub maps 10/20 to intensity 50");
}

const joyStop = parseJoyhubCommand({ action: "stop" });
if (!joyStop.ok || joyStop.payload.command !== "stop") throw new Error("joyhub stop");

const joyRotate = parseJoyhubCommand({
  action: "rotate",
  functions: "Rotate:8,Vibrate:10",
  durationSec: 6,
});
if (!joyRotate.ok) throw new Error(joyRotate.error);
expect(joyRotate.payload.action === "rotate", "joyhub keeps rotate");
expect(joyRotate.payload.functions === "Rotate:8,Vibrate:10", "joyhub does not strip functions");

const joyBad = parseJoyhubCommand({ action: "explode!!" });
if (joyBad.ok) throw new Error("joyhub should reject invalid action names");

console.log("toys check ok");
