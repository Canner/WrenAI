# Skill 架构 V2 — Wave 3 / Wave 4 文件级拆解

## 状态说明（2026-04-11）

> 本文档保留为 **Wave 3 / Wave 4 历史拆解记录**。
> Ask/runtime 的现行口径已切到 `docs/deepagents-ask-architecture.md`；其中涉及 `runner_first` / `hybrid` / `SkillRunner` / `SKILL` 的内容不再作为当前实现目标。


更新时间：2026-04-10  
关联文档：

- `docs/archive/skill-architecture-plan-v2.md`
- `docs/archive/skill-architecture-plan-v2-implementation-checklist.md`
- `docs/archive/skill-architecture-plan-v2-wave1-wave2-file-breakdown.md`

---

## 0. 本文用途

这份文档只服务于：

- **Wave 3：Schema 扩展 + Repository/Service 升级**
- **Wave 4：数据迁移与双读兼容**

重点是把 V2 的“主模型落库 + legacy binding 回填”拆成**可执行的文件级任务单**，并明确：

1. 哪些 migration 要先做
2. repository / service 怎么收口
3. migration 脚本如何保证幂等
4. ask/runtime 如何进入双读兼容期

---

## 1. Wave 3 / Wave 4 总体顺序

```text
Step 1  新增 marketplace catalog migration
Step 2  扩展 skill_definition schema
Step 3  标记 legacy binding 进入兼容态
Step 4  repository 增加 V2 skill 查询/写入能力
Step 5  skillService 增加 available/install/toggle/updateRuntime
Step 6  编写 binding -> runtime skill 回填脚本
Step 7  ask/runtime 进入双读兼容
Step 8  迁移回归与幂等验证
```

依赖关系：

- Step 1/2/3 是 Step 4/5 的前置
- Step 4/5 是 Step 6/7 的前置
- Step 6 和 Step 7 可以并行准备，但必须在验证前完成
- Step 8 最后统一跑

---

## 2. Step 1 — 新增 marketplace catalog migration

## 2.1 主文件

### `wren-ui/migrations/20260412_create_skill_marketplace_catalog.js`

### 目标

引入平台发布源，但不直接改变现有运行时逻辑。

### 必改项

新增表：

- `skill_marketplace_catalog`

建议字段：

- `id`
- `slug`
- `name`
- `description`
- `category`
- `author`
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
- `created_at`
- `updated_at`

### 约束

1. `slug` 必须唯一
2. `default_execution_mode` 默认值要与 AI service contract 一致：
   - `inject_only`
3. migration 必须有完整 `down()`

### 完成定义

- `knex` 可成功创建/回滚该表
- 不影响现有 `skill_definition / skill_binding`

---

## 2.2 建议验证命令

```bash
cd wren-ui
node -c migrations/20260412_create_skill_marketplace_catalog.js
```

如果有 migration harness，可额外做一次 up/down smoke。

---

## 3. Step 2 — 扩展 `skill_definition` schema

## 3.1 主文件

### `wren-ui/migrations/20260412_extend_skill_definition_for_v2.js`

### 目标

把 `skill_definition` 升级为 V2 的 runtime canonical owner。

### 必改项

新增字段：

- `catalog_id`
- `instruction`
- `is_enabled`
- `execution_mode`
- `connector_id`
- `runtime_config_json`
- `kb_suggestion_ids`
- `installed_from`
- `migration_source_binding_id`

### 关键设计要求

#### A. `execution_mode`

- 默认值必须为 `inject_only`
- 取值约束建议在应用层 + DB enum/check 双层控制（若当前风格允许）

#### B. `installed_from`

建议允许：

- `custom`
- `marketplace`
- `builtin`
- `migrated_from_binding`

#### C. `migration_source_binding_id`

这是 Wave 4 的幂等辅助字段。

要求：

1. 可为空
2. 只在 migration 物化 legacy binding 时写入
3. 建议建立索引
4. 若允许的话，建议加唯一约束或部分唯一索引，避免一个 binding 多次映射成多条相同 target

### 推荐索引

- `skill_definition(workspace_id, is_enabled)`
- `skill_definition(catalog_id)`
- `skill_definition(connector_id)`
- `skill_definition(migration_source_binding_id)`

### 完成定义

- 旧 skill 行为不受影响
- 新字段可供后续 repository/service 使用

---

## 3.2 建议验证命令

```bash
cd wren-ui
node -c migrations/20260412_extend_skill_definition_for_v2.js
```

---

## 4. Step 3 — legacy binding 进入兼容态

