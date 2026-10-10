import { replayResolve } from "./replay.js";

function localReplay(parsed, reason, warning) {
  const replay = replayResolve(parsed);
  return {
    ...replay,
    reason,
    warning,
    cached: false,
  };
}

export function createBrowserQlooClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const preview = options.preview || (() => null);
  const cache = options.cache || new Map();
  const timeoutMs = Number(options.timeoutMs || 12000);

  return {
    async resolvePair(parsed) {
      const previewMode = preview();
      const cacheKey = JSON.stringify({ parsed, previewMode });
      if (cache.has(cacheKey)) return { ...cache.get(cacheKey), cached: true };

      let result;
      if (previewMode === "offline") {
        result = localReplay(parsed, "offline", "预览：代理没有连上。行程是录好的 Qloo 回放，不是手写四站。这不是一次测到的真实断网。");
      } else if (previewMode === "rate_limit") {
        result = localReplay(parsed, "rate_limit", "预览：限流回退。行程是录好的 Qloo 回放，不是手写四站。这不是一次测到的真实 429。");
      } else {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl("/api/qloo", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              a: parsed.a.map((item) => item.value),
              b: parsed.b.map((item) => item.value),
            }),
            signal: controller.signal,
          });
          if (!response.ok) {
            const reason = response.status === 429 ? "rate_limit" : response.status === 504 ? "timeout" : "down";
            result = localReplay(parsed, reason, `代理返回 ${response.status}。已改显示录好的 Qloo 回放。`);
          } else {
            const payload = await response.json();
            result =
              payload.insight ||
              localReplay(parsed, payload.reason || "down", payload.warning || "代理没有给出结果。已改显示录好的 Qloo 回放。");
          }
        } catch (error) {
          const reason = error?.name === "AbortError" ? "timeout" : "offline";
          const warning =
            reason === "timeout" ? "代理超时。已改显示录好的 Qloo 回放。" : "代理没有连上。已改显示录好的 Qloo 回放。";
          result = localReplay(parsed, reason, warning);
        } finally {
          clearTimeout(timer);
        }
      }

      cache.set(cacheKey, result);
      return { ...result, cached: false };
    },
  };
}
