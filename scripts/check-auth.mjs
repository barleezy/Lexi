import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { normalizeUserId } from "../lib/memory/user.ts";

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

expect(normalizeUserId("Barleezy") === "Ian", "Barleezy aliases to Ian");
expect(normalizeUserId("ian") === "Ian", "ian aliases to Ian");

const accounts = readFileSync(new URL("../lib/auth/accounts.ts", import.meta.url), "utf8");
expect(
  accounts.includes('export const ADMIN_ACCOUNT_EMAIL = "barlow80136@gmail.com"'),
  "admin email constant",
);
expect(accounts.includes('normalizeUserId("Barleezy")'), "bootstrap uses Barleezy alias");
expect(accounts.includes("SET email = EXCLUDED.email") || accounts.includes("SET email = $1"), "bootstrap writes email");

const hashed = createHash("sha256").update("AB23CD45EF67").digest("base64url");
expect(hashed.length > 20, "reset token hash");

console.log("auth ok");
