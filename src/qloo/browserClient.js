import { createMockClient } from "./mock.js";

const mock = createMockClient();

async function localFallback(parsed, reason, warning) {
  const fallback = await mock.resolvePair(parsed);
  return {
    ...fallback,
    source: "fallback",
    reason,
    warning,
    fromQloo: false,
    cached: false,
  };
}

export function createBrowserQlooClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const preview = options.preview || (() => null);
  const cache = options.cache || new Map();
  const timeoutMs = Number(options.timeoutMs || 20000);

  return {
    async resolvePair(parsed) {
      const previewMode = preview();
      const cacheKey = JSON.stringify({ parsed, previewMode });
      if (cache.has(cacheKey)) return { ...cache.get(cacheKey), cached: true };

      let result;
      if (previewMode === "offline") {
        result = await localFallback(parsed, "offline", "预览：代理没有连上。行程是规则基线，来源标记 mock:fixture。这不是一次测到的真实断网。");
      } else if (previewMode === "rate_limit") {
        result = await localFallback(parsed, "rate_limit", "预览：限流回退。行程是规则基线，来源标记 mock:fixture。这不是一次测到的真实 429。");
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
            result = await localFallback(parsed, reason, `代理返回 ${response.status}。已改显示规则基线，来源标记 mock:fixture。`);
          } else {
            const payload = await response.json();
            result =
              payload.insight ||
              (await localFallback(parsed, payload.reason || "down", payload.warning || "代理没有给出结果。已改显示规则基线，来源标记 mock:fixture。"));
          }
        } catch (error) {
          const reason = error?.name === "AbortError" ? "timeout" : "offline";
          const warning =
            reason === "timeout"
              ? "代理超时。已改显示规则基线，来源标记 mock:fixture。"
              : "代理没有连上。已改显示规则基线，来源标记 mock:fixture。";
          result = await localFallback(parsed, reason, warning);
        } finally {
          clearTimeout(timer);
        }
      }

      cache.set(cacheKey, result);
      return { ...result, cached: false };
    },
  };
}
