# Skill 架构 V2 实施清单

## 状态说明（2026-04-11）

> 本文档保留为 **V2 实施记录 / 落地证据**。
> Ask/runtime 的现行口径已切到 `docs/deepagents-ask-architecture.md`；其中涉及 `runner_first` / `hybrid` / `SKILL` / `skillResult` 的描述应视为历史记录。


更新时间：2026-04-10
关联文档：`docs/archive/skill-architecture-plan-v2.md`

---

## 当前状态快照（2026-04-10）

结论先写清楚：

- **V2 在 repo / 本地 dev PG 范围内已完成收口**
- **主路径代码已经切到 `skill_definition`**
- **本地真实 PostgreSQL audit / rehearsal / apply / post-check 已完成**
- **若还有 staging / prod 等环境，需要复用同一套脚本单独执行**

按 Wave 看当前状态：

| Wave   | 状态          | 说明                                                                                                |
| ------ | ------------- | --------------------------------------------------------------------------------------------------- |
| Wave 1 | ✅ 已完成     | AI service 已支持 `instruction` / per-skill `execution_mode`，并完成 instruction 注入。             |
| Wave 2 | ✅ 已完成     | `wren-ui` runtime contract 已接通，askContext / adaptor / preview 主路径已切到 V2 语义。            |
| Wave 3 | ✅ 已完成     | schema / repository / service 已升级，marketplace catalog 与 workspace-owned runtime skill 已落地。 |
| Wave 4 | ✅ 已完成     | 回填脚本、幂等门禁、双读/主路径切换、本地测试、真实 dev PG rehearsal/apply 已完成。                |
| Wave 5 | ✅ 已完成     | 控制面/API/UI 已切换，legacy bindings REST 路由已删除。                                             |
| Wave 6 | ✅ 已完成     | 主路径收口与真实 dev PG post-check 已完成；`skill_binding` 已从本地真实 PG drop。                  |

最新本地验证证据：

- `bash misc/scripts/skill-binding-retirement-local-verify.sh` ✅
  - drop migration tests：8/8 passed
  - backfill script tests：3/3 passed
  - API regression tests：13/13 passed
- `bash misc/scripts/check-skill-binding-main-path.sh` ✅
- `docs/skill-binding-retirement-inventory.md` 当前 `active runtime / main-path code hit-count: 0` ✅
- 本地真实 PG：
  - `PG_URL='postgres://postgres:postgres@127.0.0.1:9432/wrenai' yarn knex migrate:list` → `No Pending Migration files Found.` ✅
  - `skill_binding` table existence check → `0` ✅
  - `scripts/migrate_skill_bindings_to_runtime_skills.ts --dry-run/--execute` 均已执行 ✅
  - 备份文件：`tmp/skill-binding-retirement-backups/skill-binding-retirement.20260410193137.dump` ✅

---

## 0. 本清单的用途

这不是新的架构文档，而是 V2 架构方案的**实施任务单**。

目标：

1. 把 V2 方案拆成可执行 wave
2. 明确每个 wave 的目标、改动面、验收门槛
3. 降低“边改边漂移”的风险

---

## 1. 总体执行顺序

```text
Wave 1  AI Service 行为桥接
Wave 2  wren-ui/runtime contract 接线
Wave 3  Schema 扩展 + Repository/Service 升级
Wave 4  数据迁移与双读兼容
Wave 5  控制面/API/UI 切换
Wave 6  Legacy 下线与收口验证
```

原则：

- **先行为，后模型**
- **先双写/双读，后切主路径**
- **先让新链路可验证，再删除旧链路**

---

## 2. Wave 1 — AI Service 行为桥接

## 2.1 目标

让 AI service 先具备 V2 语义：

- 能识别 `instruction`
- 能识别 per-skill `executionMode`
- 能在 intent / reasoning / generation 阶段统一吃 `effective_instructions`

此 wave **不要求立刻切 UI 和 DB 主模型**。

---

## 2.2 必做项

