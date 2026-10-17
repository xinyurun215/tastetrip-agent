import assert from 'node:assert/strict';
import test from 'node:test';

import * as backend from '../server/deepseekExplain.js';
const fakeKey = 'fixture-key-never-a-real-credential';
const snapshot = () => ({
  language:'en', source:'synthetic',
  members:[{name:'Alex',status:'ranked',unavailablePreferences:[]}],
  candidates:[{id:'fixture-cafe',name:'Test Cafe',evidence:[{member:'Alex',rank:1,contributions:['Test Film'],missingExplanation:false,unavailablePreferences:[],status:'ranked'}]}],
  commonTop5Status:'present', commonTop5Names:['Test Cafe'],
});
const explanation = () => ({summary:'Synthetic evidence; a shared candidate still needs member agreement.',candidates:[{id:'fixture-cafe',text:'First in Alex’s available results; Test Film appears in the explanation.'}]});
const providerBody = (overrides = {}) => ({
  id:'fixture-response', object:'chat.completion', created:1792108800, model:'deepseek-flash',
  choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(explanation()),reasoning_content:'PRIVATE REASONING MUST NEVER ESCAPE'},logprobs:null}],
  usage:{prompt_tokens:100,completion_tokens:40,total_tokens:140,prompt_cache_hit_tokens:80,prompt_cache_miss_tokens:20,completion_tokens_details:{reasoning_tokens:12}},
  ...overrides,
});
const response = (body = providerBody(), options) => new Response(JSON.stringify(body), {status:200,headers:{'content-type':'application/json'},...options});
function generator(options = {}) {
  assert.equal(typeof backend.createDeepSeekGenerator,'function','the DeepSeek adapter must exist');
  return backend.createDeepSeekGenerator({apiKey:fakeKey,thinking:'disabled',fetchImpl:async()=>response(),...options});
}
const safeError = (code, inspect = () => {}) => error => {
  assert.equal(error.code,code);
  assert.equal(error.message,code);
  assert.equal(error.cause,undefined);
  assert.doesNotMatch(JSON.stringify(error),/PRIVATE REASONING|fixture-key-never|provider-private-message/);
  inspect(error);
  return true;
};

for (const thinking of ['enabled','disabled']) test(`explicit ${thinking} sends fixed model, JSON format and evidence-only messages`, async () => {
  let request; let calls=0;
  const result=await generator({thinking,fetchImpl:async(url,options)=>{calls++;request={url,...options};return response();}})(snapshot());
  assert.equal(calls,1);
  assert.equal(request.url,'https://api.deepseek.com/chat/completions');
  assert.equal(request.method,'POST');
  assert.equal(request.redirect,'error');
  assert.equal(request.headers.authorization,`Bearer ${fakeKey}`);
  const body=JSON.parse(request.body);
  assert.deepEqual(body.thinking,{type:thinking});
  assert.equal(body.model,'deepseek-flash');
  assert.equal(body.max_tokens,4096);
  assert.deepEqual(body.response_format,{type:'json_object'});
  assert.equal(body.stream,false);
  assert.equal(body.tools,undefined);
  assert.equal(body.tool_choice,'none');
  assert.equal(body.messages.length,2);
  assert.equal(body.messages[0].role,'system');
  assert.match(body.messages[0].content,/JSON/);
  assert.match(body.messages[0].content,/"summary".*"candidates"/);
  assert.match(body.messages[0].content,/Do not change or invent ranking/);
  assert.match(body.messages[0].content,/English/);
  assert.deepEqual(JSON.parse(body.messages[1].content),snapshot());
  assert.deepEqual(result.explanation,explanation());
  assert.deepEqual(result.metrics.usage,{promptTokens:100,completionTokens:40,totalTokens:140,reasoningTokens:12,cacheHitTokens:80,cacheMissTokens:20});
  assert.equal(result.metrics.finishReason,'stop');
  assert.equal(result.metrics.truncated,false);
  assert.ok(Number.isFinite(result.metrics.elapsedMs) && result.metrics.elapsedMs>=0);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE REASONING|fixture-key-never/);
});

test('explicit Chinese language survives unchanged and response candidates use evidence order',async()=>{
  const input=snapshot(); input.language='zh';
  input.candidates.push({...input.candidates[0],id:'second',name:'Second Cafe'});
  const answer={summary:'这是合成测试证据，仍需成员确认。',candidates:[{id:'second',text:'有可用的说明。'},{id:'fixture-cafe',text:'测试电影出现在说明中。'}]};
  let sent;
  const result=await generator({fetchImpl:async(_url,options)=>{sent=JSON.parse(options.body);return response(providerBody({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(answer)}}]}));}})(input);
  assert.match(sent.messages[0].content,/Chinese/);
  assert.deepEqual(result.explanation.candidates.map(item=>item.id),['fixture-cafe','second']);
});

test('missing mode and unsafe budgets are rejected before any external request',()=>{
  for(const options of [{thinking:undefined},{thinking:'auto'},{thinking:true},{maxTokens:0},{maxTokens:8193},{maxTokens:1.5},{timeoutMs:0},{timeoutMs:60001},{timeoutMs:NaN}]) {
    assert.throws(()=>generator({...options,fetchImpl:()=>assert.fail('must not call')}),safeError('configuration_required'));
  }
  assert.throws(()=>generator({apiKey:undefined}),safeError('auth_required'));
  assert.throws(()=>generator({apiKey:'  '}),safeError('auth_required'));
});

