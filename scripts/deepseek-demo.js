// No environment loading and no network transport: both providers are synthetic.
import { pathToFileURL } from 'node:url';
import { startExplanationDemo } from './explanation-demo.js';
import { createExplainHandler } from '../server/handleExplain.js';
import { createDeepSeekGenerator } from '../server/deepseekExplain.js';

export function createMockDeepSeekMiddleware({generate}) {
  const generator=createDeepSeekGenerator({apiKey:'synthetic-test-only',thinking:'enabled',
    fetchImpl:async(_url,init)=>{
      const snapshot=JSON.parse(JSON.parse(init.body).messages[1].content);
      const explanation=await generate(snapshot);
      return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(explanation)}}]}));
    },
  });
  return createExplainHandler({local:true,env:{EXPLANATIONS_ENABLED:'true',DEEPSEEK_THINKING:'enabled'},generate:generator});
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(process.argv.length!==2) throw new Error('This demo accepts no real-call options.');
  await startExplanationDemo({createMiddleware:createMockDeepSeekMiddleware});
}