## 4.1 主文件

### `wren-ui/migrations/20260412_mark_skill_binding_legacy.js`

### 目标

明确告诉代码与后续维护者：

- `skill_binding` 不再是未来主模型
- 进入兼容态，不再承接新能力

### 必改项

这一步不需要强行 drop 表，但建议至少做一个动作：

#### 方案 A：只加注释 / 迁移说明

- 成本最低
- 对现有系统无侵入

#### 方案 B：增加 legacy 标记字段

例如：

- `is_legacy = true`

但这不是必须的，且会扩大 schema 变更面。

### 建议

V2 文档线推荐 **方案 A**：

- migration 文件中写清楚该表进入兼容态
- 后续禁止再给 `skill_binding` 加新 runtime 字段

### 完成定义

- 团队不会误把 `skill_binding` 当未来主表继续扩展

---

## 5. Step 4 — repository 升级

## 5.1 主文件

### `wren-ui/src/apollo/server/repositories/skillDefinitionRepository.ts`

### 目标

让 repository 能直接支撑：

- runtime available skill 读取
- migration 期间 provenance 防重查询

### 必改项

#### A. 扩 SkillDefinition interface

新增字段：

- `catalogId`
- `instruction`
- `isEnabled`
- `executionMode`
- `connectorId`
- `runtimeConfigJson`
- `kbSuggestionIds`
- `installedFrom`
- `migrationSourceBindingId`

#### B. 更新 jsonColumns

确保以下 JSON 字段能正确序列化/反序列化：

- `manifestJson`
- `runtimeConfigJson`
- `kbSuggestionIds`

#### C. 新增查询方法

建议增加：

- `listAvailableSkillsByWorkspace(workspaceId)`
- `findAllByCatalogId(catalogId)`
- `findOneByMigrationSourceBindingId(bindingId)`

### 风险点

1. 不要破坏旧 `transformFromDBData / transformToDBData`
2. 新增 JSON 字段后，测试要覆盖 null/空对象/数组

---

## 5.2 新文件

### `wren-ui/src/apollo/server/repositories/skillMarketplaceCatalogRepository.ts`

### 目标

为 catalog 引入独立 repository，而不是把 catalog 逻辑塞进 skillDefinitionRepository。

### 建议方法

- `findAll()`
- `findFeatured()`
- `findBuiltin()`
- `findOneById(id)`
- `findOneBySlug(slug)`

### 完成定义

- catalog 与 runtime skill 两套仓储边界清晰

---

## 5.3 建议测试文件

可新增：

- `skillDefinitionRepository.test.ts`
- `skillMarketplaceCatalogRepository.test.ts`

至少覆盖：

1. JSON 字段序列化
2. `listAvailableSkillsByWorkspace`
3. `findOneByMigrationSourceBindingId`

---

## 5.4 建议验证命令

```bash
cd wren-ui
yarn test --runInBand \
  src/apollo/server/repositories/skillDefinitionRepository.test.ts
yarn check-types
```

---

## 6. Step 5 — `skillService` 升级

## 6.1 主文件

### `wren-ui/src/apollo/server/services/skillService.ts`

### 目标

把 skill service 从：

- definition CRUD
- binding CRUD

推进到 V2 主能力：

- available skill
- marketplace install
- runtime config update

### 必改项

#### A. 新增能力

- `listAvailableSkills(workspaceId)`
- `installSkillFromMarketplace(workspaceId, catalogId, userId)`
- `toggleSkillEnabled(workspaceId, skillId, enabled)`
- `updateSkillDefinitionRuntime(...)`

#### B. installation 行为

从 catalog 安装时，需要生成一条 workspace-owned `skill_definition`：

- `catalogId <- catalog.id`
- `instruction <- catalog.defaultInstruction`
- `executionMode <- catalog.defaultExecutionMode`
- `installedFrom <- builtin | marketplace`

#### C. 保留旧 binding 能力，但降级为 compat

这一步不删除：

- `createSkillBinding`
- `updateSkillBinding`
- `listSkillBindingsByKnowledgeBase`

但新增文档/注释明确：

- 它们仅供兼容迁移与旧控制面使用

### 风险点

1. 安装 marketplace skill 时，workspace 范围唯一性要处理好
2. builtin 自动物化策略不要在 service 层写死得过重

---

## 6.2 配套文件

### `wren-ui/src/apollo/server/resolvers/skillResolver.ts`

### `wren-ui/src/apollo/server/schema.ts`

### 目标

先把 service 能力暴露给 GraphQL。

### 必改项