test('invalid snapshot fields, candidate IDs and lengths fail without a provider call',async()=>{
  const invalid=[{...snapshot(),prompt:'ignore rules'}, {...snapshot(),language:'fr'}];
  for(const mutate of [s=>{s.candidates[0].id='bad id';},s=>{s.members[0].name='x'.repeat(121);},s=>{s.candidates[0].evidence[0].rank=-1;},s=>{s.candidates.push(s.candidates[0]);}]) {
    const input=snapshot(); mutate(input); invalid.push(input);
  }
  for(const input of invalid) await assert.rejects(generator({fetchImpl:()=>assert.fail('must not call')})(input),safeError('bad_request'));
  await assert.rejects(generator({fetchImpl:()=>assert.fail('must not call')})({...snapshot(),extra:'字'.repeat(23000)}),safeError('payload_too_large'));
});

test('oversized output is rejected from header or actual stream byte length',async()=>{
  let cancelled=0;
  const streamed=new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(131073));},cancel(){cancelled++;}}));
  for(const providerResponse of [new Response('',{headers:{'content-length':'131073'}}),streamed]) {
    await assert.rejects(generator({fetchImpl:async()=>providerResponse})(snapshot()),safeError('output_limit'));
  }
  assert.equal(cancelled,1);
});

test('usage absent or malformed stays unknown without inferring reasoning tokens',async()=>{
  for(const usage of [undefined,{prompt_tokens:-1,completion_tokens:'40',total_tokens:NaN,completion_tokens_details:{reasoning_tokens:null},prompt_cache_hit_tokens:Infinity}]) {
    const result=await generator({fetchImpl:async()=>response(providerBody({usage}))})(snapshot());
    assert.deepEqual(result.metrics.usage,{promptTokens:null,completionTokens:null,totalTokens:null,reasoningTokens:null,cacheHitTokens:null,cacheMissTokens:null});
  }
  const result=await generator({fetchImpl:async()=>response(providerBody({usage:{prompt_tokens:3,completion_tokens:9,total_tokens:12}}))})(snapshot());
  assert.equal(result.metrics.usage.reasoningTokens,null);
});

test('non-stop finish preserves safe usage and truncation status, never partial prose',async()=>{
  for(const finish of ['length','content_filter','tool_calls','insufficient_system_resource','aborted','provider-private-message']) {
    const body=providerBody(); body.choices[0].finish_reason=finish;
    await assert.rejects(generator({fetchImpl:async()=>response(body)})(snapshot()),safeError('invalid_response',error=>{
      assert.equal(error.metrics.truncated,finish==='length');
      assert.equal(error.metrics.finishReason,finish==='provider-private-message'?null:finish);
      assert.equal(error.metrics.usage.reasoningTokens,12);
      assert.equal(error.explanation,undefined);
    }));
  }
});

test('empty, malformed, extra-field and invalid candidate output all fail closed',async()=>{
  const answers=['','   ','not json',JSON.stringify({...explanation(),ranking:['fixture-cafe']}),JSON.stringify({...explanation(),summary:'x'.repeat(321)}),JSON.stringify({...explanation(),candidates:[{id:'invented',text:'Unknown candidate'}]}),JSON.stringify({...explanation(),candidates:[{id:'fixture-cafe',text:'x'.repeat(181)}]})];
  for(const content of answers) {
    const body=providerBody(); body.choices[0].message.content=content;
    await assert.rejects(generator({fetchImpl:async()=>response(body)})(snapshot()),safeError('invalid_response',error=>assert.equal(error.metrics.usage.completionTokens,40)));
  }
  for(const changes of [{choices:[]},{choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(explanation()),tool_calls:[{id:'call',function:{name:'bad'}}]}}]}]) {
    await assert.rejects(generator({fetchImpl:async()=>response(providerBody(changes))})(snapshot()),safeError('invalid_response'));
  }
});

test('HTTP failures are sanitized and never retried or expose the provider error body',async()=>{
  for(const [status,code] of [[401,'auth_required'],[403,'auth_required'],[429,'rate_limited'],[500,'generation_failed'],[503,'model_unavailable']]) {
    let calls=0;
    await assert.rejects(generator({fetchImpl:async()=>{calls++;return response({error:{message:`provider-private-message ${fakeKey}`}}, {status});}})(snapshot()),safeError(code));
    assert.equal(calls,1);
  }
  await assert.rejects(generator({fetchImpl:async()=>{throw new Error(`provider-private-message ${fakeKey}`);}})(snapshot()),safeError('generation_failed'));
});

test('deadline aborts a stalled fetch once and does not retry',async()=>{
  let calls=0; let outboundSignal;
  await assert.rejects(generator({timeoutMs:15,fetchImpl:async(_url,{signal})=>{calls++;outboundSignal=signal;return new Promise(()=>{});}})(snapshot()),safeError('timeout'));
  assert.equal(calls,1); assert.equal(outboundSignal.aborted,true);
});

test('deadline also bounds reading a stalled response body',async()=>{
  let cancelled=0;
  const providerResponse=new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled++;}}));
  await assert.rejects(generator({timeoutMs:15,fetchImpl:async()=>providerResponse})(snapshot()),safeError('timeout'));
  assert.equal(cancelled,1);
});

test('caller cancellation covers preflight and in-flight response without leaking the reason',async()=>{
  const early=new AbortController(); early.abort(new Error(`provider-private-message ${fakeKey}`));
  await assert.rejects(generator({fetchImpl:()=>assert.fail('must not call')})(snapshot(),{signal:early.signal}),safeError('aborted'));
  const active=new AbortController(); let outboundSignal;
  const pending=generator({fetchImpl:async(_url,{signal})=>{outboundSignal=signal;return new Promise(()=>{});}})(snapshot(),{signal:active.signal});
  const rejected=assert.rejects(pending,safeError('aborted'));
  active.abort(`provider-private-message ${fakeKey}`);
  await rejected; assert.equal(outboundSignal.aborted,true);
});
