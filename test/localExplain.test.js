import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request } from 'node:http';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import { access } from 'node:fs/promises';

import * as backend from '../server/localExplain.js';
const snapshot = () => ({
  language:'zh', source:'synthetic',
  members:[{name:'甲',status:'ranked',unavailablePreferences:[]}],
  candidates:[{id:'fixture-cafe',name:'测试咖啡馆',evidence:[{member:'甲',rank:1,contributions:['测试电影'],missingExplanation:false,unavailablePreferences:[],status:'ranked'}]}],
  commonTop5Status:'present', commonTop5Names:['测试咖啡馆'],
});
const explanation = () => ({summary:'合成数据中的共同候选，仍需操作者确认。',candidates:[{id:'fixture-cafe',text:'在甲的有效返回中排第一；测试电影列入解释。'}]});
const middleware = options => {
  assert.equal(typeof backend.createLocalExplainMiddleware, 'function', 'local-only middleware must exist');
  return backend.createLocalExplainMiddleware(options);
};
async function withServer(handler, action) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { return await action(origin); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const post = (origin, body = snapshot(), headers = {}) => new Promise((resolve,reject) => {
  const req=request(`${origin}/api/explain`,{method:'POST',headers:{origin,'content-type':'application/json',...headers}},res=>{
    let text=''; res.setEncoding('utf8'); res.on('data',chunk=>{text+=chunk;});
    res.on('end',()=>resolve({status:res.statusCode,json:async()=>JSON.parse(text)}));
  });
  req.on('error',reject); req.end(JSON.stringify(body));
});

test('local explanation returns only validated prose and caches the same evidence and language', async () => {
  let calls = 0;
  await withServer(middleware({generate:async () => { calls++; return explanation(); }}), async origin => {
    const first = await post(origin);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), {ok:true,explanation:explanation(),cached:false});
    assert.deepEqual(await (await post(origin)).json(), {ok:true,explanation:explanation(),cached:true});
    await post(origin, {...snapshot(),language:'en'});
    assert.equal(calls, 2);
  });
});

test('request boundary rejects missing/mismatched Origin, foreign Host and non-JSON without generation', async () => {
  let calls = 0;
  await withServer(middleware({generate:async () => { calls++; return explanation(); }}), async origin => {
    for (const headers of [{origin:''},{origin:'http://evil.example'},{host:'evil.example'},{'content-type':'text/plain'}]) {
      const response = await post(origin, snapshot(), headers);
      assert.ok([403,415].includes(response.status),`headers ${JSON.stringify(headers)} returned ${response.status}`);
      assert.equal((await response.json()).ok, false);
    }
    assert.equal((await fetch(`${origin}/api/explain`, {headers:{origin}})).status, 405);
    assert.equal(calls, 0);
  });
});

test('request boundary rejects a non-loopback peer even with local headers', async () => {
  const handler = middleware({generate:async () => { throw new Error('must not run'); }});
  const req = Readable.from([]);
  Object.assign(req, {method:'POST',url:'/api/explain',headers:{host:'localhost:5173',origin:'http://localhost:5173','content-type':'application/json'},socket:{remoteAddress:'192.0.2.1',localPort:5173}});
  let status; let body;
  await handler(req, {setHeader(){},set statusCode(value){status=value;},end(value){body=JSON.parse(value);}}, () => assert.fail('unexpected next'));
  assert.equal(status, 403);
  assert.deepEqual(body, {ok:false,reason:'forbidden'});
});

test('malformed local port is rejected with a response instead of throwing', async () => {
  const handler=middleware({generate:async()=>assert.fail('must not run')});
  const req=Readable.from([]);
  Object.assign(req,{method:'POST',url:'/api/explain',headers:{host:'localhost:99999',origin:'http://localhost:99999'},socket:{remoteAddress:'127.0.0.1',localPort:5173}});
  let status;
  await assert.doesNotReject(handler(req,{setHeader(){},set statusCode(value){status=value;},end(){}},()=>{}));
  assert.equal(status,403);
});

test('strict payload and body bound prevent generation', async () => {
  let calls = 0;
  await withServer(middleware({generate:async () => { calls++; return explanation(); }}), async origin => {
    assert.equal((await post(origin, {...snapshot(),prompt:'arbitrary instruction'})).status, 400);
    assert.equal((await post(origin, {text:'x'.repeat(65537)})).status, 413);
    assert.equal(calls, 0);
  });
});

test('only one generation can run at a time and failures are fixed codes without raw logs', async () => {
  let release; let started;
  const ready = new Promise(resolve => {started=resolve;});
  const pending = new Promise(resolve => {release=resolve;});
  await withServer(middleware({generate:async () => {started(); await pending; throw new Error('secret diagnostic must not escape');}}), async origin => {
    const first = post(origin);
    await ready;
    const second = await post(origin);
    assert.equal(second.status, 409);
    assert.deepEqual(await second.json(), {ok:false,reason:'busy'});
    release();
    assert.deepEqual(await (await first).json(), {ok:false,reason:'generation_failed'});
  });
});

test('invalid generated IDs are rejected instead of displayed or cached', async () => {
  let calls=0;
  await withServer(middleware({generate:async () => {calls++; return {...explanation(),candidates:[{id:'invented',text:'不能显示'}]};}}), async origin => {
    for(let i=0;i<2;i++) assert.deepEqual(await (await post(origin)).json(), {ok:false,reason:'invalid_response'});
    assert.equal(calls,2);
  });
});