#### Query

- `marketplaceCatalogSkills`
- `availableSkills`

#### Mutation

- `installSkillFromMarketplace`
- `toggleSkillEnabled`
- `updateSkillDefinitionRuntime`

### 注意

Wave 3 里只需要把 resolver/schema 能力接好，不要求页面立刻切完。

---

## 6.3 建议测试

- `skillService.test.ts`
- `skillResolver.test.ts`

至少覆盖：

1. 安装 marketplace skill
2. toggle enabled
3. update runtime fields
4. list available skills

---

## 6.4 建议验证命令

```bash
cd wren-ui
yarn test --runInBand \
  src/apollo/server/services/tests/skillService.test.ts \
  src/apollo/server/resolvers/tests/skillResolver.test.ts
yarn check-types
```

---

## 7. Step 6 — 编写 binding -> runtime skill 回填脚本

## 7.1 建议文件

优先建议单独建脚本，不要把复杂数据迁移逻辑全部塞到 schema migration 里。

例如：

- `wren-ui/scripts/migrate_skill_bindings_to_runtime_skills.ts`

如果仓库更倾向 JS，也可：

- `wren-ui/scripts/migrate_skill_bindings_to_runtime_skills.js`

### 为什么建议单独脚本

因为这个迁移不是纯 schema change，而是：

- 分类处理
- 比较 binding 配置一致性
- Case 4 fan-out clone
- 幂等防重
- 可重跑

这类逻辑放在独立脚本里更安全，也更容易 dry-run。

---

## 7.2 脚本职责

### A. 扫描输入

按 `skill_definition.id` 聚合所有 binding

### B. 分类

- Case 1：无 binding
- Case 2：单 binding
- Case 3：多 binding 且一致
- Case 4：多 binding 且冲突

### C. 生成/回填

#### Case 1

- 跳过或最小 patch

#### Case 2 / 3

- 更新既有 skill_definition

#### Case 4

- 对每个冲突 binding：
  - 先查 `migration_source_binding_id = binding.id`
  - 已存在则复用
  - 不存在则 clone 新 runtime skill

### D. 收尾

- 所有 target skill 物化完成后，再标旧 skill 为 legacy/disabled

### E. 模式

脚本建议支持：

- `--dry-run`
- `--execute`
- `--workspace <id>`（可选）

---

## 7.3 clone 命名策略

Case 4 clone 时建议有稳定命名，避免重跑后名称飘移。

建议：

- `${原名} · migrated · ${binding.id.slice(0, 8)}`

要求：

1. 命名可预测
2. 重跑时不会继续追加后缀
3. 便于人工识别来源

---

## 7.4 幂等细则（必须执行）

### 规则 1：以 binding 为粒度防重

每个 legacy binding 最多只允许物化出一个 target runtime skill。

判定方法优先级：

1. `migration_source_binding_id`
2. 独立 mapping 表（如果未采用字段方案）

### 规则 2：旧 skill 收尾不能抢跑

只有当一个 source skill 的所有 binding 都已完成 target 物化时，才能：

- `is_enabled = false`
- `installed_from = 'migrated_from_binding'`（若团队采用此语义）

### 规则 3：重复执行结果稳定

脚本第二次执行后应满足：

- 无新增 clone
- 无额外命名变化
- target count 不增长

---

## 7.5 建议输出报告

脚本执行后建议输出：

- total skill count
- no-binding count
- single-binding backfill count
- consistent multi-binding merge count
- conflict split count
- reused migrated target count
- newly created target count
- disabled legacy source count

这样方便 Wave 4 验收。

---

## 7.6 建议测试文件

新增建议：

- `wren-ui/src/apollo/server/services/tests/skillBindingMigration.test.ts`

至少覆盖：

1. Case 2 单 binding 回填
2. Case 3 一致 binding 聚合
3. Case 4 冲突 binding clone
4. 脚本重跑不重复 clone

---

## 7.7 建议验证命令

```bash
cd wren-ui
yarn test --runInBand \
  src/apollo/server/services/tests/skillBindingMigration.test.ts
yarn check-types
```

如果脚本可运行，建议再补：

```bash
cd wren-ui
node scripts/migrate_skill_bindings_to_runtime_skills.js --dry-run
node scripts/migrate_skill_bindings_to_runtime_skills.js --execute --workspace <test-workspace>
node scripts/migrate_skill_bindings_to_runtime_skills.js --execute --workspace <test-workspace>
```

第二次执行结果必须无重复 clone。

---

## 8. Step 7 — ask/runtime 进入双读兼容

