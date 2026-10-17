import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommonComparison } from '../src/pipeline/commonCandidates.js';
import * as api from '../src/explanationEvidence.js';
const fixture = () => ({source:'live',evidenceKind:'synthetic',members:[
  {id:'a',name:'Alex',entities:[{id:'movie',name:'Dune'},{id:'book',name:'Beloved'}]},
  {id:'b',name:'Robin',entities:[]},
],pool:[{id:'place',name:'River Cafe'}],rankings:[{memberId:'a',warnings:[{type:'not_found','signal.interests.entities':['book']}],entities:[{id:'place',query:{explainability:{'signal.interests.entities':[{entity_id:'movie',score:.4},{entity_id:'book',score:.3}]}}}]}]});
function snapshot() { assert.equal(typeof api.buildExplanationSnapshot,'function'); const result=fixture(); return api.buildExplanationSnapshot(result,buildCommonComparison(result),'en'); }

test('bounded explanation snapshot contains only supported names, known failures and immutable rank evidence',()=>{
  const result=fixture(); const comparison=buildCommonComparison(result); const before=JSON.stringify({result,comparison});
  assert.equal(typeof api.buildExplanationSnapshot,'function');
  const value=api.buildExplanationSnapshot(result,comparison,'en');
  assert.equal(value.source,'synthetic');
  assert.equal(value.members[0].status,'partial');
  assert.deepEqual(value.members[0].unavailablePreferences,['Beloved']);
  assert.deepEqual(value.candidates[0].evidence[0].contributions,['Dune']);
  assert.equal(value.candidates[0].evidence[0].rank,1);
  assert.equal(value.candidates[0].evidence[1].rank,null);
  assert.equal(value.members[1].status,'no_preferences');
  assert.equal(value.commonTop5Status,'unknown');
  assert.doesNotMatch(JSON.stringify(value),/signal\.interests|entity_id|warnings|affinity|\.4/);
  assert.equal(JSON.stringify({result,comparison}),before);
});
test('all-invalid signals remove every apparent supporting contribution and taste rank',()=>{
  assert.equal(typeof api.buildExplanationSnapshot,'function');
  const result=fixture();result.rankings[0].warnings[0]['signal.interests.entities']=['movie','book'];
  const value=api.buildExplanationSnapshot(result,buildCommonComparison(result),'zh');
  assert.equal(value.members[0].status,'all_unavailable');
  assert.equal(value.candidates[0].evidence[0].rank,null);
  assert.deepEqual(value.candidates[0].evidence[0].contributions,[]);
});
test('same-title film and book retain distinct valid and unavailable signal evidence',()=>{
  const result=fixture();
  result.members[0].entities=[{id:'movie',name:'Dune',kind:'movie'},{id:'book',name:'Dune',kind:'book'}];
  result.rankings[0].warnings[0]['signal.interests.entities']=['movie'];
  const value=api.buildExplanationSnapshot(result,buildCommonComparison(result),'en');
  assert.deepEqual(value.members[0].unavailablePreferences,['Dune (film)']);
  assert.deepEqual(value.candidates[0].evidence[0].contributions,['Dune (book)']);
  assert.equal(value.candidates[0].evidence[0].rank,1);
});
test('missing contribution details remain unknown, and technical names never become explanation prose',()=>{
  assert.equal(typeof api.buildExplanationSnapshot,'function');
  const result=fixture();result.pool[0].name='qloo:entity:place';result.members[0].entities[0].name='39c448b0-5af2-4448-b3b5-234527182877';
  result.rankings[0].entities[0].query={};
  const value=api.buildExplanationSnapshot(result,buildCommonComparison(result),'zh');
  assert.equal(value.candidates[0].evidence[0].missingExplanation,true);
  assert.doesNotMatch(JSON.stringify(value),/qloo:entity|39c448b0/);
});
test('snapshot cap preserves deterministic common-top-five status from the whole comparison',()=>{
  assert.equal(typeof api.buildExplanationSnapshot,'function');
  const result=fixture();const comparison=buildCommonComparison(result);
  comparison.candidates=Array.from({length:20},(_,i)=>({...comparison.candidates[0],id:`p${i}`,name:`Place ${i}`}));
  comparison.commonTop5Ids=['p19'];comparison.unrankedMemberIds=[];comparison.incompleteMemberIds=[];
  const value=api.buildExplanationSnapshot(result,comparison,'en');
  assert.equal(value.candidates.length,12);
  assert.equal(value.commonTop5Status,'present');
  assert.deepEqual(value.commonTop5Names,['Place 19']);
});
test('request validation rejects added commands, malformed ranks, duplicate IDs and excessive content',()=>{
  const value=snapshot();assert.equal(typeof api.validateExplanationSnapshot,'function');
  assert.deepEqual(api.validateExplanationSnapshot(value),value);
  for (const alter of [v=>v.command='hello',v=>v.candidates[0].evidence[0].rank=-1,v=>v.candidates.push(v.candidates[0]),v=>v.members[0].name='x'.repeat(121),v=>v.candidates[0].evidence[1].rank=2,v=>v.language='es']) {
    const bad=structuredClone(value);alter(bad);assert.throws(()=>api.validateExplanationSnapshot(bad));
  }
});
test('response validation enforces exact candidate IDs and strings with no decisions or percentages',()=>{
  const value=snapshot();assert.equal(typeof api.validateExplanationResponse,'function');
  const good={summary:'Some evidence is unavailable; no member agreement is established.',candidates:[{id:'place',text:'Dune has supporting evidence; Beloved is unavailable.'}]};
  assert.deepEqual(api.validateExplanationResponse(good,value),good);
  for (const alter of [v=>v.selected=['place'],v=>v.candidates[0].id='other',v=>v.candidates.push(v.candidates[0]),v=>v.candidates[0].text='80% satisfaction',v=>v.summary='qloo:entity',v=>v.summary='x'.repeat(321),v=>v.candidates[0].text='39c448b0-5af2-4448-b3b5-234527182877']) {
    const bad=structuredClone(good);alter(bad);assert.throws(()=>api.validateExplanationResponse(bad,value));
  }
});
