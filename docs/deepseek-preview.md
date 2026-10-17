# DeepSeek explanation preview preparation

This phase is local and keyless. No real model/Qloo request, push, merge or remote deployment is part of this change. `https://tastetrip-agent.vercel.app` remains unchanged.

## Baseline and ownership

The source was copied from `C:/Users/xinyu/Documents/Codex/2026-10-16/task/tastetrip-local-explanations`, branch `feat/local-explanations`, commit `ac92c27deb4576027eeb45dd1863ba8f91239cc9`, including all nine modified tracked files and ten untracked prototype files. The independent copy is `task-2/tastetrip-deepseek`; the adjacent `source-manifest.json` records SHA-256 for 102 copied source files. Environment/credential files, Git metadata and generated output were excluded. A new blank `.env.example` is provided. No source reset/cleanup or changes under either D: project occurred.

Qloo and existing deterministic code retain candidate generation, ranking, exclusions, selections, confirmation and consensus. DeepSeek receives only the existing compact snapshot and returns summary/candidate prose. Candidate IDs must match the supplied snapshot. This validates structure and references; it does **not** authenticate a browser-submitted snapshot as a genuine Qloo response or prove semantic accuracy. Untrusted strings remain data and the model has no tools. Never treat generated text as member agreement or live travel facts.

## Implementation and bounds

- `api/explain.js` is a Vercel Node Function; `server/handleExplain.js` is shared with Vite development and preview. The old local Codex implementation is retained but not registered by Vite.
- Server-side `DEEPSEEK_API_KEY`; fixed model `deepseek-flash`; fixed `POST https://api.deepseek.com/chat/completions`; redirects rejected. No arbitrary provider/base URL or browser key.
- `thinking.type` is explicitly `enabled` or `disabled`. Missing/invalid configuration refuses a call. No product default has been chosen.
- JSON mode, fixed versioned instructions, existing exact-field validators, maximum six members/twelve candidates, 64 KiB input, 128 KiB provider response, 320-character summary and 180-character candidate texts.
- Application request uses `max_tokens=4096`, 25 seconds across fetch and response reading, zero retries. Body intake is bounded at two seconds. Vercel duration is 30 seconds with cancellation support enabled.
- Browser cancellation is forwarded where the runtime signals a disconnect. A timeout/cancel cannot undo tokens already generated or guarantee the provider stops billing instantly.
- Valid results retain the existing client cache and stale-response guard. A small server cache expires after five minutes and includes the thinking mode. Errors are fixed safe codes. No raw provider diagnostics or private reasoning are returned, logged or written to reports.
- Per process: one active generation, six uncached attempts/minute, sixteen cached snapshots. This is only a supplementary guard; serverless instances/regions can each have their own counters. CORS/Origin checks and client caching are **not** reliable rate limiting or authentication.
- Failed/unavailable explanations leave the deterministic evidence and rankings visible. No preference-edit or ranking-override feature was added.

## Run the keyless preview now

From this directory, with Node.js 20+ and installed dependencies:

```powershell
npm test
npm run build
npm run explain:demo
```

Open `http://127.0.0.1:5198`. The fixed footer labels synthetic Qloo and fake explanations. This demo uses the actual DeepSeek request/response adapter with a replaced transport; it never loads `.env` or contacts either provider. Test variants include `?scenario=partial-invalid`, `all-invalid`, `malformed`, `timeout` and `stale`.

```powershell
npm run explain:compare -- --output deepseek-comparison.mock.json
```

That report tests comparison plumbing only. It does not measure model quality, real latency, tokens or cost; these metrics are `null`. See [frozen comparison instructions](../test/fixtures/deepseek-README.md).

## Minimal future key setup, performed by the user

1. Copy `.env.example` to the ignored `.env.local`. Fill only `DEEPSEEK_API_KEY` with a DeepSeek official API key in your editor. Leave `QLOO_API_KEY` blank for this isolated experiment. Do not send keys in chat, use the previous Alibaba Token Plan credential, or prefix a secret with `VITE_`.
2. Prepare a sanitized, frozen `comparison-local/frozen-qloo.json` only if testing real Qloo evidence; the bundled fixture is synthetic and must retain that label. Both modes receive the same evidence, language, messages, token cap and timeout. No Qloo call is made by the script.
3. **Only after authorizing paid calls**, execute the following yourself. Node loads your private file; the script permits at most four serial model calls, with no retry. It explicitly sends both thinking modes, independent of `DEEPSEEK_THINKING`:

