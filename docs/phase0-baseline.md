# 阶段 0 基线（Architecture baseline）

这份记录冻结当前架构和边界，供后续阶段对照。阶段 0 不改变运行行为。

## 当前架构

- 浏览器（Browser）在 `src/main.js` 运行四步流程：解析（parse）、Qloo 查询（qloo）、冲突（conflicts）、重排（reorder）。
- 浏览器只向 `/api/qloo` 发送口味和行程 context（上下文）。密钥只在服务端读取。
- 本地开发和预览由 Vite 中间件（middleware）承载代理；Vercel 使用 `api/qloo.js`；Netlify 使用 `netlify/functions/qloo.js` 和重定向配置。
- 没有可用密钥、限流、超时或代理不可达时，代理返回规则基线（`mock:fixture`）。成功的实时实体标记为 `qloo:entity`。

## Qloo 调用清单（Call inventory）

服务端实现位于 `server/handleQloo.js`，所有实时调用固定到 `https://hackathon.api.qloo.com`，请求头使用 `X-Api-Key`。

| 调用 | 方法 | 目的 | 关键参数 |
| --- | --- | --- | --- |
| `/search` | GET | 将作品、音乐、饮食口味解析成实体 | `query`、`types` |
| `/v2/insights` | GET | 查询同城餐饮和现场音乐场地 | `filter.type`、`signal.interests.entities`、`filter.results.entities`、位置过滤 |

当前代码按顺序完成搜索和 insights（洞察）查询；不调用 `/recs`，不向浏览器暴露密钥，不提交 API 响应样本。

## CI 与部署（CI and deployment）

- `.github/workflows/ci.yml` 在 Node.js 22 上执行 `npm ci`、`npm test`、构建，并检查前端产物没有密钥环境变量名。
- `.github/workflows/pages.yml` 构建静态 GitHub Pages（页面），因此没有服务端代理，运行时保持规则基线。
- `vercel.json` 和 `netlify.toml` 提供相同的前端构建入口；Vercel、Netlify 的服务端环境需要单独配置 `QLOO_API_KEY` 后重新部署。
- 本地开发使用 `npm run dev`，代理由 `vite.config.js` 注入；密钥通过 `.env.local` 或进程环境提供。

## A/B 限制（A/B limits）

当前冲突、Qloo 解释和重排模块都以双人 `a`/`b` 投影为输入。阶段 1 的解析层可以保留完整 `members[]`，但 N>2 尚未进入评分、路线、动态界面或协商流程。旧双人 Demo 继续使用原投影。

阶段 1 的成员契约保留每位成员的 `tastes`、`preferences`、`hardRejections`、`softPreferences` 和 `constraints`；全局 `context` 同时保留城市、起点、时间、预算及全局拒绝/偏好。N=3 夹具只验证解析结果，不会进入旧 A/B 路线。

服务端边界完整解析请求体；当请求无法生成旧双人 `a`/`b` 投影（当前包括 N=1 和 N>2）时返回 `group_not_supported`，并在进入旧 A/B Qloo 调用前停止。这样不会丢弃成员数据，也不会把未实现的多成员请求伪装成双人结果。

## 已知风险（Known risks）

- 没有服务端密钥时无法证明实时 Qloo 结果；页面只能证明规则基线可运行。
- GitHub Pages 是静态部署，`/api/qloo` 不可用；它不能替代带服务端环境的 Vercel 或 Netlify。
- Qloo 的限流、超时、字段缺失和城市过滤仍由回退路径处理；当前仓库没有真实生产流量证据。
- 比较页右栏是规则基线，不是模型测评结果；不能据此宣称 Qloo 胜出。
- 当前路线模块仍按 A/B 关系生成解释；多成员契约需要后续阶段明确评分、路线和协商规则后才能接入。
