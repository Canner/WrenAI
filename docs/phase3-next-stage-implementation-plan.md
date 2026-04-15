# Phase 3 — 下一阶段功能实现计划

更新时间：2026-04-12

> 进度补注（2026-04-12）：
> `docs/deepagents-ask-architecture.md` 对应的 ask 主链收口已完成，包括：
> - DeepAgents 接管 fixed-order ask 主编排
> - inject-only ask contract 收口
> - ask 主路径中的 `SkillRunner` 退场
> - `thread_response.skill_result` drop migration 已落到真实 PostgreSQL
>
> 因此，本计划里涉及 ask ownership transfer / `SkillRunner` ask 遗留退场的条目，应视为**已完成的实施记录**；后续 Phase 3 剩余重点主要在控制面、产品闭环与非 ask 主链历史残留清理。

## 1. 阶段切换结论

基于当前仓库状态，**Phase 2（de-project cutover / 去 Project 化主链收口）可以视为已完成**：

- runtime 主语义已经稳定到 `workspaceId / knowledgeBaseId / kbSnapshotId / deployHash`
- `getCurrentProject()` 已退出主路径
- `wren-ui` 与 `wren-ai-service` 的 ask / runtime / persistence 主链已经完成一轮到多轮收口
- 当前剩余的 `projectId / project_id` 主要属于：
  - 实体主键 / DB schema
  - legacy compatibility bridge
  - deploy / onboarding / reset 等真实领域路径

因此，下一阶段不再以“继续消灭 project 文本命中”为目标，**主目标切换为：把已经铺好的 runtime / schema / bridge 基线，推进为可用的 V1 产品能力闭环**。

---

## 2. Phase 3 总目标

在不大动 `wren-engine` 的前提下，完成一版可验收的 WrenAI V1 功能基线：

1. **账户 / 工作区 / 知识库闭环** 可用
2. **知识库优先（KB-first）产品模型** 真正成为主入口
3. **DeepAgents Ask 固定顺序主编排** 成为默认主路径
4. **Connector / Secret / Skill** 从“有骨架”推进到“可实际配置使用”
5. **Dashboard / Schedule / Thread** 全部绑定 canonical runtime identity
6. **PostgreSQL + pgvector** 成为默认主路径
7. 保留 legacy 回退，但默认体验转向新的 inject-only ask 主链

---

## 3. 当前基础与判断

从仓库现状看，以下基础已经存在，适合进入 Phase 3：

### 3.1 已经具备的基础

- `wren-ui` 已存在：
  - `authService.ts`
  - `workspaceService.ts`
  - `connectorService.ts`
  - `secretService.ts`
  - `skillService.ts`
  - `scheduleService.ts`
  - `runtimeScope.ts`
  - 多个 runtime identity migration
- `wren-ai-service` 已存在：
  - `core/runtime_identity.py`
  - `core/deepagents_orchestrator.py`
  - `core/skill_contract.py`
  - `core/fixed_order_ask_runtime.py`
- schema/migration 已经有：
  - workspace/auth
  - knowledge base / kb snapshot
  - connector / skill / governance
  - thread / thread_response / asking_task / api_history runtime identity
  - dashboard runtime binding

### 3.2 当前主要缺口

下一阶段的主要缺口已经不是“有没有表 / 有没有 helper”，而是：

1. **控制面是否真正可用**
   - auth / bootstrap / runtime scope selector / KB 入口是否闭环
2. **Skill 是否能从配置走到可用增强**
   - connector / secret / runtime skill / instruction 注入 / ask 主链是否贯通
3. **Ask 主脑是否真正切换**
   - deepagents 是否成为默认主路径，而不只是 skeleton / optional path
4. **运维面是否完整**
   - dashboard / schedule / audit / api_history 是否形成可证明闭环
5. **验收面是否齐全**
   - golden regression / contract / e2e 是否能支撑切换

---

## 4. Phase 3 范围

## 4.1 In Scope