### A. `AskSkillCandidate` 扩字段

文件：

- `wren-ai-service/src/web/v1/services/ask.py`

任务：

- 新增 `instruction`
- 新增 `execution_mode`
- 保留现有 runner 所需字段：
  - `runtime_kind`
  - `source_type`
  - `source_ref`
  - `entrypoint`
  - `skill_config`
  - `limits`

验收：

- request model 可兼容 snake_case / camelCase
- 不破坏现有 ask skill runner tests 的解析能力

---

### B. 统一 skill instruction 注入

文件：

- `wren-ai-service/src/core/legacy_ask_tool.py`

任务：

- 新增 `extract_skill_instructions()`
- 构造 `effective_instructions`
- 至少注入以下阶段：
  - `intent_classification`
  - `sql_generation_reasoning`
  - `followup_sql_generation_reasoning`
  - `sql_generation`
  - `followup_sql_generation`

约束：

- 不要 fallback 到 `skill_name` 作为 instruction
- 只允许：
  - `skill.instruction`
  - `skill.skill_config["instruction"]`

验收：

- skill instruction 出现在 intent / reasoning / generation 入参里
- followup ask 也走同一逻辑

---

### C. deepagents 改为 per-skill 执行模式

文件：

- `wren-ai-service/src/core/deepagents_orchestrator.py`
- `wren-ai-service/src/core/tool_router.py`

任务：

- 定义 skill 级：
  - `inject_only`
  - `runner_first`
  - `hybrid`
- `inject_only`
  - 不跑 runner
  - 直接 fallback NL2SQL
- `runner_first`
  - 先跑 runner
  - 成功返回 `SKILL`
  - 失败 fallback
- `hybrid`
  - instruction 始终参与 fallback
  - runner 优先尝试

约束：

- 不新增全局 `skill_execution_mode`
- 继续保留 `ask_runtime_mode`

验收：

- deepagents 下 skill 行为由 skill 自身决定
- shadow compare 行为不被破坏

---

## 2.3 建议测试

- `test_legacy_ask_tool_skill_instruction_injection.py`
- `test_deepagents_skill_execution_mode.py`
- 现有 `test_tool_router_shadow_compare.py`（原 `test_ask_skill_runner.py`）补 executionMode 场景

---

## 3. Wave 2 — wren-ui / runtime contract 接线

## 3.1 目标

让前后端 contract 先对齐 V2 skill 输入，不必先完成 DB 迁移。

---

## 3.2 必做项

### A. adaptor 透传新字段

文件：

- `wren-ui/src/apollo/server/models/adaptor.ts`
- `wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts`

任务：

- `AskSkillCandidate` 增加：
  - `instruction`
  - `executionMode`
- `transformSkills()` 透传到 AI service

验收：

- 透传后的 payload 含新字段
- 不影响现有 preview / ask 请求

---

### B. askContext 支持新字段拼装

文件：

- `wren-ui/src/apollo/server/utils/askContext.ts`

任务：

- `toAskSkillCandidate()` 增加：
  - `instruction`
  - `executionMode`
- 在旧模型兼容期：
  - 可从旧 definition / binding / manifest 兜底取值

验收：

- `buildAskRuntimeContext()` 输出 skill candidate 含新字段

---

### C. skill preview contract 升级

文件：

- 最终主路径：`wren-ui/src/pages/api/v1/skills/[id]/test.ts`
- 过渡期曾保留：legacy binding preview route

任务：

- 先让过渡期 binding preview 能透传 V2 字段
- 再切到 skillDefinitionId preview 主路径
- 兼容窗口结束后删除 binding preview 路由

验收：

- preview 仍能跑
- runner skill / inject skill 在 preview payload 上可区分

---

## 3.3 建议测试

- `wren-ui/src/apollo/server/adaptors/tests/wrenAIAdaptor.test.ts`
- `wren-ui/src/apollo/server/utils/tests/askContext.test.ts`
- `wren-ui/src/pages/api/tests/skills_api.test.ts`

