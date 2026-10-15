import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommonComparison } from '../src/pipeline/commonCandidates.js';
import * as review from '../src/pipeline/negotiation.js';

// Explicitly synthetic fixtures; none of these names, IDs or values are Qloo records.
const members = [{ id: 'a', name: 'A', entities: [{ id: 'film-a', name: 'Synthetic Film' }, { id: 'book-a', name: 'Synthetic Book' }] },
  { id: 'b', name: 'B', entities: [{ id: 'music-b', name: 'Synthetic Music' }] }];
const place = (id, extra = {}) => ({ id, name: `Synthetic ${id}`, sourceTag: 'mock:fixture', ...extra });
const evidence = (id, signal = 'film-a', affinity = .5) => ({ id, query: { affinity, explainability: { 'signal.interests.entities': [{ entity_id: signal, score: .3 }] } } });
const compare = (pool = ['P','Q','R'].map(id => place(id)), rankings = [
  { memberId: 'a', entities: ['P','Q','R'].map(id => evidence(id)) },
  { memberId: 'b', entities: ['R','Q','P'].map(id => evidence(id, 'music-b')) },
], extra = {}) => buildCommonComparison({ members, pool, rankings, source: 'mock:fixture', ...extra });

test('same-pool order supplies ranks without adding normalized affinities', () => {
  const result = compare();
  assert.deepEqual(result.candidates.find(item => item.id === 'P').memberRanks, { a: 1, b: 3 });
  assert.deepEqual(result.candidates.find(item => item.id === 'R').memberRanks, { a: 3, b: 1 });
  assert.deepEqual(result.commonTop5Ids, ['P','Q','R']);
  assert.equal(result.coverage.a.returnedCount, 3);
  assert.equal(result.coverage.a.poolCount, 3);
  assert.deepEqual(result.incompleteMemberIds, []);
  assert.ok(result.candidates.every(item => item.groupScore === undefined && item.memberScores === undefined));
});

test('preserves actual contributions and explicitly identifies missing explanation signals', () => {
  const result = compare([place('P'), place('Q')], [
    { memberId: 'a', entities: [evidence('P'), { id: 'Q', query: { affinity: .7 } }] },
    { memberId: 'b', entities: [evidence('P', 'music-b'), evidence('Q', 'music-b')] },
  ]);
  const first = result.candidates[0].memberEvidence.a;
  assert.deepEqual(first.contributions, [{ entityId: 'film-a', name: 'Synthetic Film', score: .3 }]);
  assert.deepEqual(first.missingSignalIds, ['book-a']);
  assert.equal(first.explanationMissing, false);
  assert.equal(result.candidates[1].memberEvidence.a.explanationMissing, true);
  assert.deepEqual(result.candidates[1].memberEvidence.a.contributions, []);
});

test('malformed or unexpected contributions do not establish an explanation; query warnings survive', () => {
  const result = compare([place('P')], [{ memberId: 'a', warnings: ['Synthetic response warning'], queryWarning: 'Synthetic query warning',
    entities: [{ id: 'P', query: { affinity: .6, explainability: { 'signal.interests.entities': [
      { entity_id: 'film-a', score: null }, { entity_id: 'book-a', score: Infinity }, { entity_id: 'not-an-input', score: .8 },
    ] } } }] }, { memberId: 'b', entities: [evidence('P','music-b')] }]);
  const item = result.candidates[0].memberEvidence.a;
  assert.equal(item.explanationMissing, true);
  assert.deepEqual(item.contributions, []);
  assert.deepEqual(item.missingSignalIds, ['film-a','book-a']);
  assert.equal(item.queryWarning, 'Synthetic query warning');
  assert.deepEqual(result.coverage.a.warnings, ['Synthetic response warning']);
});

