import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const api = await import('../scripts/deepseek-compare.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('../scripts/deepseek-compare.mjs',import.meta.url).href) return {};
  throw error;
});
const fixture = JSON.parse(await readFile(new URL('./fixtures/deepseek-synthetic.json', import.meta.url), 'utf8'));
const explanation = snapshot => ({summary:snapshot.language === 'zh' ? '这是一组合成测试证据，部分偏好依据缺失。' : 'Synthetic test evidence; some preference evidence is missing.',
  candidates:snapshot.candidates.map(candidate => ({id:candidate.id,text:snapshot.language === 'zh' ? '仅说明已返回的偏好依据，缺失部分无法判断。' : 'Only returned preference evidence is described; missing evidence is unknown.'}))});
const usage = {promptTokens:100,completionTokens:50,totalTokens:150,reasoningTokens:20,cacheHitTokens:25,cacheMissTokens:75};
const result = snapshot => ({explanation:explanation(snapshot),metrics:{elapsedMs:45,finishReason:'stop',truncated:false,usage}});

test('comparison makes exactly four serial attempts with equal bounded budgets and immutable paired contexts', async () => {
  assert.equal(typeof api.runComparison, 'function');
  let active=0,peak=0;
  const calls=[];
  const before=JSON.stringify(fixture);
  const report=await api.runComparison({fixtures:fixture,maxTokens:2048,timeoutMs:1234,generateForMode:(thinking,options)=>async snapshot=>{
    active++;peak=Math.max(peak,active);calls.push({thinking,options,snapshot:structuredClone(snapshot)});
    await Promise.resolve();active--;return result(snapshot);
  }});
  assert.equal(calls.length,4);
  assert.equal(peak,1);
  assert.equal(JSON.stringify(fixture),before);
  assert.deepEqual(new Set(calls.map(call=>call.thinking)),new Set(['enabled','disabled']));
  for(const call of calls) assert.deepEqual(call.options,{maxTokens:2048,timeoutMs:1234});
  assert.equal(report.runs.length,4);
  for(const language of ['zh','en']) {
    const pair=report.runs.filter(run=>run.language===language);
    assert.equal(pair.length,2);
    assert.equal(pair[0].promptHash,pair[1].promptHash);
    assert.equal(pair[0].snapshotHash,pair[1].snapshotHash);
    assert.equal(pair[0].evidenceHash,pair[1].evidenceHash);
    assert.deepEqual(pair.map(run=>run.status),['ok','ok']);
  }
  assert.equal(new Set(report.runs.map(run=>run.evidenceHash)).size,1);
  assert.equal(report.mode,'mock');
  assert.equal(report.costTotal,null);
  assert.equal(report.runs[0].manualReview.evidenceAccuracy,null);
});

test('comparison rejects oversized, duplicate-language, or different-evidence sets before generating', async () => {
  assert.equal(typeof api.runComparison,'function');
  for(const change of [
    value=>value.snapshots.push(value.snapshots[0]),
    value=>value.snapshots[1].language='zh',
    value=>value.snapshots[1].candidates[0].evidence[0].rank=9,
    value=>value.snapshots[0].candidates[0].name='x'.repeat(121),
  ]) {
    const invalid=structuredClone(fixture);change(invalid);
    let attempts=0;
    await assert.rejects(api.runComparison({fixtures:invalid,generateForMode:()=>async()=>{attempts++;return {};}}));
    assert.equal(attempts,0);
  }
});

test('cost uses provider usage and supplied rates without guessing absent reasoning or cache tokens', () => {
  assert.equal(typeof api.calculateCost,'function');
  const rates={currency:'USD',inputCacheHitPerMillion:1,inputCacheMissPerMillion:2,outputPerMillion:3};
  assert.deepEqual(api.calculateCost(usage,rates),{currency:'USD',amount:0.000325});
  assert.equal(api.calculateCost(usage,null),null);
  assert.equal(api.calculateCost({...usage,cacheMissTokens:null},rates),null);
  assert.equal(api.calculateCost({...usage,cacheMissTokens:50},rates),null);
  // Completion tokens already include any billed reasoning; do not charge it twice.
  assert.deepEqual(api.calculateCost({...usage,reasoningTokens:null},rates),{currency:'USD',amount:0.000325});
});