```powershell
node --env-file=.env.local scripts/deepseek-compare.mjs --live --confirm-four-calls --fixtures comparison-local/frozen-qloo.json --output comparison-local/report.json
```

Omit `--fixtures ...` to use the clearly labeled synthetic evidence. Optionally pass `--rates comparison-local/rates.json` using the documented schema and then-current official rates. Costs require actual cache-hit/miss and completion usage. Missing usage remains unknown; reasoning tokens are never inferred or charged twice. Reports record prompt/evidence hashes, both budgets, latency, finish reason, truncation and safe counters, but no private reasoning.

Review Chinese and English separately against the frozen evidence. Fill the report's manual evidence-accuracy, language-quality and unsupported-claims fields. Equal total completion budgets can leave less visible output in thinking mode; examine reasoning usage and truncation before interpreting differences. Four attempts are a pilot, not a statistical benchmark. Do not silently increase only one mode's budget. A timeout/empty/truncated answer remains a failed attempt with any available usage.

After the comparison supports an explicit mode choice, a future local real UI check needs `DEEPSEEK_THINKING=enabled` **or** `disabled` and `EXPLANATIONS_ENABLED=true` in `.env.local`, followed by `npm run dev`. Do not enable it now merely to make a failing no-key request succeed. Keep the key out of build flags and browser fields.

## Remote preview blockers (not executed)

No new database or paid service was provisioned. Before a future **Preview** deployment of `tastetrip-agent`:

1. Check the project's actual plan/available allowance. In Settings → Deployment Protection, enable Vercel Authentication / Standard Protection for previews. Restrict tester access and avoid public bypass links. Confirm an unauthenticated preview/API request is blocked.
2. In Firewall, configure a rate rule scoped to Environment **Preview**, path `/api/explain`, method `POST`: suggested initial cap six requests per IP per 60 seconds, returning 429. Verify the rule works before adding a key. Current documented availability includes one Hobby rule, but availability/pricing must be checked for this project; do not purchase anything automatically. Regional/IP counts are not a global spending hard cap.
3. Only once those controls are actually verified, set **Preview-only** server variables `DEEPSEEK_API_KEY`, `EXPLANATIONS_ENABLED=true`, the consciously selected `DEEPSEEK_THINKING`, and `EXPLANATION_PREVIEW_GUARDS=verified`; set **Preview-only** build variable `VITE_EXPLANATIONS_ENABLED=true`. Vercel supplies `VERCEL_ENV=preview` and `VERCEL_URL`; exact deployment origin is required. The `verified` flag is an operator acknowledgement, not an authentication mechanism or proof of a WAF rule.
4. A newly authorized Preview deployment and cloud acceptance check are still needed. This phase has only checked local build, Node handlers and mock browser behavior. Production requests remain disabled in code even if feature flags are set. Wider public rollout requires a separately approved authentication/quota strategy (platform WAF plus a distributed quota service if a strict global cap is required).

No remote account/project inspection or changes were performed, so actual protection status, WAF availability, cloud cancellation behavior and live provider output remain unverified.

## Official references checked

- [DeepSeek API and model ID](https://api-docs.deepseek.com/)
- [Explicit thinking toggle and default vendor behavior](https://api-docs.deepseek.com/guides/thinking_mode/)
- [JSON output requirements and empty-output caveat](https://api-docs.deepseek.com/guides/json_mode/)
- [Vercel Node Functions](https://vercel.com/docs/functions/runtimes/node-js)
- [Vercel duration](https://vercel.com/docs/functions/configuring-functions/duration) and [cancellation](https://vercel.com/docs/functions/functions-api-reference#cancel-requests)
- [Deployment Protection](https://vercel.com/docs/deployment-protection) and [Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication)
- [WAF rule fields](https://vercel.com/docs/vercel-firewall/vercel-waf/rule-configuration) and [rate limits](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)