test('out-of-range explainability scores do not count as valid normalized contributions', () => {
  const result = compare([place('P')], [{ memberId: 'a', entities: [{ id:'P', query: { explainability: {
    'signal.interests.entities': [{ entity_id:'film-a',score:-.1 },{ entity_id:'book-a',score:1.1 }],
  } } }] }]);
  assert.equal(result.candidates[0].memberEvidence.a.explanationMissing, true);
  assert.deepEqual(result.candidates[0].memberEvidence.a.missingSignalIds, ['film-a','book-a']);
});

test('special member IDs retain independent ranks instead of changing map prototypes', () => {
  const pool = Array.from({length:10},(_,index) => place(`P${index}`));
  const result = compare(pool, [{ memberId:'a',entities:pool.map(item=>evidence(item.id)) },
    { memberId:'__proto__',entities:[...pool].reverse().map(item=>evidence(item.id,'music-b')) }],
  { members: [members[0],{...members[1],id:'__proto__'}] });
  assert.deepEqual(result.commonTop5Ids, []);
  assert.equal(Object.hasOwn(result.coverage,'__proto__'), true);
  assert.equal(result.candidates[0].memberRanks.__proto__, 10);
  assert.equal(result.candidates[0].memberEvidence.__proto__.rank, 10);
});

test('deduplicates stable and verified provider identifiers but leaves same-name branches separate', () => {
  const pool = [place('P', { properties: { external: { google_places: [{ id: 'synthetic-store-1' }] } } }),
    place('P'), place('P-alias', { external: { google_places: [{ id: 'synthetic-store-1' }] } }),
    place('Q', { name: 'Synthetic Twin', address: '1 Road' }), place('R', { name: 'Synthetic Twin', address: '2 Road' })];
  const result = compare(pool, [
    { memberId: 'a', entities: [evidence('outside'), evidence('P-alias'), evidence('P'), evidence('R'), evidence('Q')] },
    { memberId: 'b', entities: [evidence('Q', 'music-b'), evidence('P', 'music-b'), evidence('R', 'music-b')] },
  ]);
  assert.deepEqual(result.candidates.map(item => item.id), ['P','Q','R']);
  assert.deepEqual(result.candidates[0].aliasIds, ['P','P-alias']);
  assert.deepEqual(result.candidates[0].memberRanks, { a: 1, b: 2 });
  assert.deepEqual(result.possibleDuplicates.map(item => item.candidateIds), [['Q','R']]);
  assert.equal(result.coverage.a.returnedCount, 3);
});

test('missing members and empty signals stay unranked, and cannot establish a shared top five', () => {
  const result = compare([place('P'), place('Q')], [{ memberId: 'a', entities: [evidence('P')] }],
    { members: [...members, { id: 'c', name: 'C', entities: [] }] });
  assert.deepEqual(result.incompleteMemberIds, ['a','b']);
  assert.deepEqual(result.unrankedMemberIds, ['c']);
  assert.deepEqual(result.commonTop5Ids, []);
  assert.equal(result.candidates[0].memberRanks.c, null);
  assert.equal(result.coverage.b.returnedCount, 0);
  assert.deepEqual(compare([], []).candidates, []);
});

test('disjoint top fives are a real tradeoff, not an invented common winner', () => {
  const pool = Array.from({ length: 10 }, (_, i) => place(`P${i}`));
  const result = compare(pool, [{ memberId: 'a', entities: pool.map(item => evidence(item.id)) },
    { memberId: 'b', entities: [...pool].reverse().map(item => evidence(item.id, 'music-b')) }]);
  assert.deepEqual(result.commonTop5Ids, []);
  assert.equal(result.candidates.length, 10);
});

const ranked = (id, a, b, extra = {}) => place(id, { memberRanks: { a, b }, memberEvidence: { a: { rank: a }, b: { rank: b } }, ...extra });
const rankedStart = () => review.startReview({ members, candidates: [ranked('P',1,5), ranked('Q',2,2), ranked('R',3,1), ranked('S',4,4)], maxStops: 2 });