- built-in auth + session + workspace membership 最小可用闭环
- knowledge base / kb snapshot 主入口与 runtime scope 绑定
- connector / secret / workspace-owned `skill_definition` 可配置、可读写、可执行
- `skill_binding` 的迁移、退场与最终 drop 准备
- deepagents ask orchestrator 主路径接管
- thread / thread_response ask 结果持久化收口（移除 `SKILL` / `skillResult` 遗留）
- dashboard 多看板运行态绑定
- 站内 schedule worker + job/run 记录
- PostgreSQL + pgvector 默认主路径
- 回归 / contract / e2e / static scan 验收面

## 4.2 Out of Scope

- 真正的企业 SSO/OIDC 接入
- row/column 级权限执行
- 非 Python skill runtime
- 邮件 / IM 外发
- 多人协作 thread
- Vault / KMS / 自动密钥轮换

---

## 5. 推荐执行方式：按 4 个 Wave 收口

### 5.1 Skill V2 并入 Phase 3 的落地映射

Skill 不再单独作为“补充功能”推进，而是作为 Phase 3 主线的一部分收口。

Skill runtime owner 继续沿用 V2 的实体模型，但 ask/runtime 编排口径以 `docs/deepagents-ask-architecture.md` 为准：

- runtime canonical skill 实体仍是 **workspace-owned `skill_definition`**
- `skill_marketplace_catalog` 仍是发布源 / 安装源，不是线程直接引用对象
- `thread.selected_skill_ids`、preview、ask runtime 最终都只指向 `skill_definition.id`
- `skill_binding` 继续走**兼容迁移 -> 主路径退场 -> 最终 drop**流程，不再承接新能力
- ask/runtime 不再保留 `runner_first` / `hybrid` / `SKILL` 结果；唯一有效语义是 inject-only 增强

V2 / deepagents 阶段与 Phase 3 Wave 的对应关系：

1. **Phase A：inject-only contract 行为桥接**
   - 对应：Wave 2 前半 + Wave 3 起点
   - 目标：先让 ask/runtime 理解 `instruction` 与 inject-only 语义
2. **Phase B：schema 升级**
   - 对应：Wave 2
   - 目标：补齐 `skill_definition` runtime 字段与 marketplace/catalog 基础表
3. **Phase C：数据回填与双读收缩**
   - 对应：Wave 3
   - 目标：把 binding-centric 旧数据安全迁到 runtime skill 模型
4. **Phase D：ask ownership 切换**
   - 对应：Wave 3 后半 + Wave 4 前半
   - 目标：DeepAgents 接管固定顺序 ask 主链，UI / API / preview / ask 主路径全部切到 `skill_definition`
5. **Phase E：legacy 收口**
   - 对应：Wave 4
   - 目标：完成回归验证、drop 准备与 legacy `skill_binding` / `SkillRunner` ask 遗留退场

## Wave 1 — 控制面可用化（优先级最高）

### 目标

把“有 schema / 有 service”推进到“能登录、能进 workspace、能选 KB、能绑定 runtime scope”。

### 重点任务

1. **Auth 闭环补完**
   - bootstrap owner
   - login / logout / session validate
   - session -> actor claims 注入 runtime context
2. **Workspace / Knowledge Base 主入口收口**
   - workspace selector
   - knowledge base selector
   - kb snapshot selector
   - thread 创建时强绑定 KB + snapshot
3. **前端 runtime scope 启动链路统一**
   - `RuntimeScopeBootstrap`
   - `useProtectedRuntimeScopePage`
   - `useRuntimeScopeNavigation`
   - GraphQL runtimeScope 查询/变更链路
4. **拒绝跨 KB 污染**
   - 同 thread 禁止切换 KB
   - dashboard / ask / stream 都从 persisted runtime identity 恢复

### 主要文件面

- `wren-ui/src/pages/api/auth/*`
- `wren-ui/src/apollo/server/services/authService.ts`
- `wren-ui/src/apollo/server/services/workspaceService.ts`
- `wren-ui/src/apollo/server/context/runtimeScope.ts`
- `wren-ui/src/components/runtimeScope/*`
- `wren-ui/src/hooks/useProtectedRuntimeScopePage.ts`
- `wren-ui/src/hooks/useRuntimeScopeNavigation.tsx`

### Gate

- 可以从登录进入某个 workspace / KB
- 创建 thread 时 runtime identity 固化成功
- ask / dashboard / stream 不再要求 Project 选择
- 跨 KB thread 污染被拦截

