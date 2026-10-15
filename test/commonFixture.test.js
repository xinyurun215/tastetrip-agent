import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommonFixture } from '../scripts/common-fixture.js';
import { handleQlooRequest } from '../server/handleQloo.js';
import { buildCommonComparison } from '../src/pipeline/commonCandidates.js';

// All records and transport responses in this file are invented local fixtures.
const input = {
  mode: 'common-search', context: { city: 'New York' }, members: [
    { id: 'a', name: 'Alex', preferences: [{ kind: 'movie', query: 'Dune' }, { kind: 'artist', query: 'Miles Davis' }, { kind: 'book', query: 'Beloved' }] },
    { id: 'b', name: 'Sam', preferences: [{ kind: 'movie', query: 'Amelie' }, { kind: 'artist', query: 'Radiohead' }, { kind: 'book', query: '' }] },
    { id: 'c', name: 'Robin', preferences: [{ kind: 'movie', query: 'Interstellar' }, { kind: 'artist', query: 'Nina Simone' }, { kind: 'book', query: 'The Little Prince' }] },
  ],
};

function harness() {
  const fixture = createCommonFixture();
  const calls = [];
  return {
    calls,
    request: (body, scenario = 'default') => handleQlooRequest(body, {
      env: { QLOO_API_KEY: 'synthetic-fixture-only' }, cache: new Map(), fetchImpl: fixture.transport({ scenario, calls }),
    }),
  };
}

function confirmed(search) {
  return { mode: 'common-compare', context: input.context, members: search.insight.members.map(member => ({
    id: member.id, name: member.name,
    // The test explicitly chooses the 1984 Dune result; production requires UI confirmation.
    entities: member.preferences.map(preference => ({ id: preference.matches[0].id, kind: preference.kind })),
  })) };
}

