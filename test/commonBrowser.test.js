import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserQlooClient } from '../src/qloo/browserClient.js';

// All HTTP responses below are synthetic contract fixtures, never recorded Qloo data.
const request = { members: [{ id:'m1', name:'A', preferences:[{kind:'book',query:'Beloved'}] }], context:{city:'New York'} };
test('common search carries optional preferences without auto-selecting search results', async () => {
  const calls=[];
  const insight={mode:'common-search',source:'live',members:[{id:'m1',preferences:[{kind:'book',query:'Beloved',matches:[{id:'one'},{id:'two'}]}]}]};
  const client=createBrowserQlooClient({fetchImpl:async (_,init)=>{calls.push(JSON.parse(init.body));return {ok:true,json:async()=>({ok:true,insight})};}});
  assert.equal(typeof client.searchCommonMembers,'function');
  const result=await client.searchCommonMembers(request);
  assert.equal(calls[0].mode,'common-search');
  assert.deepEqual(calls[0].members,request.members);
  assert.deepEqual(result.members[0].preferences[0].matches,[{id:'one'},{id:'two'}]);
  assert.equal(result.members[0].entities,undefined);
});
test('common compare sends confirmed entities and exclusions, with unavailable empty results on failure', async () => {
  const calls=[];
  const client=createBrowserQlooClient({fetchImpl:async (_,init)=>{calls.push(JSON.parse(init.body));return {ok:false,status:504};}});
  assert.equal(typeof client.compareCommonMembers,'function');
  const input={...request,members:[{id:'m1',name:'A',entities:[{id:'confirmed',kind:'book'}]}]};
  const result=await client.compareCommonMembers(input,{rejectedIds:['place-x']});
  assert.equal(calls[0].mode,'common-compare');
  assert.deepEqual(calls[0].rejectedIds,['place-x']);
  assert.equal(result.source,'unavailable');
  assert.equal(result.reason,'timeout');
  assert.deepEqual(result.pool,[]);
  assert.deepEqual(result.rankings,[]);
});
test('common results arriving after cancellation reject even when transport ignores abort', async () => {
  let finish;
  const controller=new AbortController();
  const client=createBrowserQlooClient({fetchImpl:()=>new Promise(resolve=>{finish=resolve;})});
  assert.equal(typeof client.searchCommonMembers,'function');
  const pending=client.searchCommonMembers(request,{signal:controller.signal});
  controller.abort();
  finish({ok:true,json:async()=>({ok:true,insight:{source:'live',members:[]}})});
  await assert.rejects(pending,{name:'AbortError'});
});
