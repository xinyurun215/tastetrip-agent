// Explicit local synthetic Qloo fixture. It never loads .env or contacts Qloo.
// node scripts/explanation-demo.js [--real-explain]
// --real-explain permits ONE fresh Codex generation; it is never an automatic fallback.
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { handleQlooRequest } from '../server/handleQloo.js';
import { createCommonFixture } from './common-fixture.js';

const scenarios = new Set(['default','no-common-five','partial-invalid','all-invalid','no-preference','malformed','timeout','stale']);
const scenarioOf = req => {
  try { const name=new URL(req.headers.referer || 'http://127.0.0.1').searchParams.get('scenario'); return scenarios.has(name) ? name : 'default'; }
  catch { return 'default'; }
};

export function markExplanationFixture(result, scenario) {
  if (!result.ok || !result.insight) return result;
  const insight=result.insight;
  insight.evidenceKind='synthetic';
  for(const item of insight.pool || []) item.sourceTag='mock:fixture';
  for(const member of insight.members || []) {
    for(const item of member.entities || []) item.sourceTag='mock:fixture';
    for(const preference of member.preferences || []) for(const item of preference.matches || []) item.sourceTag='mock:fixture';
    if(!['partial-invalid','all-invalid'].includes(scenario)) continue;
    const ranking=insight.rankings?.find(item=>item.memberId===member.id);
    if(!ranking || !member.entities?.length) continue;
    const failed=scenario==='all-invalid' ? member.entities : member.entities.slice(0,1);
    ranking.warnings=[...(ranking.warnings || []),{type:'not_found','signal.interests.entities':failed.map(item=>item.id)}];
  }
  return result;
}

export function syntheticExplanation(snapshot) {
  const en=snapshot.language==='en';
  const summary=en ? 'Synthetic evidence only. Compare the returned preference support and gaps below.'
    : '以下仅为合成证据的文字说明，请结合各成员已返回的偏好依据与缺失信息比较。';
  return {summary,candidates:snapshot.candidates.map(candidate=>{
    const supported=candidate.evidence.flatMap(item=>item.contributions).filter((name,index,all)=>all.indexOf(name)===index).slice(0,2);
    const hasGap=candidate.evidence.some(item=>item.missingExplanation || item.unavailablePreferences.length);
    const text=supported.length ? (en ? `Returned support: ${supported.join(', ')}.${hasGap ? ' Some preference evidence is missing.' : ''}`
      : `已返回的偏好依据：${supported.join('、')}。${hasGap ? '部分偏好依据缺失。' : ''}`)
      : (en ? 'No usable preference explanation was returned; some evidence is unavailable.' : '没有返回可用的偏好解释，部分依据不可用。');
    return {id:candidate.id,text};
  })};
}

export async function startExplanationDemo({realExplain=false,createMiddleware}={}) {
  const {createLocalExplainMiddleware,createCodexGenerator}=await import('../server/localExplain.js');
  const fixture=createCommonFixture(), qlooCaches=new Map(), middlewareByScenario=new Map();
  const records=[], generations=[];
  let realInvocationCount=0;
  const realGenerator=realExplain ? createCodexGenerator() : null;
  const counters=()=>({kind:'SYNTHETIC QLOO FIXTURE; no real Qloo requests',realExplain,realInvocationCount,
    generationCount:generations.length,generations,records});
  function middlewareFor(scenario) {
    if(!middlewareByScenario.has(scenario)) {
      middlewareByScenario.set(scenario,(createMiddleware || createLocalExplainMiddleware)({generate:async snapshot=>{
        if(realExplain && realInvocationCount>=1) throw Object.assign(new Error('Single real generation already used'),{code:'generation_failed'});
        const entry={scenario,language:snapshot.language,candidateIds:snapshot.candidates.map(item=>item.id),
          source:snapshot.source,memberStatuses:snapshot.members.map(item=>item.status),startedAt:new Date().toISOString(),finished:false};
        generations.push(entry);
        try {
          if(realExplain) {realInvocationCount++;return await realGenerator(snapshot);}
          if(scenario==='timeout') throw Object.assign(new Error('Synthetic timeout'),{code:'timeout'});
          if(scenario==='stale') await new Promise(resolve=>setTimeout(resolve,1800));
          if(scenario==='malformed') return {summary:'Synthetic malformed response',candidates:[{id:'not-in-snapshot',text:'Must never be rendered.'}]};
          return syntheticExplanation(snapshot);
        } finally {entry.finished=true;entry.finishedAt=new Date().toISOString();}
      }}));
    }
    return middlewareByScenario.get(scenario);
  }
  const server=await createServer({configFile:false,envFile:false,
    server:{host:'127.0.0.1',port:5198,strictPort:true},
    plugins:[{name:'explicit-local-explanation-fixture',
      transformIndexHtml(html) {
        const mode=realExplain ? 'ONE real ChatGPT-account explanation allowed' : 'FAKE explanations; no model calls';
        return html.replace('<body>',`<body style="padding-bottom:48px"><div id="synthetic-fixture-banner" role="note" style="position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#502b1b;color:white;text-align:center;padding:10px;font:13px sans-serif">SYNTHETIC FIXTURE — no Qloo calls — ${mode}</div>`);
      },
      configureServer(vite) {
        vite.middlewares.use(async(req,res,next)=>{
          const pathname=(req.url || '').split('?')[0];
          if(pathname==='/__qa') {
            res.setHeader('content-type','application/json; charset=utf-8');
            if(req.method!=='GET') {res.statusCode=405;res.end('{"ok":false}');return;}
            res.end(JSON.stringify(counters()));return;
          }
          const scenario=scenarioOf(req);
          if(pathname==='/api/explain') return middlewareFor(scenario)(req,res,next);
          if(pathname!=='/api/qloo') return next();
          res.setHeader('content-type','application/json; charset=utf-8');
          if(req.method!=='POST') {res.statusCode=405;res.end('{"ok":false,"reason":"method_not_allowed"}');return;}
          try {
            const chunks=[];let size=0;
            for await(const chunk of req) {size+=chunk.length;if(size>65536) throw new Error('Fixture body too large');chunks.push(chunk);}
            const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if(!qlooCaches.has(scenario)) qlooCaches.set(scenario,new Map());
            const calls=[];
            const result=markExplanationFixture(await handleQlooRequest(body,{env:{QLOO_API_KEY:'synthetic-fixture-only'},
              cache:qlooCaches.get(scenario),fetchImpl:fixture.transport({scenario:'default',calls})}),scenario);
            records.push({scenario,mode:String(body.mode || 'legacy').slice(0,40),calls:calls.length,ok:result.ok,
              memberCount:Array.isArray(body.members)?body.members.length:0,poolCount:result.insight?.pool?.length || 0});
            res.end(JSON.stringify(result));
          } catch {res.statusCode=400;res.end('{"ok":false,"reason":"synthetic_fixture_error"}');}
        });
      },
    }],
  });
  await server.listen();
  console.log(`SYNTHETIC FIXTURE — no Qloo calls — http://127.0.0.1:5198 — ${realExplain ? 'ONE real explanation enabled' : 'fake explanations only'}`);
  return server;
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const args=process.argv.slice(2);
  if(args.some(arg=>arg!=='--real-explain')) throw new Error('Supported option: --real-explain');
  await startExplanationDemo({realExplain:args.includes('--real-explain')});
}
