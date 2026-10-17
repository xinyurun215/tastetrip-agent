import { defineConfig, loadEnv } from "vite";
import { handleQlooRequest } from "./server/handleQloo.js";
import { createExplainHandler } from "./server/handleExplain.js";

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function qlooProxy(env) {
  return async function qlooMiddleware(req, res, next) {
    const path = (req.url || "").split("?")[0];
    if (path !== "/api/qloo") {
      next();
      return;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, reason: "down", warning: "POST only", insight: null }));
      return;
    }
    let body = {};
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      body = {};
    }
    const result = await handleQlooRequest(body, { env, fetchImpl: globalThis.fetch });
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(result));
  };
}

function explanationProxy(env) {
  const handler = createExplainHandler({ env, local: true });
  return (req, res, next) => {
    if ((req.url || "").split("?")[0] !== "/api/explain") return next();
    return handler(req, res);
  };
}

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), "");
  const env = {
    QLOO_API_KEY: process.env.QLOO_API_KEY || fileEnv.QLOO_API_KEY || "",
    QLOO_BASE_URL: process.env.QLOO_BASE_URL || fileEnv.QLOO_BASE_URL || "",
    QLOO_TIMEOUT_MS: process.env.QLOO_TIMEOUT_MS || fileEnv.QLOO_TIMEOUT_MS || "",
  };
  const explanationEnv = Object.fromEntries([
    "DEEPSEEK_API_KEY", "DEEPSEEK_THINKING", "EXPLANATIONS_ENABLED",
    "VERCEL_ENV", "VERCEL_URL", "EXPLANATION_PREVIEW_GUARDS",
  ].map(name => [name, process.env[name] || fileEnv[name] || ""]));

  return {
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      allowedHosts: true,
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
      allowedHosts: true,
    },
    plugins: [
      {
        name: "qloo-proxy",
        configureServer(server) {
          server.middlewares.use(qlooProxy(env));
          server.middlewares.use(explanationProxy(explanationEnv));
        },
        configurePreviewServer(server) {
          server.middlewares.use(qlooProxy(env));
          server.middlewares.use(explanationProxy(explanationEnv));
        },
      },
    ],
  };
});