---

## 4. Wave 3 — Schema 扩展 + Repository/Service 升级

## 4.1 目标

把 V2 需要的 runtime skill 主模型落到 DB 和 service 上。

---

## 4.2 Migration 清单

### A. 新建 marketplace catalog

建议 migration：

- `wren-ui/migrations/20260412_create_skill_marketplace_catalog.js`

字段至少包括：

- `slug`
- `name`
- `description`
- `category`
- `version`
- `runtime_kind`
- `source_type`
- `source_ref`
- `entrypoint`
- `manifest_json`
- `default_instruction`
- `default_execution_mode`
- `is_builtin`
- `is_featured`
- `install_count`

---

### B. 扩 `skill_definition`

建议 migration：

- `wren-ui/migrations/20260412_extend_skill_definition_for_v2.js`

新增字段：

- `catalog_id`
- `instruction`
- `is_enabled`
- `execution_mode`
- `connector_id`
- `runtime_config_json`
- `kb_suggestion_ids`
- `installed_from`
- `migration_source_binding_id`（推荐，迁移期幂等辅助字段）

---

### C. legacy binding 进入兼容态

建议 migration：

- `wren-ui/migrations/20260412_mark_skill_binding_legacy.js`

可选动作：

- 添加 legacy 标记字段 / 注释
- 不再为其新增新能力字段

说明：

- 此 wave **不要**立刻 drop `skill_binding`

---

## 4.3 Repository / Service 清单

### A. Repository

文件：

- `skillDefinitionRepository.ts`
- 新建 `skillMarketplaceCatalogRepository.ts`

任务：

- `listAvailableSkillsByWorkspace(workspaceId)`
- `listBuiltinCatalogSkills()`
- `listMarketplaceCatalogSkills()`
- `findCatalogSkillById/slug()`

---

### B. Service

文件：

- `wren-ui/src/apollo/server/services/skillService.ts`

新增能力：

- `listAvailableSkills(workspaceId)`
- `installSkillFromMarketplace(workspaceId, catalogId, userId)`
- `toggleSkillEnabled(workspaceId, skillId, enabled)`
- `updateSkillDefinitionRuntime(...)`

约束：

- `selectedSkillIds` 后续只认 `skill_definition.id`
- 所有 runtime 可执行 skill 必须可从 `skill_definition` 独立解析

---

## 4.4 验收门槛

- schema 可迁移
- repository/service 可完成：
  - list available
  - install
  - toggle
  - update runtime config

状态更新（2026-04-10）：

- 已完成
- `skill_marketplace_catalog` / `skill_definition` V2 migrations 已存在
- marketplace install / available skills / runtime skill repository-service 主路径已接通

---

## 5. Wave 4 — 数据迁移与双读兼容

## 5.1 目标

把现有 binding-centric 数据稳定迁到 V2 runtime skill 模型，不打断历史线程与现有使用。

---

## 5.2 迁移策略

### Case 1：skill 没有 binding

- 保持现状
- 视为 workspace skill
- `connector_id = null`
- `runtime_config_json = manifest 或 {}`

### Case 2：只有一个 binding

迁移：

- `connector_id <- binding.connector_id`
- `runtime_config_json <- binding.binding_config`
- `is_enabled <- binding.enabled`
- `kb_suggestion_ids <- [binding.knowledge_base_id]`

### Case 3：多个 binding，配置一致

迁移：

- 聚合到同一条 `skill_definition`
- `kb_suggestion_ids` 收敛成数组

### Case 4：多个 binding，配置冲突

迁移：

- clone 多条新的 `skill_definition`
- 每个冲突 binding 对应一条 runtime skill
- 旧 skill 标记 legacy/disabled

### 幂等要求（必须补充）

Wave 4 的迁移脚本必须支持**安全重跑**。

尤其是 Case 4：

- 如果脚本跑第二次，不能再次 clone 同一条 binding 对应的 runtime skill

推荐做法：

