import assert from "node:assert/strict";
import test from "node:test";
import { handleQlooRequest } from "../server/handleQloo.js";
import { createBrowserQlooClient } from "../src/qloo/browserClient.js";
import { parseTastes } from "../src/pipeline/parse.js";

// Entirely synthetic transport fixtures; no recorded Qloo payloads or credentials.
const pair = {
  context: { city: "New York City", coordinates: { lat: 40.7484, lng: -73.9857, radiusM: 12000 } },
  a: ["Film A", "Artist A", "Food A"], b: ["Film B", "Artist B", "Food B"],
};
const members = {
  context: pair.context, mode: "members-harness",
  members: ["a", "b", "c"].map((id) => ({ id, preferences: [`Film ${id}`, `Artist ${id}`, `Food ${id}`] })),
};
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const venue = (id, lat = 40.74) => ({ entity_id: id, name: `${id} Restaurant`, type: "urn:entity:place",
  tags: [{ name: "Restaurant" }], location: { lat, lon: -73.99 }, query: { affinity: 0.7 } });
const live = (ids) => ({ source: "live", fromQloo: true, suggestions: ids.map((id) => ({ id, sourceTag: "qloo:entity" })) });

function syntheticQloo(calls, places = [venue("old"), venue("keep"), venue("other"), venue("fourth"), venue("new"), venue("outside", 10)]) {
  return async (url) => {
    const parsed = new URL(url);
    calls.push(parsed);
    if (parsed.pathname === "/v2/tags") {
      const music = /music|jazz|night/.test(parsed.searchParams.get("filter.query"));
      return response({ results: { tags: [{ id: `urn:tag:category:place:${music ? "jazz_club" : "restaurant"}`, name: music ? "Jazz Club" : "Restaurant" }] } });
    }
    if (parsed.pathname === "/search") {
      const name = parsed.searchParams.get("query");
      return response({ results: [{ entity_id: `taste:${name}`, name, type: "urn:entity:artist" }] });
    }
    if (parsed.pathname === "/v2/insights") return response({ results: { entities: places.slice(0, Number(parsed.searchParams.get("take"))) } });
    throw new Error("Unexpected synthetic URL");
  };
}

