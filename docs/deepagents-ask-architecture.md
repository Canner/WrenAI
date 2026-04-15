# DeepAgents Ask 架构设计

> 本文档是 WrenAI V1 Ask / Runtime 方向的最终架构基线。
> 适用范围：ask 主链路相关的 AI service、BFF/API contract、前端结果消费与持久化。
>
> 本文档 **覆盖** `docs/archive/skill-architecture-plan-v2.md` 中以下 ask/runtime 设计：
> - `runner_first` / `hybrid`
> - executable skill 作为 ask 主路径
> - `SkillRunner` 参与 ask 主编排
> - `SKILL` 结果类型与 `skill_result` 返回链路
>
> 同时，V2 中以下能力 **继续保留**：
> - `skill_definition` 作为 workspace runtime skill 的 canonical owner
> - `thread.selected_skill_ids -> skill_definition.id`
> - marketplace / catalog / 安装物化模型

> 实现状态（2026-04-11）：
> 本文档对应的 Stage 1～5 已完成落地。第 2 节 / 第 7 节保留的是设计与迁移时的历史现状、迁移顺序说明，不代表当前代码仍停留在该状态。

---

## 1. 官方上游 Ask 架构（参照基准）

官方 WrenAI 的 ask 流程本质上是一条**固定顺序主链**，可以概括为五个大阶段：

```
understanding → searching → planning → generating → correcting → finished
```

但 `searching` / `understanding` 内部并不是单一步骤，而是包含多段 retrieval / routing：

| 大阶段 | 状态 | 实际行为 |
|---|---|---|
| 1 | `understanding` | intent classification，分流 `TEXT_TO_SQL / GENERAL / MISLEADING` |
| 2 | `searching` | historical question、schema retrieval、sql pairs retrieval、instructions retrieval |
| 3 | `planning` | sql generation reasoning（可选） |
| 4 | `generating` | sql generation / followup sql generation |
| 5 | `correcting` | sql correction（仅在 dry-run 失败时按需重试） |

上游没有 skill 机制、没有 SkillRunner、没有 `SKILL` 结果类型，ask 主路径只围绕 NL2SQL / GENERAL 分流展开。

---

## 2. 当前实现分析

### 2.1 当前分层结构

```
AskService.ask()
  └── ToolRouter.run()
        ├── primary: DeepAgentsAskOrchestrator.run()
        │     └── run_skill_first() → 成功则返回 SKILL 结果
        │     └── fallback_runner()  → LegacyAskTool
        └── shadow:  LegacyAskTool.run()（仅在 primary 返回 SKILL 时触发）
```

### 2.2 当前 DeepAgentsAskOrchestrator 实际行为

当前 `DeepAgentsAskOrchestrator` 还不是 ask 主编排器，而是 skill-first router：

1. 先执行 `run_skill_first()`，尝试 `runner_first` / `hybrid`
2. skill 成功时直接返回 `SKILL`
3. skill 未命中或失败时，fallback 到 `LegacyAskTool`

因此，当前 deepagents 只接管了**入口路由**，没有接管 ask 的固定顺序主链。

### 2.3 当前 inject_only 注入位置

当前 `inject_only` instruction 注入已经存在，但发生在 `LegacyAskTool` 内部：

```python
effective_instructions = [
    *instructions,                              # KB instructions
    *extract_skill_instructions(ask_request.skills),
]
```

这意味着：
- skill instruction 已能影响 ask 质量
- 但 deepagents 对 instruction 注入无感知，也无法围绕它做统一编排

### 2.4 当前 shadow compare 局限

当前 shadow compare 只在 primary 返回 `SKILL` 时触发，导致 deepagents fallback 到普通 NL2SQL 路径时没有对比数据。

---

## 3. 架构决策

### 3.1 最终原则：skill 是增强层，不是执行主体

> **skill 的职责是增强 ask，而不是绕过 ask 主链。**

```text
skill = 分析视角 / 领域规则（HOW）
KB    = 数据来源 / schema（WHAT）

两者独立选择，组合生效，但统一走同一套 ask 主链。
```

结论：
- skill 只负责注入 instruction / domain guidance / 轻量上下文
- ask 主链只通过 `selected_skill_ids -> skill_definition` 解析出被选中的 runtime skill，并提取其中的 instruction 注入 `effective_instructions`
- `skill_definition` 在 ask 中不再提供独立执行路径，只承担 skill 选择与 instruction 来源的角色
- skill 不再作为 ask 的独立执行路径
- 不再存在 skill-first 成功后直接返回结果的主路径
- 即使 skill 关联 connector 元信息，也不改变 ask 主链的执行方式

### 3.2 execution mode 最终收口为 inject-only

| 模式 | 决策 | 说明 |
|---|---|---|
| `inject_only` | ✅ 保留 | 唯一有效语义；skill 仅增强 ask |
| `runner_first` | ❌ 删除 | 不再允许绕过 ask 主链 |
| `hybrid` | ❌ 删除 | 不再保留“双路径”语义 |

