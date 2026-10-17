import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { Readable } from 'node:stream';

const backend = await import('../server/handleExplain.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const snapshot = () => ({language:'en',source:'synthetic',members:[{name:'Alex',status:'ranked',unavailablePreferences:[]}],
  candidates:[{id:'test-cafe',name:'Test Cafe',evidence:[{member:'Alex',rank:1,contributions:['Test Film'],missingExplanation:false,unavailablePreferences:[],status:'ranked'}]}],
  commonTop5Status:'present',commonTop5Names:['Test Cafe']});
const explanation = () => ({summary:'Synthetic test data; shared rankings are not agreement.',candidates:[{id:'test-cafe',text:'Alex has this candidate ranked first; Test Film appears in the evidence.'}]});
const env = () => ({EXPLANATIONS_ENABLED:'true',DEEPSEEK_THINKING:'enabled'});
const handler = options => {
  assert.equal(typeof backend.createExplainHandler,'function','shared deployable explanation handler must exist');
  return backend.createExplainHandler({env:env(),local:true,generate:async()=>({explanation:explanation(),metrics:{reasoning_content:'must not return'}}),...options});
};
async function withServer(fn, action) {
  const server=createServer(fn);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  try {return await action(origin);} finally {await new Promise(resolve=>server.close(resolve));}
}
function post(origin,body=snapshot(),headers={}) {
  return new Promise((resolve,reject)=>{
    const req=request(`${origin}/api/explain`,{method:'POST',headers:{origin,'content-type':'application/json',...headers}},res=>{
      let text='';res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk;});
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(text)}));
    });
    req.on('error',reject);req.end(typeof body==='string'?body:JSON.stringify(body));
  });
}
async function invoke(fn,{body=snapshot(),headers={},remoteAddress='127.0.0.1',method='POST'}={}) {
  const req=Readable.from([]);
  Object.assign(req,{body,method,url:'/api/explain',headers:{host:'preview.example',origin:'https://preview.example','content-type':'application/json',...headers},socket:{remoteAddress,localPort:443}});
  let status, result;const responseHeaders={};
  await fn(req,{setHeader(k,v){responseHeaders[k]=v;},set statusCode(v){status=v;},end(v){result=JSON.parse(v);}});
  return {status,body:result,headers:responseHeaders};
}

