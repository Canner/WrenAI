# DeepAgents Ask Legacy 收口计划

更新时间：2026-04-17

---

## 1. 背景

当前 ask 主链已经切到：

- `wren-ui` 前端主入口：`/api/v1/asking-tasks`
- `wren-ai-service` 默认 runtime：`deepagents`
- 主执行 ownership：`DeepAgentsAskOrchestrator`

但代码中仍保留三类 legacy ask 残留：

1. **运行时兜底残留**
   - `LegacyAskTool`
   - `LegacyFixedOrderAskRuntime`
   - `ToolRouter` 中的 fallback / shadow legacy runner
2. **旧 API surface**
   - `wren-ui/src/pages/api/v1/ask.ts`
   - `wren-ui/src/pages/api/v1/stream/ask.ts`
3. **迁移期质量工具**
   - `ask_shadow_compare_enabled`
   - `ask_shadow_compare_sample_rate`
   - UI / API history 中的 shadow compare 统计与展示

这些残留**不再是当前产品 ask 主路径**，但仍会影响代码复杂度、排障心智和最终架构收口。

---

## 2. 当前真实状态

### 2.1 当前主 ask 路径

```text
home / prompt submit
  -> /api/v1/asking-tasks
  -> AskingService.createAskingTask
  -> AskingTaskTracker.createAskingTask
  -> wren-ai-service /v1/asks
  -> ToolRouter.run_ask
  -> DeepAgentsAskOrchestrator
  -> DeepAgentsFixedOrderAskRuntime
```

### 2.2 仍保留的 legacy 执行链

- `wren-ai-service/src/core/legacy_ask_tool.py`
- `wren-ai-service/src/core/fixed_order_ask_runtime.py`
  - `LegacyFixedOrderAskRuntime`
  - `FixedOrderAskRuntime = LegacyFixedOrderAskRuntime`
- `wren-ai-service/src/core/tool_router.py`
  - `fallback_runner()`
  - `shadow_runner()`

### 2.3 关键判断

- **主链路已经不是 legacy**
- **legacy 仍是活代码，不是纯历史文件**
- **当前 residual inventory 文档结论偏乐观，需要修正**

---

## 3. 目标

把 ask 相关残留按风险分三波收口：

### 3.1 目标态

1. `wren-ui` 只保留一个 ask BFF 主入口：`/api/v1/asking-tasks`
2. `wren-ai-service` 只保留一个主 runtime：`deepagents`
3. shadow compare 不再作为长期运行能力
4. legacy fixed-order ask 从 runtime fallback 退场
5. ask 文档与代码事实一致，不再出现“已无残留但代码仍保留 fallback”这种偏差

### 3.2 非目标

本计划**不包含**：

- 文本回答 `sql-answers` 阶段的合并改造
- chart generation 流程改造
- deepagents 从 fixed-order 向 fully dynamic agent orchestration 的演进

---

## 4. 残留分类与处理原则

| 类别 | 现状 | 是否主路径 | 处理策略 |
|---|---|---:|---|
| 旧 API surface | `/api/v1/ask`、`/api/v1/stream/ask` | 否 | 优先删除 |
| shadow compare | rollout / baseline 工具 | 否 | 先关闭，再删除 |
| legacy runtime fallback | deepagents 失败兜底、legacy 模式开关 | 否 | 最后删除 |
| deepagents fixed-order runtime | 当前主 ask 路径 | 是 | 保留 |

---

## 5. 分阶段实施

## Wave 0 — 文档对齐

### 目标

先把“代码真实状态”与文档对齐，避免后续误判。

### 任务

1. 更新 `docs/deepagents-ask-residual-inventory.md`
   - 明确 legacy runtime / fallback / shadow compare 仍存在
   - 明确它们不是主路径，但仍是活代码
2. 在 `docs/deepagents-ask-architecture.md` 增补一段“当前代码落地状态”
   - 主路径：deepagents
   - legacy：fallback / baseline / runtime 开关分支
3. 在 `docs/phase3-next-stage-implementation-plan.md` 标记：
   - “主链 ownership 已切换”
   - “legacy runtime 退场尚未最终完成”

### 验收标准

- 文档不再声称“已无 ask 主链残留实现”
- 文档能准确区分：
  - 主路径
  - fallback
  - 兼容入口
  - rollout 工具

---

## Wave 1 — 删除旧 API surface

### 目标

删除不再被当前产品 UI 使用的旧 ask API 入口，统一 ask BFF surface。

### 删除范围

- `wren-ui/src/pages/api/v1/ask.ts`
- `wren-ui/src/pages/api/v1/stream/ask.ts`
- 对应测试：
  - `wren-ui/src/pages/api/tests/ask_api.test.ts`
  - `wren-ui/src/pages/api/tests/stream_ask_api.test.ts`

### 前置确认

1. 当前前端页面 / hook / e2e 不再依赖这两个接口
2. 没有外部系统调用这两个接口
3. `asking-tasks` 已覆盖当前 UI ask 主链

