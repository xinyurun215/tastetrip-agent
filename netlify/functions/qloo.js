import { handleQlooRequest } from "../../server/handleQloo.js";

export async function handler(event) {
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    body = {};
  }
  const result = await handleQlooRequest(body, {
    env: process.env,
    fetchImpl: globalThis.fetch,
  });
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result),
  };
}