说明：
- 文档层面，ask/runtime 的唯一 execution 语义就是 `inject_only`
- 如果实现期短暂保留 `execution_mode` 字段，也只作为兼容字段，固定按 `inject_only` 解释，不再参与行为分支

### 3.3 当前阶段先迁 ownership，不在本阶段承诺动态编排

`DeepAgentsAskOrchestrator` 这个名字继续保留，但当前阶段的目标是：

> **把 ask 主编排 ownership 从 LegacyAskTool 迁移到 DeepAgentsAskOrchestrator。**

本阶段不追求 fully dynamic planner，而是先实现：
- deepagents 接管固定顺序 ask 主链
- legacy ask 退为 fallback / baseline
- 后续阶段再逐步引入可选的动态决策

### 3.4 AskRequest 自洽原则

ask 主链只接受 ask 真正需要的输入：
- query / histories / runtime scope
- selected skills（用于 instruction 注入）

以下内容**不再属于 ask 主请求 contract**：
- `actor_claims`
- `connectors`
- `secrets`
- `skill_config`

相关 legacy skill execution 输入类型已从当前 repo 主实现移除；后续若恢复，也不应再作为 ask runtime 的必填/可选输入继续流经主链。

### 3.5 结果模型收口：不再存在 `SKILL`

ask 主链结果收口为：
- SQL 类结果
- GENERAL / MISLEADING 类非 SQL 结果

不再存在：
- `SKILL` 作为 ask result type
- `skill_result` 作为 ask 主响应字段
- `SKILL_QUERY` 作为前端/BFF 的独立展示分支

---

## 4. 目标架构

### 4.1 整体分层

```
AskService.ask()
  └── ToolRouter.run()
        ├── primary: DeepAgentsAskOrchestrator.run()  ← 接管固定顺序 ask 编排
        └── shadow:  LegacyAskTool.run()              ← rollout 期采样对比基线
```

### 4.2 DeepAgentsAskOrchestrator（当前阶段目标行为）

当前阶段由 `DeepAgentsAskOrchestrator` 接管**固定顺序 ask 主链**：

```
Phase 0: 准备阶段
  - 收集 KB instructions + skill instructions
  - 组装 effective_instructions
  - 不依赖 SkillRunner / actor_claims / connectors / secrets

Phase 1: Understanding
  - intent classification
  - 分流 TEXT_TO_SQL / GENERAL / MISLEADING

Phase 2: Searching
  - historical question retrieval
  - 若命中 historical question，则直接返回历史命中结果，跳过后续 schema retrieval / generation / correction phases
  - sql pairs retrieval
  - instructions retrieval
  - schema retrieval

Phase 3: Planning
  - sql generation reasoning（可选）

Phase 4: Generating
  - sql generation / followup sql generation

Phase 5: Correcting
  - dry-run 失败时进入 correction loop
```

说明：
- 这是 **fixed-order orchestration**，不是 fully dynamic planning
- 后续若引入动态化，也是在这套 ownership 已迁移完成的基础上演进

### 4.3 NL2SQLToolset 抽象

将当前 `LegacyAskTool` 内的固定顺序主链拆成可复用的步骤集合，由 deepagents 调用：

> 实现备注：文档中的 `NL2SQLToolset` 是**逻辑抽象**。当前代码没有单独拆成 `src/core/nl2sql_toolset.py`，而是与各 fixed-order runtime 一起落在 `src/core/fixed_order_ask_runtime.py` 中；这属于模块划分差异，不影响功能契约。

```python
class NL2SQLToolset:
    async def classify_intent(self, ...) -> IntentResult
    async def retrieve_historical_question(self, ...) -> HistoricalResult
    async def retrieve_sql_pairs(self, ...) -> SqlPairsResult
    async def retrieve_instructions(self, ...) -> InstructionResult
    async def retrieve_schema(self, ...) -> SchemaResult
    async def reason_sql_generation(self, ...) -> ReasoningResult
    async def generate_sql(self, ...) -> SqlGenerationResult
    async def correct_sql(self, ...) -> SqlCorrectionResult
```

约束：
- `LegacyAskTool` 改为复用 `NL2SQLToolset`
- `DeepAgentsAskOrchestrator` 直接编排 `NL2SQLToolset`
- ownership 迁移后，legacy 保留为 fallback / baseline，而不是主编排真相来源

### 4.4 effective_instructions 统一流转

```text
KB instructions
    +
Skill inject-only instructions
    =
effective_instructions
```

`effective_instructions` 至少贯穿：
- intent classification
- sql generation reasoning
- sql generation / followup generation
- sql correction

其中 skill 侧输入来源明确为：
- `thread.selected_skill_ids` 选中的 `skill_definition`
- ask runtime 从这些 `skill_definition` 中解析 instruction
- 解析结果只作为 `effective_instructions` 的一部分进入 ask 主链，不再派生独立 skill execution path

---

## 5. 数据模型与接口收口

### 5.1 AskSkillCandidate

```python
class AskSkillCandidate:
    skill_id: Optional[str]
    skill_name: Optional[str]
    instruction: Optional[str]
    # 如实现期仍保留 execution_mode，仅允许 inject_only，且不参与路由分支
```

