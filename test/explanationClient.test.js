import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createExplanationClient } from '../src/explanationClient.js';
const snapshot = (language = 'en', name = 'Place') => ({language,source:'synthetic',members:[{name:'Alex',status:'ranked',unavailablePreferences:[]}],candidates:[{id:'p',name,evidence:[{member:'Alex',rank:1,contributions:['Dune'],missingExplanation:false,unavailablePreferences:[],status:'ranked'}]}],commonTop5Status:'present',commonTop5Names:[name]});
const explanation = {summary:'Evidence mentions Dune.',candidates:[{id:'p',text:'Dune appears in the returned explanation.'}]};
const response = value => ({ok:true,json:async()=>value});
const deferred = () => { let resolve; return {promise:new Promise(done=>{resolve=done;}),resolve:value=>resolve(value)}; };

test('explanation action is available in development or an explicitly enabled build', async () => {
  const url = new URL('../src/explanationClient.js', import.meta.url);
  const source = (await readFile(url, 'utf8')).replace("'./explanationEvidence.js'", JSON.stringify(new URL('../src/explanationEvidence.js', import.meta.url).href));
  for (const [env, expected] of [
    [{DEV:false}, false],
    [{DEV:false,VITE_EXPLANATIONS_ENABLED:'true'}, true],
    [{DEV:false,VITE_EXPLANATIONS_ENABLED:'false'}, false],
    [{DEV:false,VITE_EXPLANATIONS_ENABLED:true}, false],
    [{DEV:true}, true],
  ]) {
    const compiled = source.replaceAll('import.meta.env', JSON.stringify(env));
    const module = await import(`data:text/javascript,${encodeURIComponent(compiled)}`);
    assert.equal(module.localExplanationsEnabled, expected, JSON.stringify(env));
  }
});

test('one explicit request sends the whole snapshot and reuses its cache', async () => {
  assert.equal(typeof createExplanationClient,'function');
  const calls=[];
  const client=createExplanationClient({fetchImpl:async(url,init)=>{calls.push({url,init});return response({ok:true,explanation,cached:false});}});
  client.setSnapshot(snapshot());
  assert.equal(calls.length,0);
  await client.request();
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/api/explain');
  assert.equal(calls[0].init.method,'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body),snapshot());
  assert.deepEqual(client.state.explanation,explanation);
  client.setSnapshot(snapshot());
  await client.request();
  assert.equal(calls.length,1);
  client.setSnapshot(snapshot('zh'));
  assert.equal(client.state.status,'idle');
  await client.request();
  assert.equal(calls.length,2,'language belongs to the cache key');
  client.setSnapshot(snapshot());
  assert.equal(client.state.status,'ready');
  assert.equal(calls.length,2,'switching back restores the cached result without a request');
});

test('an in-flight explicit action is deduplicated and obsolete evidence cannot publish', async () => {
  const wait=deferred(); const calls=[];
  const client=createExplanationClient({fetchImpl:async(_,init)=>{calls.push(init);return wait.promise;}});
  client.setSnapshot(snapshot());
  const first=client.request(), duplicate=client.request();
  assert.equal(calls.length,1);
  assert.equal(client.state.status,'loading');
  client.setSnapshot(snapshot('en','Changed place'));
  assert.equal(calls[0].signal.aborted,true);
  wait.resolve(response({ok:true,explanation}));
  await Promise.all([first,duplicate]);
  assert.equal(client.state.status,'idle');
  assert.equal(client.state.explanation,undefined);
});

test('input invalidation rejects a late response even when the transport ignores abort', async () => {
  const wait=deferred();
  const client=createExplanationClient({fetchImpl:()=>wait.promise});
  client.setSnapshot(snapshot());
  const pending=client.request();
  client.invalidate();
  wait.resolve(response({ok:true,explanation}));
  await pending;
  assert.equal(client.state.status,'unavailable');
  client.setSnapshot(snapshot());
  assert.equal(client.state.status,'idle','obsolete output was not cached');
});

test('malformed, failed, and unknown-ID responses retain a fixed failure state without retrying', async () => {
  for (const value of [{ok:false,reason:'secret diagnostics'}, {ok:true,explanation:{summary:'Bad',candidates:[]}}, {ok:true,explanation:{summary:'Bad',candidates:[{id:'other',text:'Unsupported'}]}}, {ok:true,explanation:{summary:'qloo:entity',candidates:explanation.candidates}}]) {
    let calls=0;
    const client=createExplanationClient({fetchImpl:async()=>{calls++;return response(value);}});
    client.setSnapshot(snapshot());
    await client.request();
    assert.deepEqual(client.state,{status:'error'});
    assert.equal(calls,1);
  }
  let calls=0;
  const client=createExplanationClient({fetchImpl:async()=>{calls++;throw new Error('raw network failure');}});
  client.setSnapshot(snapshot());await client.request();
  assert.deepEqual(client.state,{status:'error'});assert.equal(calls,1);
});
