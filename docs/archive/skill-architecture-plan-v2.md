# WrenAI Skill 架构方案 V2（可落地版）

## 状态说明（2026-04-11）

> 本文档保留为 **Skill runtime owner / marketplace / migration 设计的历史基线**。
> Ask/runtime 编排、inject-only 收口、`SKILL` / `skill_result` 退场、DeepAgents ownership transfer 以 `docs/deepagents-ask-architecture.md` 为准。
> 文中涉及 `runner_first` / `hybrid` / executable skill 直返 `SKILL` 的部分，均不再作为当前实现目标。


## 1. 背景与 V2 目标

### 1.1 为什么需要 V2

当前 skill 体系已经不是单纯的“prompt 片段”：

- 前端与服务端存在完整的 `skill_definition + skill_binding + connector + secret` 链路
- ask 路径支持真正的 **skill runner 执行结果**
- 首页已经存在“技能模式 / selectedSkillIds / skill preview”交互

因此，V2 不能只做“把 instruction 塞进 NL2SQL prompt”这种单点改造，也不能简单把现有 `skill_binding.knowledge_base_id` 置空就宣告完成解耦。

V2 的目标是：

1. **解耦 skill 与 KB**
   - skill 是分析能力（HOW）
   - knowledge base 是数据来源（WHERE）
2. **同时支持两类 skill**
   - instruction 型 skill：把领域规则注入 NL2SQL
   - executable 型 skill：通过 runner 执行并可直接返回 `SKILL` 结果
3. **建立稳定的 workspace 级 skill 运行时模型**
   - 线程里选择 skill
   - ask runtime 解析 skill
   - connector / secret 归属稳定
4. **为 marketplace 做铺垫，但不把 marketplace 与 runtime 实体混淆**

---

## 2. V2 设计原则

### 2.1 运行时 canonical 实体只有一个

V2 中，**用户真正选择、线程真正持久化、ask 真正执行的 skill 实体**必须只有一个 canonical owner。

本方案定义：

- `skill_marketplace_catalog`：**发布源 / 市场源**
- `skill_definition`：**workspace 内实际可执行、可选择、可持久化的 runtime skill 实体**

也就是说：

- marketplace 只负责“发布什么”
- `skill_definition` 负责“当前 workspace 实际安装并运行什么”
- `thread.selected_skill_ids` 始终指向 `skill_definition.id`

### 2.2 不在 V2 runtime 主表引入 platform scope 行

虽然产品概念上存在：

- platform skills
- workspace skills
- user skills（未来）

但 **V2 不在 `skill_definition` 中引入 `scope='platform'` 的运行时行**。原因：

1. 当前 `skill_definition.workspace_id` 是必填
2. 权限、查询、线程引用都已按 workspace 实体组织
3. “平台内置能力”完全可以通过 **catalog + 自动安装/自动物化** 方式实现

因此：

- 平台 builtin skill：体现在 `skill_marketplace_catalog.is_builtin=true`
- 真正进入运行时后，仍然物化成 workspace 自己的一条 `skill_definition`

### 2.3 不用全局开关替代 skill 的执行语义

V2 **不引入全局 `skill_execution_mode`** 来决定整个系统是 “inject” 还是 “runner_first”。

系统级依然保留：

- `ask_runtime_mode = legacy | deepagents`

skill 级则引入自己的执行语义：

- `inject_only`
- `runner_first`
- `hybrid`

解释：

- `inject_only`：仅注入 instruction，不走 runner
- `runner_first`：优先 runner 成功则返回 `SKILL`，失败 fallback 到 NL2SQL
- `hybrid`：既注入 instruction，也允许 runner 优先执行

### 2.4 instruction 要尽早进入 ask pipeline

V2 中 skill instruction 不只在 SQL generating 阶段使用，而应构造成统一的 `effective_instructions`，至少贯穿：

1. `intent_classification`
2. `sql_generation_reasoning / followup_sql_generation_reasoning`
3. `sql_generation / followup_sql_generation`

这样才能保证分类、规划、生成阶段一致。

---

## 3. 当前系统约束（V2 必须兼容的现实）

V2 方案建立在以下现状之上：