### 5.2 AskRequest

```python
class AskRequest:
    query: str
    histories: list[QueryHistory]
    skills: list[AskSkillCandidate]
    # 以及正常 ask 所需 runtime scope 相关字段
```

明确删除：
- `actor_claims`
- `connectors`
- `secrets`
- `skill_config`

### 5.3 AskResult / 前后端响应模型

AI service ask 响应不再包含：
- `type = SKILL`
- `skill_result`

BFF / API / 前端侧同步收口：
- `AskResultType.SKILL` 删除
- `/api/v1/ask`、`/api/v1/stream/ask` 不再返回 `SKILL_QUERY`
- `SkillAnswer` 不再作为 ask 主结果渲染分支
- tracker / repository / GraphQL generated types 不再读写 `skillResult`

### 5.4 `skill_result` 持久化字段处理原则

当前 `thread_response.skill_result` 等历史字段属于 runner-first 遗留物。

处理原则：
- ask 新主链不再写入 `skill_result`
- BFF / repository 不再依赖 `skill_result`
- 迁移完成后可删除相关持久化字段与 JSON 解析逻辑

---

## 6. Shadow Compare（轻量 rollout 方案）

shadow compare 只用于 deepagents ownership 迁移期的质量比对，不作为长期重型双跑机制。

### 6.1 原则

- **采样执行**：不是所有请求都跑
- **异步/非阻塞优先**：不让 shadow 影响主响应延迟
- **仅比较可比路径**：优先 SQL 主路径，GENERAL / MISLEADING 默认不参与
- **legacy 退场后可关闭**：shadow compare 是 rollout 工具，不是永久主功能

### 6.2 对比对象

对比目标为：
- primary：deepagents 接管后的 fixed-order ask 主链
- shadow：legacy fixed-order baseline

说明：
- 当前阶段的重点是验证 ownership 迁移后结果是否偏移
- 不是为了同时长期维护两套正式 ask 实现

---

## 7. 迁移路径（已完成，保留为实施记录）

### Stage 0（当前状态）
- `DeepAgentsAskOrchestrator` 仍是 skill-first router
- `LegacyAskTool` 仍是 ask 主编排黑盒
- `runner_first / hybrid / SkillRunner / SKILL` 遗留仍在代码中

### Stage 1：Contract 收口为 inject-only
- 删除 `runner_first` / `hybrid` ask 语义
- 删除 `SkillRunner*` 在 ask 主链中的参与
- 删除 `SKILL` / `skill_result` / `SKILL_QUERY` 全链路契约
- ask request 移除 `actor_claims` / `connectors` / `secrets` / `skill_config`

### Stage 2：提取 NL2SQLToolset
- 从 `LegacyAskTool` 中抽出固定顺序主链步骤
- `LegacyAskTool` 改为调用 `NL2SQLToolset`
- `DeepAgentsAskOrchestrator` 获得 `NL2SQLToolset` 编排能力

### Stage 3：迁移 ask ownership 到 deepagents
- `DeepAgentsAskOrchestrator` 接管固定顺序 ask 主链
- skill instruction 注入提升到 orchestrator 侧统一处理
- `LegacyAskTool` 退为 fallback / baseline

### Stage 4：轻量 shadow compare rollout
- 按采样方式比较 deepagents 与 legacy baseline
- 确认结果稳定后逐步关闭 legacy shadow 依赖

### Stage 5：删除 legacy runner 遗留
- 删除 runner-health / runner-preview 等以 runner 为中心的 ask 兼容路径
- 删除前端/BFF/持久化中残留的 `skillResult` / `SKILL_QUERY` / `SkillAnswer` 逻辑

---

## 8. 关键影响面

| 层 | 影响 |
|---|---|
| AI service | `DeepAgentsAskOrchestrator` 从 skill router 变为 ask 主编排；删除 `SkillRunner` ask 主路径、`SKILL` 结果 |
| ToolRouter | shadow compare 改为轻量采样 rollout 机制 |
| Ask contract | ask request 只保留 ask 真正需要的字段；不再携带 actor/connectors/secrets |
| BFF/API | 删除 `AskResultType.SKILL`、`SKILL_QUERY`、`skillResult` 透传 |
| Frontend | ask 结果只保留 SQL / general / misleading UI；移除 `SkillAnswer` 主路径 |
| Persistence | 停止写入 `thread_response.skill_result`，迁移后删除相关解析与存储 |
| Skill runtime model | 继续沿用 V2 的 `skill_definition` canonical owner 方案 |

---

## 9. 不变项

以下内容不受本次架构决策影响：

- `skill_definition` 作为 workspace runtime skill owner
- `thread.selected_skill_ids` 指向 `skill_definition.id`
- marketplace / catalog / builtin 物化策略
- `runtime_scope_id` / `retrieval_scope_id` 隔离机制
- `ask_runtime_mode` 特性开关（`legacy | deepagents`）
- `DeepAgentsAskOrchestrator` 这个命名本身