### 风险

- 若仍有外部脚本或第三方 client 调旧接口，会产生 break change

### 验收标准

- 全仓库无产品路径调用 `/api/v1/ask` 或 `/api/v1/stream/ask`
- ask 主链只剩：
  - `/api/v1/asking-tasks`
  - `/api/v1/thread-responses/:id/generate-answer`
  - `/api/ask_task/streaming_answer`

---

## Wave 2 — 关闭并删除 shadow compare

### 目标

把 shadow compare 从 rollout 工具彻底退场。

### 实施顺序

#### Step 1：先关闭

- 固定 `ASK_SHADOW_COMPARE_ENABLED=false`
- 所有环境不再开启采样 compare

#### Step 2：再删除

删除以下内容：

- `wren-ai-service`
  - `ToolRouter` 中 shadow compare 逻辑
  - `ask_shadow_compare_enabled`
  - `ask_shadow_compare_sample_rate`
  - `AskService` 中 shadow compare 统计与建议逻辑
- `wren-ui`
  - API history 中 shadow compare 聚合接口/字段
  - 诊断页 / summary / drawer 中的 shadow compare 展示

### 风险

- 会失去 deepagents 与 legacy 的质量对比基线

### 前置条件

1. deepagents 主路径已通过回归集
2. 不再计划用 legacy 作为比对 baseline

### 验收标准

- 代码中不再有 ask shadow compare 执行逻辑
- 配置中不再有 ask shadow compare 开关
- UI 中不再展示 ask shadow compare 统计/推荐

---

## Wave 3 — 删除 legacy runtime fallback

### 目标

彻底移除 legacy ask runtime，让 deepagents 成为 ask 唯一执行路径。

### 删除范围

#### `wren-ai-service`

- `src/core/legacy_ask_tool.py`
- `src/core/fixed_order_ask_runtime.py`
  - `LegacyFixedOrderAskRuntime`
  - `FixedOrderAskRuntime = LegacyFixedOrderAskRuntime`
- `src/core/tool_router.py`
  - `fallback_runner`
  - `legacy` 模式分支
- `src/config.py`
  - `ask_runtime_mode: legacy | deepagents`
  - 收口为单一 deepagents 或移除该配置项
- `src/web/v1/services/ask.py`
  - `legacy_ask_tool` 注入
  - legacy runtime 相关 wiring

### 风险

- deepagents 若线上异常，将失去 runtime 级 legacy 回滚手段

### 强前置条件

1. deepagents 主路径稳定
2. shadow compare 已退场
3. 没有任何环境再依赖 `ASK_RUNTIME_MODE=legacy`
4. 有足够的 golden regression / smoke coverage

### 建议的安全动作

1. 先做一轮 ask golden cases
2. 再做 staging / 本地 smoke
3. 最后删 runtime fallback

### 验收标准

- 代码中不再存在 legacy ask runtime 可执行分支
- 配置中不再允许 `legacy` ask runtime
- ask 路径唯一且可解释：
  - deepagents ask
  - text-based answer
  - chart generation

---

## 6. 推荐执行顺序

### 建议顺序

1. **Wave 0**
2. **Wave 1**
3. **Wave 2**
4. **Wave 3**

### 为什么不能倒着做

- 如果直接删 Wave 3：
  - 失去 fallback
  - 失去 baseline
  - 难以快速确认 deepagents 问题
- 如果先删 Wave 1：
  - 风险最低
  - 能先统一 API surface
  - 不影响 runtime 层判断

---

## 7. 回归验证清单

## 7.1 功能回归

1. 首页新建问题
2. follow-up 问题
3. historical question 命中
4. text-to-sql 正常生成
5. text-based answer 正常生成
6. chart tab 正常生成
7. 问题失败 / SQL 失败 / text answer 失败路径

## 7.2 技术回归

1. `wren-ui` ask 相关 API tests
2. `wren-ai-service` ask / tool_router / runtime tests
3. 至少一条真实环境 smoke ask

## 7.3 文档回归

1. ask 架构文档与代码一致
2. residual inventory 与真实状态一致
3. phase plan 不再把“已切 ownership”和“已删除 legacy fallback”混为一谈

---

## 8. 里程碑判断

### M1：API 收口完成

满足：

- `/api/v1/ask`
- `/api/v1/stream/ask`

已删除，产品 ask 统一走 `asking-tasks`

### M2：rollout 工具退场

满足：

- shadow compare 全部下线

### M3：runtime 最终收口

满足：

- legacy runtime 删除
- ask runtime 单一化为 deepagents

---

## 9. 一句话总结

当前 ask 架构已经是：

> **deepagents 主路径 + legacy fallback / shadow / 兼容入口残留**

本计划的目标不是重新设计 ask，而是把这些**非主路径残留**按风险从低到高逐步收干净，最终收口成：

> **唯一 ask BFF 入口 + 唯一 deepagents runtime + 无 legacy fallback**

