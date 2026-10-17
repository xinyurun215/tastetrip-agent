// Defaults to synthetic, offline responses. No .env loading and no Qloo calls.
// Future live use requires BOTH --live and --confirm-four-calls; never retries.
// node scripts/deepseek-compare.mjs [--fixtures path.json] [--rates path.json] [--output report.json]
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { validateExplanationSnapshot, validateExplanationResponse } from '../src/explanationEvidence.js';
import { EXPLANATION_PROMPT_VERSION, buildExplanationMessages } from '../server/explanationPrompt.js';

const MODES = ['enabled','disabled'];
const TOKEN_KEYS = ['promptTokens','completionTokens','totalTokens','reasoningTokens','cacheHitTokens','cacheMissTokens'];
const ERRORS = new Set(['auth_required','configuration_required','bad_request','payload_too_large','timeout','aborted','rate_limited','model_unavailable','output_limit','invalid_response','generation_failed']);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const token = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

function safeMetrics(value) {
  const finishReason = ['stop','length','content_filter','tool_calls','insufficient_system_resource'].includes(value?.finishReason) ? value.finishReason : null;
  return {elapsedMs:number(value?.elapsedMs),finishReason,
    truncated:finishReason === 'length' || (typeof value?.truncated === 'boolean' ? value.truncated : null),
    usage:Object.fromEntries(TOKEN_KEYS.map(key=>[key,token(value?.usage?.[key])]))};
}

function validateRates(rates) {
  if (rates === null) return null;
  const keys=['currency','inputCacheHitPerMillion','inputCacheMissPerMillion','outputPerMillion'];
  if (!rates || Object.keys(rates).sort().join('|') !== keys.sort().join('|') || !/^[A-Z]{3}$/.test(rates.currency)
      || keys.filter(key=>key!=='currency').some(key=>number(rates[key]) === null)) throw new Error('Invalid explicit rates');
  return rates;
}

export function calculateCost(usage, rates = null) {
  validateRates(rates);
  if (!rates || ['promptTokens','completionTokens','cacheHitTokens','cacheMissTokens'].some(key=>token(usage?.[key]) === null)
      || usage.cacheHitTokens + usage.cacheMissTokens !== usage.promptTokens) return null;
  const amount=(usage.cacheHitTokens * rates.inputCacheHitPerMillion + usage.cacheMissTokens * rates.inputCacheMissPerMillion
    + usage.completionTokens * rates.outputPerMillion) / 1_000_000;
  // completionTokens is billed once; reasoningTokens is a subset when reported.
  return {currency:rates.currency,amount:Number(amount.toFixed(12))};
}

function validateInputs(fixtures, maxTokens, timeoutMs) {
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 25000)
    throw new Error('Invalid bounded budget (max-tokens 1..8192, timeout-ms 1..25000)');
  if (!fixtures || typeof fixtures.label !== 'string' || !fixtures.label.trim() || fixtures.label.length > 200
      || /[\u0000-\u001f\u007f]/.test(fixtures.label) || !Array.isArray(fixtures.snapshots) || fixtures.snapshots.length !== 2)
    throw new Error('Expected a labeled pair of frozen zh/en snapshots');
  const snapshots=fixtures.snapshots.map(validateExplanationSnapshot);
  if (new Set(snapshots.map(snapshot=>snapshot.language)).size !== 2) throw new Error('Expected one zh and one en snapshot');
  const evidenceHashes=snapshots.map(({language,...evidence})=>hash(evidence));
  if (evidenceHashes[0] !== evidenceHashes[1]) throw new Error('Both languages must share the same frozen evidence');
  return snapshots;
}

