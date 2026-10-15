import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// Execute the real entry point and its imports; only the browser DOM is replaced.
// These regressions must fail if main.js ignores the current negotiation state.
async function mount(result, request) {
  const url = new URL("../src/main.js", import.meta.url);
  const source = await readFile(url, "utf8");
  const imports = {};
  for (const match of source.matchAll(/^import \{([^}]+)\} from "([^"]+)";$/gm)) {
    const module = await import(new URL(match[2], url));
    for (const name of match[1].split(",").map((value) => value.trim())) imports[name] = module[name];
  }
  const nodes = new Map();
  const document = {
    querySelectorAll: () => [],
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, {
        innerHTML: "", outerHTML: "", listeners: {},
        querySelectorAll: () => [],
        addEventListener(type, listener) { this.listeners[type] = listener; },
      });
      return nodes.get(selector);
    },
  };
  const context = vm.createContext({
    ...imports, document, URLSearchParams,
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }) },
    location: { hash: "", search: "" }, result, request,
  });
  vm.runInContext(source.replace(/^import .*;\r?$/gm, ""), context, { filename: "src/main.js" });
  const render = () => vm.runInContext(`
    document.querySelector("#members-result-panel").outerHTML = renderMembersResult(result, request);
    document.querySelector("#members-route").innerHTML = renderMembersNegotiation(result, request);
    bindNegotiationPanel(result, request);
  `, context);
  render();
  return {
    click(action) {
      const { type, ...data } = action;
      document.querySelector("#members-result-panel").listeners.click({
        target: { closest: () => ({ dataset: { negotiate: type, ...data } }) },
      });
    },
    restart: render,
    get state() { return vm.runInContext("membersNegotiationState", context); },
    get route() { return document.querySelector("#members-route").innerHTML; },
    get summary() { return document.querySelector("#members-result-panel").outerHTML; },
    get names() { return [...this.route.matchAll(/<b>([^<]+)<\/b>/g)].map((match) => match[1]); },
  };
}

function fixture(context = {}) {
  const members = [
    { id: "m1", name: "甲", preferences: ["电影", "爵士", "火锅"] },
    { id: "m2", name: "乙", preferences: ["展览", "摇滚", "烧烤"] },
  ];
  return {
    request: { members, context: { time: "18:00-22:00", budget: 100, ...context } },
    result: { source: "fallback", members, suggestions: [
      { id: "balanced", name: "均衡站", memberScores: { m1: 0.375, m2: 0.875 }, cost: 20, durationMinutes: 60, sourceTag: "mock:fixture" },
      { id: "favorite", name: "甲的首选", memberScores: { m1: 0.625, m2: 0.25 }, cost: 20, durationMinutes: 60, sourceTag: "mock:fixture" },
    ] },
  };
}

test("rejecting every site displays no route instead of reviving fallback candidates", async () => {
  const { result, request } = fixture();
  const ui = await mount(result, request);
  assert.deepEqual(ui.names, ["均衡站", "甲的首选"]);
  assert.match(ui.route, /第 0 轮/);
  ui.click({ type: "reject_site", candidateId: "balanced" });
  assert.deepEqual(ui.names, ["甲的首选"]);
  ui.click({ type: "reject_site", candidateId: "favorite" });
  assert.equal(ui.state.status, "blocked");
  assert.deepEqual(ui.names, []);
  assert.match(ui.route, /route-empty/);
  assert.match(ui.summary, /0 站.*blocked/);
  ui.click({ type: "prioritize_member", memberId: "m1" });
  assert.deepEqual(ui.names, []);
  ui.click({ type: "undo" });
  ui.click({ type: "undo" });
  assert.deepEqual(ui.names, ["甲的首选"]);
  assert.deepEqual(Array.from(ui.state.rejectedIds), ["balanced"]);
});