1. `deepagents_orchestrator.run()` 当前仍是 **runner-first → fallback**
2. `skill_binding` 当前不仅是“关系表”，还承载：
   - `connector_id`
   - `binding_config`
   - `enabled`
3. 迁移启动时，`buildAskRuntimeContext()` 依赖 `skill_binding` 来解析：
   - skills
   - connectors
   - secrets
4. 迁移启动时，技能控制面仍然是 binding-centric：
   - 技能管理页同时展示 `skillDefinitions + skillBindings`
   - skill preview API 仍走 legacy binding preview 路径
   - 首页按 KB 去拉 legacy binding 列表

因此，V2 必须包含：

- runtime 行为改造
- schema 改造
- 数据迁移
- API / UI 控制面改造

而不是只改文档语义。

> 实施状态更新（2026-04-10）：上述第 3/4 点已经完成收口。当前主路径已切到
> `skill_definition`：
>
> - `buildAskRuntimeContext()` 只按 `selectedSkillIds -> skill_definition` 解析
> - skill preview 主路径为 `/api/v1/skills/:id/test`
> - 首页使用 workspace 级 available skills，而不是按 KB 拉 binding
> - legacy bindings REST 兼容层已删除

---

## 4. V2 目标模型

## 4.1 概念层

```text
Marketplace Catalog（平台发布源）
    ↓ 安装 / 自动物化
Skill Definition（workspace runtime skill）
    ↓ 被 thread.selected_skill_ids 引用
Ask Runtime（instruction / runner / connector / secret 解析）
```

### 4.2 与 KB 的关系

V2 中：

- skill **不绑定** KB
- skill **可推荐** 给某些 KB（仅 UI soft hint）
- skill 执行时使用当前 ask 的 runtime scope（workspace / KB / snapshot / deploy）

也就是说：

- KB 决定数据范围
- skill 决定分析策略或执行能力
- 两者独立选择，同时生效

---

## 5. 数据模型设计（V2）

## 5.1 新增表：`skill_marketplace_catalog`

平台维护的发布源，不参与 thread 持久化与 ask runtime 直接选择。

```sql
CREATE TABLE skill_marketplace_catalog (
  id                UUID PRIMARY KEY,
  slug              VARCHAR NOT NULL UNIQUE,
  name              VARCHAR NOT NULL,
  description       TEXT,
  category          VARCHAR,
  author            VARCHAR,
  version           VARCHAR NOT NULL DEFAULT '1.0.0',
  runtime_kind      VARCHAR NOT NULL DEFAULT 'isolated_python',
  source_type       VARCHAR NOT NULL DEFAULT 'marketplace',
  source_ref        TEXT,
  entrypoint        VARCHAR,
  manifest_json     JSONB,
  default_instruction TEXT,
  default_execution_mode VARCHAR NOT NULL DEFAULT 'inject_only',
  is_builtin        BOOLEAN NOT NULL DEFAULT false,
  is_featured       BOOLEAN NOT NULL DEFAULT false,
  install_count     INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMP NOT NULL DEFAULT now(),
  updated_at        TIMESTAMP NOT NULL DEFAULT now()
);
```

### 说明

- `default_instruction`：安装时的默认 instruction
- `default_execution_mode`：安装时的默认执行模式
- builtin skill 不是“直接运行”，而是“可自动安装/自动物化”

---

## 5.2 修改表：`skill_definition`

V2 中，`skill_definition` 直接成为 **workspace runtime skill**。

建议新增字段：

```sql
ALTER TABLE skill_definition ADD COLUMN catalog_id UUID NULL REFERENCES skill_marketplace_catalog(id);
ALTER TABLE skill_definition ADD COLUMN instruction TEXT;
ALTER TABLE skill_definition ADD COLUMN is_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE skill_definition ADD COLUMN execution_mode VARCHAR NOT NULL DEFAULT 'inject_only';
ALTER TABLE skill_definition ADD COLUMN connector_id UUID NULL REFERENCES connector(id);
ALTER TABLE skill_definition ADD COLUMN runtime_config_json JSONB;
ALTER TABLE skill_definition ADD COLUMN kb_suggestion_ids JSONB;
ALTER TABLE skill_definition ADD COLUMN installed_from VARCHAR NOT NULL DEFAULT 'custom';
-- custom | marketplace | builtin
```