export async function runComparison({fixtures,generateForMode,maxTokens=4096,timeoutMs=25000,rates=null,mode='mock'}={}) {
  const snapshots=validateInputs(fixtures,maxTokens,timeoutMs);
  validateRates(rates);
  if (!['mock','live'].includes(mode) || typeof generateForMode !== 'function') throw new Error('Invalid comparison configuration');
  const report={schemaVersion:1,mode,model:'deepseek-flash',fixtureLabel:fixtures.label,
    evidenceSource:snapshots[0].source,budget:{maxTokens,timeoutMs,maxCalls:4,retries:0},rates,
    limitations:[
      mode==='mock' ? 'Offline plumbing check only: no model-quality, latency, token, or cost measurement.' : 'One attempt per language and mode: a bounded pilot, not a statistical benchmark.',
      'Evidence accuracy and Chinese/English expression require manual review; structural validation does not prove factual accuracy.',
      'Identical max_tokens caps total completion work; reasoning may consume that budget. Review reasoningTokens and truncated together; budgets are never adjusted automatically.',
      'Missing reasoningTokens means unknown, not zero; no token counts are inferred from text.',
      'Cost is calculated only from explicit rates and complete actual cache/completion usage; completion tokens are not charged twice for reasoning. It is not an invoice.',
      'Alternating mode order reduces a fixed first-call bias; cache effects and network timing still limit latency/cost conclusions.',
    ],contexts:[],runs:[],costTotal:null};
  const generators=new Map(MODES.map(thinking=>[thinking,generateForMode(thinking,{maxTokens,timeoutMs})]));
  for (const [index,snapshot] of snapshots.entries()) {
    const {language,...evidence}=snapshot;
    const messages=buildExplanationMessages(snapshot);
    const context={language,promptVersion:EXPLANATION_PROMPT_VERSION,promptHash:hash(messages),snapshotHash:hash(snapshot),evidenceHash:hash(evidence)};
    report.contexts.push({...context,messages});
    // Counterbalance the order; neither mode is a product default.
    for (const thinking of index === 0 ? MODES : [...MODES].reverse()) {
      const run={...context,thinking,status:'error',explanation:null,error:null,metrics:safeMetrics(null),cost:null,
        manualReview:{evidenceAccuracy:null,languageQuality:null,unsupportedClaims:null,notes:null}};
      try {
        const response=await generators.get(thinking)(structuredClone(snapshot));
        run.metrics=safeMetrics(response?.metrics);
        run.explanation=validateExplanationResponse(response?.explanation,snapshot);
        run.status='ok';
      } catch (error) {
        if (error?.metrics) run.metrics=safeMetrics(error.metrics);
        run.error=ERRORS.has(error?.code) ? error.code : 'generation_failed';
      }
      run.cost=calculateCost(run.metrics.usage,rates);
      report.runs.push(run);
    }
  }
  if (report.runs.every(run=>run.cost !== null)) report.costTotal={currency:rates.currency,amount:Number(report.runs.reduce((sum,run)=>sum+run.cost.amount,0).toFixed(12))};
  return report;
}

function mockGenerator() {
  return async snapshot => ({explanation:{
    summary:snapshot.language==='zh' ? '这是合成测试说明，不能用于判断真实模型效果；请核对已返回的证据与缺失信息。'
      : 'Synthetic test explanation only; this does not measure model quality. Review returned evidence and missing information.',
    candidates:snapshot.candidates.map(candidate=>({id:candidate.id,text:snapshot.language==='zh'
      ? '此处仅验证说明数据格式；请根据冻结证据人工检查偏好支持、缺失信息和排名。'
      : 'This checks the explanation format only; manually review preference support, missing evidence, and rank against the frozen evidence.'})),
  },metrics:safeMetrics(null)});
}

async function readJson(path) {
  const bytes=await readFile(path);
  if (bytes.length > 65536) throw new Error('Fixture or rates file exceeds 64 KiB');
  return JSON.parse(bytes.toString('utf8'));
}

export async function runCli(args=[],dependencies={}) {
  const options={};
  const flags=new Set(['--live','--confirm-four-calls']);
  const values=new Set(['--fixtures','--rates','--max-tokens','--timeout-ms','--output']);
  for (let index=0;index<args.length;index++) {
    const arg=args[index];
    if (Object.hasOwn(options,arg) || (!flags.has(arg) && !values.has(arg))) throw new Error('Unknown or duplicate option');
    if (flags.has(arg)) options[arg]=true;
    else {if (!args[index+1] || args[index+1].startsWith('--')) throw new Error('Missing option value');options[arg]=args[++index];}
  }
  if (options['--live'] && !options['--confirm-four-calls']) throw new Error('--live requires --confirm-four-calls');
  if (options['--confirm-four-calls'] && !options['--live']) throw new Error('--confirm-four-calls requires --live');
  const fixtures=await readJson(options['--fixtures'] || new URL('../test/fixtures/deepseek-synthetic.json',import.meta.url));
  const rates=options['--rates'] ? await readJson(options['--rates']) : null;
  const maxTokens=options['--max-tokens'] === undefined ? 4096 : Number(options['--max-tokens']);
  const timeoutMs=options['--timeout-ms'] === undefined ? 25000 : Number(options['--timeout-ms']);
  // Validate everything before the only branch permitted to read a key.
  validateInputs(fixtures,maxTokens,timeoutMs);validateRates(rates);
  let generateForMode=mockGenerator;
  if (options['--live']) {
    const apiKey=(dependencies.environment ?? process.env).DEEPSEEK_API_KEY;
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('DEEPSEEK_API_KEY must be configured by the operator');
    const create=dependencies.liveGenerator || (await import('../server/deepseekExplain.js')).createDeepSeekGenerator;
    generateForMode=(thinking,budget)=>create({apiKey,thinking,...budget});
  }
  const report=await runComparison({fixtures,generateForMode,maxTokens,timeoutMs,rates,mode:options['--live']?'live':'mock'});
  if (options['--output']) await writeFile(options['--output'],JSON.stringify(report,null,2)+'\n','utf8');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {console.log(JSON.stringify(await runCli(process.argv.slice(2)),null,2));}
  catch {console.error('Comparison did not start. Check the documented flags, frozen fixture, budgets, rates, and (only for confirmed live mode) server key.');process.exitCode=1;}
}