test('errors and invalid explanations preserve safe metrics, never leak reasoning, and are not retried', async () => {
  assert.equal(typeof api.runComparison,'function');
  let calls=0;
  const report=await api.runComparison({fixtures:fixture,generateForMode:()=>async snapshot=>{
    calls++;
    if(calls===1) throw Object.assign(new Error('private-error-marker'),{code:'timeout',metrics:{elapsedMs:1234,finishReason:'length',truncated:true,reasoning_content:'private-reasoning-marker',usage:{...usage,reasoningTokens:null}}});
    if(calls===2) return {explanation:{...explanation(snapshot),reasoning_content:'private-output-marker'},metrics:{elapsedMs:4,finishReason:'stop',truncated:false,usage}};
    return {...result(snapshot),reasoning_content:'private-top-marker'};
  }});
  assert.equal(calls,4);
  assert.deepEqual(report.runs.map(run=>run.status),['error','error','ok','ok']);
  assert.equal(report.runs[0].error,'timeout');
  assert.equal(report.runs[0].metrics.truncated,true);
  assert.equal(report.runs[0].metrics.usage.reasoningTokens,null);
  assert.equal(report.runs[1].error,'invalid_response');
  assert.equal(report.runs[1].metrics.elapsedMs,4);
  assert.doesNotMatch(JSON.stringify(report),/private-/);
  assert.equal(report.runs[0].explanation,null);
});

test('default mock CLI never reads key or creates a live generator, and unconfirmed live mode fails first', async () => {
  assert.equal(typeof api.runCli,'function');
  const environment=new Proxy({}, {get(){throw new Error('Forbidden environment read');}});
  const dependencies={environment,liveGenerator:()=>{throw new Error('Forbidden live generation');}};
  const report=await api.runCli([],dependencies);
  assert.equal(report.mode,'mock');
  assert.equal(report.runs.length,4);
  assert.ok(report.runs.every(run=>run.metrics.usage.totalTokens===null));
  assert.match(report.fixtureLabel,/SYNTHETIC/);
  await assert.rejects(api.runCli(['--live'],dependencies),/confirm-four-calls/);
  await assert.rejects(api.runCli(['--confirm-four-calls'],dependencies),/--live/);
  await assert.rejects(api.runCli(['--max-tokens','0'],dependencies),/budget/);
});

test('live CLI creates only the explicit enabled and disabled generators after confirmation', async () => {
  assert.equal(typeof api.runCli,'function');
  let reads=0;
  const configs=[];
  const report=await api.runCli(['--live','--confirm-four-calls'],{
    environment:new Proxy({}, {get(_target,name){assert.equal(name,'DEEPSEEK_API_KEY');reads++;return 'synthetic-test-placeholder';}}),
    liveGenerator:options=>{configs.push(options);return async snapshot=>result(snapshot);},
  });
  assert.equal(reads,1);
  assert.equal(report.mode,'live');
  assert.deepEqual(configs.map(config=>config.thinking),['enabled','disabled']);
  assert.ok(configs.every(config=>config.maxTokens===4096 && config.timeoutMs===25000));
  assert.doesNotMatch(JSON.stringify(report),/synthetic-test-placeholder/);
});

test('CLI output file preserves Chinese JSON without depending on shell encoding', async () => {
  assert.equal(typeof api.runCli,'function');
  const directory=await mkdtemp(join(tmpdir(),'tastetrip-compare-'));
  const output=join(directory,'report.json');
  try {
    await api.runCli(['--output',output]);
    const report=JSON.parse(await readFile(output,'utf8'));
    assert.equal(report.runs.length,4);
    assert.match(report.runs.find(run=>run.language==='zh').explanation.summary,/合成测试/);
  } finally {
    await unlink(output).catch(error=>{if(error.code!=='ENOENT') throw error;});
    await rmdir(directory);
  }
});
