# Qloo 上游实体排除补充验收

本次在 `b5afccc32859b90aa81252371a68ff4f7f8ab0c8` 上做最小补丁，修复拒绝 ID 仅在应用后端过滤、没有发送给 Qloo 的缺口。没有新增数据源或修改相册。

## 官方依据与实现边界

2026-10-15 已读取 [Qloo Insights API 官方文档](https://docs.qloo.com/reference/insights-api-deep-dive) 的页面及其内嵌 OpenAPI 参数定义：

- `filter.exclude.entities` 是逗号分隔的实体 ID 字符串，用于排除结果中的实体。
- `take` 的范围为 1–50；`page` 范围为 1–100，默认 1。官方推荐用 `page` 取后续结果；`offset` 是另一种偏移方式。
- 文档没有给 `filter.exclude.entities` 声明 `maxLength` 或列表数量上限。不要把下述应用保护值说成官方限制。

pair 与 members 两条 discovery 路径现在都发送完整的、已排序去重的拒绝 ID；空集合省略排除参数。初次 `take=8`，补查 `take=min(50,max(16,8+拒绝数))`，固定 `page=1`。不接受调用者覆盖 `take/page/offset`，不新增分页扫描。单页没有足够候选只代表此次有限查询未找到可用替代，不代表所有分页均无替代。

HTTP 入口只接受 1–128 字符的字母、数字、冒号、下划线或连字符 ID，去重后最多 100 个，URL 编码后的排除值最多 4096 个 ASCII 字符。这些是本地 GET 请求保护值。非法或超限输入在任何上游调用前返回 `bad_input`，不截断、不丢弃部分排除项。中英文界面均提示输入无效。

仍保留返回后本地防御性过滤和地理校验，即使上游没有遵守参数，也不能复活被拒站点。members 的现有审计日志记录实际请求 URL，不记录 API key 请求头；可用来核对排除参数，但缓存命中或 HTTP 200 本身都不能证明 Qloo 已执行过滤。

## 本地验证

- 新增请求参数和边界测试先运行失败（7 项）；双语 `bad_input` 测试也先复现失败。实现后相关测试 30/30 通过。
- 完整 `npm test`：145/145 通过。
- `npm run build`：通过，20 modules，`index-D4tDSM2l.js`。
- 独立只读复查未发现阻塞性问题或范围扩大。
- 测试捕获发往 Qloo 域名的合成 `fetchImpl` 请求；没有真实 Qloo 调用或真实凭据。覆盖排序去重、空列表、完整合法边界列表、不同集合缓存隔离、相同集合缓存复用、固定分页、超限零请求、防御过滤、审计 URL 和密钥不出现在响应中。
- 日志在仓库外 `C:/Users/xinyu/AppData/Local/Temp/tastetrip-review-evidence/tests-upstream-exclusions.txt` 和 `build-upstream-exclusions.txt`。

## 访问诊断的实际证据

以下两个连接器工具返回 Vercel 服务端 403，不是沙箱审批拒绝：

1. `mcp__codex_apps__vercel_filter_project_envs`：`GET /v10/projects/{idOrName}/env`，`decrypt=false`，目标 `prj_wmKtnSfil8gUBcWHnEmMAsFwcBjJ`，team `team_yUEuI549IuhYAf7VNZzRWinr`。
2. `mcp__codex_apps__vercel_get_deployment`：`GET /v13/deployments/{idOrUrl}`，目标 `dpl_BR9iux5j1PSgU3J9dX1rcTAZWgth`，同一 team。

错误均为当前连接无权访问 `xinyurun` scope。没有从返回错误推断 Qloo 凭据不存在。

此前 `Get-Command vercel` 没找到 PATH 入口；沙箱 `npx --offline --no-install vercel --version` 返回 `ENOTCACHED`，当前用户执行同命令则因缺少可安装包确认退出。这是本地命令发现/调用失败，不是 CLI 登录或权限拒绝；此前据此称 CLI 不可用不够准确。

进一步只读检查发现已有缓存 CLI：`C:/Users/xinyu/AppData/Local/npm-cache/_npx/67eb4586ca667318/node_modules/vercel/dist/vc.js`，版本 64.0.2。直接通过 Node 调用，显式限定 `--scope xinyurun --non-interactive`：

- `project inspect tastetrip-agent` 成功，项目 ID 与连接器识别结果一致。
- `env list preview --project prj_wmKtnSfil8gUBcWHnEmMAsFwcBjJ` 成功，只显示元数据；`QLOO_API_KEY` 为 Hidden / Secret，已有 Preview 适用范围。

因此无需重新登录、改变授权配置或复制生产密钥。后续可在原批准范围内用这个现有 CLI 访问同一项目；若 CLI 自身出现明确访问拒绝，则停下报告。没有读取/输出 token 或 Qloo 密钥，也没有运行 env pull。

新后端真实 Qloo 参数处理及预览端到端流程仍需单独验收，不能由上述合成测试替代。