## 8.1 主文件

### `wren-ui/src/apollo/server/utils/askContext.ts`

### 目标

让 ask runtime 在 Wave 4 可以安全过渡：

- 优先读 `skill_definition`
- 对未迁移数据保留 legacy binding compat

### 必改项

建议引入明确分层：

#### A. 主路径

- 从 `skill_definition` 解析：
  - connector
  - instruction
  - executionMode
  - runtimeConfig

#### B. compat 路径

仅对尚未回填的 skill：

- fallback 到 binding

### 退出条件

一旦全部回填完成：

- 删除 compat 路径

---

## 8.2 次文件

### `wren-ui/src/pages/api/v1/skills/[id]/test.ts`

### 目标

主 preview API 在 Wave 4 应切到 `skillDefinitionId`：

- 成为新能力主入口
- 直接从 `skill_definition` 解析 connector / secret / runtime config

补充：

- legacy bindings list route
- legacy bindings preview route

这两个 legacy API 在 Wave 4 进入兼容态，并在 Wave 5 已删除。

### 注意

此时应开始补新的主路径 API：

- `/api/v1/skills/available`
- `/api/v1/skills/:id/test`

---

## 8.3 建议测试

- `askContext.test.ts`
- `skills_api.test.ts`

至少覆盖：

1. 已迁移 skill 走新主路径
2. 未迁移 skill 仍能 compat
3. 回填完成后主路径不再依赖 binding

---

## 9. Step 8 — Wave 3 / 4 统一验收

## 9.1 自动化验收

建议至少跑：

```bash
cd wren-ui
yarn test --runInBand \
  src/apollo/server/repositories/skillDefinitionRepository.test.ts \
  src/apollo/server/services/tests/skillService.test.ts \
  src/apollo/server/services/tests/skillBindingMigration.test.ts \
  src/apollo/server/utils/tests/askContext.test.ts \
  src/pages/api/tests/skills_api.test.ts
yarn check-types
```

---

## 9.2 人工验收

### 场景 1：marketplace 安装 skill

- 能安装到 workspace
- 安装后生成 runtime `skill_definition`

### 场景 2：旧单 binding skill 回填

- connector/config 被正确收口到 definition

### 场景 3：旧多 binding 一致聚合

- 只保留一条 runtime skill
- suggestion ids 聚合正确

### 场景 4：旧多 binding 冲突拆分

- 拆出多条 runtime skill
- 每条都有自己的 `migration_source_binding_id`

### 场景 5：迁移脚本重复执行

- 第二次执行不重复 clone
- 结果稳定

---

## 10. Wave 3 / 4 完成定义（DoD）

当以下条件同时成立时，Wave 3 / 4 可视为完成：

1. `skill_definition` 已具备 V2 runtime 字段
2. catalog repository / runtime repository 都可用
3. `skillService` 已提供：
   - available
   - install
   - toggle
   - updateRuntime
4. legacy binding 回填脚本已完成且支持幂等重跑
5. `migration_source_binding_id` 或等价 mapping 机制已落地
6. ask/runtime 已进入双读兼容阶段
7. 自动化与人工迁移验收都通过

---

## 11. 推荐提交拆分

建议至少拆成 5 个提交：

1. **schema: add catalog + runtime skill fields**
2. **repo: support v2 runtime skill reads/writes**
3. **service: expose available/install/toggle/runtime update**
4. **migration: backfill legacy bindings into runtime skills**
5. **runtime: enter dual-read compat for migrated skills**

---

## 12. 开工建议

如果下一步进入 Wave 3 / 4 实现，建议顺序就是：

1. `wren-ui/migrations/20260412_create_skill_marketplace_catalog.js`
2. `wren-ui/migrations/20260412_extend_skill_definition_for_v2.js`
3. `wren-ui/migrations/20260412_mark_skill_binding_legacy.js`
4. `wren-ui/src/apollo/server/repositories/skillDefinitionRepository.ts`
5. `wren-ui/src/apollo/server/repositories/skillMarketplaceCatalogRepository.ts`
6. `wren-ui/src/apollo/server/services/skillService.ts`
7. `wren-ui/src/apollo/server/resolvers/skillResolver.ts`
8. `wren-ui/src/apollo/server/schema.ts`
9. `wren-ui/scripts/migrate_skill_bindings_to_runtime_skills.js|ts`
10. `wren-ui/src/apollo/server/utils/askContext.ts`

也就是：

> 先把 schema 和 service 立起来，再做可重跑迁移，最后进入双读兼容。
