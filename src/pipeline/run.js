import { parseTastes } from "./parse.js";
import { detectConflicts } from "./conflicts.js";
import { reorderRoute } from "./reorder.js";

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function runPipeline(raw, client, options = {}) {
  const dwellMs = options.dwellMs ?? 0;
  const shouldContinue = options.shouldContinue || (() => true);
  const onStep = options.onStep || (() => {});
  const steps = [];

  async function step(id, fn) {
    if (!shouldContinue()) {
      const error = new Error("cancelled");
      error.code = "CANCELLED";
      throw error;
    }
    onStep({ id, status: "running", steps });
    if (dwellMs > 0) await delay(dwellMs);
    if (!shouldContinue()) {
      const error = new Error("cancelled");
      error.code = "CANCELLED";
      throw error;
    }
    try {
      const result = await fn();
      steps.push({ id, status: "done", result });
      onStep({ id, status: "done", result, steps });
      return result;
    } catch (error) {
      steps.push({ id, status: "error", error });
      onStep({ id, status: "error", error, steps });
      throw error;
    }
  }

  const parsed = await step("parse", async () => parseTastes(raw));
  const insight = await step("qloo", async () => client.resolvePair(parsed));
  const conflicts = await step("conflicts", async () => detectConflicts(parsed, insight));
  const route = await step("reorder", async () => reorderRoute(parsed, conflicts, insight));
  return { parsed, insight, conflicts, route, steps };
}