test('review ranking uses rank coverage and disagreement, never hidden affinity scores', () => {
  const state = rankedStart();
  assert.equal(state.comparisonMode, true);
  assert.deepEqual(state.selected.map(item => item.id), ['Q','R']);
  assert.deepEqual(state.confirmedIds, []);
  assert.equal(state.selected[0].memberRanks.a, 2);
});

test('explicit candidate selection proposes replacing only an unconfirmed stop and invalidates changed legs', () => {
  let state = rankedStart();
  state = review.confirmReview(state, state.version, 'Q');
  const version = state.version;
  state = review.selectReviewCandidate(state, 'S', version);
  assert.deepEqual(state.selected.map(item => item.id), ['Q','R']);
  assert.deepEqual(state.pending.selected.map(item => item.id), ['Q','S']);
  assert.deepEqual(state.pending.diff.removed, ['R']);
  assert.deepEqual(state.pending.diff.added, ['S']);
  assert.deepEqual(state.pending.diff.retained, ['Q']);
  assert.deepEqual(state.pending.route.stops[1].memberRanks, { a: 4, b: 4 });
  assert.equal(state.pending.route.stops[1].status, 'needs_verification');
  assert.ok(state.version > version, 'selection must invalidate an older async recheck');
  assert.equal(review.selectReviewCandidate(state, 'P', version), state);
  const confirmed = review.confirmReview(state, state.version);
  assert.deepEqual(confirmed.selected.map(item => item.id), ['Q','S']);
  assert.deepEqual(review.undoReview(confirmed).selected.map(item => item.id), ['Q','R']);
});

test('selection respects confirmed stops, prior vetoes, cancellation and stale results', () => {
  let state = review.confirmReview(rankedStart(), 1);
  const blocked = review.selectReviewCandidate(state, 'S', state.version);
  assert.equal(blocked.notice, 'confirmed_conflict');
  assert.equal(blocked.pending, null);
  state = review.rejectReview(state, 'R', state.version);
  assert.equal(review.selectReviewCandidate(state, 'R', state.version), state);
  state = review.selectReviewCandidate(state, 'S', state.version);
  assert.deepEqual(state.pending.selected.map(item => item.id), ['Q','S']);
  const pendingVersion = state.version;
  state = review.cancelReview(state);
  assert.equal(state.pending, null);
  assert.deepEqual(state.selected.map(item => item.id), ['Q']);
  assert.equal(review.proposeReview(state, pendingVersion, [ranked('T',1,1)]), state);
});

test('explicit selection starts an empty review even with incomplete ranks, without fabricating evidence', () => {
  let state = review.startReview({ members, candidates: [ranked('P',1,null)], maxStops: 2 });
  assert.deepEqual(state.selected, []);
  state = review.selectReviewCandidate(state, 'P', state.version);
  assert.deepEqual(state.pending.selected.map(item => item.id), ['P']);
  assert.equal(state.pending.selected[0].memberRanks.b, null);
  assert.equal(state.confirmedIds.length, 0);
});

test('comparison veto replacement retains rank evidence and uses same-pool rank order', () => {
  let state = review.rejectReview(rankedStart(), 'Q', 1);
  state = review.proposeReview(state, state.version, []);
  assert.deepEqual(state.pending.selected.map(item => item.id), ['S','R']);
  assert.equal(state.pending.selected[0].memberRanks.b, 4);
});

