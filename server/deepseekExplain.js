import { validateExplanationSnapshot, validateExplanationResponse } from '../src/explanationEvidence.js';
import { buildExplanationMessages } from './explanationPrompt.js';

export const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const DEEPSEEK_MODEL = 'deepseek-flash';
const INPUT_LIMIT = 65536;
const OUTPUT_LIMIT = 131072;
const finishReasons = new Set(['stop','length','content_filter','tool_calls','insufficient_system_resource','aborted']);
const errorCodes = new Set(['bad_request','payload_too_large','output_limit','invalid_response','auth_required','rate_limited','model_unavailable','generation_failed','timeout','aborted']);
const failure = code => Object.assign(new Error(code), {code});
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const usageMetrics = usage => ({
  promptTokens:count(usage?.prompt_tokens),
  completionTokens:count(usage?.completion_tokens),
  totalTokens:count(usage?.total_tokens),
  // Never derive reasoning usage from prose length or the completion total.
  reasoningTokens:count(usage?.completion_tokens_details?.reasoning_tokens),
  cacheHitTokens:count(usage?.prompt_cache_hit_tokens),
  cacheMissTokens:count(usage?.prompt_cache_miss_tokens),
});

export function createDeepSeekGenerator({apiKey,thinking,maxTokens=4096,timeoutMs=25000,fetchImpl=globalThis.fetch}={}) {
  // No process.env reads here: the server boundary must supply configuration.
  if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 1024 || /[\s\u0000-\u001f\u007f]/.test(apiKey)) throw failure('auth_required');
  if (!['enabled','disabled'].includes(thinking)
      || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192
      || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000
      || typeof fetchImpl !== 'function') throw failure('configuration_required');

  return async (input,{signal}={}) => {
    const started = performance.now();
    let finishReason = null;
    let usage = usageMetrics();
    const metrics = () => ({elapsedMs:Math.max(0,Math.round(performance.now()-started)),finishReason,truncated:finishReason === 'length',usage});
    let snapshot;
    try {
      const serialized = JSON.stringify(input);
      if (typeof serialized !== 'string') throw failure('bad_request');
      if (Buffer.byteLength(serialized,'utf8') > INPUT_LIMIT) throw failure('payload_too_large');
      snapshot = validateExplanationSnapshot(input);
    } catch (cause) {
      throw failure(cause?.code === 'payload_too_large' ? 'payload_too_large' : 'bad_request');
    }
    if (signal?.aborted) throw Object.assign(failure('aborted'),{metrics:metrics()});

    const controller = new AbortController();
    let reader;
    let cancelled = false;
    let interruptedBy;
    let rejectInterrupted;
    const interrupted = new Promise((_resolve,reject) => {rejectInterrupted=reject;});
    const cancelReader = () => {
      if (reader && !cancelled) {
        cancelled = true;
        // Do not await a remote stream's cancellation acknowledgement.
        Promise.resolve(reader.cancel()).catch(() => {});
      }
    };
    const interrupt = code => {
      if (interruptedBy) return;
      interruptedBy = code;
      controller.abort();
      cancelReader();
      rejectInterrupted(failure(code));
    };
    const onAbort = () => interrupt('aborted');
    signal?.addEventListener('abort',onAbort,{once:true});
    const timer = setTimeout(() => interrupt('timeout'),timeoutMs);
    try {
      const operation = (async () => {
        const response = await fetchImpl(DEEPSEEK_ENDPOINT,{
          method:'POST',redirect:'error',signal:controller.signal,
          headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},
          body:JSON.stringify({model:DEEPSEEK_MODEL,thinking:{type:thinking},max_tokens:maxTokens,
            response_format:{type:'json_object'},stream:false,tool_choice:'none',messages:buildExplanationMessages(snapshot)}),
        });
        if (interruptedBy) {
          Promise.resolve(response.body?.cancel()).catch(() => {});
          throw failure(interruptedBy);
        }
        if (!response.ok) {
          // Error bodies are not useful evidence and can contain private diagnostics.
          Promise.resolve(response.body?.cancel()).catch(() => {});
          throw failure(({401:'auth_required',403:'auth_required',429:'rate_limited',503:'model_unavailable'})[response.status] || 'generation_failed');
        }
        if (Number(response.headers.get('content-length')) > OUTPUT_LIMIT) {
          Promise.resolve(response.body?.cancel()).catch(() => {});
          throw failure('output_limit');
        }
        if (!response.body) throw failure('invalid_response');
        reader = response.body.getReader();
        const chunks=[];
        let bytes=0;
        while (true) {
          const {done,value} = await reader.read();
          if (interruptedBy) throw failure(interruptedBy);
          if (done) break;
          bytes += value.byteLength;
          if (bytes > OUTPUT_LIMIT) {cancelReader();throw failure('output_limit');}
          chunks.push(value);
        }
        let envelope;
        try {envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
        catch {throw failure('invalid_response');}
        // Copy only numeric counters and an enumerated reason; reasoning_content is never retained or exposed.
        usage = usageMetrics(envelope?.usage);
        const choice = envelope?.choices?.[0];
        finishReason = finishReasons.has(choice?.finish_reason) ? choice.finish_reason : null;
        if (!Array.isArray(envelope?.choices) || envelope.choices.length !== 1 || finishReason !== 'stop'
            || choice?.message?.role !== 'assistant' || choice.message.tool_calls?.length
            || typeof choice.message.content !== 'string' || !choice.message.content.trim()) throw failure('invalid_response');
        try {return validateExplanationResponse(JSON.parse(choice.message.content),snapshot);}
        catch {throw failure('invalid_response');}
      })();
      const explanation = await Promise.race([operation,interrupted]);
      return {explanation,metrics:metrics()};
    } catch (cause) {
      cancelReader();
      const code = interruptedBy || (errorCodes.has(cause?.code) ? cause.code : 'generation_failed');
      // Construct a fresh error; never forward fetch/provider messages, stacks, causes or bodies.
      throw Object.assign(failure(code),{metrics:metrics()});
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort',onAbort);
    }
  };
}
