import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

test("home renders the three-step desktop shell", () => {
  for (const step of ["members", "qloo", "negotiation"]) {
    assert.match(source, new RegExp(`data-shell-panel=\\"${step}\\"`));
    assert.match(source, new RegExp(`data-shell-nav=\\"${step}\\"`));
  }
  assert.match(source, /data-context="city"/);
  assert.match(source, /buildMembersRequest\(readMembersForm\(form\), context\)/);
  assert.match(source, /function renderMembersNegotiation/);
  assert.match(source, /id="members-route"/);
});
