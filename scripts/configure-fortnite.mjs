import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getFortniteStatus, runFortniteCommand } from "../lib/voice/fortnite.ts";

function loadEnvLocal() {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq);
    let value = trimmed.slice(eq + 1);
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvLocal();

function publicResult(result) {
  return {
    ok: result.ok,
    status: result.status,
    configured: result.configured,
    canPlayInGame: result.canPlayInGame,
    error: result.error,
    tokenScope: result.tokenScope,
    needsReauth: result.needsReauth,
    lexi: result.lexi,
    friend: result.friend,
    party: result.party,
    epicHttpReady: result.epicHttpReady,
    inIanParty: result.inIanParty,
    visibleInFortnite: result.visibleInFortnite,
    autoFriend: result.autoFriend,
    deviceAuthCreated: result.deviceAuthCreated,
  };
}

try {
  const status = await getFortniteStatus({ autoFriend: true });
  console.log(JSON.stringify(publicResult(status), null, 2));
  if (status.needsReauth) {
    console.log(
      "Epic token is missing scope=basic_profile friends_list presence. Paste a new EPIC_EXCHANGE_CODE (from the Android-client redirect that requests that scope) and re-run this script so device auth is reissued. Then start the fortnitepy sidecar with `npm run fortnite:sidecar`. Do not commit the code.",
    );
  }
  if (!status.ok) process.exit(1);
} catch (error) {
  const status = typeof error?.status === "number" ? error.status : 502;
  console.log(
    JSON.stringify(
      {
        ok: false,
        status,
        configured: true,
        canPlayInGame: false,
        error: error instanceof Error ? error.message : "Fortnite request failed.",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
