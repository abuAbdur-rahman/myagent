import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = process.env.MYAGENT_SCREEN_MODEL_SRC
  ? resolve(process.env.MYAGENT_SCREEN_MODEL_SRC)
  : "C:\\Users\\abdul\\myagent-models\\models\\deberta-v3-base-prompt-injection-v2";
const dest = join(root, "src-tauri", "resources", "screen-model");

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const manifestPath = join(source, "MANIFEST.json");
if (!existsSync(manifestPath)) {
  console.error(`model manifest not found: ${manifestPath}`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

mkdirSync(dest, { recursive: true });
for (const [name, expected] of Object.entries(manifest.files)) {
  const from = join(source, name);
  if (!existsSync(from)) {
    console.error(`missing ${from}; run the model prep first`);
    process.exit(1);
  }
  const actual = sha256(from);
  if (actual !== expected.sha256) {
    console.error(`sha256 mismatch for ${name}\n  expected ${expected.sha256}\n  actual   ${actual}`);
    process.exit(1);
  }
  copyFileSync(from, join(dest, name));
  console.log(`${name}: ${statSync(from).size} bytes, sha256 ok`);
}
console.log(`bundled into ${dest}`);