### 说明

- `instruction`：skill 自身的领域分析提示
- `is_enabled`：workspace 维度启用开关
- `execution_mode`：`inject_only | runner_first | hybrid`
- `connector_id`：V2 最小可行方案先支持单 primary connector
- `runtime_config_json`：skill 的 workspace 运行时配置
- `kb_suggestion_ids`：仅 UI 提示，不参与权限与执行约束
- `installed_from`：来源展示与权限控制辅助字段

### 迁移期辅助字段（推荐）

为保证 Wave 4 数据迁移**可重跑且不重复克隆**，建议在迁移期额外增加一个 provenance 字段：

```sql
ALTER TABLE skill_definition ADD COLUMN migration_source_binding_id UUID NULL;
```

用途：

- 仅用于 legacy `skill_binding -> skill_definition` 回填时做幂等防重
- 尤其用于 **Case 4（多个 binding 配置冲突，需要拆成多条 runtime skill）**

说明：

- `installed_from='migrated_from_binding'` 只能说明“这条 skill 来自迁移”，
  但**不能唯一标识是哪一个 binding 生成的**
- 对于 Case 4，一条旧 skill 可能拆出多条新 skill，单靠 `installed_from` 不足以判断某个 binding 是否已经物化
- 因此更推荐：
  - 要么直接加 `migration_source_binding_id`
  - 要么建立一张独立 migration mapping 表

V2 默认建议采用前者，等兼容窗口结束后可再评估是否移除该字段。

### 保持不变

- `thread.selected_skill_ids` 继续存 `skill_definition.id`

---

## 5.3 `skill_binding` 的处置

V2 **不建议继续复用 `skill_binding` 作为主路径表**。

原因：

1. 它是 KB 绑定心智的产物
2. 当前没有 `workspace_id`
3. 当前语义混杂：关系、connector、config、enabled 混在一起
4. 会让“skill 已与 KB 解耦”的产品语义长期不干净

### V2 方案

- Phase B~C：`skill_binding` 进入**兼容只读态**
- Phase C：把仍有价值的数据迁到 `skill_definition`
- Phase E：删除主路径读写
- Phase F：真正 drop table（或保留归档窗口后移除）

---

## 6. Ask Runtime 设计（V2）

## 6.1 前端传参

前端仍然传：

- `selectedSkillIds`
- 当前 runtime identity（workspace / knowledgeBase / kbSnapshot / deployHash）

不再按 KB 去解析绑定。

### 新语义

```text
selectedSkillIds = 用户本次明确选中的 workspace runtime skill ids
```

---

## 6.2 `buildAskRuntimeContext()` 新逻辑

```ts
// 1. 按 workspace 拉取 available skills
const availableSkills = await skillService.listAvailableSkills(workspaceId);

// 2. selectedSkillIds 白名单过滤
const selectedSkills = selectedSkillIds?.length > 0 ? availableSkills.filter((skill) => selectedSkillIds.includes(skill.id)) : [];

// 3. 从 skill_definition 直接解析 connector / secret / runtime config
// 4. 组装 AskSkillCandidate[]
```

### 关键变化

旧逻辑：

```text
skillBindingsByKnowledgeBase → definition → connector/secret
```

新逻辑：

```text
skillDefinitionsByWorkspace → selected skills → connector/secret
```

即：

- 不再调用 `listSkillBindingsByKnowledgeBase`
- 不再把 KB 当作 skill availability 过滤条件
- 只把 KB 当作当前 ask 的 runtime scope

---

## 6.3 `AskSkillCandidate`（V2）

```ts
interface AskSkillCandidate {
  skillId?: string | null;
  skillName?: string | null;
  instruction?: string | null;
  executionMode?: "inject_only" | "runner_first" | "hybrid";
  runtimeKind?: string;
  sourceType?: string;
  sourceRef?: string | null;
  entrypoint?: string | null;
  skillConfig?: Record<string, any>;
  limits?: {
    timeoutMs?: number;
    maxMemoryMb?: number | null;
    networkAllowlist?: string[];
  };
}
```

---

## 7. AI Service 设计（V2）

## 7.1 保留系统级 `ask_runtime_mode`

继续保留：

