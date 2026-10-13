import { handleQlooRequest } from "../server/handleQloo.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, reason: "down", warning: "POST only", insight: null });
    return;
  }
  const result = await handleQlooRequest(req.body || {}, {
    env: process.env,
    fetchImpl: globalThis.fetch,
  });
  res.status(200).json(result);
}
