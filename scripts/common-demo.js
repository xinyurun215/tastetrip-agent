// Local interaction fixture: no credentials, real Qloo calls or recorded responses.
// Run: node scripts/common-demo.js (http://127.0.0.1:5197)
import { createServer } from 'vite';
import { handleQlooRequest } from '../server/handleQloo.js';
import { createCommonFixture } from './common-fixture.js';

const records = [];
const caches = new Map();
let fixture = createCommonFixture();
const scenarios = new Set(['default', 'empty', 'partial', 'slow', 'slow-search', 'error', 'recheck']);
const server = await createServer({ configFile: false, envFile: false,
  server: { host: '127.0.0.1', port: 5197, strictPort: true },
  plugins: [{
    name: 'explicit-local-common-fixture',
    transformIndexHtml(html) {
      return html.replace('<body>', '<body style="padding-bottom:42px"><div id="synthetic-fixture-banner" role="note" style="position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#502b1b;color:white;text-align:center;padding:8px;font:13px sans-serif">SYNTHETIC FIXTURE — no Qloo calls · ?scenario=empty / partial / slow / slow-search / error / recheck</div>');
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith('/__qa')) {
          if (new URL(req.url, 'http://127.0.0.1').searchParams.get('reset') === '1') {
            records.length = 0;
            caches.clear();
            fixture = createCommonFixture();
          }
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(records));
          return;
        }
        if (req.url !== '/api/qloo') return next();
        res.setHeader('content-type', 'application/json; charset=utf-8');
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ ok: false, reason: 'method_not_allowed' }));
          return;
        }
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const rawScenario = new URL(req.headers.referer || 'http://127.0.0.1').searchParams.get('scenario') || 'default';
          const scenario = scenarios.has(rawScenario) ? rawScenario : 'default';
          if (!caches.has(scenario)) caches.set(scenario, new Map());
          const calls = [];
          if ((body.mode === 'common-compare' && scenario === 'slow') || (body.mode === 'common-search' && scenario === 'slow-search')) {
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
          const result = await handleQlooRequest(body, {
            env: { QLOO_API_KEY: 'synthetic-fixture-only' },
            cache: caches.get(scenario),
            fetchImpl: fixture.transport({ scenario, calls }),
          });
          // This marker is exclusive to the local harness. Backend source="live"
          // means its normal handler path ran, not that this demo contacted Qloo.
          if (result.ok && result.insight) {
            result.insight.evidenceKind = 'synthetic';
            for (const item of result.insight.pool || []) item.sourceTag = 'mock:fixture';
            for (const member of result.insight.members || []) {
              for (const item of member.entities || []) item.sourceTag = 'mock:fixture';
              for (const preference of member.preferences || []) {
                for (const item of preference.matches || []) item.sourceTag = 'mock:fixture';
              }
            }
          }
          records.push({ scenario, mode: String(body.mode || 'legacy').slice(0, 40),
            memberCount: Array.isArray(body.members) ? body.members.length : 0,
            rejectedIds: Array.isArray(body.rejectedIds) ? body.rejectedIds.filter(id => typeof id === 'string').slice(0, 100) : [],
            calls: calls.length, requests: calls, ok: result.ok, reason: result.reason || null,
            poolIds: result.insight?.pool?.map(item => item.id) || [],
            rankingCounts: result.insight?.rankings?.map(item => ({ memberId: item.memberId, count: item.entities.length })) || [],
          });
          res.end(JSON.stringify(result));
        } catch (error) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, reason: 'synthetic_fixture_error', warning: String(error.message).slice(0, 240) }));
        }
      });
    },
  }],
});
await server.listen();
console.log('SYNTHETIC FIXTURE — no Qloo calls — http://127.0.0.1:5197');
