# Skill binding retirement checklist (2026-04-10)

## Current status

- 主路径代码已经不再依赖 legacy `skill_binding`：
  - ask runtime 走 `skill_definition`
  - preview 主路径走 `/api/v1/skills/:id/test`
  - bindings REST 兼容层已删除
- **本地 dev PostgreSQL 已于 2026-04-10 完成真实 cutover**
  - audit 已执行
  - rehearsal / dry-run 已执行
  - apply 已执行
  - `skill_binding` 已从本地真实 PG drop
  - `yarn knex migrate:list` 已回到 `No Pending Migration files Found.`
- 继续保留的资产已经缩到三类：
  1. **历史 migration**
  2. **回填 / 审计脚本**
  3. **归档设计文档**

最新基线建议一起看：

- `bash misc/scripts/skill-binding-retirement-local-verify.sh`
- `bash misc/scripts/check-skill-binding-main-path.sh`
- `bash misc/scripts/inventory-skill-binding-residuals.sh > docs/skill-binding-retirement-inventory.md`
- `cd wren-ui && yarn test tests/migrations/20260410122000_drop_legacy_skill_binding.test.js --runInBand`
- `cd wren-ui && yarn test src/pages/api/tests/skills_api.test.ts src/pages/api/tests/graphql.test.ts --runInBand`
- `bash misc/scripts/skill-binding-retirement-audit.sh "$PG_URL"`
- `bash misc/scripts/skill-binding-retirement-rehearsal.sh "$PG_URL"`
- `bash misc/scripts/skill-binding-retirement-apply.sh "$PG_URL"`
- `cd wren-ui && yarn test scripts/migrate_skill_bindings_to_runtime_skills.test.ts --runInBand`

---

## 本地真实 PG 执行记录（2026-04-10）

目标库：

- `postgres://postgres:postgres@127.0.0.1:9432/wrenai`

执行结果摘要：

1. **audit**
   - `skill_binding` 相关阻塞项为 0
   - 实际样本库为空数据态：
     - `skill_binding` 行数：`0`
     - `skill_definition` 行数：`0`
2. **rehearsal / dry-run**
   - `scripts/migrate_skill_bindings_to_runtime_skills.ts --dry-run`
   - 输出：
     ```json
     {
       "execute": false,
       "scannedSkills": 0,
       "skillsWithBindings": 0,
       "updatedSkills": 0,
       "createdClones": 0,
       "skippedSkills": 0
     }
     ```
3. **apply**
   - 备份文件：
     - `tmp/skill-binding-retirement-backups/skill-binding-retirement.20260410193137.dump`
   - `scripts/migrate_skill_bindings_to_runtime_skills.ts --execute`
   - 输出：
     ```json
     {
       "execute": true,
       "scannedSkills": 0,
       "skillsWithBindings": 0,
       "updatedSkills": 0,
       "createdClones": 0,
       "skippedSkills": 0
     }
     ```
   - 之后执行：
     - `yarn knex migrate:latest`
4. **post-check**
   - `skill_binding` table existence：`0`
   - `yarn knex migrate:list`：`No Pending Migration files Found.`

说明：

- 这次本地真实 PG 执行证明：**repo 侧代码、migration、gate 与验证链路已能完成完整退场**
- 执行中临时生成的本地容器 wrapper 已完成清理；备份 dump 继续作为本地归档保留在 `tmp/skill-binding-retirement-backups/`
- 若后续还存在 staging / prod / 其他共享环境，需要按同一 checklist 再单独执行一遍

---

## 剩余资产分层

### 1. 历史 migration：保留在 git，**不要直接删文件**

这些文件属于 schema 历史的一部分，未来真正 drop `skill_binding` 时，应该新增 migration，而不是回删旧 migration：

- `wren-ui/migrations/20260401150002_create_connector_skill_governance_tables.js`
- `wren-ui/migrations/20260410120020_mark_skill_binding_legacy.js`

处理原则：

- 保留在仓库历史中
- 允许继续被 inventory 扫到
- 不是“代码残留回归”

### 2. 回填 / 审计资产：本地 dev PG 已执行完成，后续按环境决定是否继续保留

- `wren-ui/scripts/migrate_skill_bindings_to_runtime_skills.ts`
- `wren-ui/scripts/migrate_skill_bindings_to_runtime_skills.test.ts`
- `misc/sql/skill-binding-retirement-readiness.sql`

处理原则：

- 对本地 dev PG 而言，真实 rehearsal / execute / audit / apply 已完成
- 若还要对 staging / prod 执行，继续保留这些资产最稳妥
- 若所有目标环境都执行完，可再决定是否归档，但不必和 drop migration 同一步完成

### 3. 归档设计文档：允许保留历史上下文

这些文档仍可能提到 legacy binding，因为它们记录的是演进过程，而不是当前线上主路径：

- `docs/phase3-next-stage-implementation-plan.md`
- `docs/skill-architecture-plan-v2*.md`

处理原则：

- 可以保留历史上下文
- 但不能把 legacy binding 描述成“当前主路径”

---

## 最终 drop `skill_binding` 的前置条件

必须同时满足：

1. **主路径守卫稳定通过**
   - `bash misc/scripts/check-skill-binding-main-path.sh`
2. **回填脚本在真实 PostgreSQL 环境完成 dry-run / execute / audit**
   - `cd wren-ui && yarn test scripts/migrate_skill_bindings_to_runtime_skills.test.ts --runInBand`
   - `bash misc/scripts/skill-binding-retirement-rehearsal.sh "$PG_URL"`
   - 用真实库执行 `wren-ui/scripts/migrate_skill_bindings_to_runtime_skills.ts`
