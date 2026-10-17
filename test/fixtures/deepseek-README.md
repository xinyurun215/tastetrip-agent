# Frozen evidence for a bounded DeepSeek comparison

`deepseek-synthetic.json` is a hand-authored **synthetic contract fixture**, derived from the existing explanation evidence test scenario. It is not a recorded Qloo response and has no real model measurements. It covers a supported preference, an unavailable preference, a missing explanation, and a member with no preferences.

Run the offline workflow from the project root:

```powershell
node scripts/deepseek-compare.mjs --output deepseek-comparison.mock.json
```

The default command does not read environment credentials, load `.env` files, or call Qloo/DeepSeek. Mock usage, latency, and cost remain `null`. Chinese and English each have explicit `enabled` and `disabled` runs, with no selected product default. JSON is also printed to stdout; `--output` writes UTF-8 directly to the named file (overwriting it), avoiding Windows shell encoding changes. Choose a new output filename for each run.

Before a later authorized real comparison, prepare a **sanitized frozen snapshot** file using the same wrapper (`label`, `snapshots`). Save it outside the tracked fixtures, for example `comparison-local/frozen-qloo.json`. Replace the synthetic snapshots with the exact bounded `buildExplanationSnapshot` contract. Remove personal names or other unnecessary identifying text consistently, mark actual Qloo-derived data `source: "live"`, and label its provenance truthfully. Include exactly one `zh` and one `en` snapshot; all fields except `language` must match. Do not add credentials, full Qloo responses, or private user records. The script never fetches evidence itself. Do not commit the local input or report.

The user must configure `DEEPSEEK_API_KEY` privately in the process environment themselves. The script does not accept a key on the command line or load a credentials file. Only after explicit authorization for real calls, run:

```powershell
node scripts/deepseek-compare.mjs --live --confirm-four-calls --fixtures comparison-local/frozen-qloo.json --output comparison-local/report.json
```

This makes at most four serial attempts (two languages × two modes), with no retries. Both modes use `max_tokens=4096` and `timeout=25000 ms` unless **one shared** `--max-tokens` (1–8192) / `--timeout-ms` (1–25000) override is supplied. The script never increases a budget after truncation. Mode order alternates by language to reduce order bias; this small pilot is not a statistical latency benchmark.

Optional `--rates comparison-local/rates.json` accepts only explicit, user-verified per-million-token rates:

```json
{
  "currency": "USD",
  "inputCacheHitPerMillion": 0,
  "inputCacheMissPerMillion": 0,
  "outputPerMillion": 0
}
```

These zeroes illustrate the schema and **are not vendor prices**; replace all three with currently verified rates. Omit the flag to leave costs unknown. Calculated cost needs actual completion tokens and actual prompt cache-hit/miss tokens; missing or inconsistent counts produce `null`. Completion tokens are charged once, including reasoning when it is part of that reported count. Missing reasoning-token counts remain unknown, never inferred from text. Provider billing remains authoritative.

Each report records the prompt messages, prompt version, SHA-256 hashes, frozen evidence source, equal budgets, validated explanation or safe error code, elapsed time, finish reason, truncation, usage, and optional calculated cost. It excludes raw provider payloads, private reasoning, credentials, and raw error messages. Structural validation checks fields, candidate IDs, and text lengths; it does not prove factual grounding or language quality.

Fill each run's `manualReview` fields after reading its explanation against the frozen snapshot: `evidenceAccuracy`, `languageQuality`, `unsupportedClaims`, and `notes`. Check that supported names, unavailable evidence, null ranks, and absence of consensus are stated correctly. Compare Chinese and English separately; inspect reasoning tokens and truncation before attributing quality differences to the mode. A length-limited failure must not be recorded as a valid quality win or loss without that context.