function processes({auth='Logged in using ChatGPT',event,exitCode=0,authExit=0}={}) {
  const calls=[]; const killed=[];
  const spawnImpl = (file,args,options) => {
    const child = new EventEmitter();
    Object.assign(child,{pid:1000+calls.length,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()});
    let input=''; child.stdin.on('data',chunk => {input+=chunk;});
    const call={file,args,options,child,get input(){return input;}}; calls.push(call);
    child.stdin.on('finish',() => queueMicrotask(() => {
      if(args[0]==='login') child.stdout.write(auth);
      else child.stdout.write(event ?? `${JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(explanation())}})}\n${JSON.stringify({type:'turn.completed'})}\n`);
      child.stdout.end(); child.stderr.end(); child.emit('close',args[0]==='login'?authExit:exitCode);
    }));
    return child;
  };
  return {calls,killed,spawnImpl,terminate:async child => {killed.push(child.pid);child.emit('close',1);}};
}

test('subprocess uses only fixed ChatGPT/model arguments, sanitized environment and an empty temporary cwd', async () => {
  assert.equal(typeof backend.createCodexGenerator,'function');
  const fixture=processes();
  const result=await backend.createCodexGenerator({...fixture,environment:{PATH:'safe-path',TEMP:process.env.TEMP,OPENAI_API_KEY:'must-not-copy',CODEX_API_KEY:'must-not-copy',HTTP_PROXY:'must-not-copy'}})(snapshot());
  assert.deepEqual(result,explanation());
  assert.equal(fixture.calls.length,2);
  assert.deepEqual(fixture.calls[0].args,['login','status']);
  const call=fixture.calls[1];
  assert.equal(call.options.shell,false);
  assert.equal(call.options.windowsHide,true);
  assert.deepEqual(Object.keys(call.options.env).sort(),['PATH','TEMP']);
  assert.ok(call.args.includes('gpt-6-luna'));
  assert.ok(call.args.includes('forced_login_method="chatgpt"'));
  assert.ok(call.args.includes('--ignore-user-config'));
  assert.ok(call.args.includes('--ephemeral'));
  assert.equal(call.input.includes('测试咖啡馆'),true);
  await assert.rejects(access(call.options.cwd));
});

test('subprocess refuses non-ChatGPT auth without an inference attempt', async () => {
  assert.equal(typeof backend.createCodexGenerator,'function');
  const fixture=processes({auth:'Logged in using an API key'});
  await assert.rejects(backend.createCodexGenerator(fixture)(snapshot()), error => error.code==='auth_required');
  assert.equal(fixture.calls.length,1);
  const missing=processes({auth:'Not logged in',authExit:1});
  await assert.rejects(backend.createCodexGenerator(missing)(snapshot()),error=>error.code==='auth_required');
  assert.equal(missing.calls.length,1);
});

test('subprocess allows nonfatal startup item diagnostics when the turn completes', async () => {
  const fixture=processes({event:[
    {type:'item.completed',item:{type:'error',message:'Duplicate agent role detected'}},
    {type:'item.completed',item:{type:'agent_message',text:JSON.stringify(explanation())}},
    {type:'turn.completed'},
  ].map(JSON.stringify).join('\n')+'\n'});
  assert.deepEqual(await backend.createCodexGenerator(fixture)(snapshot()),explanation());
  assert.deepEqual(fixture.killed,[]);
});

test('ordinary generated prose is not mistaken for an authentication or quota event', async () => {
  const answer={...explanation(),summary:'The literal preference name usage_limit_reached is supplied data.'};
  const fixture=processes({event:[
    {type:'item.completed',item:{type:'agent_message',text:JSON.stringify(answer)}},
    {type:'turn.completed'},
  ].map(JSON.stringify).join('\n')+'\n'});
  assert.deepEqual(await backend.createCodexGenerator(fixture)(snapshot()),answer);
  assert.deepEqual(fixture.killed,[]);
});

test('subprocess stops unexpected tools and model/quota errors without retry', async () => {
  assert.equal(typeof backend.createCodexGenerator,'function');
  for(const [event,code] of [
    [JSON.stringify({type:'item.started',item:{type:'command_execution',command:'forbidden'}}),'tool_not_allowed'],
    [JSON.stringify({type:'error',message:'model_not_found'}),'model_unavailable'],
    [JSON.stringify({type:'error',message:'usage_limit_reached'}),'quota_exceeded'],
  ]) {
    const fixture=processes({event:`${event}\n`});
    await assert.rejects(backend.createCodexGenerator(fixture)(snapshot()),error=>error.code===code);
    assert.equal(fixture.calls.length,2);
    assert.deepEqual(fixture.killed,[1001]);
  }
});

test('subprocess bounds output and kills the owned process', async () => {
  assert.equal(typeof backend.createCodexGenerator,'function');
  const fixture=processes({event:'x'.repeat(262145)});
  await assert.rejects(backend.createCodexGenerator(fixture)(snapshot()),error=>error.code==='output_limit');
  assert.deepEqual(fixture.killed,[1001]);
});

test('subprocess enforces the 60-second deadline without retry', async t => {
  assert.equal(typeof backend.createCodexGenerator,'function');
  t.mock.timers.enable({apis:['setTimeout']});
  const fixture=processes();
  const ordinarySpawn=fixture.spawnImpl;
  let started;
  const ready=new Promise(resolve=>{started=resolve;});
  fixture.spawnImpl=(file,args,options)=>{
    if(args[0]==='login') return ordinarySpawn(file,args,options);
    const child=new EventEmitter();
    Object.assign(child,{pid:1001,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()});
    fixture.calls.push({file,args,options,child});
    child.stdin.on('finish',started);
    return child;
  };
  const result=backend.createCodexGenerator(fixture)(snapshot());
  const rejected=assert.rejects(result,error=>error.code==='timeout');
  await ready;
  t.mock.timers.tick(60000);
  await rejected;
  assert.equal(fixture.calls.length,2);
  assert.deepEqual(fixture.killed,[1001]);
});