3. **readiness audit 无阻塞项**
   - 运行 `misc/sql/skill-binding-retirement-readiness.sql`
   - 或直接执行 `bash misc/scripts/skill-binding-retirement-audit.sh "$PG_URL"`
   - 重点看：
     - legacy binding 的 distinct runtime signature 是否都已 materialize
     - `migration_source_binding_id` 是否唯一
     - 仍保留 legacy binding 的原始 `skill_definition` 是否都已写回 runtime fields
4. **线程 / preview / ask 的历史兼容已验证**
   - `cd wren-ui && yarn test src/pages/api/tests/skills_api.test.ts src/pages/api/tests/graphql.test.ts --runInBand`
   - 已显式覆盖 skills REST 与 GraphQL 主路径回归
   - 若还存在历史数据样本，需额外做一次真实库 spot-check
5. **drop migration 的门禁测试已通过**
   - `cd wren-ui && yarn test tests/migrations/20260410122000_drop_legacy_skill_binding.test.js --runInBand`
   - 覆盖：
     - table 已不存在时 no-op
     - 缺失 `migration_source_binding_id` 时 fail-fast
     - duplicated `migration_source_binding_id` 时 fail-fast
     - 多 signature binding group 未完全 materialize 时 fail-fast
     - runtime settings 未回填时 fail-fast
     - 所有 gate 通过后才真正 `dropTable('skill_binding')`
     - `down` 只重建空表结构，不恢复历史数据
6. **本地无 PG 的安全校验链路已打包**
   - `bash misc/scripts/skill-binding-retirement-local-verify.sh`
   - 会串行执行：
     - main-path guardrail
     - legacy bindings route 目录不存在检查
     - residual inventory refresh
     - wrapper script `bash -n`
     - drop migration `node -c`
     - migration / backfill / skills-api-graphql 三组定向测试
     - checklist / inventory / migration 的 prettier 校验

本地 dev PG 状态（2026-04-10）：

- 上述 1~6 项在本地 repo / dev PG 范围内均已满足
- 因此本地 dev PG 已执行最终 drop migration 并通过 post-check
- 这个前置条件清单后续主要用于**其他环境复用**

---

## 建议的最终执行顺序（也是本地 dev PG 已执行顺序）

### Wave A：数据库就绪性确认 ✅

1. 对真实 PostgreSQL 库执行 `skill-binding-retirement-readiness.sql`
   - 或 `bash misc/scripts/skill-binding-retirement-audit.sh "$PG_URL"`
2. 记录：
   - `skill_binding` 总行数
   - 已迁移 runtime skill 行数
   - 未完成 materialize 的 binding signature group 样本
   - duplicated `migration_source_binding_id` 是否为 0

### Wave B：回填执行与复核 ✅

1. dry-run：
   - `cd wren-ui && yarn ts-node scripts/migrate_skill_bindings_to_runtime_skills.ts --dry-run`
   - 或 `bash misc/scripts/skill-binding-retirement-rehearsal.sh "$PG_URL"`
2. execute：
   - `cd wren-ui && yarn ts-node scripts/migrate_skill_bindings_to_runtime_skills.ts --execute`
3. 再次执行 readiness audit，确认：
   - 未完成 materialize 的 binding signature group 为 0
   - duplicated `migration_source_binding_id` 为 0

### Wave C：最终 drop migration ✅

新增一个**新的 PostgreSQL migration**，负责：

- drop `skill_binding` table
- 如有必要，补齐/收紧 `skill_definition` 上的最终约束
- 明确 down migration 策略（若不可逆，要在说明里写清楚）

当前已准备的 migration 草案：

- `wren-ui/migrations/20260410122000_drop_legacy_skill_binding.js`

配套自动化测试：

- `wren-ui/tests/migrations/20260410122000_drop_legacy_skill_binding.test.js`

这个 migration 的策略是：

- **先校验，再 drop**
- 若下面任一条件不满足则直接 fail，避免误删：
  - `skill_definition.migration_source_binding_id` 已存在
  - `migration_source_binding_id` 没有重复值
  - legacy binding 的“多 signature 拆分”已经 materialize 成足够的 runtime skill clone
  - 仍有 legacy binding 的 skill_definition 已写回 runtime settings（`kb_suggestion_ids / execution_mode / is_enabled`）
- `down` 只重建空表结构，**不会恢复历史数据**

也已补配套 apply wrapper：

- `bash misc/scripts/skill-binding-retirement-apply.sh "$PG_URL"`

这个 wrapper 会：

- 先做 `pg_dump` 备份
- 先检查 `skill_definition` 是否具备最终 drop 所需列（`migration_source_binding_id / kb_suggestion_ids / execution_mode / is_enabled`）
- 先跑 readiness audit
- 执行 runtime skill backfill
- 再次检查 drop gates
- 最后执行 `yarn knex migrate:latest`
- 结束后校验 `skill_binding` table 已不存在

### Wave D：仓库收尾（可选）

在本地 dev PG 完成 drop migration 并验证通过后，再决定是否：

- 归档 `migrate_skill_bindings_to_runtime_skills.ts`
- 缩减 inventory 文档中的过渡说明

---

## 当前结论

`skill_binding` 在 repo / 本地 dev PG 范围内已经完成退场：

- **历史 schema**
- **可复用于其他环境的操作资产**
- **归档文档上下文**

这意味着下一步工作的重心已经从“继续做本地 PG cutover”切换为：

> **整理文档状态、按需归档辅助资产，并在其他环境复用同一套 audit / rehearsal / apply / post-check。**

补充说明：

- 最终 drop migration 与 apply wrapper 已在本地真实 PG 走通
- migration gate 的自动化测试也已补齐并通过
- 若没有额外环境要切，这条线在 repo / 本地 dev PG 范围内可视为完成
