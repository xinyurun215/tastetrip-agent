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

## 运行证据（2026-10-13 UTC）

真实 Production 部署已经完成：

- URL：[https://tastetrip-agent.vercel.app/](https://tastetrip-agent.vercel.app/)
- Deployment：`dpl_3dfft5hsENvk6wwpGqZosxwRrq7t`
- Commit：`d5ae64d392511a096a8e4a2d438cf02ad16b4fd7`（`main`）
- Vercel 状态：`READY`，别名已指向上述生产 URL。
- `QLOO_API_KEY` 只存在于 Vercel Production / Preview / Development Secret 环境；没有写入仓库或浏览器构建。

以下结果来自生产页面的真实提交，页面均明确显示 `Qloo live · qloo:entity`：

1. 多人成功：Shanghai、人民广场、3 名成员（甲/乙/丙）。每人返回 3 个 Qloo 实体：
   - 甲：`Movie 43`、`嚴爵`、`火锅英雄（Hero Hot-pot）`
   - 乙：`Arrested Development`、`School of Rock`、`好好吃肉韓式烤肉吃到飽-高雄左營店`
   - 丙：`The King of Comedy`、`奥田民生`、`老串角居酒屋-江子翠總店/板橋美食/板橋推薦餐廳/板橋居酒屋/板橋宵夜/板橋串燒/板橋晚餐推薦`
   候选 `SoFi Stadium`、`Paperboy East`、`Pike Place Fish Market`、`Bamboula's` 均标记 `qloo:entity`，评分矩阵显示成员 affinity；路线生成 4 站并标记为 `partial`（部分成员缺少该候选评分）。
2. 硬性拒绝：把甲的硬拒绝设为真实返回的 `SoFi Stadium` 后重新提交。页面仍返回 `Qloo live · qloo:entity`，协商动作列表移除 `SoFi Stadium`，冲突区记录 `甲：SoFi Stadium hard_rejection`，路线缩为 3 站；没有把被过滤地点伪装成可选站点。
3. 真实上游失败：服务端处理器使用一次临时无效凭据对 Qloo 发起真实请求，Qloo 返回 HTTP `401`；应用结果为 `reason: "down"`、`source: "fallback"`、`mock:fixture`，10 次请求均记录 `DOWN`，没有显示 `live`。临时凭据未写入文件、Vercel 或日志。

页面的“预览限流回退”另有明确文案：`这不是一次测到的真实 429`。它只用于验收界面降级，不能替代上面的真实上游失败证据。

本阶段回归结果：`npm test` 49/49 通过；`npm run build` 通过；Vercel 远端构建通过。真实响应正文没有提交到仓库，只保留脱敏摘要和可复核的来源标记。

本地或部署环境可运行 `npm run qloo:smoke`。脚本只输出来源、成员数、候选数、请求数和配额，不输出密钥；没有服务端密钥时会明确失败。