---

## Wave 2 — 知识库资产与 Skill 基础设施收口

### 目标

把 connector / secret / skill 从“表结构 + service 骨架”推进到“workspace 级可配置、可注入、可迁移到 runtime skill 模型”。

### 重点任务

1. **Connector 管理闭环**
   - connector CRUD
   - workspace / KB 作用域校验
   - sample/test connection 能力
2. **Secret 注入闭环**
   - app-level encryption
   - key_version
   - connector/skill secret 注入边界
   - re-encrypt 脚本与测试
3. **Phase A：inject-only contract 行为桥接**
   - `AskSkillCandidate` 增加 `instruction`；若暂保留 `executionMode`，仅按 `inject_only` 解释
   - `wrenAIAdaptor` / `askContext` / AI service 透传并消费 selected skills + instruction
   - instruction 要进入 intent / reasoning / generation / correction，而不只是 generating 阶段
4. **Phase B：schema 与 service 升级**
   - 新建 `skill_marketplace_catalog`
   - 扩展 `skill_definition` runtime 字段
   - `skill_binding` 停止承接新能力，只保留过渡期兼容语义
   - repository / service 改为围绕 workspace-owned runtime skill 组织
5. **Ask contract 收口与 runner 退役准备**
   - ask request 不再继续携带 `actor_claims` / `connectors` / `secrets` / `skill_config`
   - `SkillRunner` 不再作为 ask 主路径依赖
   - 为 preview / runner-health 的兼容退场准备切面
6. **知识资产收口**
   - glossary / instructions / SQL pairs / analysis rule 的 KB 作用域统一

### 主要文件面

- `wren-ui/src/apollo/server/services/connectorService.ts`
- `wren-ui/src/apollo/server/services/secretService.ts`
- `wren-ui/src/apollo/server/services/skillService.ts`
- `wren-ui/src/apollo/server/utils/askContext.ts`
- `wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts`
- `wren-ui/src/pages/api/v1/connectors/*`
- `wren-ui/src/pages/api/v1/skills/*`
- `wren-ui/migrations/*skill*`
- `wren-ai-service/src/core/skill_contract.py`
- `wren-ai-service/src/core/legacy_ask_tool.py`
- `wren-ai-service/src/core/deepagents_orchestrator.py`
- `wren-ai-service/src/core/fixed_order_ask_runtime.py`
- `wren-ai-service/src/web/v1/services/*`

### Gate

- UI/API 能创建 connector 与 skill
- secret 不落明文
- ask/runtime contract 已支持 `instruction` 与 inject-only 语义
- ask 主链不再依赖 actor claims / connector / secret 作为 skill 执行输入
- `SkillRunner` 已退出 ask 主路径设计目标
- `skill_binding` 不再继续扩展新能力

---

## Wave 3 — Ask 主编排切换（最关键的业务波次）

### 目标

把 deepagents 从“已接线/可选”推进到“默认主路径”，并完成 runtime skill 数据迁移、主路径切换与 ask contract 收口。

### 重点任务

1. **DeepAgentsAskOrchestrator 主路径化**
   - `ASK_RUNTIME_MODE=deepagents` 作为默认
   - legacy 变成 fallback / rollback 开关
   - 当前阶段先接管 fixed-order ask orchestration，不承诺同阶段完成动态编排
2. **Phase C：数据回填与冲突处理**
   - 单 binding skill 回填到原 `skill_definition`
   - 多 binding 同配置 skill 聚合 `kb_suggestion_ids`
   - 多 binding 冲突 skill 拆分成多个 runtime skill
   - 回填脚本必须可重跑、幂等，并能避免重复克隆
3. **Phase D：ask 主路径切换**
   - `buildAskRuntimeContext()` 按 `selectedSkillIds -> skill_definition` 解析 runtime skill
   - preview API 切到 `skillDefinitionId`
   - 首页 skill picker / available skills 不再按 KB 读取 bindings
   - ask request 不再继续传 `actor_claims` / `connectors` / `secrets` / `skill_config`
