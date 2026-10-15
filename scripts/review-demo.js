// Local interaction fixture. No credentials, network Qloo calls or recorded responses.
// Run: node scripts/review-demo.js (http://127.0.0.1:5196)
import { createServer } from 'vite';
import { handleQlooRequest } from '../server/handleQloo.js';

const records = [];
const caches = new Map();
const place = (id, index) => ({ entity_id: id, name: `Fixture ${id} Restaurant`, type:'urn:entity:place',
  location:{lat:40.74 + index / 1000,lon:-73.99}, properties:{address:`Synthetic address ${id}`, geocode:{city:'New York',country_code:'US'}},
  tags:[{name:'Restaurant'}], query:{affinity:.9 - index/100} });
const response = data => ({ok:true,status:200,json:async()=>data});
function transport(recheck, calls, scenario) {
  return async url => {
    const u = new URL(url); calls.push(u.pathname + '?' + u.searchParams);
    if (u.pathname === '/search' && u.searchParams.get('types') === 'urn:entity:locality') return response({results:[{
      entity_id:'fixture-ny',name:'New York',type:'urn:entity:locality',location:{lat:40.74,lon:-73.99},
      tags:[{tag_id:'urn:tag:genre:locality:city'}],
    }]});
    if (u.pathname === '/search') return response({results:[{entity_id:`taste:${u.searchParams.get('query')}`,name:u.searchParams.get('query'),type:'urn:entity:artist'}]});
    if (u.pathname === '/v2/tags') {
      const music = /music|jazz|night/.test(u.searchParams.get('filter.query'));
      return response({results:{tags:[{id:`urn:tag:category:place:${music?'jazz_club':'restaurant'}`,name:music?'Jazz Club':'Restaurant'}]}});
    }
    if (u.pathname === '/v2/insights') return response({results:{entities:(recheck && scenario !== 'empty' ? ['A','B','C','D','E'] : ['A','B','C']).map(place)}});
    throw new Error('Unexpected fixture path');
  };
}
const server = await createServer({ configFile:false, envFile:false, server:{host:'127.0.0.1',port:5196,strictPort:true}, plugins:[{
  name:'explicit-local-review-fixture',
  transformIndexHtml(html) { return html.replace('<body>', '<body><div style="position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#502b1b;color:white;text-align:center;padding:8px;font:13px sans-serif">合成验收演示 / SYNTHETIC FIXTURE — no Qloo calls · ?scenario=empty / error / slow</div>'); },
  configureServer(vite) {
    vite.middlewares.use(async(req,res,next)=>{
      if (req.url?.startsWith('/__qa')) {
        if (req.url.includes('reset=1')) { records.length=0; caches.clear(); }
        res.setHeader('content-type','application/json'); res.end(JSON.stringify(records)); return;
      }
      if (req.url !== '/api/qloo') return next();
      const chunks=[]; for await (const chunk of req) chunks.push(chunk);
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const scenario=new URL(req.headers.referer || 'http://localhost').searchParams.get('scenario') || 'replacement';
      if (!caches.has(scenario)) caches.set(scenario,new Map());
      const calls=[];
      if ((body.recheck && scenario === 'slow') || scenario === 'slow-initial') await new Promise(resolve=>setTimeout(resolve,1500));
      const result = body.recheck && scenario === 'error'
        ? {ok:false,reason:'timeout',insight:{source:'unavailable',reason:'timeout',suggestions:[]}}
        : await handleQlooRequest(body,{env:{QLOO_API_KEY:'synthetic-fixture-only'},cache:caches.get(scenario),fetchImpl:transport(Boolean(body.recheck),calls,scenario)});
      records.push({scenario,recheck:Boolean(body.recheck),rejectedIds:body.rejectedIds || [],calls:calls.length,reason:result.reason || null,ids:result.insight?.suggestions?.map(item=>item.id)});
      res.setHeader('content-type','application/json; charset=utf-8'); res.end(JSON.stringify(result));
    });
  },
}]});
await server.listen();
console.log('SYNTHETIC REVIEW DEMO http://127.0.0.1:5196 — no real Qloo calls');