for (const coordinates of [false, true]) {
  test(`member priority reaches the displayed route (${coordinates ? "with" : "without"} coordinates)`, async () => {
    const { result, request } = fixture({ time: "18:00-19:15", ...(coordinates ? { coordinates: { lat: 31.23, lng: 121.47 } } : {}) });
    if (coordinates) {
      result.suggestions[0].coordinates = { lat: 31.23, lng: 121.47 };
      result.suggestions[1].coordinates = { lat: 31.231, lng: 121.47 };
    }
    const ui = await mount(result, request);
    assert.deepEqual(ui.names, ["均衡站"]);
    ui.click({ type: "prioritize_member", memberId: "m1" });
    assert.equal(ui.state.selected[0].id, "favorite");
    assert.deepEqual(ui.names, ["甲的首选"]);
    assert.match(ui.route, /mock:fixture/);
  });
}

test("rejecting an early stop replans time and budget for the remaining stop", async () => {
  const { result, request } = fixture({ time: "18:00-19:00", budget: 20 });
  const ui = await mount(result, request);
  ui.click({ type: "reject_site", candidateId: "balanced" });
  assert.deepEqual(ui.names, ["甲的首选"]);
  assert.match(ui.route, /18:00/);
  assert.match(ui.summary, /1 站/);
});

test("shortening to zero stays empty until undo restores the previous route", async () => {
  const { result, request } = fixture();
  const ui = await mount(result, request);
  ui.click({ type: "shorten_route", count: "1" });
  assert.equal(ui.names.length, 1);
  ui.click({ type: "shorten_route", count: "1" });
  assert.deepEqual(ui.names, []);
  ui.click({ type: "undo" });
  assert.equal(ui.names.length, 1);
  assert.equal(ui.state.round, 1);
});

test("undo restores state and permits a new negotiation without changing original candidates", async () => {
  const { result, request } = fixture();
  const original = structuredClone(result);
  const ui = await mount(result, request);
  const initial = structuredClone(ui.state);
  ui.click({ type: "prioritize_member", memberId: "m1" });
  const prioritized = structuredClone(ui.state);
  ui.click({ type: "reject_site", candidateId: "favorite" });
  assert.match(ui.summary, /data-negotiate="undo"/);
  ui.click({ type: "undo" });
  assert.deepEqual(structuredClone(ui.state), prioritized);
  assert.deepEqual(ui.names, ["甲的首选", "均衡站"]);
  ui.click({ type: "undo" });
  assert.deepEqual(structuredClone(ui.state), initial);
  ui.click({ type: "undo" });
  assert.deepEqual(structuredClone(ui.state), initial);
  ui.click({ type: "reject_site", candidateId: "balanced" });
  assert.deepEqual(ui.names, ["甲的首选"]);
  assert.equal(ui.state.round, 1);
  ui.restart();
  assert.deepEqual(structuredClone(ui.state), initial);
  assert.deepEqual(ui.names, ["均衡站", "甲的首选"]);
  assert.deepEqual(result, original);
});

test("an infeasible route does not report candidate count or achieved as its route summary", async () => {
  const { result, request } = fixture({ budget: 0 });
  result.fairnessSummary = "2 站 · achieved";
  const ui = await mount(result, request);
  assert.deepEqual(ui.names, []);
  assert.match(ui.summary, /0 站.*blocked/);
});

test("member hard rejections remain excluded across undo and a fresh negotiation", async () => {
  const { result, request } = fixture();
  request.members[0].hardRejections = ["均衡站"];
  const original = structuredClone(result);
  const ui = await mount(result, request);
  assert.deepEqual(ui.names, ["甲的首选"]);
  ui.click({ type: "reject_site", candidateId: "favorite" });
  assert.deepEqual(ui.names, []);
  ui.click({ type: "undo" });
  assert.deepEqual(ui.names, ["甲的首选"]);
  ui.restart();
  assert.deepEqual(ui.names, ["甲的首选"]);
  assert.deepEqual(result, original);
});
