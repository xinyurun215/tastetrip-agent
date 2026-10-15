import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// Main, its client, renderers and pipeline are real. Only DOM and HTTP transport
// are replaced. All place facts and responses in this file are synthetic.
async function mount(result, request, transport = async () => response([])) {
  const url = new URL("../src/main.js", import.meta.url);
  const source = await readFile(url, "utf8");
  const imports = {};
  for (const match of source.matchAll(/^import \{([^}]+)\} from "([^"]+)";$/gm)) {
    const module = await import(new URL(match[2], url));
    for (const name of match[1].split(",").map(value => value.trim())) imports[name] = module[name];
  }
  imports.chooseLanguage("zh");
  const calls = [];
  const createClient = imports.createBrowserQlooClient;
  imports.createBrowserQlooClient = options => createClient({ ...options, fetchImpl: async (url, init) => {
    const call = { url, body: JSON.parse(init.body), signal: init.signal };
    calls.push(call);
    return transport(call);
  } });
  const nodes = new Map();
  const document = {
    documentElement: {}, querySelectorAll: () => [],
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, {
        innerHTML: "", outerHTML: "", listeners: {}, querySelectorAll: () => [],
        querySelector: child => document.querySelector(child),
        addEventListener(type, listener) { this.listeners[type] = listener; },
      });
      return nodes.get(selector);
    },
  };
  const form = document.querySelector("#members-workspace");
  form.querySelector = selector => ({ value: request.context[selector.match(/data-context="([^"]+)"/)?.[1]] || "" });
  form.querySelectorAll = selector => selector !== ".member-card" ? [] : request.members.map(member => ({
    querySelector: field => ({ value: member[field.match(/data-field="([^"]+)"/)?.[1]] || "" }),
    querySelectorAll: field => field === ".member-preference" ? member.preferences.map(value => ({ value })) : [],
  }));
  const context = vm.createContext({
    ...imports, document, URLSearchParams, AbortController, setTimeout, clearTimeout,
    window: { addEventListener() {}, setTimeout, matchMedia: () => ({ matches: true }) },
    location: { hash: "", search: "" }, result, request,
  });
  vm.runInContext(source.replace(/^import .*;\r?$/gm, ""), context, { filename: "src/main.js" });
  const render = () => vm.runInContext(`
    activeMembersResult = result; activeMembersRequest = request; shellStep = 'negotiation';
    membersNegotiationState = planMembersNegotiation(result, request).negotiation;
    refreshMembersViews();
  `, context);
  render();
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return {
    calls, flush, restart: render,
    async click(type, data = {}) {
      document.querySelector("#members-route-panel").listeners.click({
        target: { closest: selector => selector === "[data-review]" ? {
          dataset: { review: type, version: String(this.state.version), ...data },
        } : null },
      });
      await flush();
    },
    async back() {
      document.querySelector("#app-shell").listeners.click({
        target: { closest: selector => selector === "[data-shell-next]" ? { dataset: { shellNext: "qloo" } } : null },
      });
      await flush();
    },
    switchLanguage(value) {
      document.querySelector("#language-switch").listeners.change({ target: { value } });
    },
    example() { document.querySelector('#new-york-example').listeners.click(); },
    renderPair() {
      return vm.runInContext(`
        runPipeline({ ...DEMO_INPUT, context: request.context }, { resolvePair: async () => result })
          .then(outcome => renderBoard(planFrom(outcome), { ...DEMO_INPUT, context: request.context }));
      `, context);
    },
    get book() { return vm.runInContext("travelBooks.members", context); },
    get state() { return vm.runInContext("membersNegotiationState", context); },
    get draft() { return vm.runInContext("({ members: draftMembers, context: draftContext })", context); },
    get route() { return document.querySelector("#members-route").innerHTML; },
    get summary() { return document.querySelector("#members-result").innerHTML; },
    get names() { return [...this.route.matchAll(/<b>([^<]+)<\/b>/g)].map(match => match[1]); },
    get bookNames() { return Array.from(this.book.stops, stop => stop.name); },
  };
}

const place = (id, score = .8) => ({
  id, name: id, memberScores: { m1: score, m2: score }, cost: 20,
  durationMinutes: 30, travelMinutes: 5, openingHours: "17:00-23:00", sourceTag: "mock:fixture",
});
function fixture(count = 4, context = {}) {
  const members = [
    { id: "m1", name: "甲", preferences: ["电影", "爵士", "火锅"] },
    { id: "m2", name: "乙", preferences: ["展览", "摇滚", "烧烤"] },
  ];
  return {
    request: { members, context: { time: "18:00-22:00", budget: 100, ...context } },
    result: { source: "fallback", members, suggestions: ["A", "B", "C", "D"].slice(0, count).map((id, index) => place(id, .9 - index / 10)) },
  };
}
const response = suggestions => ({ ok: true, json: async () => ({ ok: true, insight: {
  source: "live", fromQloo: true, suggestions, members: [], requestLog: [],
} }) });
function deferred() {
  let resolve;
  return { promise: new Promise(done => { resolve = done; }), resolve: value => resolve(value) };
}

test("explicit fallback member sources remain mock labels in the rendered evidence", async () => {
  const { request, result } = fixture();
  result.members = result.members.map(member => ({ ...member, sourceTag: "mock:fixture" }));
  const ui = await mount(result, request);
  assert.match(ui.summary, /<h3>甲 <span class="tag">mock:fixture<\/span><\/h3>/);
  assert.match(ui.summary, /非真实 Qloo 结果/);
  assert.doesNotMatch(ui.summary, /qloo:entity/);
});

test("destination failure renders no itinerary or album entry", async () => {
  const { request, result } = fixture(0, { city: "Unknown" });
  Object.assign(result, { source: "unavailable", reason: "destination_unresolved", warning: "目的地无法唯一确认" });
  const ui = await mount(result, request);
  assert.deepEqual(ui.names, []);
  assert.match(ui.summary, /目的地无法验证/);
  assert.match(ui.route, /目的地无法验证/);
  assert.equal(ui.book.stops.length, 0);
  assert.doesNotMatch(ui.route, /data-book-open|mock:fixture/);
});

test("pair destination failure preserves unavailable source notes without claiming mock success", async () => {
  const { request, result } = fixture(0, { city: "Unknown" });
  Object.assign(result, { source: "unavailable", reason: "destination_unresolved", warning: "目的地无法唯一确认" });
  const ui = await mount(result, request);
  const board = await ui.renderPair();
  for (const className of ["mode-note", "fine"]) {
    const note = board.match(new RegExp(`<p class="${className}">([^<]*)</p>`))?.[1];
    assert.match(note, /目的地无法唯一确认/);
    assert.match(note, /无可用路线/);
    assert.doesNotMatch(note, /mock:fixture|备用数据|规则基线/);
  }
  assert.doesNotMatch(board, /class="stop"|data-book-open/);
});

test("confirm, reject, review and accept keep confirmed places until the current version is accepted", async () => {
  const { result, request } = fixture();
  const original = structuredClone(result);
  const ui = await mount(result, request);
  assert.deepEqual(ui.names, ["A", "B", "C"]);
  assert.deepEqual(Array.from(ui.state.confirmedIds), []);
  assert.match(ui.route, /当前操作者确认站点选择/);
  await ui.click("confirm");
  assert.deepEqual(Array.from(ui.state.confirmedIds), ["A", "B", "C"]);
  const oldVersion = ui.state.version;
  await ui.click("reject", { candidateId: "A" });
  assert.deepEqual(ui.names, ["B", "C"]);
  assert.deepEqual(Array.from(ui.state.confirmedIds), ["B", "C"]);
  assert.deepEqual(Array.from(ui.state.pending.selected, item => item.id), ["D", "B", "C"]);
  assert.match(ui.route, /待确认修改/);
  assert.match(ui.route, /受影响路段与下游时间/);
  assert.match(ui.route, /已有候选池，未额外查询/);
  assert.equal(ui.calls.length, 0);
  await ui.click("confirm", { version: String(oldVersion) });
  assert.deepEqual(ui.names, ["B", "C"], "stale confirmation must not adopt the pending route");
  await ui.click("confirm");
  assert.deepEqual(ui.names, ["D", "B", "C"]);
  assert.equal(ui.state.pending, null);
  assert.equal(ui.state.confirmedVersion, ui.state.version);
  assert.deepEqual(result, original);
});

test("cancel retains exclusion and undo restores the prior adopted selection", async () => {
  const { result, request } = fixture();
  const ui = await mount(result, request);
  await ui.click("confirm");
  await ui.click("reject", { candidateId: "A" });
  await ui.click("cancel");
  assert.deepEqual(ui.names, ["B", "C"]);
  assert.deepEqual(Array.from(ui.state.rejectedIds), ["A"]);
  assert.equal(ui.state.pending, null);
  assert.match(ui.route, /排除项仍保留/);
  const cancelledVersion = ui.state.version;
  await ui.click("undo");
  assert.deepEqual(ui.names, ["A", "B", "C"]);
  assert.deepEqual(Array.from(ui.state.rejectedIds), []);
  assert.ok(ui.state.version > cancelledVersion);
});

test("reserve exhaustion performs a recheck and renders returned evidence as a pending change", async () => {
  const { result, request } = fixture(3);
  const ui = await mount(result, request, async () => response([place("A"), place("D")]));
  await ui.click("confirm_site", { candidateId: "C" });
  await ui.click("reject", { candidateId: "A" });
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.calls[0].url, "/api/qloo");
  assert.equal(ui.calls[0].body.recheck, true);
  assert.deepEqual(ui.calls[0].body.rejectedIds, ["A"]);
  assert.deepEqual(ui.names, ["B", "C"]);
  assert.deepEqual(Array.from(ui.state.pending.selected, item => item.id), ["D", "B", "C"]);
  assert.deepEqual(Array.from(ui.state.confirmedIds), ["C"]);
  assert.match(ui.route, /补查来源：Qloo 实际响应/);
  await ui.click("confirm");
  assert.deepEqual(ui.names, ["D", "B", "C"]);
});

test("no alternatives stops the flow without resurrecting the rejected place or album entry", async () => {
  const { result, request } = fixture(1);
  const ui = await mount(result, request);
  await ui.click("reject", { candidateId: "A" });
  assert.equal(ui.state.phase, "blocked");
  assert.equal(ui.state.notice, "no_alternatives");
  assert.deepEqual(ui.names, []);
  assert.equal(ui.state.pending, null);
  assert.match(ui.route, /没有足够替代，已停止/);
  assert.equal(ui.book.stops.length, 0);
  assert.doesNotMatch(ui.route, /data-book-open/);
  await ui.click("confirm");
  assert.deepEqual(ui.names, []);
  await ui.click("undo");
  assert.deepEqual(ui.names, ["A"]);
});

test("a failed recheck keeps adopted places and displays the localized error", async () => {
  const { result, request } = fixture(3);
  const ui = await mount(result, request, async () => ({ ok: false, status: 504 }));
  await ui.click("reject", { candidateId: "A" });
  assert.equal(ui.state.phase, "blocked");
  assert.equal(ui.state.pending, null);
  assert.deepEqual(ui.names, ["B", "C"]);
  assert.match(ui.route, /Qloo 查询超时/);
  ui.switchLanguage("en");
  assert.match(ui.route, /Qloo timed out/);
  assert.equal(ui.calls.length, 1);
  ui.switchLanguage("zh");
});

test("hard rejections cannot return through supplemental evidence, undo or a fresh review", async () => {
  const { result, request } = fixture();
  request.members[0].hardRejections = ["A"];
  const original = structuredClone(result);
  const ui = await mount(result, request, async () => response([place("A", .99), place("B"), place("E")]));
  assert.deepEqual(ui.names, ["B", "C", "D"]);
  await ui.click("reject", { candidateId: "B" });
  assert.deepEqual(Array.from(ui.state.pending.selected, item => item.id), ["E", "C", "D"]);
  await ui.click("cancel");
  await ui.click("undo");
  assert.deepEqual(ui.names, ["B", "C", "D"]);
  ui.restart();
  assert.deepEqual(ui.names, ["B", "C", "D"]);
  assert.deepEqual(result, original);
});

test("rapid rejections ignore the earlier response and require confirmation of the latest version", async t => {
  const { result, request } = fixture(3);
  const first = deferred();
  const second = deferred();
  t.after(() => { first.resolve(response([])); second.resolve(response([])); });
  let requests = 0;
  const ui = await mount(result, request, () => requests++ ? second.promise : first.promise);
  await ui.click("confirm");
  await ui.click("reject", { candidateId: "A" });
  const staleVersion = ui.state.version;
  await ui.click("reject", { candidateId: "B" });
  assert.equal(ui.calls[0].signal.aborted, true);
  assert.deepEqual(ui.calls[1].body.rejectedIds, ["A", "B"]);
  first.resolve(response([place("OLD")]));
  await ui.flush();
  assert.equal(ui.state.phase, "checking");
  assert.deepEqual(ui.names, ["C"]);
  second.resolve(response([place("D"), place("E")]));
  await ui.flush();
  assert.deepEqual(Array.from(ui.state.pending.selected, item => item.id), ["D", "E", "C"]);
  await ui.click("confirm", { version: String(staleVersion) });
  assert.deepEqual(ui.names, ["C"]);
  await ui.click("confirm");
  assert.deepEqual(ui.names, ["D", "E", "C"]);
  assert.doesNotMatch(ui.route, /OLD/);
});

for (const action of ["cancel", "undo", "back"]) {
  test(`${action} invalidates a pending HTTP response without adopting its places`, async t => {
    const { result, request } = fixture(3);
    const pending = deferred();
    t.after(() => pending.resolve(response([])));
    const ui = await mount(result, request, () => pending.promise);
    await ui.click("reject", { candidateId: "A" });
    if (action === "back") await ui.back(); else await ui.click(action);
    assert.equal(ui.calls[0].signal.aborted, true);
    const version = ui.state.version;
    pending.resolve(response([place("LATE")]));
    await ui.flush();
    assert.equal(ui.state.version, version);
    assert.equal(ui.state.pending, null);
    assert.deepEqual(ui.names, action === "undo" ? ["A", "B", "C"] : ["B", "C"]);
    assert.deepEqual(Array.from(ui.state.rejectedIds), action === "undo" ? [] : ["A"]);
    assert.doesNotMatch(ui.route, /LATE/);
  });
}

test("album snapshots follow adopted choices and exclude pending replacements", async () => {
  const { result, request } = fixture();
  const ui = await mount(result, request);
  assert.deepEqual(ui.bookNames, ["A", "B", "C"]);
  await ui.click("confirm");
  await ui.click("reject", { candidateId: "A" });
  assert.deepEqual(ui.bookNames, ["B", "C"]);
  assert.equal(ui.book.stops[0].cost, "20");
  assert.equal(ui.book.demo, true);
  assert.deepEqual(Array.from(ui.state.pending.selected, item => item.id), ["D", "B", "C"]);
  await ui.click("confirm");
  assert.deepEqual(ui.bookNames, ["D", "B", "C"]);
  await ui.click("undo");
  assert.deepEqual(ui.bookNames, ["B", "C"]);
  assert.equal(ui.state.pending, null);
});

test("switching language preserves input, exclusions, confirmations and pending version without a query", async () => {
  const { result, request } = fixture(4, { city: "New York, US", start: "用户的起点" });
  const ui = await mount(result, request);
  await ui.click("confirm");
  await ui.click("reject", { candidateId: "A" });
  const before = structuredClone(ui.state);
  ui.switchLanguage("en");
  assert.match(ui.route, /Changes awaiting your confirmation/);
  assert.match(ui.route, /用户的起点/);
  assert.match(ui.summary, /Fallback data · not a live Qloo result/);
  assert.deepEqual(structuredClone(ui.state), before);
  assert.equal(ui.draft.context.city, "New York, US");
  assert.deepEqual(Array.from(ui.draft.members[0].preferences), ["电影", "爵士", "火锅"]);
  assert.equal(ui.calls.length, 0);
  ui.switchLanguage("zh");
  assert.match(ui.route, /待确认修改/);
  assert.deepEqual(structuredClone(ui.state), before);
});

test("known infeasibility renders an empty stopped route despite a candidate count summary", async () => {
  const { result, request } = fixture(4, { budget: 0 });
  result.fairnessSummary = "4 站 · achieved";
  const ui = await mount(result, request);
  assert.deepEqual(ui.names, []);
  assert.match(ui.route, /已停止/);
  assert.doesNotMatch(ui.route, /achieved|data-book-open/);
});

test('filling an example invalidates the old pending revision like returning to inputs', async () => {
  const {result,request}=fixture();
  const ui=await mount(result,request);
  await ui.click('confirm');await ui.click('reject',{candidateId:'A'});
  const oldVersion=ui.state.version;
  ui.example();
  assert.equal(ui.state.pending,null);
  assert.ok(ui.state.version>oldVersion);
  assert.deepEqual(Array.from(ui.state.rejectedIds),['A']);
});

test('new replacement evidence appears in the matrix and rejected place names survive adoption', async () => {
  const {result,request}=fixture(3);
  result.suggestions[0].name='Original restaurant name';
  const ui=await mount(result,request,()=>response([{...place('D'),name:'New evidence restaurant'}]));
  await ui.click('reject',{candidateId:'A'});
  assert.match(ui.summary,/New evidence restaurant/);
  await ui.click('confirm');
  assert.match(ui.route,/已排除：Original restaurant name/);
  assert.match(ui.summary,/New evidence restaurant/);
});
