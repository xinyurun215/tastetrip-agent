# Weekly milestones

Clock starts Saturday 10 Oct 2026. Submission deadline is 30 Oct 2026, 23:45 America/New_York (31 Oct 2026, 11:45 Asia/Shanghai). Each week ends with a publicly accessible build of this PR branch. Nothing is published by pushing `main`.

The durable host is GitHub Pages from `.github/workflows/pages.yml` on `cursor/tastetrip-demo-d78e`. Turning Pages on is blocked for this agent: `POST /repos/xinyurun215/tastetrip-agent/pages` returns 403 `Resource not accessible by integration`. A repo admin has to set Settings → Pages → Build and deployment → Source to GitHub Actions. Vercel and Netlify need their own logins, which this run does not have.

Until that setting exists, the public URL is a Cloudflare quick tunnel to the dev server. That URL dies when the tunnel process stops. It is not the October 30 archive.

## Week of 10 Oct, ending 16 Oct

Public version: ticket stubs, torn conflict seam, yellow itinerary, and the four agent steps (parse → Qloo → conflicts → reorder) on the mock client.

Shipped when the tunnel (or Pages, if an admin enables it) serves `一键试玩` for the fixed pair: 《布达佩斯大饭店》 / jazz / hotpot against Marvel / hip-hop / sushi.

Still mock. No Qloo key. Posters stay labeled placeholders.

## Week of 17 Oct, ending 23 Oct

Public version: same page, with live mode actually callable.

Needs someone who can set `QLOO_API_KEY` on a host that actually runs the server proxy (Vercel, Netlify, or the Vite dev server). The variable is server-only. Do not put it in the static Pages build. The second step should show Qloo entity names from `https://hackathon.api.qloo.com/search`, and place suggestions from `POST /v2/insights`. If the key is still missing, publish the fallback build anyway and leave the warning on the Qloo step.

Posters stay placeholders. Do not hotlink photos.

## Week of 24 Oct, ending 30 Oct

Public version: submission freeze before 30 Oct, 23:45 ET.

Rehearse `docs/demo-script.md` against that URL. Conflict detection tests and CI stay green. The README still says what the key changes: real entity resolution and affinity, not the handwritten "why both will like it" lines.

If Pages is still off, the week's public version is whatever no-login tunnel is running for the rehearsal, and the git tag for the freeze stays on this PR branch only.
