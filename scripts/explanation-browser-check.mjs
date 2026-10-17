// Attaches to an existing isolated test browser. Does not launch a browser.
// Usage: node scripts/explanation-browser-check.mjs <browser-websocket> <evidence-directory> [--real-only]
// Routine mode requires fake explanations. --real-only requires explicit --real-explain server startup.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [websocket,out,...options]=process.argv.slice(2);
if(!websocket || !out || options.some(arg=>arg!=='--real-only')) throw new Error('Expected browser websocket, evidence directory, optional --real-only');
const realOnly=options.includes('--real-only');
const socket=new WebSocket(websocket);
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
let sequence=0;
const waiting=new Map(), errors=[], checks=[], blockedExternal=[];
socket.onmessage=event=>{
  const value=JSON.parse(event.data);
  if(value.id) {const pending=waiting.get(value.id);waiting.delete(value.id);if(pending) value.error?pending.reject(value.error):pending.resolve(value.result);}
  else if(value.method==='Runtime.exceptionThrown') errors.push(value.params.exceptionDetails.text);
  else if(value.method==='Fetch.requestPaused') {
    const url=value.params.request.url;
    const local=url.startsWith('http://127.0.0.1:5198/') || url.startsWith('data:') || url.startsWith('blob:');
    if(!local) blockedExternal.push(url);
    void command(local?'Fetch.continueRequest':'Fetch.failRequest',{requestId:value.params.requestId,...(local?{}:{errorReason:'BlockedByClient'})},value.sessionId);
  }
};
const command=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
  const id=++sequence;waiting.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
});
const {targetId}=await command('Target.createTarget',{url:'about:blank'});
const {sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
await command('Page.enable',{},sessionId);
await command('Runtime.enable',{},sessionId);
await command('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]},sessionId);
await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false},sessionId);
await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},sessionId);
await mkdir(out,{recursive:true});
const evaluate=async expression=>{
  const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);
  if(result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const wait=async(expression,timeout=15000)=>{
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline) {if(await evaluate(expression)) return;await new Promise(resolve=>setTimeout(resolve,80));}
  throw new Error('Timed out: '+expression+'\n'+await evaluate('document.body.innerText'));
};
const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const submit=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`);
const language=value=>evaluate(`document.querySelector('#language-switch').value=${JSON.stringify(value)};document.querySelector('#language-switch').dispatchEvent(new Event('change',{bubbles:true}))`);
const qa=()=>evaluate(`fetch('/__qa').then(response=>response.json())`);
const ranks=()=>evaluate(`[...document.querySelectorAll('.score-matrix tbody tr')].map(row=>[...row.querySelectorAll('td')].slice(0,3).map(cell=>cell.textContent))`);
const route=()=>evaluate(`[...document.querySelectorAll('.members-route-list b')].map(element=>element.textContent)`);
const normalText=()=>evaluate(`document.querySelector('#common-comparison-panel').innerText`);
const note=name=>{checks.push(name);console.log('PASS '+name);};
const screenshot=async(name,full=false)=>{
  await evaluate(`document.querySelector('#common-comparison-panel')?.scrollIntoView({block:'start'})`);
  const metrics=full ? await command('Page.getLayoutMetrics',{},sessionId) : null;
  const size=metrics?.cssContentSize || metrics?.contentSize;
  const capture=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:full,
    ...(size?{clip:{x:0,y:0,width:size.width,height:size.height,scale:1}}:{})},sessionId);
  await writeFile(join(out,name+'.png'),Buffer.from(capture.data,'base64'));
};
async function navigate(scenario='default') {
  await command('Page.navigate',{url:`http://127.0.0.1:5198/?scenario=${scenario}`},sessionId);
  await wait(`document.querySelector('#app-shell') || document.querySelector('#language-choice')`);
  if(await evaluate(`!!document.querySelector('#language-choice')`)) {await click('input[value="en"]');await submit('#language-choice');}
  await language('en');await click('#new-york-example');
}
async function comparison(scenario='default') {
  await navigate(scenario);
  if(scenario==='no-preference') await evaluate(`for(const input of document.querySelectorAll('.member-card')[2].querySelectorAll('.member-preference')) {input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await submit('#members-workspace');
  await wait(`!!document.querySelector('#entity-confirmation-form')`);
  await evaluate(`for(const key of new Set([...document.querySelectorAll('[data-entity-choice]')].map(element=>element.dataset.choiceKey))) {const choices=[...document.querySelectorAll('[data-entity-choice]')].filter(element=>element.dataset.choiceKey===key&&element.value!=='__skip__');choices.at(-1)?.click();}`);
  await submit('#entity-confirmation-form');
  await wait(`!!document.querySelector('#common-comparison-panel')`);
  await wait(`!!document.querySelector('[data-explain-results]')`);
}
async function generate() {
  await click('[data-explain-results]');
  await wait(`!!document.querySelector('#generated-explanation')`,realOnly?75000:15000);
}
const countScenario=(data,scenario)=>data.generations.filter(item=>item.scenario===scenario).length;

try {
  await comparison(realOnly?'partial-invalid':'default');
  if(realOnly) {await language('zh');await wait(`!!document.querySelector('[data-explain-results]')`);}
  const initial=await qa();
  assert.equal(initial.realExplain,realOnly,'The server mode must match this check; never silently use the account for routine checks');
  assert.match(await evaluate(`document.querySelector('#synthetic-fixture-banner').textContent`),/SYNTHETIC FIXTURE.*no Qloo calls/);
  const beforeRanks=await ranks(), beforeRoute=await route();
  assert.ok(beforeRanks.length>0);
  assert.equal(initial.generationCount,0,'Fresh fixture server required; initial rendering must not generate explanations');
  assert.doesNotMatch(await normalText(),/qloo:entity|synthetic:|signal\.interests\.entities|[0-9a-f]{8}-[0-9a-f-]{27}/i);
  assert.equal(await evaluate(`[...document.querySelectorAll('.technical-evidence')].every(element=>!element.open)`),true);
  note('Readable deterministic result and collapsed diagnostics appear without a model call');

  if(realOnly) {
    assert.equal(initial.realInvocationCount,0);
    const started=Date.now();
    await generate();
    const elapsedMs=Date.now()-started;
    const after=await qa();
    assert.equal(after.realInvocationCount,1);
    assert.equal(after.generationCount,1);
    assert.deepEqual(await ranks(),beforeRanks);
    assert.deepEqual(await route(),beforeRoute);
    const response=await evaluate(`({summary:document.querySelector('#generated-explanation').textContent,candidates:[...document.querySelectorAll('.candidate-explanation')].map(element=>({id:element.dataset.explanationId,text:element.textContent}))})`);
    assert.equal(response.candidates.length,beforeRanks.length);
    await screenshot('real-account-synthetic-evidence-zh');
    await screenshot('real-account-synthetic-evidence-full-zh',true);
    await click('[data-explain-results]');
    assert.equal((await qa()).realInvocationCount,1);
    note('One real account explanation of synthetic evidence leaves ranks and route unchanged; repeated action reuses it');
    assert.deepEqual(errors,[]);
    await writeFile(join(out,'real-browser-checks.json'),JSON.stringify({kind:'Synthetic Qloo evidence; real Codex account explanation only',elapsedMs,checks,errors,response,qa:await qa()},null,2));
  } else {
    assert.match(await normalText(),/No common (?:top five|Top 5)/i);
    await generate();
    assert.equal((await qa()).generationCount,1);
    assert.deepEqual(await ranks(),beforeRanks);
    assert.deepEqual(await route(),beforeRoute);
    assert.equal(await evaluate(`document.querySelectorAll('.candidate-explanation').length`),beforeRanks.length);
    await click('[data-explain-results]');
    assert.equal((await qa()).generationCount,1);
    await language('zh');assert.equal((await qa()).generationCount,1);
    await language('en');await wait(`!!document.querySelector('#generated-explanation')`);
    assert.equal((await qa()).generationCount,1);
    await screenshot('01-explanation-synthetic-en');
    note('No-common-five, explicit single generation, cache reuse and language change preserve deterministic ranks and route');

    await language('zh');
    const chineseRanks=await ranks(), chineseRoute=await route();
    await generate();
    assert.equal((await qa()).generationCount,2);
    assert.match(await evaluate(`document.querySelector('#generated-explanation').textContent`),/合成/);
    assert.deepEqual(await ranks(),chineseRanks);
    assert.deepEqual(await route(),chineseRoute);
    await screenshot('05-explanation-synthetic-zh');
    note('Chinese mock explanation uses a separate language cache and preserves ranks and route');

    await comparison('partial-invalid');
    const partial=await normalText();
    assert.match(partial,/Dune/);
    assert.match(partial,/unavailable|not found|not returned/i);
    assert.doesNotMatch(partial,/qloo:entity|synthetic:|signal\.interests\.entities/);
    assert.ok((await ranks()).some(row=>row.some(cell=>/#\d/.test(cell))));
    await screenshot('02-partial-invalid-readable-en');
    note('A failed confirmed preference uses its supplied name while valid ranks remain');

    await comparison('all-invalid');
    assert.ok((await ranks()).every(row=>row.every(cell=>!/#\d/.test(cell))));
    assert.match(await normalText(),/unavailable|not ranked|unranked/i);
    assert.doesNotMatch(await normalText(),/No common (?:top five|Top 5)/i);
    assert.deepEqual(await route(),[]);
    await screenshot('03-all-invalid-no-ranks-en');
    note('All-unavailable members have no taste ranks and cannot establish a shared top five');

    await comparison('no-preference');
    assert.ok((await ranks()).every(row=>!/#\d/.test(row[2])));
    assert.match(await normalText(),/not ranked|unranked|no confirmed preferences/i);
    assert.doesNotMatch(await normalText(),/No common (?:top five|Top 5)/i);
    note('A blank-preference member remains unranked and shared top five remains unknown');

    for(const scenario of ['malformed','timeout']) {
      await comparison(scenario);
      const previousRanks=await ranks();
      const oldCount=countScenario(await qa(),scenario);
      await click('[data-explain-results]');
      await wait(`document.querySelector('.explanation-status')?.textContent && !document.querySelector('[data-explain-results]')?.disabled`);
      assert.equal(await evaluate(`!!document.querySelector('#generated-explanation')`),false);
      assert.equal(countScenario(await qa(),scenario),oldCount+1);
      assert.deepEqual(await ranks(),previousRanks);
      assert.ok(await evaluate(`document.querySelectorAll('.candidate-evidence').length>0`));
      assert.doesNotMatch(await normalText(),/Must never be rendered|not-in-snapshot/);
      await screenshot(`${scenario}-deterministic-fallback-en`);
      note(`${scenario} response preserves readable deterministic evidence and the ranking table`);
    }

    await comparison('stale');
    await click('[data-explain-results]');
    await wait(`fetch('/__qa').then(response=>response.json()).then(data=>data.generations.some(item=>item.scenario==='stale'))`);
    await language('zh');
    await wait(`fetch('/__qa').then(response=>response.json()).then(data=>data.generations.filter(item=>item.scenario==='stale').every(item=>item.finished))`);
    await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(await evaluate(`!!document.querySelector('#generated-explanation')`),false);
    assert.equal(countScenario(await qa(),'stale'),1);
    assert.ok((await ranks()).length>0);
    note('Late explanation for the previous language is ignored without an automatic replacement call');

    await comparison('no-common-five');
    assert.match(await normalText(),/No common (?:top five|Top 5)/i);
    await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=document.documentElement.clientWidth`),true);
    await screenshot('04-readable-mobile-en');
    note('Narrow screen retains usable comparison without page overflow');
    assert.equal((await qa()).realInvocationCount,0);
    assert.deepEqual(errors,[]);
    note('Routine acceptance made zero real model/Qloo calls and had no browser runtime errors');
    await writeFile(join(out,'browser-checks.json'),JSON.stringify({kind:'Fully synthetic; no real Qloo or model calls',checks,errors,blockedExternal,qa:await qa()},null,2));
  }
  console.log('EVIDENCE '+out);
} catch(error) {
  await screenshot('failure');
  await writeFile(join(out,'failure.txt'),String(error)+'\n'+await evaluate('document.body.innerText'));
  throw error;
} finally {
  await command('Target.closeTarget',{targetId});
  socket.close();
}
