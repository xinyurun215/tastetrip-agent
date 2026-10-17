import { validateExplanationSnapshot, validateExplanationResponse } from '../src/explanationEvidence.js';

const BODY_LIMIT=65536;
const STATUS={disabled:503,configuration_required:503,auth_required:503,forbidden:403,method_not_allowed:405,
  unsupported_media_type:415,payload_too_large:413,bad_request:400,busy:409,rate_limited:429,
  model_unavailable:503,timeout:504,aborted:499,output_limit:502,invalid_response:502,generation_failed:502};
const fail=code=>Object.assign(new Error(code),{code});

function localOrigin(req) {
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) return null;
  const host=req.headers.host;
  if(typeof host!=='string' || !/^(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/.test(host)) return null;
  try {
    const url=new URL(`http://${host}`);
    return Number(url.port || 80)===req.socket.localPort ? `http://${host}` : null;
  } catch {return null;}
}

function allowedOrigin(req,env,local) {
  if(local && !env.VERCEL_ENV) return localOrigin(req);
  if(env.VERCEL_ENV!=='preview' || env.EXPLANATION_PREVIEW_GUARDS!=='verified') return null;
  // VERCEL_URL is a platform-provided deployment hostname, never a request header.
  const host=env.VERCEL_URL;
  if(typeof host!=='string' || !/^[a-z0-9][a-z0-9.-]*$/i.test(host) || req.headers.host!==host) return null;
  return `https://${host}`;
}

async function readBody(req) {
  if(req.body!==undefined) {
    const text=typeof req.body==='string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
    if(Buffer.byteLength(text)>BODY_LIMIT) throw fail('payload_too_large');
    return JSON.parse(text);
  }
  return new Promise((resolve,reject)=>{
    const chunks=[];let size=0;
    const cleanup=()=>{clearTimeout(timer);req.off('data',data);req.off('end',end);req.off('error',error);req.off('aborted',error);};
    const stop=code=>{cleanup();req.resume();reject(fail(code));};
    const data=chunk=>{size+=chunk.length;if(size>BODY_LIMIT) stop('payload_too_large');else chunks.push(chunk);};
    const error=()=>stop('bad_request');
    const end=()=>{cleanup();try {resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));} catch {reject(fail('bad_request'));}};
    const timer=setTimeout(()=>stop('timeout'),2000);
    req.on('data',data);req.on('end',end);req.on('error',error);req.on('aborted',error);
  });
}

export function createExplainHandler({env={},local=false,generate,fetchImpl=globalThis.fetch,now=Date.now}={}) {
  // These guards/cache are per process only. Preview authentication and platform
  // rate limiting must be configured separately before enabling paid calls.
  let active=false,windowStart=now(),attempts=0;
  const cache=new Map();
  return async function explain(req,res) {
    const send=(status,body)=>{
      if(res.destroyed || res.writableEnded) return;
      res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');
      res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.end(JSON.stringify(body));
    };
    const error=reason=>send(STATUS[reason] || 502,{ok:false,reason});
    if(req.method!=='POST') {res.setHeader('allow','POST');error('method_not_allowed');return;}
    if(env.EXPLANATIONS_ENABLED!=='true' || env.VERCEL_ENV==='production') {error('disabled');return;}
    if(!['enabled','disabled'].includes(env.DEEPSEEK_THINKING)) {error('configuration_required');return;}
    if(!(local && !env.VERCEL_ENV) && (env.VERCEL_ENV!=='preview' || env.EXPLANATION_PREVIEW_GUARDS!=='verified')) {error('configuration_required');return;}
    const origin=allowedOrigin(req,env,local);
    // CSRF defense only: Origin/Host are not authentication or rate limiting.
    if(!origin || req.headers.origin!==origin) {error('forbidden');return;}
    if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) {error('unsupported_media_type');return;}
    if(Number(req.headers['content-length'])>BODY_LIMIT) {req.resume?.();error('payload_too_large');return;}
    let snapshot;
    try {snapshot=validateExplanationSnapshot(await readBody(req));}
    catch(cause) {error(['payload_too_large','timeout'].includes(cause?.code)?cause.code:'bad_request');return;}
    const key=JSON.stringify([env.DEEPSEEK_THINKING,snapshot]);
    const hit=cache.get(key);
    if(hit && now()-hit.at<300000) {send(200,{ok:true,explanation:hit.explanation,cached:true});return;}
    if(hit) cache.delete(key);
    if(active) {error('busy');return;}
    if(now()-windowStart>=60000) {windowStart=now();attempts=0;}
    if(attempts>=6) {res.setHeader('retry-after',String(Math.max(1,Math.ceil((60000-(now()-windowStart))/1000))));error('rate_limited');return;}
    const controller=new AbortController();
    const cancel=()=>{if(!res.writableEnded) controller.abort();};
    req.once?.('aborted',cancel);res.once?.('close',cancel);
    active=true;attempts++;
    try {
      const generator=generate || (await import('./deepseekExplain.js')).createDeepSeekGenerator({
        apiKey:env.DEEPSEEK_API_KEY,thinking:env.DEEPSEEK_THINKING,maxTokens:4096,timeoutMs:25000,fetchImpl,
      });
      const result=await generator(snapshot,{signal:controller.signal});
      if(controller.signal.aborted) throw fail('aborted');
      let explanation;
      try {explanation=validateExplanationResponse(result.explanation,snapshot);} catch {throw fail('invalid_response');}
      if(cache.size>=16) cache.delete(cache.keys().next().value);
      cache.set(key,{at:now(),explanation});
      send(200,{ok:true,explanation,cached:false});
    } catch(cause) {error(Object.hasOwn(STATUS,cause?.code)?cause.code:'generation_failed');}
    finally {active=false;req.off?.('aborted',cancel);res.off?.('close',cancel);}
  };
}
