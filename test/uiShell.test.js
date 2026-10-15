import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function mount(storage = { choice: "zh" }, browserLanguage = "en-US") {
  const url = new URL("../src/main.js", import.meta.url);
  const source = await readFile(url, "utf8");
  const imports = {};
  for (const match of source.matchAll(/^import \{([^}]+)\} from "([^"]+)";$/gm)) {
    const module = await import(new URL(match[2], url));
    for (const name of match[1].split(",").map(value => value.trim())) imports[name] = module[name];
  }
  const choose = imports.chooseLanguage;
  choose(storage.choice || "zh");
  // Persistence is a boundary double. Translation and gate/shell rendering are real.
  imports.hasLanguageChoice = () => storage.choice != null;
  imports.chooseLanguage = value => { storage.choice = value; return choose(value); };
  let queries = 0;
  const client = imports.createBrowserQlooClient;
  imports.createBrowserQlooClient = options => client({ ...options, fetchImpl: async () => { queries += 1; throw new Error("Unexpected network"); } });
  const nodes = new Map();
  const document = {
    documentElement: {}, querySelectorAll: () => [],
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, {
        innerHTML: "", listeners: {}, querySelectorAll: () => [], querySelector: () => null,
        addEventListener(type, listener) { this.listeners[type] = listener; },
      });
      return nodes.get(selector);
    },
  };
  const context = vm.createContext({
    ...imports, document, URLSearchParams, AbortController, setTimeout, clearTimeout,
    navigator: { language: browserLanguage },
    window: { addEventListener() {}, setTimeout, matchMedia: () => ({ matches: true }) },
    location: { hash: "", search: "" },
  });
  vm.runInContext(source.replace(/^import .*;\r?$/gm, ""), context, { filename: "src/main.js" });
  return {
    choose(value) {
      document.querySelector("#language-choice").listeners.submit({
        preventDefault() {}, currentTarget: { querySelector: () => ({ value }) },
      });
    },
    get html() { return document.querySelector("#app").innerHTML; },
    get queries() { return queries; },
    get lang() { return document.documentElement.lang; },
  };
}

test("the rendered home exposes three workflow panels and actionable member inputs", async () => {
  const ui = await mount();
  for (const step of ["members", "qloo", "negotiation"]) {
    assert.match(ui.html, new RegExp(`data-shell-panel="${step}"`));
    assert.match(ui.html, new RegExp(`data-shell-nav="${step}"`));
  }
  assert.match(ui.html, /<form[^>]+id="members-workspace"/);
  assert.match(ui.html, /<input[^>]+data-context="city"/);
  assert.match(ui.html, /查询 Qloo 候选/);
  assert.match(ui.html, /id="members-result"/);
  assert.match(ui.html, /id="members-route"/);
  assert.match(ui.html, /id="language-switch"/);
  assert.equal(ui.queries, 0);
});

for (const language of ["zh", "en"]) {
  test(`first visit requires an explicit ${language} choice and refresh reuses it`, async () => {
    const storage = { choice: null };
    const ui = await mount(storage, language === "zh" ? "en-US" : "zh-CN");
    assert.match(ui.html, /选择语言 \/ Choose your language/);
    assert.doesNotMatch(ui.html, /id="members-workspace"/);
    assert.match(ui.html, language === "zh" ? /value="en" checked/ : /value="zh" checked/);
    assert.equal(storage.choice, null, "browser preference does not choose on the user's behalf");
    ui.choose(language);
    assert.equal(storage.choice, language);
    assert.match(ui.html, language === "en" ? /Find Qloo candidates/ : /查询 Qloo 候选/);
    assert.equal(ui.lang, language === "en" ? "en" : "zh-CN");
    assert.equal(ui.queries, 0);
    const refreshed = await mount(storage, language === "en" ? "zh-CN" : "en-US");
    assert.doesNotMatch(refreshed.html, /选择语言 \/ Choose your language/);
    assert.match(refreshed.html, language === "en" ? /Find Qloo candidates/ : /查询 Qloo 候选/);
    assert.equal(refreshed.queries, 0);
  });
}