test('empty common review adds explicit choices up to the stop limit and grows its refill target on adoption', () => {
  let state = review.startReview({ members, candidates: [ranked('P',1,1),ranked('Q',2,2),ranked('R',3,3)],
    comparisonMode: true, initialSelection: [], maxStops: 2 });
  assert.deepEqual(state.selected, []);
  assert.equal(state.targetCount, 0);
  state = review.selectReviewCandidate(state, 'Q', state.version);
  assert.deepEqual(state.pending.selected.map(item => item.id), ['Q']);
  state = review.confirmReview(state, state.version);
  assert.equal(state.targetCount, 1);
  state = review.selectReviewCandidate(state, 'R', state.version);
  assert.deepEqual(state.pending.selected.map(item => item.id), ['Q','R']);
  assert.deepEqual(state.pending.diff.affected, ['R'], 'appending a stop does not change an earlier confirmed leg');
  state = review.confirmReview(state, state.version);
  assert.equal(state.targetCount, 2);
  assert.deepEqual(state.confirmedIds, ['Q','R']);
  assert.equal(review.selectReviewCandidate(state, 'P', state.version).notice, 'confirmed_conflict');
  state = review.rejectReview(state, 'R', state.version);
  state = review.proposeReview(state, state.version);
  assert.deepEqual(state.pending.selected.map(item => item.id), ['Q','P']);
});

test('vetoed provider-equivalent place cannot revive under a new ID and a confirmed place cannot duplicate', () => {
  const store = id => ({ external: { google_places: [{ id }] } });
  let state = review.startReview({ members, candidates: [ranked('P',1,1,store('synthetic-store-p')), ranked('Q',2,2,store('synthetic-store-q'))], maxStops: 2 });
  state = review.confirmReview(state, state.version);
  state = review.rejectReview(state, 'P', state.version);
  state = review.proposeReview(state, state.version, [ranked('P-new',1,1,store('synthetic-store-p')),
    ranked('Q-new',2,2,store('synthetic-store-q'))], { queried:true });
  assert.equal(state.pending, null);
  assert.equal(state.notice, 'no_alternatives');
  assert.equal(state.candidates.some(item => item.id === 'P-new'), false);
  assert.equal(review.selectReviewCandidate(state, 'Q-new', state.version), state);
});

test('new-pool ranks cannot compete against the old pool in a supplemental proposal', () => {
  let state = review.startReview({ members, candidates: [ranked('P',1,1), ranked('Q',2,2), ranked('R',3,3)], maxStops: 2 });
  state = review.rejectReview(state, 'P', state.version);
  state = review.proposeReview(state, state.version, [ranked('S',9,9)], { queried:true });
  assert.deepEqual(state.pending.selected.map(item => item.id), ['S','Q']);
});

test('an empty fresh pool cannot fall back to an earlier pool reserve', () => {
  let state = review.startReview({ members, candidates: [ranked('P',1,1),ranked('Q',2,2),ranked('R',3,3)],maxStops:2 });
  state = review.rejectReview(state,'P',state.version);
  state = review.proposeReview(state,state.version,[],{queried:true});
  assert.equal(state.pending,null);
  assert.equal(state.notice,'no_alternatives');
});

test('alias veto stays protected after a replacement is adopted and a later recheck arrives', () => {
  let state = review.startReview({ members,candidates:[ranked('P',1,1,{aliasIds:['P','P2']}),ranked('Q',2,2),ranked('R',3,3)],maxStops:2 });
  state = review.rejectReview(state,'P',state.version);
  state = review.proposeReview(state,state.version);
  state = review.confirmReview(state,state.version);
  state = review.rejectReview(state,'R',state.version);
  state = review.proposeReview(state,state.version,[ranked('P2',1,1)],{queried:true});
  assert.equal(state.pending,null);
  assert.equal(state.notice,'no_alternatives');
});

test('an explicit current-pool alias resolves to its preserved canonical candidate', () => {
  const external = { google_places: [{id:'synthetic-store-p'}] };
  let state = review.startReview({members,candidates:[ranked('Q',1,1),ranked('P',2,2,{external})],maxStops:1});
  state = review.rejectReview(state,'Q',state.version);
  state = review.proposeReview(state,state.version,[ranked('P-new',1,1,{external})],{queried:true});
  state = review.cancelReview(state);
  state = review.selectReviewCandidate(state,'P-new',state.version);
  assert.deepEqual(state.pending?.selected.map(item=>item.id),['P']);
});
