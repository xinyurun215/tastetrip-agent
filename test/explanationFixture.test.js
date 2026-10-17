import test from 'node:test';
import assert from 'node:assert/strict';
import { markExplanationFixture, syntheticExplanation } from '../scripts/explanation-demo.js';
import { buildCommonComparison } from '../src/pipeline/commonCandidates.js';
import { buildExplanationSnapshot, validateExplanationResponse } from '../src/explanationEvidence.js';

const fixture = () => ({ok:true, insight:{source:'live',members:[
  {id:'m1',name:'Alex',entities:[{id:'synthetic:film',name:'Dune'},{id:'synthetic:music',name:'Jazz'}]},
],pool:[{id:'A',name:'Test Cafe'}],rankings:[{memberId:'m1',entities:[{id:'A',query:{explainability:{
  'signal.interests.entities':[{entity_id:'synthetic:film',score:.5},{entity_id:'synthetic:music',score:.2}],
}}}]}]}});
const snapshot = scenario => {
  const result=markExplanationFixture(fixture(),scenario).insight;
  return buildExplanationSnapshot(result,buildCommonComparison(result),'en');
};

test('partial-invalid fixture identifies only a confirmed signal by name without discarding usable ranks',()=>{
  const value=snapshot('partial-invalid');
  assert.equal(value.source,'synthetic');
  assert.equal(value.members[0].status,'partial');
  assert.deepEqual(value.members[0].unavailablePreferences,['Dune']);
  assert.equal(value.candidates[0].evidence[0].rank,1);
  assert.deepEqual(value.candidates[0].evidence[0].contributions,['Jazz']);
});

test('all-invalid fixture retains the returned pool but supplies no taste ranks or support',()=>{
  const value=snapshot('all-invalid');
  assert.equal(value.commonTop5Status,'unknown');
  assert.equal(value.candidates.length,1);
  assert.equal(value.members[0].status,'all_unavailable');
  assert.equal(value.candidates[0].evidence[0].rank,null);
  assert.deepEqual(value.candidates[0].evidence[0].contributions,[]);
});

test('synthetic generator returns valid prose only from the supplied evidence',()=>{
  for(const scenario of ['default','partial-invalid','all-invalid']) {
    const value=snapshot(scenario);
    const response=validateExplanationResponse(syntheticExplanation(value),value);
    assert.deepEqual(response.candidates.map(item=>item.id),['A']);
    assert.doesNotMatch(response.candidates[0].text,/synthetic:|qloo:entity|%/);
    if(scenario==='all-invalid') assert.match(response.candidates[0].text,/unavailable|No usable/i);
  }
});