test('default disabled and missing thinking mode never generate',async()=>{
  let calls=0;
  for(const configuration of [{},{EXPLANATIONS_ENABLED:'true'},{...env(),DEEPSEEK_THINKING:'auto'}]) {
    await withServer(handler({env:configuration,generate:async()=>{calls++;}}),async origin=>{
      assert.equal((await post(origin)).status,503);
    });
  }
  assert.equal(calls,0);
});
test('valid prose is returned and cached by evidence, language, and explicit thinking mode',async()=>{
  let calls=0;const configuration=env();
  await withServer(handler({env:configuration,generate:async()=>{calls++;return {explanation:explanation()};}}),async origin=>{
    const first=await post(origin);
    assert.deepEqual(first.body,{ok:true,explanation:explanation(),cached:false});
    assert.equal(first.headers['cache-control'],'no-store');
    assert.equal((await post(origin)).body.cached,true);
    await post(origin,{...snapshot(),language:'zh'});
    configuration.DEEPSEEK_THINKING='disabled';await post(origin);
    assert.equal(calls,3);
  });
});
test('production remains disabled even with all feature and preview flags',async()=>{
  const result=await invoke(handler({local:false,env:{...env(),VERCEL_ENV:'production',VERCEL_URL:'preview.example',EXPLANATION_PREVIEW_GUARDS:'verified'},generate:()=>assert.fail('must not call')}));
  assert.equal(result.status,503);
});
test('preview requires explicit guard acknowledgement and exact deployment origin',async()=>{
  const base={...env(),VERCEL_ENV:'preview',VERCEL_URL:'preview.example'};
  assert.equal((await invoke(handler({local:false,env:base}))).status,503);
  const fn=handler({local:false,env:{...base,EXPLANATION_PREVIEW_GUARDS:'verified'}});
  assert.equal((await invoke(fn)).status,200);
  for(const headers of [{origin:''},{origin:'https://evil.example'},{host:'evil.example'}]) {
    assert.equal((await invoke(fn,{headers})).status,403);
  }
  assert.equal((await invoke(handler({local:false,env:{...base,VERCEL_ENV:'development',EXPLANATION_PREVIEW_GUARDS:'verified'}}))).status,503);
});
test('local handler refuses non-loopback peers and mismatched host/origin',async()=>{
  const fn=handler();
  assert.equal((await invoke(fn,{remoteAddress:'192.0.2.4',headers:{host:'localhost:443',origin:'http://localhost:443'}})).status,403);
  await withServer(fn,async origin=>{
    for(const headers of [{origin:''},{origin:'http://evil.example'},{host:'localhost:1'}]) assert.equal((await post(origin,snapshot(),headers)).status,403);
    assert.equal((await fetch(origin+'/api/explain',{headers:{origin}})).status,405);
    assert.equal((await post(origin,snapshot(),{'content-type':'text/plain'})).status,415);
  });
});
test('strict input validation and byte limits apply to streamed and parsed bodies',async()=>{
  let calls=0;const fn=handler({generate:async()=>{calls++;return {explanation:explanation()};}});
  await withServer(fn,async origin=>{
    for(const body of ['{',{...snapshot(),prompt:'override'},{...snapshot(),candidates:[{...snapshot().candidates[0],id:'invalid id'}]}]) assert.equal((await post(origin,body)).status,400);
    assert.equal((await post(origin,{text:'x'.repeat(65537)})).status,413);
  });
  const preview=handler({local:false,env:{...env(),VERCEL_ENV:'preview',VERCEL_URL:'preview.example',EXPLANATION_PREVIEW_GUARDS:'verified'}});
  assert.equal((await invoke(preview,{body:{text:'x'.repeat(65537)}})).status,413);
  assert.equal(calls,0);
});
test('invalid outputs and provider diagnostics are neither exposed nor cached',async()=>{
  let calls=0;
  await withServer(handler({generate:async()=>{calls++;return {explanation:{...explanation(),candidates:[{id:'invented',text:'Invalid candidate'}]}};}}),async origin=>{
    for(let i=0;i<2;i++) assert.deepEqual((await post(origin)).body,{ok:false,reason:'invalid_response'});
    assert.equal(calls,2);
  });
  await withServer(handler({generate:async()=>{throw Object.assign(new Error('SECRET raw provider body'),{code:'private_error',metrics:{reasoning_content:'private'}});}}),async origin=>{
    assert.deepEqual((await post(origin)).body,{ok:false,reason:'generation_failed'});
  });
});
test('single-instance budget bounds failed attempts and resets after one minute',async()=>{
  let time=0,calls=0;
  await withServer(handler({now:()=>time,generate:async()=>{calls++;throw new Error('failure');}}),async origin=>{
    for(let i=0;i<6;i++) assert.equal((await post(origin)).status,502);
    const limited=await post(origin);assert.equal(limited.status,429);assert.equal(limited.headers['retry-after'],'60');
    time=60000;assert.equal((await post(origin)).status,502);assert.equal(calls,7);
  });
});
test('concurrent generation is rejected and a failed request releases the slot',async()=>{
  let release,started;const ready=new Promise(resolve=>{started=resolve;});const pending=new Promise(resolve=>{release=resolve;});
  await withServer(handler({generate:async()=>{started();await pending;throw Object.assign(new Error('timeout'),{code:'timeout'});}}),async origin=>{
    const first=post(origin);await ready;assert.equal((await post(origin)).status,409);release();assert.equal((await first).status,504);
    assert.equal((await post(origin)).status,504);
  });
});
test('disconnect aborts generation and aborted data is not cached',async()=>{
  let started,signal;const ready=new Promise(resolve=>{started=resolve;});let aborted;
  const stopped=new Promise(resolve=>{aborted=resolve;});
  await withServer(handler({generate:async(_snapshot,options)=>{
    signal=options.signal;started();return new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted();reject(Object.assign(new Error('aborted'),{code:'aborted'}));},{once:true}));
  }}),async origin=>{
    const req=request(origin+'/api/explain',{method:'POST',headers:{origin,'content-type':'application/json'}});req.on('error',()=>{});req.end(JSON.stringify(snapshot()));
    await ready;req.destroy();await stopped;assert.equal(signal.aborted,true);
  });
});
