import test from 'node:test';
import assert from 'node:assert/strict';
import * as view from '../src/commonView.js';
import { chooseLanguage } from '../src/i18n.js';

const request={mode:'common-search',context:{city:'New York'},members:[{id:'m1',name:'A',preferences:[{kind:'movie',query:'Dune'}]},{id:'m2',name:'B',preferences:[]}]};
const search={source:'live',members:[{id:'m1',name:'A',preferences:[{kind:'movie',query:'Dune',matches:[{id:'d1',name:'Dune',types:['urn:entity:movie'],year:1984,disambiguation:'David Lynch',external:{imdb:[{id:'tt0087182'}]}},{id:'d2',name:'Dune',types:['urn:entity:movie'],year:2021,disambiguation:'Denis Villeneuve'}]}]},{id:'m2',name:'B',preferences:[]}]};
test('free taste request allows a book only and an entirely blank member',()=>{
  assert.equal(typeof view.buildCommonSearchRequest,'function');
  const input=view.buildCommonSearchRequest([{id:'a',preferences:['','',' Beloved ']},{id:'b',preferences:['','','']}],{city:'New York'});
  assert.deepEqual(input.members[0].preferences,[{kind:'book',query:'Beloved'}]);
  assert.deepEqual(input.members[1].preferences,[]);
});
test('ambiguous entities show disambiguation facts with no preselected match',()=>{
  assert.equal(typeof view.renderEntityConfirmation,'function');
  chooseLanguage('en');
  const html=view.renderEntityConfirmation(search,{});
  assert.match(html,/1984/);assert.match(html,/2021/);assert.match(html,/David Lynch/);assert.match(html,/tt0087182/);
  assert.doesNotMatch(html,/ checked/);
  assert.match(html,/Skip this preference/);
  assert.match(html,/No confirmed preferences/);
  chooseLanguage('zh');
});
test('entity facts omit empty ISBN arrays while preserving real book ISBNs',()=>{
  const html=view.renderEntityConfirmation({members:[{id:'m1',name:'A',preferences:[
    {kind:'movie',query:'Dune',matches:[{id:'movie',name:'Dune',types:['urn:entity:movie'],isbn13:[]}]},
    {kind:'artist',query:'Miles Davis',matches:[{id:'artist',name:'Miles Davis',types:['urn:entity:artist'],isbn13:[]}]},
    {kind:'book',query:'Beloved',matches:[{id:'book',name:'Beloved',types:['urn:entity:book'],isbn13:['9781400033416']}]},
  ]}]});
  assert.equal((html.match(/ISBN/g) || []).length,1);
  assert.match(html,/ISBN 9781400033416/);
});
test('comparison requires explicit match or skip and sends the exact chosen entity',()=>{
  assert.equal(typeof view.buildConfirmedCommonRequest,'function');
  assert.throws(()=>view.buildConfirmedCommonRequest(search,request,{}),{code:'UNCONFIRMED_ENTITIES'});
  const input=view.buildConfirmedCommonRequest(search,request,{'0:0':'d2'});
  assert.equal(input.mode,'common-compare');
  assert.equal(input.members[0].entities[0].id,'d2');
  assert.equal(input.members[0].entities[0].year,2021);
  assert.equal(input.members[0].entities[0].kind,'movie');
  assert.deepEqual(input.members[1].entities,[]);
  assert.throws(()=>view.buildConfirmedCommonRequest(search,request,{'0:0':'__skip__'}),{code:'NO_CONFIRMED_SIGNALS'});
});
test('common evidence states missing explanations and unknown common top five for unranked members',()=>{
  assert.equal(typeof view.renderCommonComparison,'function');
  chooseLanguage('en');
  const comparison={candidates:[{id:'a',name:'A place',memberRanks:{m1:1,m2:null},memberEvidence:{m1:{rank:1,explanationMissing:true,contributions:[],missingSignalIds:['d2']}},sourceTag:'mock:fixture'}],commonTop5Ids:[],incompleteMemberIds:[],unrankedMemberIds:['m2'],possibleDuplicates:[],coverage:{m1:{returnedCount:1,poolCount:1,complete:true,hasSignals:true},m2:{returnedCount:0,poolCount:1,complete:false,hasSignals:false}}};
  const html=view.renderCommonComparison({...search,source:'synthetic'},comparison,{version:3,selected:[],rejectedIds:[],pending:null});
  assert.match(html,/Missing explanation/);assert.match(html,/Cannot determine a common Top 5/);assert.match(html,/Unranked/);assert.match(html,/data-candidate-id="a"/);
  assert.doesNotMatch(html,/Group score|satisfaction|NaN/);
  chooseLanguage('zh');
});
test('complete divergent rankings and raw warnings remain visible with synthetic source disclosure',()=>{
  chooseLanguage('en');
  const comparison={candidates:[{id:'a',name:'A',memberRanks:{m1:1,m2:9},memberEvidence:{m1:{explanationMissing:true,warning:'<test warning>'},m2:{explanationMissing:false,contributions:[{entityId:'d2',name:'Dune',score:.7}],missingSignalIds:['other']}}}],coverage:{m1:{hasSignals:true,complete:true,returnedCount:9,poolCount:9},m2:{hasSignals:true,complete:true,returnedCount:9,poolCount:9}},commonTop5Ids:[],incompleteMemberIds:[],unrankedMemberIds:[]};
  const html=view.renderCommonComparison({...search,evidenceKind:'synthetic',poolWarnings:['limited pool']},comparison,{version:1});
  assert.match(html,/No common Top 5/);assert.match(html,/Synthetic test data/);
  assert.match(html,/&lt;test warning&gt;/);assert.match(html,/limited pool/);
  assert.match(html,/this does not establish that they had no effect/);
  assert.doesNotMatch(html,/Live Qloo taste evidence/);
  chooseLanguage('zh');
});
test('selected and rejected provider aliases cannot be selected as new places',()=>{
  chooseLanguage('en');
  const external={google_places:[{id:'verified-store-id'}]};
  const old={id:'old',name:'Old record',external};
  const fresh={id:'new',name:'Fresh record',external,memberRanks:{m1:1}};
  const comparison={candidates:[fresh],commonTop5Ids:[],coverage:{}};
  const selected=view.renderCommonComparison(search,comparison,{version:1,selected:[old],rejectedIds:[]});
  assert.match(selected,/data-candidate-id="new"[^>]*disabled>In draft/);
  const rejected=view.renderCommonComparison(search,comparison,{version:1,selected:[],rejectedIds:['old'],rejectedCandidates:[old]});
  assert.match(rejected,/data-candidate-id="new"[^>]*disabled>Excluded/);
  chooseLanguage('zh');
});
test('returned order without any usable confirmed signal is never presented as a taste rank',()=>{
  chooseLanguage('en');
  const result={source:'live',members:[{id:'m1',name:'C',entities:[{id:'book',name:'Beloved'}]}]};
  const comparison={candidates:[{id:'p',name:'Place',memberRanks:{m1:null},memberEvidence:{m1:{rank:null,returnedRank:4,contributions:[],explanationMissing:true,allSignalsUnavailable:true,usable:false,unavailableSignalIds:['book']}}}],coverage:{m1:{hasSignals:true,returnedCount:18,poolCount:18,returnedComplete:true,complete:false,allSignalsUnavailable:true,usable:false,unavailableSignalIds:['book']}},commonTop5Ids:[],unrankedMemberIds:['m1'],incompleteMemberIds:['m1']};
  const html=view.renderCommonComparison(result,comparison,{version:1});
  assert.match(html,/All confirmed signals were unavailable/);
  assert.match(html,/Returned order: 4/);
  assert.match(html,/cannot be used as a taste rank/);
  assert.match(html,/18\/18 candidates returned/);
  assert.match(html,/Cannot determine a common Top 5/);
  assert.doesNotMatch(html,/Returned ranks for 18\/18|<td>#4<\/td>|Unranked: no confirmed preferences/);
  chooseLanguage('zh');
});
test('partial unavailable signals are named while remaining taste ranks stay visible',()=>{
  chooseLanguage('en');
  const result={source:'live',members:[{id:'m1',name:'A',entities:[{id:'movie',name:'Dune'},{id:'book',name:'Beloved'}]}]};
  const comparison={candidates:[{id:'p',name:'Place',memberRanks:{m1:2},memberEvidence:{m1:{rank:2,contributions:[{entityId:'movie',name:'Dune',score:.4}],missingSignalIds:['book'],unavailableSignalIds:['book'],allSignalsUnavailable:false,usable:true}}}],coverage:{m1:{hasSignals:true,returnedCount:1,poolCount:1,complete:true,usable:true,unavailableSignalIds:['book']}},commonTop5Ids:['p'],unrankedMemberIds:[],incompleteMemberIds:[]};
  const html=view.renderCommonComparison(result,comparison,{version:1});
  assert.match(html,/Unavailable confirmed signals: Beloved/);
  assert.match(html,/<td>#2<\/td>/);
  assert.doesNotMatch(html,/All confirmed signals were unavailable/);
  chooseLanguage('zh');
});