- `legacy`
- `deepagents`

用于系统运行时路由与 shadow compare，不与 skill 行为混淆。

### 不新增

- 不新增全局 `skill_execution_mode`

---

## 7.2 `legacy_ask_tool.py`

新增统一逻辑：

```python
skill_instructions = extract_skill_instructions(ask_request.skills)
effective_instructions = list(instructions) + skill_instructions
```

并在以下阶段统一使用 `effective_instructions`：

1. `intent_classification`
2. `sql_generation_reasoning`
3. `followup_sql_generation_reasoning`
4. `sql_generation`
5. `followup_sql_generation`

### `extract_skill_instructions()`

提取顺序：

1. `skill.instruction`
2. `skill.skill_config["instruction"]`
3. 无则跳过，不 fallback 到 `skill_name`

> 不建议直接 fallback 到 `skill_name`，因为 skill 名称常常不是可执行的领域指令，会污染 prompt。

---

## 7.3 `deepagents_orchestrator.py`

改为**按 skill 自身执行模式**路由，而不是全局开关。

### 运行规则

#### `inject_only`

- 不调用 runner
- 只把 instruction 注入 fallback NL2SQL 路径

#### `runner_first`

- 调用 runner
- success → 返回 `SKILL`
- fail → fallback NL2SQL

#### `hybrid`

- instruction 参与 fallback NL2SQL
- 同时允许 runner-first
- success → 返回 `SKILL`
- fail → fallback NL2SQL，但保留该 skill 的 instruction

---

## 7.4 `tool_router.py`

职责保持不变：

- 系统级 runtime 路由
- shadow compare

变化只是：

- `DeepAgentsAskOrchestrator.run()` 内部不再依赖全局 skill mode
- 转而依赖每个 skill 的 `execution_mode`

---

## 8. API / GraphQL / UI 设计（V2）

## 8.1 GraphQL

### Query

```graphql
type Query {
  marketplaceCatalogSkills: [MarketplaceCatalogSkill!]!
  availableSkills: [SkillDefinition!]!
}
```

### Mutation

```graphql
type Mutation {
  installSkillFromMarketplace(catalogId: ID!): SkillDefinition!
  toggleSkillEnabled(skillId: ID!, enabled: Boolean!): SkillDefinition!
  updateSkillDefinitionRuntime(skillId: ID!, instruction: String, executionMode: String, connectorId: String, runtimeConfig: JSON, kbSuggestionIds: JSON): SkillDefinition!
}
```

---

## 8.2 REST API

### 保留

- `/api/v1/skills`

### 新增/调整

- `/api/v1/skills/available`
- `/api/v1/skills/:id/test`
  - 用 skillDefinitionId 做 preview
  - 不再使用 bindingId

### 已移除（主仓代码）

- legacy bindings list route
- legacy bindings preview route

---

## 8.3 技能管理页

页面重构为两块：

### A. 技能市场

- 展示 `skill_marketplace_catalog`
- builtin 显示“内置可用”
- marketplace 显示“安装”

### B. 我的技能

- 展示 workspace 下所有 `skill_definition`
- 可编辑：
  - instruction
  - execution mode
  - connector
  - runtime config
  - enable/disable
  - KB suggestions

### 去掉

- KB 绑定表格
- “为某个 KB 绑定技能”的交互

---

## 8.4 首页 Skill Selector

首页 skill picker 改为：

- 只按 workspace 拉取 `availableSkills`
- 不再按 KB 拉 bindings
- 选中的 skill ids 直接作为 `selectedSkillIds`

KB 与 skill 的关系只体现在：

- 当前 KB 可以用于 UI 推荐排序
- 不参与 skill 可用性硬过滤

---

## 9. 迁移策略（V2 关键）

V2 成败的关键，不是 schema 设计本身，而是**如何把现有 binding-centric 数据迁过去**。

## 9.1 Phase A：行为桥接（先做，可独立上线）

目标：先让 AI service 理解 V2 skill 输入，但不立刻打断现有数据模型。

步骤：

1. `AskSkillCandidate` 增加：
   - `instruction`
   - `executionMode`