for (const [label, input] of [["pair", pair], ["members", members]]) {
  test(`${label} feedback performs wider discovery, excludes rejected places before selection, and keeps geography`, async () => {
    const calls = [];
    const options = { env: { QLOO_API_KEY: "synthetic-key" }, cache: new Map(), fetchImpl: syntheticQloo(calls) };
    const first = await handleQlooRequest(input, options);
    assert.equal(first.insight.source, "live");
    assert.ok(first.insight.suggestions.some((place) => place.id === "old"));
    const initialCalls = calls.length;
    assert.ok(calls.filter((url) => url.searchParams.has("filter.tags")).every((url) => !url.searchParams.has("filter.exclude.entities")));
    const revised = await handleQlooRequest({ ...input, rejectedIds: ["old", " old ", "already-rejected"] }, options);
    assert.equal(revised.insight.source, "live");
    assert.ok(revised.insight.suggestions.every((place) => place.id !== "old" && place.id !== "outside"));
    assert.ok(revised.insight.suggestions.some((place) => place.id === "new"));
    const discoveries = calls.slice(initialCalls).filter((url) => url.searchParams.has("filter.tags"));
    assert.ok(discoveries.length >= 2, "feedback must issue a distinct discovery request");
    assert.ok(discoveries.every((url) => Number(url.searchParams.get("take")) > 8));
    assert.ok(discoveries.every((url) => url.searchParams.get("filter.exclude.entities") === "already-rejected,old"));
    assert.ok(discoveries.every((url) => url.searchParams.get("page") === "1" && !url.searchParams.has("offset")));
    assert.ok(discoveries.every((url) => url.searchParams.get("filter.location") === "POINT(-73.9857 40.7484)"));
    if (label === "members") {
      assert.ok(revised.insight.members.every((member) => member.suggestions.every((place) => place.id !== "old")));
      const logged = revised.insight.requestLog.filter((entry) => entry.source === "qloo" && entry.status === "ok" && new URL(entry.url).searchParams.has("filter.tags"));
      assert.deepEqual(logged.map((entry) => entry.url), discoveries.map(String));
      assert.equal(JSON.stringify(revised).includes("synthetic-key"), false);
    }
  });

  test(`${label} bounds discovery to one page and sends the complete allowed exclusion list`, async () => {
    const calls = [];
    const rejectedIds = Array.from({ length: 100 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`);
    const result = await handleQlooRequest({ ...input, rejectedIds, page: 100, take: 500, offset: 1000 }, {
      env: { QLOO_API_KEY: "synthetic-key" }, cache: new Map(), fetchImpl: syntheticQloo(calls),
    });
    assert.equal(result.ok, true);
    const discoveries = calls.filter((url) => url.searchParams.has("filter.tags"));
    assert.equal(discoveries.length, label === "pair" ? 2 : 6);
    for (const url of discoveries) {
      assert.equal(url.searchParams.get("filter.exclude.entities"), rejectedIds.join(","));
      assert.equal(url.searchParams.get("take"), "50");
      assert.equal(url.searchParams.get("page"), "1");
      assert.equal(url.searchParams.has("offset"), false);
    }
  });

  test(`${label} empty recheck omits exclusions and uses a fresh bounded discovery`, async () => {
    const calls = [];
    const options = { env: { QLOO_API_KEY: "synthetic-key" }, cache: new Map(), fetchImpl: syntheticQloo(calls) };
    await handleQlooRequest(input, options);
    const count = calls.length;
    await handleQlooRequest({ ...input, recheck: true, rejectedIds: [] }, options);
    const discoveries = calls.slice(count).filter((url) => url.searchParams.has("filter.tags"));
    assert.ok(discoveries.length >= 2);
    assert.ok(discoveries.every((url) => !url.searchParams.has("filter.exclude.entities") && url.searchParams.get("take") === "16"));
  });

  test(`${label} feedback has no mock fallback when credentials are missing or the service fails`, async () => {
    for (const env of [{}, { QLOO_API_KEY: "synthetic-key" }]) {
      const result = await handleQlooRequest({ ...input, rejectedIds: ["old"] }, { env, cache: new Map(), fetchImpl: async () => { throw new Error("synthetic outage"); } });
      assert.equal(result.ok, false);
      assert.equal(result.insight.source, "unavailable");
      assert.deepEqual(result.insight.suggestions, []);
      assert.equal(JSON.stringify(result).includes("mock:"), false);
    }
  });

  test(`${label} feedback reports no alternatives if all geographically verified places are rejected`, async () => {
    const result = await handleQlooRequest({ ...input, rejectedIds: ["old"] }, {
      env: { QLOO_API_KEY: "synthetic-key" }, cache: new Map(), fetchImpl: syntheticQloo([], [venue("old"), venue("outside", 10)]),
    });
    assert.equal(result.ok, false);
    assert.equal(result.insight.source, "unavailable");
    assert.deepEqual(result.insight.suggestions, []);
  });
}

for (const method of ["resolvePair", "resolveMembers"]) {
  const parsed = method === "resolvePair" ? parseTastes(pair) : members;
  test(`${method} sends feedback and isolates its cache from the initial response`, async () => {
    const posted = [];
    const client = createBrowserQlooClient({ fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      posted.push(body);
      return response({ ok: true, insight: live(body.recheck ? ["new"] : ["old"]) });
    } });
    await client[method](parsed);
    const result = await client[method](parsed, { rejectedIds: ["old"] });
    assert.deepEqual(result.suggestions.map((place) => place.id), ["new"]);
    assert.equal(posted.length, 2);
    assert.deepEqual(posted[1].rejectedIds, ["old"]);
    assert.equal(posted[1].recheck, true);
    const cached = await client[method](parsed, { rejectedIds: ["old", "old"] });
    assert.equal(posted.length, 2);
    assert.equal(cached.cached, true);
  });

  test(`${method} stops feedback for unavailable, empty, fallback and rejected-only responses without caching failure`, async () => {
    for (const outcome of [
      () => { throw new Error("synthetic network failure"); },
      () => response({}, 429),
      () => response({ ok: false, reason: "down", insight: { source: "fallback", suggestions: [{ id: "mock:1" }] } }),
      () => response({ ok: true, insight: live([]) }),
      () => response({ ok: true, insight: live(["old"]) }),
    ]) {
      let count = 0;
      const client = createBrowserQlooClient({ fetchImpl: () => { count += 1; return outcome(); } });
      const result = await client[method](parsed, { rejectedIds: ["old"] });
      assert.equal(result.source, "unavailable");
      assert.deepEqual(result.suggestions, []);
      assert.equal(JSON.stringify(result).includes("mock:"), false);
      await client[method](parsed, { rejectedIds: ["old"] });
      assert.equal(count, 2);
    }
  });

  test(`${method} honors cancellation even if the transport resolves after abort`, async () => {
    const controller = new AbortController();
    let finish;
    const client = createBrowserQlooClient({ fetchImpl: () => new Promise((resolve) => { finish = resolve; }) });
    const pending = client[method](parsed, { rejectedIds: ["old"], signal: controller.signal });
    controller.abort();
    finish(response({ ok: true, insight: live(["new"]) }));
    await assert.rejects(pending, { name: "AbortError" });
  });

  test(`${method} feedback preview never supplies demonstration replacements`, async () => {
    const client = createBrowserQlooClient({ preview: () => "offline", fetchImpl: () => { throw new Error("must not fetch"); } });
    const result = await client[method](parsed, { rejectedIds: ["old"] });
    assert.equal(result.source, "unavailable");
    assert.deepEqual(result.suggestions, []);
  });
}

test("an explicit two-member request retains member-specific evidence on initial and feedback queries", async () => {
  const input = { ...members, members: members.members.slice(0, 2) };
  const options = { env: { QLOO_API_KEY: "synthetic-key" }, cache: new Map(), fetchImpl: syntheticQloo([]) };
  for (const rejectedIds of [[], ["old"]]) {
    const result = await handleQlooRequest({ ...input, rejectedIds }, options);
    assert.deepEqual(result.insight.members?.map((member) => member.id), ["a", "b"]);
    assert.ok(result.insight.suggestions.every((place) => Object.keys(place.memberScores || {}).length === 2));
  }
});

test("different rejection sets do not reuse member discovery HTTP cache even with the same count", async () => {
  const calls = [];
  const options = { env: { QLOO_API_KEY: "synthetic-key" }, cache: new Map(), fetchImpl: syntheticQloo(calls) };
  await handleQlooRequest({ ...members, rejectedIds: ["old"] }, options);
  const count = calls.length;
  const revised = await handleQlooRequest({ ...members, rejectedIds: ["new"] }, options);
  assert.ok(calls.slice(count).some((url) => url.searchParams.has("filter.tags")));
  assert.ok(calls.slice(count).filter((url) => url.searchParams.has("filter.tags")).every((url) => url.searchParams.get("filter.exclude.entities") === "new"));
  assert.ok(revised.insight.suggestions.every((place) => place.id !== "new"));
});

test("malformed or excessive rejection IDs stop before upstream calls without truncation", async () => {
  const cases = ["old", [1], [" "], ["old,new"], ["old\nnew"], ["old\u0000new"], ["old%2Cnew"], ["x".repeat(129)],
    Array.from({ length: 101 }, (_, i) => `id-${i}`), Array.from({ length: 40 }, (_, i) => `${i}-` + "x".repeat(110))];
  for (const input of [pair, members]) for (const rejectedIds of cases) {
    const calls = [];
    const result = await handleQlooRequest({ ...input, rejectedIds }, { env: { QLOO_API_KEY: "synthetic-key" }, cache: new Map(), fetchImpl: syntheticQloo(calls) });
    assert.equal(result.reason, "bad_input");
    assert.equal(result.insight, null);
    assert.equal(calls.length, 0);
  }
});

test("normalized rejection sets reuse cached requests and preserve the maximum single ID length", async () => {
  const calls = [];
  const options = { env: { QLOO_API_KEY: "synthetic-key" }, cache: new Map(), fetchImpl: syntheticQloo(calls) };
  const longId = "x".repeat(128);
  const first = await handleQlooRequest({ ...members, rejectedIds: [longId, "old"] }, options);
  assert.equal(first.ok, true);
  const count = calls.length;
  const same = await handleQlooRequest({ ...members, rejectedIds: [" old ", longId, "old"] }, options);
  assert.equal(same.ok, true);
  assert.equal(calls.length, count);
  assert.ok(calls.filter((url) => url.searchParams.has("filter.tags")).every((url) => url.searchParams.get("filter.exclude.entities") === `old,${longId}`));
});

test("member feedback rate-limit preview never contacts Qloo", async () => {
  let calls = 0;
  const result = await handleQlooRequest({ ...members, rejectedIds: ["old"], preview: "rate_limit" }, {
    env: { QLOO_API_KEY: "synthetic-key" }, cache: new Map(), fetchImpl: async () => { calls += 1; throw new Error("must not fetch"); },
  });
  assert.equal(calls, 0);
  assert.equal(result.reason, "rate_limit");
  assert.equal(result.insight.source, "unavailable");
});

test("feedback reports timeout without a mock replacement", async () => {
  const result = await handleQlooRequest({ ...members, rejectedIds: ["old"] }, {
    env: { QLOO_API_KEY: "synthetic-key", QLOO_TIMEOUT_MS: "5" }, cache: new Map(),
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("synthetic timeout", "AbortError")), { once: true });
    }),
  });
  assert.equal(result.reason, "timeout");
  assert.equal(result.insight.source, "unavailable");
  assert.deepEqual(result.insight.suggestions, []);
});

test("initial members cancellation aborts the transport and rejects without a fallback result", async () => {
  const controller = new AbortController();
  let transportSignal;
  const client = createBrowserQlooClient({ fetchImpl: (_url, { signal }) => {
    transportSignal = signal;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true }));
  } });
  const pending = client.resolveMembers(members, { signal: controller.signal });
  controller.abort();
  assert.equal(transportSignal.aborted, true);
  await assert.rejects(pending, { name: "AbortError" });
});

test("initial members late response after cancellation is rejected and not cached", async () => {
  const controller = new AbortController();
  let finish;
  let calls = 0;
  const client = createBrowserQlooClient({ fetchImpl: () => {
    calls += 1;
    return calls === 1 ? new Promise((resolve) => { finish = resolve; }) : response({ ok: true, insight: live(["fresh"]) });
  } });
  const pending = client.resolveMembers(members, { signal: controller.signal });
  controller.abort();
  finish(response({ ok: true, insight: live(["cancelled"]) }));
  await assert.rejects(pending, { name: "AbortError" });
  const next = await client.resolveMembers(members);
  assert.equal(calls, 2);
  assert.deepEqual(next.suggestions.map((place) => place.id), ["fresh"]);
});

test("an already cancelled initial members request cannot read cached results or start transport", async () => {
  let calls = 0;
  const client = createBrowserQlooClient({ fetchImpl: () => { calls += 1; return response({ ok: true, insight: live(["fresh"]) }); } });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.resolveMembers(members, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls, 0);
  await client.resolveMembers(members);
  await assert.rejects(client.resolveMembers(members, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("initial members failures and empty results remain retryable while successful evidence is cached", async () => {
  for (const outcome of [
    () => { throw new Error("synthetic outage"); },
    () => response({ ok: false, reason: "down", insight: { source: "fallback", fromQloo: false, suggestions: [] } }),
    () => response({ ok: false, reason: "destination_unresolved", insight: { source: "unavailable", suggestions: [] } }),
    () => response({ ok: true, reason: "no_verified_places", insight: live([]) }),
    () => response({ ok: false, reason: "down", insight: live(["must-not-use"]) }),
  ]) {
    let calls = 0;
    const client = createBrowserQlooClient({ fetchImpl: () => { calls += 1; return calls === 1 ? outcome() : response({ ok: true, insight: live(["fresh"]) }); } });
    const first = await client.resolveMembers(members);
    assert.equal(first.suggestions.some((place) => place.id === "must-not-use"), false);
    const second = await client.resolveMembers(members);
    assert.equal(calls, 2);
    assert.equal(second.cached, false);
    assert.deepEqual(second.suggestions.map((place) => place.id), ["fresh"]);
    assert.equal((await client.resolveMembers(members)).cached, true);
    assert.equal(calls, 2);
  }
});

test("initial members HTTP failures map status without trusting or parsing an error body", async () => {
  for (const [status, reason] of [[429, "rate_limit"], [504, "timeout"], [503, "down"]]) {
    let calls = 0;
    const client = createBrowserQlooClient({ fetchImpl: () => {
      calls += 1;
      return { ok: false, status, json: async () => { throw new Error("HTML proxy failure"); } };
    } });
    const first = await client.resolveMembers(members);
    assert.equal(first.reason, reason);
    assert.deepEqual(first.suggestions, []);
    await client.resolveMembers(members);
    assert.equal(calls, 2);
  }
});
