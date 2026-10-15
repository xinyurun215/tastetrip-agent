// Browser acceptance against scripts/review-demo.js, using a disposable CDP tab.
// Usage: node scripts/review-browser-check.mjs <browser-websocket> <evidence-directory>
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const socket = new WebSocket(process.argv[2]);
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
let sequence=0; const waiting=new Map(); const errors=[];
socket.onmessage=event=>{const value=JSON.parse(event.data); if(value.id){const pending=waiting.get(value.id);waiting.delete(value.id);value.error?pending.reject(value.error):pending.resolve(value.result);} else if(value.method==='Runtime.exceptionThrown') errors.push(value.params.exceptionDetails.text);};
const command=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;waiting.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
const {targetId}=await command('Target.createTarget',{url:'about:blank'});
const {sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
await command('Page.enable',{},sessionId); await command('Runtime.enable',{},sessionId);
await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false},sessionId);
await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},sessionId);
const evaluate=async expression=>{const response=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));return response.result.value;};
const wait=async expression=>{const until=Date.now()+15000;while(Date.now()<until){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,80));}throw new Error('Timed out: '+expression);};
const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const changeLanguage=value=>evaluate(`document.querySelector('#language-switch').value=${JSON.stringify(value)};document.querySelector('#language-switch').dispatchEvent(new Event('change',{bubbles:true}))`);
const names=()=>evaluate(`[...document.querySelectorAll('.members-route-list b')].map(x=>x.textContent)`);
const records=()=>evaluate(`fetch('/__qa').then(r=>r.json())`);
const out=process.argv[3];await mkdir(out,{recursive:true});
const checks=[];
const note=name=>{checks.push(name);console.log('PASS '+name);};
const screenshot=async name=>{const image=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);await writeFile(join(out,name+'.png'),Buffer.from(image.data,'base64'));};
async function navigate(scenario='replacement') {
  await command('Page.navigate',{url:`http://127.0.0.1:5196/?scenario=${scenario}`},sessionId);
  await wait(`document.querySelector('#app-shell') || document.querySelector('#language-choice')`);
}
async function freshTrip(scenario='replacement') {
  await navigate(scenario);
  if(await evaluate(`!!document.querySelector('#language-choice')`)) {await click('input[value="en"]');await evaluate(`document.querySelector('#language-choice').requestSubmit()`);}
  await click('#new-york-example');
  await evaluate(`document.querySelector('#members-workspace').requestSubmit()`);
  await wait(`!!document.querySelector('#members-result-panel')`);
  await click('[data-shell-nav="negotiation"]');
  assert.equal((await names()).length,3);
}