2. `wrenAIAdaptor` 透传这两个字段
3. `legacy_ask_tool.py` 引入 `effective_instructions`
4. `deepagents_orchestrator.py` 支持 per-skill execution mode
5. 兼容旧数据：
   - 若没有 `instruction` 字段，可从旧 `binding_config / manifest` 兜底读取

### 结果

- 即使前端还没 fully 切 UI，也能先验证 V2 ask 行为

---

## 9.2 Phase B：schema 升级

新增：

1. `skill_marketplace_catalog`
2. `skill_definition` 新字段

此时：

- `skill_binding` 仍保留
- 但不再继续扩展新能力

---

## 9.3 Phase C：数据回填与冲突处理

对每个 `skill_definition` 做分类迁移：

### Case 1：没有 binding

- 直接保留为 workspace skill
- `connector_id = null`
- `runtime_config_json = manifest 或空`

### Case 2：恰好一个 active binding

- 回填到该 `skill_definition`
  - `connector_id <- binding.connector_id`
  - `runtime_config_json <- binding.binding_config`
  - `is_enabled <- binding.enabled`
  - `kb_suggestion_ids <- [binding.knowledge_base_id]`

### Case 3：多个 binding，且配置一致

若多个 binding 的：

- `connector_id` 相同
- `binding_config` 相同
- `enabled` 语义一致

则：

- 只回填一条 `skill_definition`
- `kb_suggestion_ids` 聚合为数组

### Case 4：多个 binding，且配置冲突

这是 V2 的重点。

处理策略：

1. 克隆出新的 `skill_definition` 行，每个冲突 binding 对应一条 runtime skill
2. 新 skill 继承原 skill 的：
   - name（附加后缀）
   - runtime package 信息
   - secret
3. 各自携带自己的：
   - `connector_id`
   - `runtime_config_json`
   - `kb_suggestion_ids`
   - `migration_source_binding_id`

旧 skill 处理：

- 标记为 `is_enabled=false`
- 标记 `migration_note='split_from_legacy_binding'`（可通过 json/meta 字段存）
- 暂时保留只读兼容，不再给新线程使用

### Phase C 的幂等要求

Phase C 的迁移脚本必须满足：

1. **可重复执行**
2. **不会重复克隆 Case 4 skill**
3. **重复执行后结果稳定**

推荐规则：

#### 对 Case 2 / Case 3（更新既有行）

- 先读取当前 `skill_definition`
- 计算目标 patch
- 若目标值已一致，则跳过写入

#### 对 Case 4（克隆新行）

- 先按 `migration_source_binding_id = binding.id` 检查是否已经存在迁移产物
- 若存在，则直接复用，不再重复克隆
- 若不存在，才创建新的 runtime skill

#### 对旧 skill 的收尾动作

- 只有在所有冲突 binding 都完成物化后，才把旧 skill 置为 legacy/disabled
- 该步骤也必须是幂等更新，而不是假设只跑一次

如果团队不愿在 `skill_definition` 中引入迁移辅助字段，则必须至少使用**独立 mapping 表**来记录：

- `source_skill_definition_id`
- `source_binding_id`
- `target_skill_definition_id`

否则无法安全支持脚本重跑。

### 兼容说明

旧 thread 若仍引用旧 skill id：

- 在兼容窗口内仍可通过 legacy resolver 回放
- 新线程只允许写入新 skill ids

---

## 9.4 Phase D：控制面切换

完成后：

- `listAvailableSkills(workspaceId)` 以 `skill_definition` 为准
- skill preview 改为基于 `skill_definition.id`
- 首页 skill picker 不再访问 `/skills/bindings`
- 技能管理页去掉 binding 面板

---

## 9.5 Phase E：下线 legacy binding 主路径

完成以下条件后才能下线：

1. ask runtime 不再读 `skill_binding`
2. preview API 不再读 `skill_binding`
3. UI 不再展示或写入 `skill_binding`
4. 数据回填完成
5. 历史线程兼容方案已验证

> 状态：1~3 已完成；当前剩余工作主要是迁移脚本、数据回填验证与最终表退场窗口管理。

---

## 10. 实现顺序（推荐）