4. **DeepAgents fixed-order ownership transfer**
   - 从 `LegacyAskTool` 提取 `NL2SQLToolset` 级步骤
   - 当前实现中，`NL2SQLToolset` 与 fixed-order runtime 同文件落在 `src/core/fixed_order_ask_runtime.py`，未额外拆出独立模块
   - orchestrator 统一组装 `effective_instructions = KB instructions + skill instructions`
   - ask 主路径不再保留 `skill-first` / `runner_first` / `hybrid`
   - legacy ask 保留为 fallback / baseline
5. **Ask 结果协议与持久化收口**
   - 删除 `SKILL` / `skillResult` / `SKILL_QUERY` 语义
   - `thread_response` / adaptor / 前端结果消费不再依赖 `skillResult`
   - 收口为 SQL / general / misleading 主路径渲染
6. **Golden regression + 轻量 shadow compare**
   - 采用采样 + 异步/非阻塞方式比较 deepagents 与 legacy baseline
   - 失败时可快速切回 legacy

### 主要文件面

- `wren-ai-service/src/core/deepagents_orchestrator.py`
- `wren-ai-service/src/core/legacy_ask_tool.py`
- `wren-ai-service/src/core/tool_router.py`
- `wren-ai-service/src/web/v1/services/ask.py`
- `wren-ui/src/apollo/server/services/askingService.ts`
- `wren-ui/src/apollo/server/utils/askContext.ts`
- `wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts`
- `wren-ui/src/pages/api/v1/skills/[id]/test.ts`
- `wren-ui/src/pages/home/index.tsx`
- `wren-ui/scripts/migrate_skill_bindings_to_runtime_skills.ts`
- `wren-ui/src/components/chart/index.tsx`
- `wren-ui/src/components/pages/apiManagement/*`

### Gate

- 默认 ask 可走 deepagents 主路径
- skill instruction 已进入 intent / reasoning / generation / correction
- `selectedSkillIds` / preview / ask 主路径都以 `skill_definition` 为准
- ask 主路径已不再返回 `SKILL` / `skillResult`
- binding -> runtime skill 回填能稳定重跑
- `thread_response` / adaptor / 前端结果消费不再依赖 `skillResult`
- 前端 SQL / general / misleading 主路径渲染通过

---

## Wave 4 — Dashboard / Schedule / 发布验收收口

### 目标

把“能问”扩展为“能看、能定时跑、能验收上线”，并完成 Skill V2 legacy 收口与最终退场准备。

### 重点任务

1. **Dashboard 多看板闭环**
   - dashboard / item runtime binding
   - refresh 按 dashboard 自身 binding 执行
2. **Schedule worker 闭环**
   - job CRUD
   - job run 持久化
   - retry / audit / error capture
3. **Storage 主路径确认**
   - PostgreSQL + pgvector 默认部署
   - provider smoke tests
   - 初始化与本地/dev 验证脚本
4. **Skill V2 Phase E：legacy 下线与退场窗口管理**
   - ask runtime / preview / UI 不再读写 `skill_binding`
   - residual inventory / main-path guard 稳定为 0
   - PostgreSQL audit / rehearsal / apply wrapper 已落地并在本地 dev PG 执行通过
   - 本地 dev PG 已执行最终 drop migration；若其他环境存在，再按相同步骤执行
5. **验收与发布门禁**
   - static scan
   - contract tests
   - integration
   - e2e
   - rollback 演练

### 主要文件面

- `wren-ui/src/apollo/server/services/dashboardService.ts`
- `wren-ui/src/apollo/server/services/scheduleService.ts`
- `wren-ui/src/apollo/server/backgrounds/dashboardCacheBackgroundTracker.ts`
- `wren-ui/src/apollo/server/backgrounds/scheduleWorker.ts`
- `wren-ai-service/src/providers/document_store/pgvector.py`
- `misc/scripts/scan-current-project.sh`
- `misc/scripts/scan-runtime-identity.sh`
- `misc/scripts/check-skill-binding-main-path.sh`
- `misc/scripts/skill-binding-retirement-*.sh`
- `misc/sql/skill-binding-retirement-readiness.sql`
- `wren-ui/migrations/20260410122000_drop_legacy_skill_binding.js`

### Gate

