import { handleQlooRequest } from "../server/handleQloo.js";

if (!String(process.env.QLOO_API_KEY || "").trim()) {
  console.error("QLOO_API_KEY is missing; set it in the server environment only.");
  process.exit(2);
}

const input = {
  mode: "members-harness",
  context: { city: "Shanghai", coordinates: { lat: 31.2304, lng: 121.4737, radiusM: 9000 } },
  members: [
    { id: "m1", name: "A", preferences: ["Whiplash", "jazz", "hotpot"], hardRejections: ["seafood"] },
    { id: "m2", name: "B", preferences: ["museum", "rock", "barbecue"] },
    { id: "m3", name: "C", preferences: ["comedy", "folk", "noodles"] },
  ],
};

const result = await handleQlooRequest(input, { env: process.env, fetchImpl: globalThis.fetch });
const insight = result.insight || {};
const summary = {
  ok: result.ok,
  reason: result.reason,
  source: insight.source,
  memberCount: insight.members?.length || 0,
  candidateCount: insight.suggestions?.length || 0,
  requestCount: insight.requestStats?.total || 0,
  quota: insight.quota || null,
  sourceTags: [...new Set((insight.suggestions || []).map((item) => item.sourceTag).filter(Boolean))],
};
console.log(JSON.stringify(summary, null, 2));
if (summary.source !== "live") process.exit(1);