```text
Wave 1：AI service 行为桥接
  1. AskSkillCandidate 增加 instruction / executionMode
  2. wrenAIAdaptor 透传字段
  3. legacy_ask_tool 注入 effective_instructions
  4. deepagents_orchestrator 改成 per-skill execution mode

Wave 2：schema 与 service
  5. 新建 skill_marketplace_catalog
  6. 扩 skill_definition 字段
  7. repository / skillService 增加 available / install / toggle / updateRuntime

Wave 3：迁移与双读
  8. 回填 skill_definition
  9. 冲突 binding 拆 skill
  10. askContext 改成 skill_definition 主路径，必要时兼容旧 binding

Wave 4：控制面/UI
  11. 技能管理页改成 marketplace + 我的技能
  12. 首页 skill picker 改为 workspace 级 availableSkills
  13. preview API 切到 /api/v1/skills/:id/test

Wave 5：收口
  14. 删除主路径对 skill_binding 的依赖
  15. 完成回归验证
  16. 在兼容窗口结束后移除 skill_binding
```

---

## 11. 关键接口变更清单

## 11.1 wren-ui

- `skillDefinitionRepository.ts`
  - 增加 `listAvailableSkillsByWorkspace`
  - 增加 marketplace 安装相关方法
- `skillService.ts`
  - 增加 `listAvailableSkills(workspaceId)`
  - 增加 `installSkillFromMarketplace`
  - 增加 `toggleSkillEnabled`
  - 增加 `updateSkillDefinitionRuntime`
- `askContext.ts`
  - 从 `skill_definition` 直接解析 skills/connectors/secrets
- `wrenAIAdaptor.ts`
  - 透传 `instruction` / `executionMode`
- `pages/knowledge/skills.tsx`
  - 重构为 marketplace + 我的技能
- `pages/home/index.tsx`
  - skill picker 不再按 KB 拉 binding

## 11.2 wren-ai-service

- `src/web/v1/services/ask.py`
  - `AskSkillCandidate` 增字段
- `src/core/legacy_ask_tool.py`
  - 提前构造 `effective_instructions`
- `src/core/deepagents_orchestrator.py`
  - 按 skill 级执行模式路由
- `src/core/tool_router.py`
  - 保留 ask runtime mode，不引入全局 skill mode

---

## 12. 验证方案

## 12.1 AI service

新增测试：

1. `test_legacy_ask_tool_skill_instruction_injection.py`
   - 验证 intent / reasoning / generation 都使用 `effective_instructions`
2. `test_deepagents_skill_execution_mode.py`
   - `inject_only` 不跑 runner
   - `runner_first` success 返回 `SKILL`
   - `runner_first` fail fallback
   - `hybrid` fail 后 fallback 仍带 instruction

## 12.2 wren-ui

新增测试：

1. `askContext.test.ts`
   - 不再依赖 KB binding 解析 available skills
2. `skills_api.test.ts`
   - skill preview 改为以 skillDefinitionId 为主
3. `home/index.test.tsx`
   - 首页 skill picker 不再按 KB 拉 bindings
4. `knowledge/skills` 页面测试
   - marketplace / install / enable / edit runtime config

## 12.3 数据迁移验证

迁移后必须验证：

1. 单 binding skill 正确回填
2. 多 binding 一致配置 skill 正确聚合
3. 多 binding 冲突 skill 被正确拆分
4. 历史 thread 兼容读不回归

---

## 13. V2 明确不做的事情

V2 不做：

1. user-private skill 完整实现
2. 多 connector per skill 的通用化模型
3. marketplace 自动升级/版本漂移治理
4. 完整删除所有 legacy thread 兼容逻辑

这些都可以在 V3 再推进。

---

## 14. 最终决策摘要

V2 的核心决策是：

1. **skill 与 KB 解耦，但不牺牲现有 runner 能力**
2. **runtime canonical 实体是 workspace-owned `skill_definition`**
3. **catalog 是发布源，不是 thread 直接引用对象**
4. **skill 行为是 per-skill，而不是全局开关**
5. **instruction 要贯穿整个 ask pipeline，而不是只在 generating 阶段拼接**
6. **`skill_binding` 进入兼容退场流程，而不是继续长期复用**

如果按这个版本落地，V2 能同时满足：

- 产品语义更干净
- 迁移路径更可执行
- 对现有 ask / skill runner / connector / secret 链路更安全
