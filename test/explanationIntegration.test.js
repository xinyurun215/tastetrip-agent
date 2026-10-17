import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Evaluate our registration code with an inert environment and provider adapter.
// No .env files, real credentials, provider calls or local Codex processes are used.
async function configure() {
  const source = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8');
  const created = [];
  const context = vm.createContext({
    defineConfig: value => value,
    loadEnv: () => ({DEEPSEEK_API_KEY:'synthetic-key',DEEPSEEK_THINKING:'enabled',EXPLANATIONS_ENABLED:'true',UNRELATED_SECRET:'excluded'}),
    process:{cwd:()=>'/isolated',env:{}},
    handleQlooRequest:()=>assert.fail('Qloo must not run'),
    createLocalExplainMiddleware:()=>()=>assert.fail('The Codex middleware must not run'),
    createExplainHandler: options => {
      created.push(options);
      return (req,res) => res.end(JSON.stringify({route:req.url,local:options.local}));
    },
  });
  vm.runInContext(source.replace(/^import .*;\r?$/gm, '').replace('export default ', 'globalThis.config = '), context);
  return {config:context.config({mode:'test'}),created};
}

test('Vite dev and preview route explicit explanation requests to the server adapter', async () => {
  const {config,created}=await configure();
  for (const hook of ['configureServer','configurePreviewServer']) {
    const middlewares=[];
    for(const plugin of config.plugins) plugin[hook]?.({middlewares:{use:handler=>middlewares.push(handler)}});
    let output, next=0;
    const req={url:'/api/explain?test=1',method:'POST'};
    for(const handler of middlewares) await handler(req,{end:value=>{output=JSON.parse(value);}},()=>{next++;});
    assert.deepEqual(output,{route:'/api/explain?test=1',local:true},hook);
    assert.ok(next>=1,'unrelated Qloo middleware passes through');
    for(const handler of middlewares) await handler({url:'/unrelated'},{end:()=>assert.fail('unrelated path intercepted')},()=>{});
  }
  assert.equal(created.length,2);
  for(const options of created) {
    assert.equal(options.env.DEEPSEEK_API_KEY,'synthetic-key');
    assert.equal(options.env.DEEPSEEK_THINKING,'enabled');
    assert.equal(options.env.EXPLANATIONS_ENABLED,'true');
    assert.equal(options.env.UNRELATED_SECRET,undefined);
  }
  assert.equal(config.define,undefined,'server configuration is not injected into browser globals');
});
