import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");

function filesUnder(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) found.push(...filesUnder(full));
    else found.push(full);
  }
  return found;
}

test("frontend source does not name the server key or the old browser env", () => {
  const roots = ["src", "index.html"].map((entry) => path.join(ROOT, entry));
  const files = roots.flatMap((entry) => (statSync(entry).isDirectory() ? filesUnder(entry) : [entry]));
  const hits = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const keyName = "QLOO_" + "API_KEY";
    const oldName = "VITE_" + "QLOO";
    if (text.includes(keyName) || text.includes(oldName)) {
      hits.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(hits, []);
});