try {
  await navigate(); await evaluate(`fetch('/__qa?reset=1')`); await evaluate(`localStorage.removeItem('tastetrip-language')`); await navigate();
  assert.equal(await evaluate(`!!document.querySelector('#language-choice')`),true);
  assert.equal(await evaluate(`!!document.querySelector('#members-workspace')`),false);
  await screenshot('01-language-choice');
  await click('input[value="en"]');await evaluate(`document.querySelector('#language-choice').requestSubmit()`);
  assert.equal(await evaluate(`document.documentElement.lang`),'en');
  await navigate();assert.equal(await evaluate(`document.documentElement.lang`),'en');note('English explicit first choice and refresh');
  await evaluate(`localStorage.removeItem('tastetrip-language')`);await navigate();await click('input[value="zh"]');
  await evaluate(`document.querySelector('#language-choice').requestSubmit()`);assert.equal(await evaluate(`document.documentElement.lang`),'zh-CN');
  await navigate();assert.equal(await evaluate(`document.documentElement.lang`),'zh-CN');await changeLanguage('en');note('Chinese explicit first choice and refresh');
  await click('#new-york-example');
  await evaluate(`document.querySelector('[data-context="budget"]').value='123'`);
  const initialCount=(await records()).length;
  await changeLanguage('zh');assert.equal(await evaluate(`document.querySelector('[data-context="budget"]').value`),'123');
  await navigate();assert.equal(await evaluate(`document.documentElement.lang`),'zh-CN');
  await changeLanguage('en');assert.equal((await records()).length,initialCount);note('Chinese remembered on refresh; switching preserves input without Qloo');
  await freshTrip();await screenshot('02-evidence-route-en');
  await click('[data-review="confirm"]');
  assert.equal(await evaluate(`[...document.querySelectorAll('.members-route-list .tag')].filter(x=>x.textContent==='Confirmed place').length`),3);
  await click('[data-review="reject"][data-candidate-id="A"]');
  await wait(`!!document.querySelector('.review-diff')`);
  assert.deepEqual(await names(),['Fixture B Restaurant','Fixture C Restaurant']);
  const feedback=(await records()).at(-1);assert.equal(feedback.recheck,true);assert.deepEqual(feedback.rejectedIds,['A']);assert.ok(feedback.calls>0);
  const count=(await records()).length;
  await screenshot('03-proposed-change-en');
  await changeLanguage('zh');assert.equal((await records()).length,count);assert.deepEqual(await names(),['Fixture B Restaurant','Fixture C Restaurant']);
  await evaluate(`document.querySelector('.review-diff').scrollIntoView({block:'start'})`);
  await screenshot('04-proposed-change-zh');await changeLanguage('en');
  await click('.review-diff [data-review="confirm"]');
  assert.deepEqual(await names(),['Fixture D Restaurant','Fixture B Restaurant','Fixture C Restaurant']);
  assert.equal(await evaluate(`!!document.querySelector('.review-diff')`),false);note('Rejection → real fixture HTTP recheck → bilingual diff → operator acceptance');
  await evaluate(`document.querySelector('#members-route-panel').scrollIntoView({block:'start'})`);await screenshot('05-accepted-choices-en');
  await click('[data-review="reject"][data-candidate-id="B"]');await wait(`!!document.querySelector('.review-diff')`);
  await click('[data-review="cancel"]');assert.deepEqual(await names(),['Fixture D Restaurant','Fixture C Restaurant']);
  await click('[data-review="undo"]');assert.deepEqual(await names(),['Fixture D Restaurant','Fixture B Restaurant','Fixture C Restaurant']);note('Cancel retains exclusion; undo restores last decision');
  await freshTrip();await click('[data-review="reject"][data-candidate-id="A"]');await wait(`!!document.querySelector('.review-diff')`);
  await click('#new-york-example');await click('[data-shell-nav="negotiation"]');
  assert.equal(await evaluate(`!!document.querySelector('.review-diff')`),false);assert.deepEqual(await names(),['Fixture B Restaurant','Fixture C Restaurant']);note('Example input invalidates the prior pending proposal');
  await freshTrip('slow'); await click('[data-review="confirm"]');
  await click('[data-review="reject"][data-candidate-id="A"]');
  await click('[data-review="reject"][data-candidate-id="B"]');
  await wait(`!!document.querySelector('.review-diff')`);
  assert.deepEqual(await names(),['Fixture C Restaurant']);
  assert.equal(await evaluate(`document.querySelector('.review-diff').textContent.includes('Fixture A Restaurant')`),true);
  assert.equal(await evaluate(`document.querySelector('.review-diff dd:nth-of-type(2)').textContent.includes('Fixture A Restaurant')`),false);
  await evaluate(`window.staleConfirm=document.querySelector('.review-diff [data-review="confirm"]')`);
  await click('[data-review="cancel"]');const cancelledText=await evaluate(`document.querySelector('#members-route-panel').textContent`);
  await evaluate(`window.staleConfirm.click()`);assert.equal(await evaluate(`document.querySelector('#members-route-panel').textContent`),cancelledText);note('Rapid rejection and expired confirmation cannot adopt stale choices');
  await freshTrip('slow');await click('[data-review="reject"][data-candidate-id="A"]');await click('[data-shell-nav="qloo"]');
  await evaluate(`new Promise(r=>setTimeout(r,1800))`);await click('[data-shell-nav="negotiation"]');
  assert.equal(await evaluate(`!!document.querySelector('.review-diff')`),false);assert.deepEqual(await names(),['Fixture B Restaurant','Fixture C Restaurant']);note('Back navigation cancels the pending revision and ignores late response');
  await freshTrip('empty');await click('[data-review="reject"][data-candidate-id="A"]');
  await wait(`document.querySelector('.review-notice')?.textContent.includes('Not enough alternatives')`);
  assert.equal(await evaluate(`!!document.querySelector('.review-diff')`),false);await screenshot('06-no-alternative-en');note('No alternatives stops with no invented replacement');
  await freshTrip('error');await click('[data-review="reject"][data-candidate-id="A"]');
  await wait(`document.querySelector('.review-notice')?.textContent.includes('timed out')`);
  await changeLanguage('zh');assert.match(await evaluate(`document.querySelector('.review-notice').textContent`),/超时/);await screenshot('07-error-zh');note('Failed recheck and error language switching');
  await click('[data-shell-nav="members"]');await evaluate(`document.querySelector('.member-preference').value=''; document.querySelector('#members-workspace').requestSubmit()`);
  await wait(`document.querySelector('.review-notice')?.textContent.includes('完整填写')`);
  await changeLanguage('en');assert.match(await evaluate(`document.querySelector('.review-notice').textContent`),/Complete all three/);note('Input validation in both languages');
  await navigate('slow-initial');await click('#new-york-example');await evaluate(`document.querySelector('#members-workspace').requestSubmit()`);
  await click('#cancel-members');await evaluate(`new Promise(r=>setTimeout(r,1800))`);
  assert.equal(await evaluate(`!!document.querySelector('#members-result-panel')`),false);note('Initial query cancellation ignores the late response');
  assert.deepEqual(errors,[]);note('No browser runtime errors');
  await writeFile(join(out,'browser-checks.json'),JSON.stringify({kind:'synthetic only',checks,errors,records:await records()},null,2));
  console.log('EVIDENCE '+out);
} finally { socket.close(); }
