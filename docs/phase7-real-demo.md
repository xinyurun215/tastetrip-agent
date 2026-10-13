# 阶段 7：真实 Qloo 运行与部署

## 服务端配置

部署 Vercel 或 Netlify 时，只在服务端环境设置：

```text
QLOO_API_KEY=<server-only key>
QLOO_TIMEOUT_MS=8000
```

浏览器只调用 `/api/qloo`，构建产物不读取密钥。代理固定请求 `https://hackathon.api.qloo.com`，并在响应中保留 `qloo:entity`、`fallback` 和 `mock:fixture` 来源标记。

## 部署入口

- Vercel：使用 `vercel.json`，构建命令 `npm run build`，输出目录 `dist`。
- Netlify：使用 `netlify.toml`，函数目录 `netlify/functions`，`/api/qloo` 重定向到函数。
- GitHub Pages：只能展示静态备用数据，不能作为真实 Qloo Demo。

## 运行证据

部署后记录以下三组响应，不要把真实 Qloo 响应提交到仓库：

1. 多人成功：`mode: "members-harness"`，至少 3 名成员；记录外部 URL、时间、成员实体、候选地点、`requestLog` 和 `qloo:entity`。
2. 硬性拒绝：至少一名成员设置硬拒绝；记录过滤理由和剩余候选。
3. Qloo 限流或失败：记录 HTTP/超时状态，确认响应明确为 `fallback` / `mock:fixture`，且没有伪称实时 Qloo。

当前工作区已完成本地代理、缓存、重试、来源审计和构建测试；真实外部证据仍需要部署凭据与服务器端 `QLOO_API_KEY`。

本地或部署环境可运行 `npm run qloo:smoke`。脚本只输出来源、成员数、候选数、请求数和配额，不输出密钥；没有服务端密钥时会明确失败。
