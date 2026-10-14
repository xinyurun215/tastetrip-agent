# TasteTrip · 合味旅行

TasteTrip helps a group turn different tastes, deal-breakers, and travel constraints into one executable route. It keeps each member visible, uses Qloo for entity and place discovery, scores the group fairly, and records negotiation decisions.

## Live demo

**Production:** <https://tastetrip-agent.vercel.app/>

The current Vercel deployment is `READY` and keeps `QLOO_API_KEY` in a server-only Secret. The verified live runs and their source labels are recorded in [docs/phase7-real-demo.md](docs/phase7-real-demo.md).

## What the product does

- Accepts any number of `members[]`; there is no product-level A/B limit.
- Parses each member's preferences, hard rejections, soft preferences, city, starting point, time window, and budget.
- Resolves taste entities and place candidates through Qloo's hackathon API.
- Builds a member × place score matrix without inventing missing affinities.
- Filters hard rejections before route selection.
- Plans a route using starting location, order, approximate movement cost, time windows, opening hours, and budget.
- Supports negotiation actions: reject a stop, prioritize a member, or shorten the route.
- Labels live Qloo data as `qloo:entity` and every fallback as `fallback` / `mock:fixture`.

## Qloo workflow: request → result

1. The browser sends taste strings and travel context to the server route `/api/qloo`.
2. The server resolves each member's work, music, and food preferences with `GET /search`.
3. The server resolves place tags and requests same-city place insights with `GET /v2/insights`.
4. The server records request type, entity, tags, member, city, coordinates, retry attempt, source, and result summary in `requestLog`; aggregate counts stay in `requestStats` and `quota`.
5. Returned Qloo entities and place candidates carry `qloo:entity`. The fairness scorer copies `query.affinity` values into the score matrix and leaves absent values as `null`.
6. The route planner selects accepted candidates and explains each stop. A failed or rate-limited Qloo request returns an explicit fallback marker and never claims to be live Qloo data.

The API key is read only from the server environment. It is never placed in browser code, Vite output, logs, or this repository.

## Fairness and negotiation

For each member and candidate place, the normalized utility is `u(member, venue)`. The group score is:

```text
mean satisfaction + minimum satisfaction - disagreement - movement cost - hard-rejection penalty
```

The route score adds accepted stop scores and subtracts total movement time, time-window violations, and budget overruns. After an objection, only the affected route state is recomputed; the trace records the round, the action, who gained, who conceded, and the new member weights.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open the Vite URL and use **跑成员线束** to run the N-person harness. Without a local server key, the page deliberately uses the rules baseline and shows `mock:fixture`.

```bash
npm test
npm run build
npm run qloo:smoke
```

`npm run qloo:smoke` requires `QLOO_API_KEY` in the server process and prints only a safe summary. It exits clearly when the key is absent or when the result is not live.

## Deploy to Vercel

1. Create or connect the Vercel project to this repository.
2. Set `QLOO_API_KEY` as a Vercel **Server Secret** for Production (and Preview if needed).
3. Use `npm run build` with output directory `dist`.
4. Redeploy and verify `/api/qloo` with a three-member `members-harness` request.

Do not put the key in `.env` committed files or any `VITE_*` variable. GitHub Pages is static and cannot provide the server proxy; it is only a fallback presentation.

## Verified scenarios

The current production evidence covers:

1. A three-member Shanghai run with live Qloo entities, place candidates, and `qloo:entity` scores.
2. A live run where member 甲 rejects the returned place `SoFi Stadium`; the place is filtered and the route shortens.
3. A controlled real Qloo HTTP 401 probe using a temporary invalid credential; the server returns `reason: "down"`, `source: "fallback"`, and `mock:fixture`.

The UI's rate-limit button is intentionally labeled as a preview and is not presented as a measured 429. See [docs/phase7-real-demo.md](docs/phase7-real-demo.md) and [docs/competition-evidence.md](docs/competition-evidence.md) for the evidence matrix.

## Scope and limitations

This release does not include accounts, payments, bookings, flights, hotels, weather, photos, social graphs, or a general-purpose chat assistant. Qloo results can be incomplete, rate-limited, or missing affinity values; the UI keeps those gaps visible and falls back with an explicit source label. The current public demo uses one city per request.

## License

MIT. See [LICENSE](LICENSE).
