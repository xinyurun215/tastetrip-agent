# TasteTrip 第三轮：共同候选比较，本地验收报告

日期：2026-10-15。范围：沿用现有界面的最小功能实现；本地验收，不推送、不合并、不部署。

## 结果

共同候选比较已实现。每名成员可选电影、音乐人、书籍偏好，也可全部留空；群组至少需要一条经操作者明确确认的文化实体。自由输入先搜索，结果展示名称、类型、年份、消歧信息、外部标识及 ISBN；不自动选第一条。无结果可明确跳过。实体 ID 在服务端按所选类别再次验证。

一次发现最多 25 个地理范围内的候选，随后每位有信号的成员对同一冻结池排序。界面显示逐人名次、返回覆盖和名次差异；不同查询的 affinity 不相加，也不被称为满意度。没有共同前五、返回不完整、成员无信号和候选池为空分别处理。

解释仅使用实际响应中可解析的已选信号贡献，保留接口警告。缺解释明确显示不足；贡献未出现不推断为没有作用。相同稳定地点 ID 或可验证同店标识可合并；同名不同分店保留并标疑似重复。否决对已知别名和可验证同店身份持续生效。

选择候选只生成待采纳修改，接入原有采纳、取消、撤销和已确认站点保护。初始共同路线为空，由操作者逐项选择；确认不代表真实多用户投票。输入修改后旧路线仍显示，但操作禁用；晚到结果、重复提交和旧按钮不能跨版本生效。补查与撤销同步恢复对应候选池，避免混用不同池的名次。价格、营业、移动时间等未知事实继续待核实。相册实现和照片未修改。

## 工作树与启动

- 仓库：`https://github.com/xinyurun215/tastetrip-agent`
- 基线：`0ced72928562ea19de1172f92c29fc8aea4cd6f3`
- 分支：`feat/common-candidate-comparison`
- 工作树：`C:\Users\xinyu\Documents\Codex\2026-10-15\task-11\tastetrip-common-candidates`
- 历史 Git 对象以只读来源复制至本任务独立 bare 仓库，再创建分支工作树；没有修改 `D:\合味旅行` 的未提交历史改动，也没有修改上一轮参考检出。

本地合成体验入口：<http://127.0.0.1:5197>。

在上述工作树执行：

```powershell
node scripts/common-demo.js
```

首次选择语言 → 填入纽约示例 → 搜索实体 → 每条明确选择准确版本或跳过 → 比较共同候选 → 选择并查看修改 → 采纳。示例中的所有数据都为合成，顶部证据标注和底部固定标记均明确说明。此服务禁用环境文件并注入本地假传输，不会访问真实 Qloo。

场景：`?scenario=partial`（排名缺项）、`empty`（空池）、`error`（服务失败）、`slow`（慢比较）、`slow-search`（慢搜索）、`recheck`（初始池仅三项，否决后补查新池）。常规 `npm run dev` 没有本机 Qloo 凭据时会显示不可用，不会伪造实时候选。

## 验证证据

- 基线：145/145 测试通过。
- 最终 `npm test`：198/198 通过，0 失败、0 跳过。
- `npm run build`：通过，21 个模块；本地构建产物已生成。Windows 沙箱曾阻止 Vite realpath，获准在沙箱外重跑本地构建后成功，未部署。
- Chrome 155 本地浏览器验收：14/14 检查通过，0 页面运行时异常；桌面 1440×1080、移动端 390×844。
- `git diff --check`：通过。
- 相册文件及 `public/album-photos` 的差异为空。
- 无新增依赖。离线依赖安装因缓存缺少 Vite 未完成，随后复用相同基线参考检出的依赖目录完成测试与构建。

浏览器检查包含：自由输入与可选空类别；歧义实体显式确认；实体选择在中英切换后保留且不新增请求；同池排名与无共同前五；选择待采纳与全确认保护；否决、取消、撤销及过期采纳；输入变更后旧路线操作无效；候选耗尽后的真实后端代码补查和撤销恢复旧池；部分覆盖；某成员全部留空；空池；取消搜索的迟到响应；快速重提只采用最新结果；输入修改令慢比较失效；移动端表格横向滚动与页面无横向溢出。

自动测试覆盖额外边界：`types[]`、`properties.external`、Insights `subtype`、同池参数完全一致、原始解释和警告、404 无结果、错误类型或失效实体、不可信地点地理、重复/同店别名/不同分店、缺失或无效贡献、无共同前五、特殊成员键、跨池排名隔离、硬拒绝、已确认站点及未知事实保护。夹具全部明确合成；集成测试的真实网络调用陷阱计数为 0。

本机证据目录：`C:\Users\xinyu\Documents\Codex\2026-10-15\task-11\deliverables`。

- `unit-tests.txt`：完整测试输出。
- `build.txt`：最终成功构建输出。
- `browser/browser-checks.json`：14 项验收与合成请求参数记录。
- `browser/01-entity-confirmation-en.png`：实体歧义确认。
- `browser/02-common-comparison-zh.png`：同池排名、无共同前五和疑似重复。
- `browser/03-candidate-proposal-en.png`：待采纳修改与未知行程事实。
- `browser/04-confirmed-route-en.png`：已确认路线和操作员身份边界。
- `browser/05-mobile-comparison-en.png`：移动端比较。

## 来源与未跑边界

第二轮报告 `libfile_9db8b4ac114c8191b11d1962f07babca` v8 已通过 Library 完整读取。使用当前消费电脑支持的物化流程后，下载步骤完成但 Windows 扩展属性步骤失败；已确认原报告目标文件不存在，没有把云端路径当作本机文件。实现依据完整 Library read、委派摘要和官方资料继续。本机独立合同摘记位于 `reference/TasteTrip-Round3-Qloo-Contract-Notes.md`，明确不是物化原件。

参考官方 [Qloo Search](https://github.com/qloo/docs-public/blob/d4a0eb978518f7fb404993d1509d11b21239ada6/reference/get-search.md)、[Entities](https://github.com/qloo/docs-public/blob/d4a0eb978518f7fb404993d1509d11b21239ada6/reference/get-entities.md)、[解释合同](https://github.com/qloo/docs-public/blob/d4a0eb978518f7fb404993d1509d11b21239ada6/reference/insights-api-deep-dive.md)及 [affinity 解读](https://github.com/qloo/docs-public/blob/main/docs/interpreting-affinity-scores.md)。

本轮没有真实 Qloo 查询，没有读取或下载 Vercel Secret/auth token，没有远端部署、环境配置或远端验收。没有接入 LLM、请求模型密钥或建立 LLM 框架；当前最小功能不需要 LLM。没有原始 Qloo 响应进入仓库。

合成验证不证明真实服务的完整响应形状、延迟、配额、推荐质量或用户满意度。第二轮证据只支持文化信号影响排序，不能支持质量或满意度改善。完整 `/entities` 外层响应及真实外部地点标识样本尚待后续获授权的真实验收核对；当前解析采用保守支持和明确空/错处理。远端真实验收需另行授权。