test('synthetic integration exercises typed search, fixed-pool rankings and evidence without network access', async t => {
  const originalFetch = globalThis.fetch;
  let realFetchAttempts = 0;
  globalThis.fetch = async () => { realFetchAttempts += 1; throw new Error('Real network fetch forbidden in the synthetic integration test'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const { request, calls } = harness();
  const search = await request(input);
  assert.equal(search.ok, true);
  const dune = search.insight.members[0].preferences[0].matches;
  assert.equal(dune.length, 2);
  assert.deepEqual(dune.map(item => item.year), [1984, 2021]);
  assert.ok(dune.every(item => item.types.includes('urn:entity:movie') && item.external.imdb[0].id));
  assert.ok(search.insight.members[0].preferences[1].matches[0].external.spotify[0].id);
  assert.equal(search.insight.members[0].preferences[2].matches[0].isbn13.length, 1);
  assert.equal(search.insight.members[1].preferences.length, 2, 'blank optional book does not cause a search');

  const result = await request(confirmed(search));
  assert.equal(result.ok, true);
  const fixedPoolCalls = calls.filter(call => call.path === '/v2/insights' && call.params['filter.results.entities']);
  const poolIds = result.insight.pool.map(item => item.id).join(',');
  assert.equal(fixedPoolCalls.length, 3);
  assert.ok(fixedPoolCalls.every(call => call.params['filter.results.entities'] === poolIds
    && call.params['filter.type'] === 'urn:entity:place' && call.params['feature.explainability'] === 'true'));
  assert.equal(new Set(fixedPoolCalls.map(call => call.params['signal.interests.entities'])).size, 3);

  const comparison = buildCommonComparison(result.insight);
  assert.equal(comparison.candidates.length, 9);
  assert.deepEqual(comparison.commonTop5Ids, []);
  assert.deepEqual(comparison.incompleteMemberIds, []);
  assert.deepEqual(comparison.candidates.find(item => item.id === 'A').aliasIds, ['A', 'A-alias']);
  assert.deepEqual(comparison.possibleDuplicates.map(item => item.candidateIds), [['G', 'H']]);
  assert.deepEqual(comparison.candidates.find(item => item.id === 'A').memberRanks, { a: 1, b: 7, c: 4 });
  const partialEvidence = comparison.candidates.find(item => item.id === 'E').memberEvidence.a;
  assert.equal(partialEvidence.contributions.length, 2);
  assert.equal(partialEvidence.missingSignalIds.length, 1);
  assert.equal(partialEvidence.explanationMissing, false);
  assert.equal(comparison.candidates.find(item => item.id === 'F').memberEvidence.a.explanationMissing, true);
  assert.ok(comparison.candidates.every(item => item.memberScores === undefined && item.groupScore === undefined));
  const repeat = buildCommonComparison((await request(confirmed(search))).insight);
  assert.deepEqual(repeat.candidates.map(item => item.memberRanks), comparison.candidates.map(item => item.memberRanks));
  assert.equal(realFetchAttempts, 0);
  assert.ok(calls.every(call => !JSON.stringify(call).includes('synthetic-fixture-only')));
});

test('synthetic entity lookup rejects a confirmed ID declared as the wrong cultural type', async () => {
  const { request, calls } = harness();
  const search = await request(input);
  const body = confirmed(search);
  body.members[0].entities[0].kind = 'book';
  const result = await request(body);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'entity_unverified');
  assert.equal(calls.filter(call => call.path === '/v2/insights').length, 0);
});

test('synthetic scenarios preserve partial coverage, empty discovery and service failure', async () => {
  const { request } = harness();
  const body = confirmed(await request(input));
  const partial = buildCommonComparison((await request(body, 'partial')).insight);
  assert.deepEqual(partial.incompleteMemberIds, ['b', 'c']);
  assert.equal(partial.coverage.a.returnedCount, 9);
  assert.equal(partial.coverage.b.returnedCount, 6);
  assert.equal(partial.coverage.c.returnedCount, 6);
  assert.deepEqual(partial.commonTop5Ids, []);

  const empty = await request(body, 'empty');
  assert.equal(empty.ok, true);
  assert.equal(empty.reason, 'no_candidates');
  assert.deepEqual(empty.insight.pool, []);
  assert.ok(empty.insight.rankings.every(item => item.reason === 'no_candidates' && item.entities.length === 0));
  const failed = await request(body, 'error');
  assert.equal(failed.ok, false);
  assert.equal(failed.insight.source, 'unavailable');
  assert.deepEqual(failed.insight.pool, []);
  assert.deepEqual(failed.insight.rankings, []);
});

test('synthetic recheck expands discovery while excluding a rejected place and its verified alias', async () => {
  const { request, calls } = harness();
  const body = confirmed(await request(input));
  const initial = await request(body, 'recheck');
  assert.equal(initial.ok, true);
  assert.deepEqual(initial.insight.pool.map(item => item.id), ['A', 'B', 'C']);

  const callOffset = calls.length;
  const fresh = await request({ ...body, rejectedIds: ['A'] }, 'recheck');
  assert.equal(fresh.ok, true);
  const freshIds = 'BCDEFGHI'.split('');
  assert.deepEqual(fresh.insight.pool.map(item => item.id), freshIds);
  const requestCalls = calls.slice(callOffset);
  const discovery = requestCalls.find(call => call.path === '/v2/insights' && !call.params['filter.results.entities']);
  assert.equal(discovery.params['filter.exclude.entities'], 'A');
  const rankings = requestCalls.filter(call => call.params['filter.results.entities']);
  assert.equal(rankings.length, 3);
  assert.ok(rankings.every(call => call.params['filter.results.entities'] === freshIds.join(',')));
  const comparison = buildCommonComparison(fresh.insight);
  assert.deepEqual(comparison.candidates.map(item => item.id), freshIds);
  assert.ok(comparison.candidates.every(item => !item.aliasIds.includes('A') && !item.aliasIds.includes('A-alias')));
  assert.deepEqual(comparison.incompleteMemberIds, []);
});