- 多 dashboard 不串 KB
- schedule job 能执行并留痕
- pgvector 主路径 smoke 通过
- Skill V2 main-path residual inventory = 0
- legacy binding 退场 audit / rehearsal / apply / local verify 在本地 dev PG 已通过
- release 验收 checklist 完成

---

## 6. 并行 lane 建议（最快推进方案）

如果继续使用 OMX / team 并行推进，建议直接按下面 4 条 lane：

### Lane A — 控制面 / Auth / Runtime Scope

- owner：`wren-ui`
- 范围：登录、session、workspace、KB selector、thread binding
- 对应 Wave：Wave 1

### Lane B — Connector / Secret / Skill 管理面

- owner：`wren-ui + wren-ai-service` 边界
- 范围：connector/secret/skill CRUD + Skill V2 schema/service/runtime contract
- 对应 Wave：Wave 2

### Lane C — Ask Orchestrator

- owner：`wren-ai-service` 主导，`wren-ui` 配合
- 范围：deepagents 固定顺序主路径、instruction 注入、inject-only contract、skill_definition 主路径切换、`SKILL`/`skillResult` 收口
- 对应 Wave：Wave 3

### Lane D — Dashboard / Schedule / Verification

- owner：`wren-ui + tests/scripts`
- 范围：dashboard binding、schedule worker、scan/golden/e2e、legacy skill_binding retirement
- 对应 Wave：Wave 4

### 推荐依赖顺序

- 先启动 Lane A + Lane B
- Lane C 在 Wave 2 inject-only contract 与 ask contract 收口后切主攻
- Lane D 全程跟跑，但在 Wave 3 后集中收口

---

## 7. 下一阶段的“完成定义”

当满足以下条件时，可以认为 Phase 3 完成：

1. 用户可登录并进入某个 workspace
2. 用户可选择 knowledge base + snapshot，并在该上下文下发起 ask
3. connector / secret / skill 可以配置，且 runtime canonical skill 为 workspace-owned `skill_definition`
4. `thread.selected_skill_ids`、preview、ask 主路径都以 `skill_definition.id` 为准
5. ask 默认走 deepagents 主路径，且 instruction 注入 + inject-only 语义生效
6. legacy fallback 到 NL2SQL baseline 能跑通
7. thread / dashboard / schedule 都绑定 canonical runtime identity
8. PostgreSQL + pgvector 为默认主路径
9. `skill_binding` 已退出主路径，且本地 dev PG 已完成最终退场 / drop 验证
10. golden regression / contract / e2e / static scan 全部通过

---

## 8. 当前不建议做的事

下一阶段先不要把精力继续投入在这些事情上：

1. 继续 repo-wide 追求 `projectId` 文本清零
2. 提前做企业 SSO/OIDC 真接入
3. 提前做 row/column 级权限执行
4. 提前做多语言 skill runtime
5. 提前重写 `wren-engine`

这些事情要么收益不高，要么会稀释当前 V1 主路径交付速度。

---

## 9. 建议的立即开工顺序

如果现在直接切到实现，建议按下面顺序进入：

### Step 1

先做 **Wave 1 整包收口**：

- 登录 / session / actor claims
- workspace / KB / snapshot 主入口
- thread 强绑定 KB

### Step 2

紧接着做 **Wave 2 整包收口**：

- connector / secret / skill 管理面
- Phase A/B：inject-only 行为桥接 + schema/service 升级
- ask contract 收口与 runner 退役准备

### Step 3

然后做 **Wave 3 整包切主路径**：

- deepagents ask 默认化
- Phase C/D：回填迁移 + 主路径切换
- fixed-order ownership transfer + inject-only ask contract 收口

### Step 4

最后做 **Wave 4 验收收口**：

- dashboard / schedule
- pgvector smoke
- Phase E：legacy binding / SkillRunner ask 遗留收口 / audit / rehearsal / drop window
- golden regression / e2e / rollback

---

## 10. 一句话总结

**Phase 2 已经把“运行时语义”收干净了；Phase 3 的核心不是继续做语义清洗，而是把 auth、KB、skill、deepagents ask、dashboard、schedule 这些能力真正做成一个可验收的 V1 产品闭环。**