1. 在 `skill_definition` 增加：
   - `migration_source_binding_id`
2. 每次准备 clone 前，先检查：
   - 是否已存在 `migration_source_binding_id = 当前 binding.id` 的 target skill
3. 若已存在：
   - 直接复用
   - 不再二次创建

不推荐只靠：

- `installed_from='migrated_from_binding'`

原因：

- 它只能表示“来自迁移”
- 不能唯一定位“来自哪个 binding”
- 对多 binding fan-out 场景不足以防重

如果不想往 `skill_definition` 挂临时字段，至少要建立 migration mapping 表。

---

## 5.3 askContext 双读期策略

双读期允许：

1. **主路径**
   - 从 `skill_definition` 直接解析 runtime skill
2. **兼容路径**
   - 对尚未完成回填的数据，临时读取 legacy binding

退出条件：

- 所有活跃 skill 已完成回填
- preview / ask / UI 都不再依赖 binding

---

## 5.4 验收门槛

- 迁移脚本可重跑/幂等
- 回填后 skill list 与原可用结果不丢失
- 多 binding 冲突 case 有明确拆分输出
- 同一 source binding 重跑后不会重复生成新的 runtime skill

状态更新（2026-04-10）：

- 本地已完成
- `migrate_skill_bindings_to_runtime_skills.ts` 与对应测试已存在
- `migration_source_binding_id` 幂等防重方案已落地
- 本地真实 PostgreSQL 库上的 rehearsal / execute / post-audit 已完成
- 若还存在其他环境，再按同一脚本链路复用执行

---

## 6. Wave 5 — 控制面/API/UI 切换

## 6.1 目标

把产品表面真正从 KB-binding skill 切到 workspace runtime skill。

---

## 6.2 API 切换

### 新主路径

- `GET /api/v1/skills`
- `GET /api/v1/skills/available`
- `POST /api/v1/skills/:id/test`

### legacy 路径

- legacy bindings list route
- legacy bindings preview route

要求：

- legacy 路径只保留兼容期
- 新写入操作不再写 binding

状态更新（2026-04-10）：

- legacy REST 路径已从代码删除
- preview 主路径已统一为 `POST /api/v1/skills/:id/test`

---

## 6.3 技能管理页重构

文件：

- `wren-ui/src/pages/knowledge/skills.tsx`

拆为两部分：

### A. 技能市场

- builtin / featured / install

### B. 我的技能

- instruction
- execution mode
- connector
- runtime config
- enable/disable
- kb suggestions

去掉：

- binding 表格
- “为 KB 绑定技能”的交互

---

## 6.4 首页 Skill Selector 切换

文件：

- `wren-ui/src/pages/home/index.tsx`
- 如需抽组件：`wren-ui/src/components/home/SkillSelector.tsx`

目标：

- 只拉 workspace 级 `availableSkills`
- 不再对每个 KB 去请求 bindings
- KB 只影响推荐排序，不影响可用性硬过滤

---

## 6.5 验收门槛

- 技能管理页不再暴露 binding 心智
- 首页 skill picker 不再依赖 KB-binding API
- 新创建 thread 的 `selectedSkillIds` 都指向 runtime `skill_definition.id`

状态更新（2026-04-10）：

- 已完成
- `knowledge/skills` 页面已切为 marketplace + 我的技能
- 首页 skill picker 已改为 workspace `availableSkills`
- bindings REST 兼容路由已从代码删除

---

## 7. Wave 6 — Legacy 下线与收口验证

## 7.1 目标

删除主路径中的 binding 依赖，并收口测试/脚本/扫描。

---

## 7.2 必做项

### A. 删除主路径读取

- askContext 不再读 `listSkillBindingsByKnowledgeBase`
- preview 主路径不再读 binding
- 首页不再请求 legacy bindings list route
- 技能管理页不再展示 binding

### B. 扫描与守卫

新增或更新扫描脚本，防止主路径回退到 binding-centric 模型：

