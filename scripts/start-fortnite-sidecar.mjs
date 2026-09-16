import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(root, "sidecars/fortnite");
const script = resolve(dir, "sidecar.py");
const requirements = resolve(dir, "requirements.txt");
const venvPython = resolve(dir, ".venv/bin/python");

function loadEnvLocal() {
  try {
    const text = readFileSync(resolve(root, ".env.local"), "utf8");
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
  } catch {
    // .env.local is optional; the sidecar also loads it.
  }
}

loadEnvLocal();

if (!existsSync(script)) {
  console.error("missing sidecars/fortnite/sidecar.py");
  process.exit(1);
}

if (!existsSync(venvPython)) {
  const py = process.env.FORTNITEPY_PYTHON?.trim() || "python3";
  const created = spawnSync(py, ["-m", "venv", resolve(dir, ".venv")], {
    cwd: root,
    stdio: "inherit",
  });
  if (created.status !== 0) {
    console.error("Could not create sidecars/fortnite/.venv. Install Python 3 and retry.");
    process.exit(created.status || 1);
  }
}

const pip = spawnSync(venvPython, ["-m", "pip", "install", "-r", requirements], {
  cwd: root,
  stdio: "inherit",
});
if (pip.status !== 0) {
  console.error("Could not install fortnitepy. Check network and retry.");
  process.exit(pip.status || 1);
}

console.log("Starting fortnitepy sidecar (Friends lobby party only). Ctrl+C to stop.");
const child = spawn(venvPython, [script], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
