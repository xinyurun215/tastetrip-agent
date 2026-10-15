# 目的地与候选地理真实性修复验收记录

## 最终真实 Preview 验证（2026-10-15 05:35–05:38 UTC）

**结论：纽约城市文本完整链路通过；东京、巴黎仍不能可靠解析，明确返回空路线。不能宣称三城都已支持。** 未知城市和独立同名歧义场景也已真实验证为空路线。本节是最终结论；后面的“前轮历史记录”只保留修复过程与旧证据，不代表最终版本的验收结果。

本轮仅追加城市类型识别、对应地理回归和本报告。保留交接时所有已有修改，没有修改时间、预算、营业时间、评分逻辑，没有提交、推送或生产发布；没有读取或导出密钥、浏览器凭据，没有新增服务或关闭部署保护。

### 可复核版本

- Git 基线：`57ddf45f4977e19a93924bef982db5a2ce1e7919`，地理修改仍在工作区。
- 最终 Preview：[TasteTrip v4](https://tastetrip-agent-pc3wf2995-xinyurun.vercel.app)。部署 `dpl_8QmuNpC3Kth2b832DUzhTPkDmm7A`，CLI 确认 `READY`。
- 最终 `server/handleQloo.js` SHA256：`37435E8CC4583032C115A67E27B37B5692AC80507D7CADC1F724BFDBF2B4DAF1`。
- 最终 `test/geography.test.js` SHA256：`7DC3A8D87918D09B99024717AF81BA1D75FEE01C59C97C7AE1DF0DF945AB6A6B`。
- 部署源目录：`C:/Users/xinyu/AppData/Local/Temp/tastetrip-preview-geo-v4-20261015/`。最终部署清单已更新为 `tastetrip-preview-geo-manifest.json`，记录部署 ID、URL、基线与文件哈希。报告在验证结束后更新，故部署内报告是此前版本；应用源码与当前工作区一致。
- 正式 `https://tastetrip-agent.vercel.app` 没有改动。

### 真实根因与最小修复

Qloo 的 `urn:entity:locality` 表示地理区域，并不保证是城市。交接 v2 的实际返回中，New York 同时有 State、City、Neighbourhood；Tokyo 精确名称/别名匹配为東京都 Province 与迪拜 Tokyo Islet。旧实现只检查 locality 和名称，忽略地理层级，因此产生错误歧义；若只剩一个省或岛，又可能错误接受。

公开 [Search Entities](https://docs.qloo.com/reference/get-search) 文档确认 locality 可用于搜索、搜索支持标签与分页；[Insights API 参数](https://docs.qloo.com/reference/insights-api-deep-dive) 确认 locality ID 用于 `filter.location`，文本查询是模糊匹配，`filter.location.radius=0` 关闭边界外扩。City / Province / Islet 标签的具体值来自本轮真实返回，不把文档未说明的层级关系当成已证明事实。

最小变更：从来源标签 `tag_id` / `id` / `value` 读取 locality 类型，只接受唯一且明确的 `urn:tag:genre:locality:city`。已知非城市层级不再参与城市选择；缺失类型的精确同名项仍保留为潜在冲突，防止丢弃法国巴黎后误选美国同名城市。缺少 City 证据、类型冲突、多个城市均明确失败。没有硬编码城市坐标、国家或 locality ID，没有按第一个结果选择。

查询仍使用原有 `take=20`。期间 v3 曾尝试按公开文档扩大到 `take=199`，真实 hackathon 请求返回 `DOWN`，只产生 1 次网络尝试和空路线；现有审计没有保留 HTTP 状态细节，不能断言具体服务端限制。已撤回该额外修改，仅保留类型修复。v3 `dpl_ArxhGkBJkrhHzNcRog4ry7xkmFQL` 是未通过验证的中间版本，不作为交付预览；没有重复部署交接的 v2。

### 最终六次真实页面提交

使用三名虚构成员 `Geo-QA-1/2/3`，偏好均为 `Interstellar / Coldplay / Shake Shack`。共同目的地只输入城市文本，没有输入坐标；成员自身城市保留为上海，以验证它不会覆盖共同目的地。通过真实页面表单提交 `/api/qloo`，服务端使用既有 Preview 配置访问真实 Qloo；没有网络 mock、旧生产回放或伪造候选。

| 输入 | 结果 | Qloo 网络尝试 | 缓存命中 | 候选 / 页面站点 |
|---|---|---:|---:|---:|
| New York | 城市 ID 解析、地点查询及页面路线通过 | 15（含 4 次限流重试） | 10 | 4 / 3 |
| Tokyo | `destination_unresolved`，无城市级精确证据 | 1 | 0 | 0 / 0 |
| Paris | `destination_unresolved`，多个同名 locality 与类型缺失 | 1 | 0 | 0 / 0 |
| NoSuchCityGeoQA20261015 | `destination_unresolved`，无精确匹配 | 1 | 0 | 0 / 0 |
| Springfield | `destination_unresolved`，返回 20 个精确同名 locality | 1 | 0 | 0 / 0 |
| New York（换虚构起点复验缓存） | 同样的候选与路线 | 0 | 16 | 4 / 3 |

最终 v4 合计 **19 次网络尝试，26 次缓存命中**。其中 4 次网络尝试是 429 限流失败，既有重试机制随后成功；统计中的 `failed=4` 指这些尝试，并非 4 个最终失败提交。纽约第二次更换起点以绕过浏览器整请求缓存，实际发出了应用 API 请求，服务端 Qloo HTTP 请求全部复用缓存。所有失败场景都在目的地解析处停止，没有发起地点 Insights 查询。

本轮额外诊断包括 v2 巴黎一次应用请求（目的地 Qloo 缓存命中 1，无网络尝试）及上述 v3 一次失败网络尝试；与最终 v4 合计是 20 次已记录 Qloo 网络尝试。交接旧证据中的调用不计入本轮。

### 纽约候选及页面核验

解析目的地 ID：`81E61924-6CEE-4AB4-93D3-282A5C784AB8`，来源 City，来源中心 `(40.66320611815103, -73.93889084762313)`。目的地 country 缺失，保持空字符串。每次地点 Insights URL 均使用该 ID 和 `filter.location.radius=0`，本地再核验候选位于中心 12 公里范围内。

| 来源地点 | 纬度 | 经度 | 来源城市 / 国家 | 距中心 km |
|---|---:|---:|---|---:|
| VALERIE | 40.7563426 | -73.9811274 | New York / US | 10.951 |
| Amsterdam Billiards | 40.7317088 | -73.9899424 | New York / US | 8.749 |
| 230 Fifth Rooftop Bar | 40.7441081 | -73.9888201 | New York / US | 9.932 |
| Spyglass Rooftop Bar | 40.7519694 | -73.9848404 | New York / US | 10.603 |

四个候选均为 `qloo:entity`，地址及实体 ID 保留在响应证据。实际页面协商路线顺序：**230 Fifth Rooftop Bar → Spyglass Rooftop Bar → VALERIE**。自动核验路线中的 city、country、lat、lng、address 与对应候选逐字段一致，且页面文本包含这三个地点；第二轮缓存结果相同。浏览器错误列表为空。

### 东京、巴黎和失败边界

- Tokyo：精确匹配的東京都是 Province，中心约 `(29.9895, 140.7677)`；另一个 Tokyo 是 Islet，中心约 `(25.2486, 55.1814)`。它们均被拒绝。其他日本城市的模糊返回没有代替东京。页面明确显示“目的地未确认 · 无可用路线”。
- Paris：20 个返回中有 15 个精确名称匹配；法国附近的三个 Paris locality 缺少类型/国家信息，同时存在多个美国同名 City。保留歧义，未选择排名第一项，也未将未知国家补成 FR。实际巴黎仍未生成路线。
- 未知城市和 Springfield：真实页面均为空路线且显示无法唯一确认城市级目的地，没有复活旧路线或备用示例。
- 当前解析是对返回的前 20 个候选作名称、类型及限定信息核验，不是全球同名城市的穷尽证明。只接受 City 标签，会保守拒绝 town、特殊行政区及缺少类型的数据。国家限定只能使用来源已有字段，不能保证补充国家就可解除缺失数据问题。
- **因此“三城都可用”的目标仍有明确缺口：东京与巴黎需要可靠、可区分的城市级地理证据。** 本轮授权范围内未引入新地理服务或城市对照表，也未猜测坐标。三城真实行为已测完，但只有纽约完成“城市文本 → locality ID → 地点候选 → 页面路线”的成功路径；另外两城验证的是安全停止路径。
- 12 公里中心检查是距离核验，行政边界仍依赖 Qloo ID 过滤，不是独立多边形验证。未处理时间、预算、营业时间、评分或起点地理编码，地理通过不等于完整行程可执行。

### 最终验证与证据

新增 3 组真实形状回归：纽约 City 与 State / Neighbourhood 的顺序无关选择；东京 Province / Islet 即使唯一且附近有地点也不能成为城市；缺失类型既不能单独通过，也不能被丢弃后误选外国同名城市。这三组在修改前均失败，修改后通过；原有正常三城测试是受控 fixture，不冒充真实 Qloo 覆盖。

- `npm test`：**80 tests / 80 pass / 0 fail**。
- 最终 `npm run build`：通过，15 modules，`index-BgWrAXpS.js`；Preview 云端构建同样通过。首次本地受限执行因 Windows `EPERM realpath` 失败，经允许的正常权限重跑成功。
- `git diff --check`：通过（已有文件 CRLF 提示，不是检查失败）。
- `tastetrip-verify-final.mjs`：直接断言 6 次真实响应的目的地、过滤参数、候选坐标距离、路线字段与 UI 文本，全部通过。

下列文件均位于 `C:/Users/xinyu/AppData/Local/Temp/`，不含密钥或浏览器凭据：

| 文件 | 内容 |
|---|---|
| `tastetrip-preview-final-evidence.json` | 本轮 v2 / v3 诊断及 v4 六次页面请求的完整应用响应与时间戳 |
| `tastetrip-preview-verified-summary.json` | 最终 v4 汇总、候选来源/坐标/距离、精确同名 locality、路线及调用数 |
| `tastetrip-preview-geo-manifest.json` | 最终部署版本和源文件 SHA256 |
| `tastetrip-preview-geo-tests.txt` | 最终 80/80 测试日志 |
| `tastetrip-v4-ny-ui.txt`、`tastetrip-v4-ny-cache-ui.txt` | 首轮与缓存轮实际页面路线文本 |
| `tastetrip-v4-tokyo-ui.txt`、`tastetrip-v4-paris-ui.txt` | 东京、巴黎真实空路线页面文本 |
| `tastetrip-v4-unknown-ui.txt`、`tastetrip-v4-ambiguous-ui.txt` | 未知与独立歧义真实空路线页面文本 |
| `tastetrip-verify-final.mjs` | 真实证据断言脚本 |

## 前轮历史记录（以下结论已由上面的最终验证更新）

日期：2026-10-15。基线：`57ddf45f4977e19a93924bef982db5a2ce1e7919`。工作树最初干净；未提交、推送或部署。本轮仅修地理链路，未修改预算、共同时间、营业时间算法或引入模型控制器。

## 结论

本地修复和离线回归完成，75/75 测试通过，生产构建通过。旧跨国错误候选在纽约、东京、巴黎范围内重放均被排除；少量真实坐标查询得到的三地候选可以被本地新版接受并排出路线。

**尚不能宣称“文本城市输入的新版线上端到端验证通过”。** 新增 Qloo locality 搜索及 locality ID 过滤仅完成文档核对、受控响应回归和浏览器重放。本机进程没有配置 Qloo 密钥；现有线上 API 是旧代码，不能测试新增查询；本轮禁止部署且未读取、导出密钥。此项需要在后续获准的现有服务运行环境补一次真实接口验证，尤其确认 locality 的坐标字段和国家/别名覆盖。未使用新增付费服务或凭据。

## 根因与数据链路

1. UI 的 `readMembersContext` 只读取城市文本；`createBrowserQlooClient.resolveMembers` 原样转发。UI 没有地点解析能力，也没有数值坐标输入。
2. 服务端 `placeParamsAt` 原来只有存在坐标才写入地理参数。文本城市不进入地点查询，所以纽约、东京、巴黎的查询 URL 可以完全相同，命中同一批全球结果缓存。这是请求参数缺失，不是已证明 Qloo 无视了正确的地理过滤。
3. `cityOf` 只读 `properties.geocode.name`，未读取 `geocode.city`。`name` 也可能是街区名，不等价于城市。
4. `isSameCityAt` 在候选缺城市时直接放行；没有共同目的地解析和坐标核验。旧 `scanPlace` 递归扫描的坐标还能被后续嵌套字段覆盖或混用。
5. 归一化用 `cityOf(item) || location.city` 回填城市。因此意大利 Tenuta Pianirossi 的原始坐标 `(42.9278021, 11.3584034)` 和意大利地址仍在，却被写成输入城市 New York/Paris。
6. 每位成员的位置可以覆盖共同目的地，合并候选没有共同范围核验。公平评分和路线规划消费这些候选，最终页面照常展示。

## 最小实现

- 复用现有 Qloo `/search`、串行队列、缓存、审计和 `/v2/insights`；没有新依赖。
- 无显式坐标时，搜索 `urn:entity:locality`，只接受唯一精确名称或来源别名匹配，支持来源国家/地区限定。模糊错配、同名歧义、缺 ID/坐标、查询失败明确返回 `destination_*`，不继续全球地点搜索。
- 文本解析成功使用 locality ID 和 `filter.location.radius=0` 请求，禁用默认边界外扩；候选还必须具有有效坐标并位于目的地中心 12 公里以内。当前范围明确显示在结果中。
- API 显式坐标模式保留现有点/半径查询，验证坐标范围；它表示输入坐标范围，**不声称已独立核验输入的城市文字或行政边界**。
- 共同路线只使用全局目的地，成员城市/起点保留在成员资料中，不再覆盖候选查询范围。
- 坐标从已知地理字段成对读取；优先来源有无效坐标时不借用其他嵌套字段洗成有效点。缺坐标或范围外候选被排除；来源国家与解析目的地国家均有值且不一致时排除。
- 来源城市、国家、坐标、地址保留到候选及多成员路线；缺城市为空，绝不填成输入城市。`geocode.city` 优先于 `geocode.name`。
- 无合格候选返回 `no_verified_places` 和空路线。目的地失败在结果和路线视图展示具体原因。旧双人流程也不能把此类失败回退成示例行程。

## 测试证据

新增 `test/geography.test.js` 共 16 条，调用真实浏览器客户端 → 请求处理器 → 归一化/筛选 → 路线规划，仅替换外部 HTTP 边界。另在执行真实 `src/main.js` 的 UI 回归中新增 1 条不可用目的地显示测试。

首轮 11 条地理回归全部失败，随后按具体失败逐项修复；双人假路线、UI 原因显示、坐标混用、空坐标、行政边界默认扩展等补充回归也先确认失败后修复。原有 6 条测试失败源于地点 fixture 缺坐标；补全这些合法样本的坐标，保留原评分/缓存/请求断言，没有放松生产地理校验。

- 最终全套：`npm test`，**75 tests / 75 pass / 0 fail**。
- 构建：Vite `build({configFile:false, envFile:false, ...})`，15 modules，成功。跳过环境文件读取。默认沙盒最终构建一次 `EPERM realpath`，在同样禁用配置/环境读取的授权本地构建重试成功；不是代码构建错误。
- `git diff --check` 通过，仅 Git 提示现有 CRLF 策略。
- 离线覆盖：纽约、东京、巴黎正常候选；全球/跨国候选；成员城市与共同目的地不同；未知目的地；模糊错配；同名歧义及国家限定；缺目的地坐标；缺/异常候选坐标；来源字段不改写；路线保留地理信息；双人回退与错误可见性。

## 真实请求与重放边界

只向现有生产 API 提交 3 次请求，使用虚构的 Geo-QA-1/2/3 和公开口味，显式指定三地坐标及 12 公里半径。请求审计记录 Qloo 网络调用共 **16** 次：纽约 12、东京 2、巴黎 2，其余复用缓存。无模型调用。

| 目的地 | 生产返回 | 本地新版保留 | 本地路线示例 |
|---|---:|---:|---|
| New York | 4 个 live 候选 | 4 | Spyglass Rooftop Bar、VALERIE、230 Fifth Rooftop Bar，共 3 站 |
| Tokyo | 4 个 live 候选 | 4 | TK NIGHTCLUB、Butagumi，共 2 站 |
| Paris | 4 个 live 候选 | 4 | Quartier Latin、La Rêverie Bastille，共 2 站 |

这些是旧线上代理已归一化的真实返回，再经过本地新代码验证和规划；不是新代码已部署，也不是新增 locality 搜索的真实验证。旧代理已丢失的原始国家字段不能在重放中恢复，国家解析保留由结构化离线样本验证。

把前轮保存的错误候选原样重放到三个坐标范围，三地均为 **0 候选 / 0 站 / no_verified_places**，包括被旧代码错误标为 New York 的意大利坐标。

## 浏览器

独立浏览器、本地真实页面和真实请求处理器；外部 Qloo 使用保存的候选重放，locality 响应与评分为明确测试 fixture，不作真实评分证明。

- 纽约表单提交 → 候选 → 协商路线可走通；成员仍写上海也未覆盖纽约共同查询。
- 拒绝 VALERIE 后实际路线重新排列，未复活该站点。
- Unknown 提交后结果与路线为 0 站，展示目的地无法唯一确认；最终视图标为“目的地未确认 · 无可用路线”。
- 浏览器错误列表为空。浏览器和本地测试服务器已关闭。

## 交付物

全部证据位于 `C:/Users/xinyu/AppData/Local/Temp/`：

- `tastetrip-geo-tests.txt`：最终测试日志。
- `tastetrip-geo-live.json`：3 次生产请求、返回和本地重放结果。
- `tastetrip-geo-old-evidence-replay.json`：旧跨国错误候选三地重放结果。
- `tastetrip-geo-browser-evidence.json`：本地浏览器请求、结果和 Qloo 重放 URL。
- `tastetrip-geo-ny-route.png` / `tastetrip-geo-unresolved.png`：本地正常/失败截图。

前轮 QA 附件已上传到 Library：

| 文件 | library_file_id |
|---|---|
| 完整 N3/N5 QA 报告 | `libfile_e86606bae1d88191aba5c09ea3009d9d` |
| 跨国错误路线截图 | `libfile_7c24c3bbe8f481918d6c7c3d2b1eaf29` |
| 五人评分表截图 | `libfile_15a13b767d6c8191b9dfc21e6b4918d3` |
| 全部拒绝截图 | `libfile_cd4256a45e6c8191b7079360ea1cab4b` |

## 剩余边界

- 新 locality 搜索和 ID 过滤需在现有授权服务环境真实验证；名称/别名、国家限定、城市质心缺失或覆盖不完整时会诚实返回不可用。当前尚不能保证任意城市文本都可解析。
- 12 公里中心范围是保守候选范围，不是行政边界多边形计算；行政边界过滤依赖 Qloo 的 locality ID，缺失来源国家时不会推断国家。未实现交通跨境、起点地理编码。
- 多人共同时间、未知费用/营业时间和缺失跨成员评分仍为前轮发现的独立问题，本轮未处理，不把“地理通过”等同“完整旅行可执行”。

官方接口依据：[Search Entities](https://docs.qloo.com/reference/get-search)、[Insights API 参数](https://docs.qloo.com/reference/insights-api-deep-dive)。文档通过公开页面读取，无密钥。