- 扫描 `listSkillBindingsByKnowledgeBase`
- 扫描 legacy bindings route 关键字
- 扫描直接按 KB 过滤 skill availability 的主路径逻辑

### C. 最终 drop（可延后）

当满足以下条件后，才真正 drop `skill_binding`：

1. 线上无新写入
2. 双读兼容窗口结束
3. 历史线程兼容验证完成

状态更新（2026-04-10）：

- A/B 已完成并已补充扫描守卫
- `20260410122000_drop_legacy_skill_binding.js` 与其门禁测试已完成并在本地真实 PG 验证通过
- 本地真实 PG 已完成 audit / rehearsal / apply / post-check
- 当前若还有剩余动作，主要是文档归档与其他环境复用同一套 cutover 步骤，而不是 repo 主路径继续改造

---

## 7.3 验收门槛

- 主路径 0 调用 binding-centric API
- 关键回归通过
- 文档与 UI 语义一致

---

## 8. 每个 Wave 的建议提交策略

建议按以下粒度提交：

1. **Wave 1**
   - `Bridge V2 skill runtime fields into ask pipeline`
2. **Wave 2**
   - `Expose V2 skill fields through UI adaptor/runtime context`
3. **Wave 3**
   - `Add workspace-owned runtime skill schema for V2`
4. **Wave 4**
   - `Backfill legacy binding data into runtime skill definitions`
5. **Wave 5**
   - `Switch skill control plane from bindings to workspace runtime skills`
6. **Wave 6**
   - `Retire legacy KB-bound skill paths from the main flow`

---

## 9. 推荐验证矩阵

## 9.1 Python / AI service

- `test_tool_router_shadow_compare.py`（原 `test_ask_skill_runner.py`）
- 新增：
  - `test_legacy_ask_tool_skill_instruction_injection.py`
  - `test_deepagents_skill_execution_mode.py`

## 9.2 TypeScript / wren-ui

- `askContext.test.ts`
- `skills_api.test.ts`
- `wrenAIAdaptor.test.ts`
- `home/index.test.tsx`
- `knowledge/skills` 页面测试

## 9.3 人工走查

### 场景 1：inject-only skill

- 选 skill
- 不跑 runner
- SQL 受 instruction 影响

### 场景 2：runner-first skill

- preview 成功
- ask 返回 `SKILL`

### 场景 3：runner-first fallback

- runner 故障
- 自动 fallback 到 NL2SQL

### 场景 4：切 KB 不丢 skill

- 切换 KB 后 skill 列表仍然稳定
- 只是推荐顺序变化

### 场景 5：binding 冲突迁移

- 一个 skill 原来绑定多个 KB 且 connector/config 冲突
- 迁移后拆成多条 runtime skill

---

## 10. 本清单对应的完成定义（DoD）

满足以下条件，才算 V2 落地完成：

1. `skill_definition` 成为 runtime canonical owner
2. `thread.selected_skill_ids` 只引用 runtime skill ids
3. skill instruction 贯穿 ask pipeline
4. executable skill 不因解耦改造而失效
5. 首页与技能管理页不再以 KB binding 为主心智
6. legacy binding 不再参与主路径
7. 关键自动化测试与人工验收都通过

按当前状态评估：

- 1~7 在 repo / 本地 dev PG 范围内均已满足
- 若存在其他环境，需把相同的 PostgreSQL cutover 与 post-check 再执行一遍，但这不再阻塞当前实现清单收口

---

## 11. 最后建议

真正开始改代码时，建议严格按下面顺序推进：

1. **先 Wave 1**
2. **再 Wave 2**
3. **再 Wave 3**
4. **Wave 4 单独做迁移验证**
5. **Wave 5/6 再切 UI 与删除旧路径**

不要一口气把：

- prompt 注入
- schema 迁移
- marketplace
- skill picker
- legacy 清理

放在一个大 diff 里做。

最稳的节奏是：

> 先让行为正确，再让数据模型正确，最后让控制面与产品语义正确。
