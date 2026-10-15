import test from 'node:test';
import assert from 'node:assert/strict';
import * as n from '../src/pipeline/negotiation.js';

// Entirely synthetic: these facts are deliberately complete, not Qloo evidence.
const members = [{ id: 'a' }, { id: 'b' }];
const candidate = (id, score = .8) => ({ id, name: id, memberScores: { a: score, b: score }, groupScore: score * 2,
  cost: 10, openingHours: '08:00-23:00', durationMinutes: 30, travelMinutes: 5, sourceTag: 'mock:fixture' });
const context = { time: '10:00-20:00', budget: 100 };
const start = (count = 4) => n.startReview({ members, context, candidates: ['A','B','C','D'].slice(0,count).map(id => candidate(id)), maxStops: 3 });

test('review starts with a bounded draft and reserve, not operator confirmation', () => {
  const s = start();
  assert.deepEqual(s.selected.map(x => x.id), ['A','B','C']);
  assert.deepEqual(s.confirmedIds, []);
  assert.equal(s.pending, null);
});
test('confirming one site never claims the whole draft is confirmed', () => {
  const s = n.confirmReview(start(), 1, 'B');
  assert.deepEqual(s.confirmedIds, ['B']);
  assert.equal(s.confirmedVersion, null);
});
test('missing initial taste evidence does not choose an arbitrary site', () => {
  const s = n.startReview({members,context,candidates:[{...candidate('unknown'),memberScores:{a:null,b:null}}]});
  assert.deepEqual(s.selected, []);
  assert.equal(s.notice, 'missing_scores');
});
test('reject records exclusion, retains confirmed stops, and only proposes replacement', () => {
  let s = n.confirmReview(start(), 1);
  s = n.rejectReview(s, 'A', s.version);
  assert.deepEqual(s.selected.map(x=>x.id), ['B','C']);
  assert.equal(s.selected[0].travelMinutes, undefined, 'removing A invalidates the old A → B travel fact immediately');
  assert.deepEqual(s.confirmedIds, ['B','C']);
  s = n.proposeReview(s, s.version, []);
  assert.deepEqual(s.selected.map(x=>x.id), ['B','C']);
  assert.deepEqual(s.pending.selected.map(x=>x.id), ['D','B','C']);
  assert.deepEqual(s.pending.diff.removed, ['A']);
  assert.deepEqual(s.pending.diff.added, ['D']);
  assert.deepEqual(s.pending.diff.affected, ['D','B','C']);
  assert.equal(s.pending.route.feasible, false, 'changed legs are not proved by old travel times');
  const stale = n.confirmReview(s, s.version - 1);
  assert.equal(stale, s);
  s = n.confirmReview(s, s.version);
  assert.deepEqual(s.selected.map(x=>x.id), ['D','B','C']);
  assert.deepEqual(s.confirmedIds, ['D','B','C']);
  assert.equal(s.confirmedVersion, s.version);
});
test('insufficient reserve requests Qloo; duplicate and rejected returned IDs cannot revive', () => {
  let s = n.rejectReview(start(3), 'A', 1);
  s = n.proposeReview(s, s.version, []);
  assert.equal(s.phase, 'checking');
  s = n.proposeReview(s, s.version, [candidate('A'), candidate('D'), candidate('D')], { queried: true });
  assert.deepEqual(s.pending.selected.map(x=>x.id), ['D','B','C']);
  assert.equal(s.candidates.filter(x=>x.id==='D').length, 1);
});
test('fast consecutive rejection, cancel, undo and stale query cannot cross versions', () => {
  let s = n.rejectReview(start(3), 'A', 1);
  const old = s.version;
  s = n.rejectReview(s, 'B', s.version);
  assert.equal(n.proposeReview(s, old, [candidate('D')], { queried:true }), s);
  s = n.cancelReview(s);
  assert.deepEqual(s.rejectedIds, ['A','B']);
  assert.equal(s.pending, null);
  assert.equal(n.proposeReview(s, old, [candidate('D')], { queried:true }), s);
  s = n.undoReview(s);
  assert.deepEqual(s.rejectedIds, ['A']);
  assert.deepEqual(s.selected.map(x=>x.id), ['B','C']);
  assert.ok(s.version > old);
});
test('no alternatives and failed Qloo stop without accepting or reviving anything', () => {
  let s = n.rejectReview(start(3), 'A', 1);
  s = n.proposeReview(s, s.version, [], { queried:true });
  assert.equal(s.phase, 'blocked');
  assert.equal(s.notice, 'no_alternatives');
  assert.equal(s.pending, null);
  s = n.proposeReview(s, s.version, [], { queried:true, error:'timeout' });
  assert.equal(s.notice, 'timeout');
});
test('a proposal that would drop a confirmed stop requests a tradeoff', () => {
  let s = n.confirmReview(start(3), 1);
  s = n.rejectReview(s, 'A', s.version);
  s = n.proposeReview(s, s.version, [candidate('D')], { queried:true });
  // The new candidate consumes the known budget, leaving no room for B and C.
  s = n.proposeReview(s, s.version, [{...candidate('E', .99), cost:100}], { queried:true });
  assert.equal(s.phase, 'blocked');
  assert.equal(s.notice, 'confirmed_conflict');
  assert.deepEqual(s.confirmedIds, ['B','C']);
  assert.equal(s.pending, null);
});
test('missing member affinity cannot establish a replacement', () => {
  let s = n.rejectReview(start(3), 'A', 1);
  s = n.proposeReview(s, s.version, [{ ...candidate('D'), memberScores:{a:.9,b:null} }], {queried:true});
  assert.equal(s.notice, 'missing_scores');
  assert.equal(s.pending, null);
});
