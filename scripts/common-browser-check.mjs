// Browser acceptance against the explicit local synthetic server; no live Qloo.
// Usage: node scripts/common-browser-check.mjs <browser-websocket> <evidence-directory>
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const socket = new WebSocket(process.argv[2]);
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
let sequence=0; const waiting=new Map(); const errors=[];
socket.onmessage=event=>{const v=JSON.parse(event.data);if(v.id){const p=waiting.get(v.id);waiting.delete(v.id);v.error?p.reject(v.error):p.resolve(v.result);}else if(v.method==='Runtime.exceptionThrown')errors.push(v.params.exceptionDetails.text);};
const command=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;waiting.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
const {targetId}=await command('Target.createTarget',{url:'about:blank'});
const {sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
await command('Page.enable',{},sessionId);await command('Runtime.enable',{},sessionId);
await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false},sessionId);
await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},sessionId);
const evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=async expression=>{const until=Date.now()+15000;while(Date.now()<until){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,80));}throw new Error('Timed out: '+expression+'\n'+await evaluate('document.body.innerText'));};
const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const submit=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`);
const language=value=>evaluate(`document.querySelector('#language-switch').value=${JSON.stringify(value)};document.querySelector('#language-switch').dispatchEvent(new Event('change',{bubbles:true}))`);
const names=()=>evaluate(`[...document.querySelectorAll('.members-route-list b')].map(x=>x.textContent)`);
const records=()=>evaluate(`fetch('/__qa').then(r=>r.json())`);
const out=process.argv[3];await mkdir(out,{recursive:true});
const checks=[];const note=name=>{checks.push(name);console.log('PASS '+name);};
const screenshot=async name=>{const img=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);await writeFile(join(out,name+'.png'),Buffer.from(img.data,'base64'));};
async function navigate(scenario='default') {
  await command('Page.navigate',{url:`http://127.0.0.1:5197/?scenario=${scenario}`},sessionId);
  await wait(`document.querySelector('#app-shell') || document.querySelector('#language-choice')`);
  if(await evaluate(`!!document.querySelector('#language-choice')`)){await click('input[value="en"]');await submit('#language-choice');}
  await language('en');await click('#new-york-example');
}
async function confirmEntities() {
  await wait(`!!document.querySelector('#entity-confirmation-form')`);
  await evaluate(`for(const key of new Set([...document.querySelectorAll('[data-entity-choice]')].map(x=>x.dataset.choiceKey))){const radios=[...document.querySelectorAll('[data-entity-choice]')].filter(x=>x.dataset.choiceKey===key&&x.value!=='__skip__');if(radios.length)radios.at(-1).click();}`);
  await submit('#entity-confirmation-form');
}
async function freshComparison(scenario='default') {await navigate(scenario);await submit('#members-workspace');await confirmEntities();await wait(`!!document.querySelector('#common-comparison-panel')`);}
async function choose(id) {await click(`[data-common-select][data-candidate-id="${id}"]`);await wait(`!!document.querySelector('.review-diff')`);}
try {
  await navigate();
  await evaluate(`fetch('/__qa?reset=1')`);
  await evaluate(`const input=document.querySelector('.member-preference');input.value='Dune';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelectorAll('.member-card')[0].querySelector('[data-preference-index="2"]').value='';`);
  await submit('#members-workspace');await wait(`!!document.querySelector('#entity-confirmation-form')`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-entity-choice]:checked').length`),0);
  assert.ok(await evaluate(`document.querySelectorAll('[data-choice-key="0:0"]').length>=3`),'ambiguous movie has at least two matches and skip');
  await submit('#entity-confirmation-form');assert.equal(await evaluate(`!!document.querySelector('#common-comparison-panel')`),false);
  await click('[data-choice-key="0:0"]:not([value="__skip__"])');
  const chosenEntity=await evaluate(`document.querySelector('[data-choice-key="0:0"]:checked').value`);
  const choiceRequests=(await records()).length;await language('zh');await language('en');
  assert.equal(await evaluate(`document.querySelector('[data-choice-key="0:0"]:checked').value`),chosenEntity);
  assert.equal((await records()).length,choiceRequests);
  await screenshot('01-entity-confirmation-en');
  await confirmEntities();await wait(`!!document.querySelector('#common-comparison-panel')`);
  assert.match(await evaluate(`document.querySelector('#common-comparison-panel').textContent`),/No common (?:top five|Top 5)/i);
  note('Free movie input, optional book, ambiguous entities and explicit confirmation');
  const count=(await records()).length;await language('zh');assert.equal((await records()).length,count);
  await evaluate(`document.querySelector('#common-comparison-panel').scrollIntoView({block:'start'})`);await screenshot('02-common-comparison-zh');
  await language('en');assert.equal((await records()).length,count);
  assert.doesNotMatch(await evaluate(`document.querySelector('#common-comparison-panel').textContent`),/Group score|satisfaction/i);
  note('Bilingual same-pool comparison preserves evidence without new requests');
  assert.deepEqual(await names(),[]);
  await choose('A');assert.deepEqual(await names(),[]);
  await click('.review-diff [data-review="confirm"]');assert.equal((await names()).length,1);
  const first=(await names())[0];await click('[data-shell-nav="qloo"]');
  await choose('B');assert.deepEqual(await names(),[first]);
  const beforeSwitch=(await records()).length;await language('zh');await language('en');assert.equal((await records()).length,beforeSwitch);
  await evaluate(`document.querySelector('.review-diff').scrollIntoView({block:'start'})`);await screenshot('03-candidate-proposal-en');
  await click('.review-diff [data-review="confirm"]');assert.equal((await names()).length,2);assert.equal((await names())[0],first);
  await click('[data-shell-nav="qloo"]');await choose('C');await click('.review-diff [data-review="confirm"]');assert.equal((await names()).length,3);
  const adopted=await names();await click('[data-shell-nav="qloo"]');await click('[data-common-select][data-candidate-id="D"]');assert.deepEqual(await names(),adopted);assert.equal(await evaluate(`!!document.querySelector('.review-diff')`),false);
  note('Selection requires diff acceptance; all confirmed places protected');
  await click('[data-shell-nav="negotiation"]');await click('[data-review="reject"][data-candidate-id="B"]');await wait(`!!document.querySelector('.review-diff')`);
  assert.equal((await names()).length,2);assert.ok((await names()).includes(first));
  await evaluate(`window.expiredAcceptance=document.querySelector('.review-diff [data-review="confirm"]')`);
  await click('[data-review="cancel"]');await evaluate(`window.expiredAcceptance.click()`);assert.equal((await names()).length,2);
  await click('[data-review="undo"]');assert.deepEqual(await names(),adopted);
  await evaluate(`document.querySelector('#members-route-panel').scrollIntoView({block:'start'})`);await screenshot('04-confirmed-route-en');
  note('Veto replacement, cancel, undo and expired acceptance preserve adopted state');
  await evaluate(`window.staleRouteReject=document.querySelector('[data-review="reject"]');const changedBudgetInput=document.querySelector('[data-context="budget"]');changedBudgetInput.value='99';changedBudgetInput.dispatchEvent(new Event('input',{bubbles:true}));`);
  const staleCount=(await records()).length;
  await evaluate(`window.staleRouteReject.dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  assert.deepEqual(await names(),adopted);assert.equal((await records()).length,staleCount);
  assert.equal(await evaluate(`[...document.querySelectorAll('#members-route-panel [data-review]')].every(x=>x.disabled)`),true);
  note('Edited trip inputs disable current and detached stale route decisions');
  await freshComparison('recheck');
  for(const id of ['A','B','C']) {await click('[data-shell-nav="qloo"]');await choose(id);await click('.review-diff [data-review="confirm"]');}
  const beforeRecheck=(await records()).length;
  await click('[data-review="reject"][data-candidate-id="A"]');await wait(`!!document.querySelector('.review-diff')`);
  assert.ok((await records()).length>beforeRecheck);
  const recheck=(await records()).at(-1);assert.equal(recheck.mode,'common-compare');assert.ok(recheck.rejectedIds.includes('A'));
  assert.equal((await names()).length,2);
  await click('[data-review="undo"]');assert.equal((await names()).length,3);
  assert.equal(await evaluate(`document.querySelectorAll('[data-common-select]').length`),3,'undo restores the matching old candidate pool');
  await click('[data-review="reject"][data-candidate-id="A"]');await wait(`!!document.querySelector('.review-diff')`);
  await click('.review-diff [data-review="confirm"]');assert.equal((await names()).length,3);
  assert.ok(!(await names()).some(name=>name.includes('Synthetic A ')));note('Exhausted reserve rechecks a fresh shared pool and retains confirmed places');
  await freshComparison('partial');assert.match(await evaluate(`document.querySelector('#common-comparison-panel').textContent`),/incomplete|missing|unknown|not returned/i);note('Partial rank and explanation coverage is visible');
  await navigate();await evaluate(`for(const input of document.querySelectorAll('.member-card')[2].querySelectorAll('.member-preference')) input.value='';`);
  await submit('#members-workspace');await confirmEntities();await wait(`!!document.querySelector('#common-comparison-panel')`);
  assert.match(await evaluate(`document.querySelector('#common-comparison-panel').textContent`),/not ranked|unranked/i);
  assert.doesNotMatch(await evaluate(`document.querySelector('#common-comparison-panel').textContent`),/No common (?:top five|Top 5)/i);
  note('A member may leave all cultural categories blank; shared top five remains unknown');
  await freshComparison('empty');assert.equal(await evaluate(`document.querySelectorAll('[data-common-select]').length`),0);assert.deepEqual(await names(),[]);note('Empty common pool creates no fabricated itinerary');
  await navigate('slow-search');await submit('#members-workspace');await wait(`!!document.querySelector('#cancel-members')`);await click('#cancel-members');
  await new Promise(r=>setTimeout(r,1800));assert.equal(await evaluate(`!!document.querySelector('#entity-confirmation-form')`),false);note('Cancelled entity search ignores late response');
  await navigate('slow-search');await submit('#members-workspace');
  await evaluate(`const input=document.querySelector('.member-preference');input.value='Inception';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#members-workspace').requestSubmit();`);
  await wait(`!!document.querySelector('#entity-confirmation-form')`);
  assert.match(await evaluate(`document.querySelector('#entity-confirmation-form').textContent`),/Inception/);
  assert.doesNotMatch(await evaluate(`document.querySelector('#entity-confirmation-form').textContent`),/Dune/);
  note('Rapid resubmission displays only the latest entity search');
  await navigate('slow');await submit('#members-workspace');await confirmEntities();await wait(`!!document.querySelector('#cancel-members')`);
  await evaluate(`const input=document.querySelector('.member-preference');input.value='A changed movie';input.dispatchEvent(new Event('input',{bubbles:true}));`);
  await new Promise(r=>setTimeout(r,1800));assert.equal(await evaluate(`!!document.querySelector('#common-comparison-panel')`),false);note('Preference edits invalidate a slow comparison');
  await freshComparison();
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);
  await evaluate(`document.querySelector('#common-comparison-panel').scrollIntoView({block:'start'})`);
  assert.equal(await evaluate(`document.documentElement.scrollWidth<=document.documentElement.clientWidth`),true);
  await screenshot('05-mobile-comparison-en');note('Mobile comparison retains table scrolling without page overflow');
  assert.deepEqual(errors,[]);note('No browser runtime errors');
  await writeFile(join(out,'browser-checks.json'),JSON.stringify({kind:'synthetic only; real Qloo not run',checks,errors,records:await records()},null,2));
  console.log('EVIDENCE '+out);
} catch(error) {await screenshot('failure');await writeFile(join(out,'failure.txt'),String(error)+'\n'+await evaluate('document.body.innerText'));throw error;}
finally {await command('Target.closeTarget',{targetId});socket.close();}
