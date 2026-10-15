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

function localMembersFallback(parsed, reason, warning) {
  return {
    source: "fallback",
    reason,
    warning,
    fromQloo: false,
    cached: false,
    members: (parsed.members || []).map((member) => ({
      id: member.id,
      name: member.name,
      context: member.context || member.constraints || {},
      entities: (member.preferences || []).map((preference) => ({
        id: `mock:${member.id}:${preference.key || "preference"}`,
        name: preference.value || preference,
        kind: preference.key || "preference",
        query: preference.value || preference,
        sourceTag: "mock:fixture",
      })),
      suggestions: [],
    })),
    suggestions: [],
    requestLog: [],
    requestStats: { total: 0, network: 0, retries: 0, rateLimited: 0, failed: 0, cacheHits: 0 },
    quota: { used: 0, limit: null, remaining: null },
  };
}

export function createBrowserQlooClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const preview = options.preview || (() => null);
  const cache = options.cache || new Map();
  const timeoutMs = Number(options.timeoutMs || 20000);

  async function resolveRecheck(parsed, request, members) {
    const rejectedIds = [...new Set(request.rejectedIds || [])].sort();
    const previewMode = preview();
    const cacheKey = JSON.stringify({ parsed, members, rejectedIds, recheck: true, previewMode });
    const cancelled = () => { if (request.signal?.aborted) throw new DOMException("Request cancelled", "AbortError"); };
    const unavailable = (reason, warning = "Qloo 补查不可用，未提供替代地点。请稍后重试。") => ({
      source: "unavailable", fromQloo: false, cached: false, reason, warning,
      suggestions: [], members: [], entities: { a: [], b: [] }, tensions: [],
    });
    cancelled();
    if (cache.has(cacheKey)) return { ...cache.get(cacheKey), cached: true };
    if (previewMode === "offline" || previewMode === "rate_limit") return unavailable(previewMode);

    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      const body = members ? { ...parsed, mode: "members-harness" } : {
        a: parsed.a.map((item) => item.value), b: parsed.b.map((item) => item.value), context: parsed.context,
      };
      const response = await fetchImpl("/api/qloo", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, rejectedIds, recheck: true }), signal: controller.signal,
      });
      cancelled();
      if (controller.signal.aborted) return unavailable("timeout");
      if (!response.ok) return unavailable(response.status === 429 ? "rate_limit" : response.status === 504 ? "timeout" : "down");
      const payload = await response.json();
      cancelled();
      if (controller.signal.aborted) return unavailable("timeout");
      const insight = payload.insight;
      if (payload.ok === false || insight?.source !== "live" || insight?.fromQloo !== true) {
        return unavailable(payload.reason || insight?.reason || "down");
      }
      const allowed = (place) => !rejectedIds.includes(String(place.id));
      const suggestions = (insight.suggestions || []).filter(allowed);
      if (!suggestions.length) return unavailable("no_alternatives");
      const result = { ...insight, suggestions, cached: false,
        ...(Array.isArray(insight.members) ? { members: insight.members.map((member) => ({ ...member, suggestions: (member.suggestions || []).filter(allowed) })) } : {}),
      };
      cache.set(cacheKey, result);
      return result;
    } catch (error) {
      cancelled();
      return unavailable(error?.name === "AbortError" ? "timeout" : "offline");
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", abort);
    }
  }

  return {
    async resolvePair(parsed, request = {}) {
      if (request.recheck || request.rejectedIds?.length) return resolveRecheck(parsed, request, false);
      const previewMode = preview();
      const cacheKey = JSON.stringify({ parsed, previewMode });
      if (cache.has(cacheKey)) return { ...cache.get(cacheKey), cached: true };

      let result;
      if (previewMode === "offline") {
        result = await localFallback(parsed, "offline", "这次是备用数据。预览：代理没有连上。行程是规则基线，来源标记 mock:fixture。这不是一次测到的真实断网。");
      } else if (previewMode === "rate_limit") {
        result = await localFallback(parsed, "rate_limit", "这次是备用数据。预览：限流回退。行程是规则基线，来源标记 mock:fixture。这不是一次测到的真实 429。");
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
              context: parsed.context,
            }),
            signal: controller.signal,
          });
          if (!response.ok) {
            const reason = response.status === 429 ? "rate_limit" : response.status === 504 ? "timeout" : "down";
            result = await localFallback(parsed, reason, `这次是备用数据。代理返回 ${response.status}。已改显示规则基线，来源标记 mock:fixture。`);
          } else {
            const payload = await response.json();
            result =
              payload.insight ||
              (await localFallback(parsed, payload.reason || "down", payload.warning || "这次是备用数据。代理没有给出结果。已改显示规则基线，来源标记 mock:fixture。"));
          }
        } catch (error) {
          const reason = error?.name === "AbortError" ? "timeout" : "offline";
          const warning =
            reason === "timeout"
              ? "这次是备用数据。代理超时。已改显示规则基线，来源标记 mock:fixture。"
              : "这次是备用数据。代理没有连上。已改显示规则基线，来源标记 mock:fixture。";
          result = await localFallback(parsed, reason, warning);
        } finally {
          clearTimeout(timer);
        }
      }

      cache.set(cacheKey, result);
      return { ...result, cached: false };
    },

    async resolveMembers(parsed, request = {}) {
      if (request.recheck || request.rejectedIds?.length) return resolveRecheck(parsed, request, true);
      const cancelled = () => { if (request.signal?.aborted) throw new DOMException("Request cancelled", "AbortError"); };
      cancelled();
      const previewMode = preview();
      const cacheKey = JSON.stringify({ members: parsed, previewMode });
      if (cache.has(cacheKey)) return { ...cache.get(cacheKey), cached: true };

      let result;
      if (previewMode === "offline") {
        result = localMembersFallback(parsed, "offline", "这次是备用数据。预览：代理没有连上。成员实体和候选地点标记 mock:fixture。" );
      } else if (previewMode === "rate_limit") {
        result = localMembersFallback(parsed, "rate_limit", "这次是备用数据。预览：限流回退。成员实体和候选地点标记 mock:fixture。" );
      } else {
        const controller = new AbortController();
        const abort = () => controller.abort();
        request.signal?.addEventListener("abort", abort, { once: true });
        const timer = setTimeout(abort, timeoutMs);
        try {
          const response = await fetchImpl("/api/qloo", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...parsed, mode: "members-harness" }),
            signal: controller.signal,
          });
          cancelled();
          if (controller.signal.aborted) throw new DOMException("Request timed out", "AbortError");
          if (!response.ok) {
            const reason = response.status === 429 ? "rate_limit" : response.status === 504 ? "timeout" : "down";
            result = localMembersFallback(parsed, reason, `代理返回 ${response.status}，没有可用的 Qloo 候选地点。`);
          } else {
            const payload = await response.json();
            cancelled();
            if (controller.signal.aborted) throw new DOMException("Request timed out", "AbortError");
            result = payload.ok === false && payload.insight?.source === "live"
              ? localMembersFallback(parsed, payload.reason || "down", payload.warning || "Qloo 查询失败，没有可用的候选地点。")
              : payload.insight || localMembersFallback(parsed, payload.reason || "down", payload.warning || "这次是备用数据。成员结果标记 mock:fixture。" );
          }
        } catch (error) {
          cancelled();
          const reason = error?.name === "AbortError" ? "timeout" : "offline";
          result = localMembersFallback(parsed, reason, reason === "timeout" ? "这次是备用数据。代理超时。成员结果标记 mock:fixture。" : "这次是备用数据。代理没有连上。成员结果标记 mock:fixture。" );
        } finally {
          clearTimeout(timer);
          request.signal?.removeEventListener("abort", abort);
        }
      }

      if (result.source === "live" && result.fromQloo === true && !result.reason && result.suggestions?.length) cache.set(cacheKey, result);
      return { ...result, cached: false };
    },
  };
}
