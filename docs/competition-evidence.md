# TasteTrip competition evidence

This page is the short English evidence index for the Qloo Agentic Hackathon submission. It points to reproducible repository and deployment facts without storing Qloo response bodies or secrets.

## Product claim

TasteTrip accepts arbitrary `members[]`, resolves their tastes and candidate places with Qloo, computes group fairness, plans a constrained route, and lets the group renegotiate affected stops. The original two-person demo remains as a compatibility projection and a visual entry point.

## Qloo evidence chain

| Step | Evidence in the repository | Runtime source label |
| --- | --- | --- |
| Member parsing | `src/pipeline/parse.js`, `test/pipeline.test.js` | Input contract is `members[]` plus `context` |
| Entity resolution | `server/handleQloo.js` | `qloo:entity` on member entities |
| Place candidates | `server/handleQloo.js` | `qloo:entity` on suggestions |
| Request audit | `requestLog`, `requestStats`, `quota` | URL, type, entity, tags, member, city, coordinates, retry and result summary |
| Fairness | `src/pipeline/fairness.js` | Per-member score matrix, mean, minimum, disagreement and filtered reasons |
| Route | `src/pipeline/routePlanner.js` | Order, movement cost, time/budget checks and reasons |
| Negotiation | `src/pipeline/negotiation.js` | Round, action, affected candidates, gains, concessions and weights |

The server uses `GET /search` and `GET /v2/insights` against `https://hackathon.api.qloo.com`. The browser never receives `QLOO_API_KEY`.

## Deployment evidence

- Public URL: <https://tastetrip-agent.vercel.app/>
- Vercel deployment: `dpl_5r5mNqW5rshP7JP42M8tF3UgWoZ2`
- Deployment state: `READY`, target `production`
- Runtime commit: `461db36`
- Build: `npm run build` → `dist`
- Secret: `QLOO_API_KEY` configured in Vercel server environments; no value is stored in Git.

## Three verified scenarios

### 1. Multi-member live run

The production page ran a Shanghai request with three members: 甲, 乙, and 丙. Each member received three Qloo entities. The page showed `Qloo live · qloo:entity`; the candidate score matrix contained `SoFi Stadium`, `Paperboy East`, `Pike Place Fish Market`, and `Bamboula's`, all tagged `qloo:entity`.

### 2. Hard rejection

Member 甲 rejected `SoFi Stadium`, a place returned by the previous live request. The next live request kept the Qloo source label, removed that stop from the negotiation actions, recorded `甲：SoFi Stadium hard_rejection`, and reduced the route from four stops to three.

### 3. Upstream failure and fallback

A server-side probe sent a temporary invalid credential to the real Qloo endpoint. Qloo returned HTTP `401`. The same handler returned `reason: "down"`, `source: "fallback"`, `mock:fixture`, and ten failed request statuses. The invalid value was not stored or logged. The UI's rate-limit preview is separately labeled as a preview and is not counted as a real 429.

## Verification

```text
npm test      # 49/49 passing
npm run build # Vite production build passing
```

The public repository contains source, tests, configuration, and redacted evidence only. It does not contain Qloo API responses, user credentials, or deployment secrets.

## Known limitations

- A Qloo response can omit an affinity; the matrix displays an em dash and the route marks the result `partial`.
- A Qloo timeout, rate limit, or upstream error uses the explicit rules fallback.
- The demo currently accepts one city per request; multi-city operations are outside this release.
- Accounts, payments, reservations, flights, hotels, weather, photos, and social graphs are intentionally out of scope.
