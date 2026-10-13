# 阶段 2：Qloo 多成员 harness（测试线束）

阶段 2 通过服务端显式模式 `mode: "members-harness"` 运行，不把多成员输入送进旧的 A/B 评分或路线模块。

## 输入与位置

- 输入沿用 `members[]` 和全局 `context`；成员可以覆盖自己的城市和坐标。
- 地点请求只在存在有效坐标时加入 `filter.location` 和半径；没有坐标时不会伪造纽约位置。
- 旧双人 Demo 在 fixture 中显式提供纽约坐标，浏览器代理会转发 `context`。

## 可复核输出

`resolveMembersHarness` 返回每位成员的 Qloo 实体和地点候选，并保留：

- `requestLog`：请求 URL、类型、实体、标签、成员、城市、坐标、尝试次数、来源和结果摘要；
- `requestStats`：总请求、网络请求、重试、限流、失败和缓存命中；
- `quota`：已用请求数、可选配额上限和剩余量。

Qloo 实体和候选地点标记 `qloo:entity`。没有密钥、限流、超时或不可达时，结果明确标记 `fallback` / `mock:fixture`，并保留已发生请求的审计信息。

## 验证

测试覆盖 N=3、动态上海坐标、成员顺序串行、429 有界重试、HTTP 缓存、配额统计、缺少密钥和失败回退。阶段 2 不包含公平评分、路线优化、动态界面或协商 Agent。
