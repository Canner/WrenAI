# RALPLAN — WrenAI V1 改造方案

## Meta
- Mode: `ralplan --consensus --deliberate`
- Scope: 基于 `docs/需求V1.md` 与 `docs/refer_dula/*`，在当前 WrenAI 代码基础上规划一版可执行的产品与架构改造路线。
- Planning only: 本文档只定义改造方案、分期和验证，不直接修改业务代码。

## Companion Artifacts
- PRD: `.omx/plans/prd-wrenai-v1-rebuild.md`
- Phase 0 执行拆解: `.omx/plans/phase0-wrenai-v1-execution.md`
- Test Spec: `.omx/plans/test-spec-wrenai-v1-rebuild.md`
- Phase 1 任务包: `.omx/plans/phase1-task-packages.md`

## RALPLAN-DR Summary

### Principles
1. **保留有效底座，但收紧对外产品概念**：继续复用 Wren Engine 的语义层与 SQL 执行能力；对用户只暴露 workspace / knowledge base，不再把 `project` 当作产品一级对象（`wren-engine/README.md:26-27`, `wren-engine/README.md:101-105`, `wren-ui/src/apollo/server/repositories/projectRepository.ts:199-208`）。
2. **Ask 编排优先收口**：尽快让 `deepagents` 接管 ask orchestration；现有 retrieval / NL2SQL / chart generation 退为被编排能力，而不是继续让 legacy AskService 做主脑（`wren-ai-service/src/web/v1/services/ask.py:133-245`, `wren-ai-service/src/globals.py:115-215`）。
3. **治理先做必需层级**：V1 先完成内建账号体系、workspace 级和 knowledge base 级隔离；SSO/OIDC、行级/列级策略只预留扩展位，不阻塞首发。
4. **统一资产抽象，兼容表和 API**：数据源既包括数据库表，也包括业务/API 数据；产品层统一成 asset，执行层保持 table 与 API 双轨。
5. **基础设施直接收敛**：首期默认存储直接统一到 PostgreSQL + pgvector；定时报表先只做站内，不扩展邮件/IM 分发。

### Decision Drivers
1. **用户决策已明确**：你已确认内建账号、知识库优先、站内 schedule、workspace/knowledge base 权限、PostgreSQL + pgvector、deepagents 尽快替换 ask 编排，这些都应直接进入 V1 主路径。
2. **现状偏差大**：当前 UI/服务几乎都围绕“当前 project”展开，且默认元数据库仍是 sqlite、向量检索默认是 qdrant，也没有账号/成员域，不满足目标产品形态（`wren-ui/src/apollo/server/repositories/projectRepository.ts:185-208`, `docker/docker-compose.yaml:70-118`, `docker/config.example.yaml:67-168`）。
3. **可复用底座仍然存在**：LiteLLM provider、Haystack 检索、Hamilton pipeline、Wren Engine 语义层都已可运行；真正该优先替换的是 ask orchestration，而不是整栈推倒（`wren-ai-service/pyproject.toml:15-37`, `wren-ai-service/src/core/pipeline.py:14-37`, `wren-ai-service/src/providers/llm/litellm.py:22-166`）。

### Viable Options

#### Option A — 继续让 legacy AskService 主导，只在前面加轻量 router
**Approach**：保留当前 `AskService` 为主编排，只在入口前增加少量 skill 判断与 API 分流。

**Pros**
- 改动最小，短期风险最低。
- 复用当前 `ask.py` 及既有 retrieval/generation 代码最多（`wren-ai-service/src/web/v1/services/ask.py:192-245`）。

**Cons**
- 与“尽快替换现有 ask 编排”的目标冲突。
- 会继续把复杂度堆在 legacy AskService 上，后续再切 deepagents 成本更高。

#### Option B-prime — 让 deepagents 尽快接管 Ask orchestration，保留 Wren Engine 与底层检索/生成能力（推荐）
**Approach**：在 `wren-ai-service` 中引入 `deepagents` 作为 ask 主编排层；把现有 retrieval、SQL generation、SQL correction、chart generation、用户自定义 skill 调用（可连 API、DB 或复合 agent 流程）都收敛成 deepagents 可调用的 tools / subflows；Wren Engine 继续负责系统内建语义层与 SQL 执行。

**Pros**
- 与你当前优先级一致：先收口 ask runtime，而不是继续维护双主脑。
- 能较快支持“API 数据 + 表数据”混合问答，并把 mixed-result composition 放进统一 orchestrator。
- 保留现有 Wren Engine、LiteLLM、Haystack、Hamilton 的复用价值，避免整栈重写（`wren-ai-service/src/globals.py:39-215`, `wren-engine/ibis-server/README.md:1-2`）。

**Cons**
- ask 主链路改造风险显著高于 Option A。
- 必须同步准备 golden regression、feature flag rollback、trace 观测，否则上线风险过高。

#### Option C — deepagents 主导且同步移除 Haystack/Hamilton/qdrant 风格旧栈
**Approach**：把 query routing、knowledge retrieval、tool use、memory 全迁到 deepagents，只保留最薄的 SQL 执行器。

**Pros**
- 技术叙事最统一。
- 长远看在线链路组件最少。

**Cons**
- 破坏面最大。
- 会同时触发 ask、检索、索引、图表、评估、观测链路重写，超出 V1 合理风险。

### Recommendation
选择 **Option B-prime**：**保留 Wren Engine；让 deepagents 尽快接管 ask orchestration；Haystack/Hamilton 暂时退到可复用底层能力；首期主路径直接统一到 PostgreSQL + pgvector。**

### Pre-mortem（deliberate mode）
1. **失败场景 1：产品上去掉 Project，但实现上仍大量依赖 `getCurrentProject()`，最后“表面无 Project、内里全是 Project”。**
   - 信号：API/resolver/background 继续默认取第一条 project（`wren-ui/src/apollo/server/repositories/projectRepository.ts:199-208`, `wren-ui/src/apollo/server/backgrounds/dashboardCacheBackgroundTracker.ts:104-108`）。
   - 预防：Phase 0 先冻结 `workspace_id / knowledge_base_id / kb_snapshot_id / deploy_hash / actor_claims` 合同，再做 UI 收口。
2. **失败场景 2：过快替换 ask 编排，但没有 rollback / golden cases，导致问数效果回退。**
   - 信号：historical retrieval、SQL pair/instruction retrieval、SQL correction、chart generation 在 deepagents 接管后命中率和成功率下降（`wren-ai-service/src/globals.py:115-215`）。
   - 预防：deepagents 接管 ask 时必须保留 `ASK_RUNTIME_MODE=legacy|deepagents` 回退开关，并建立 golden regression 套件。
3. **失败场景 3：PostgreSQL + pgvector 直接切换后，向量检索质量或运维稳定性回退。**
   - 信号：当前 qdrant provider 路径被移除后，召回延迟/准确率明显恶化（`docker/config.example.yaml:67-168`, `wren-ai-service/src/providers/document_store/qdrant.py:367-425`）。
   - 预防：切换前先完成 pgvector provider、导数迁移脚本、基准对比和回滚快照。
4. **失败场景 4：内建账号体系先做了，但接口与数据模型没有预留 SSO/OIDC 扩展，后续被迫重写。**
   - 信号：认证逻辑散落在 resolver/service，没有统一 identity provider interface。
   - 预防：Phase 0 就把 `auth_identity` / `auth_session` / `identity_provider` 扩展槽定义清楚。

### Expanded Test Plan（deliberate mode）
- **Unit**
  - built-in auth：账号注册/登录/密码校验/session 生命周期。
  - scoped context resolver：workspace / knowledge base / runtime project / actor claims 解析。
  - deepagents tool planner：API hit / NL2SQL fallback / mixed answer 选择。
  - 用户自定义 skill：claims 注入、secret 绑定、API/DB 访问、输出 normalization。
  - permission guard：workspace 级、knowledge base 级 deny-by-default。
- **Integration**
  - sqlite/qdrant 导入到 PostgreSQL + pgvector 的 migration / rollback。
  - ask 链路：deepagents 主编排 + legacy tool fallback + chart generation。
  - asset onboarding：table source、user-defined skill、glossary/rule/sql template 生效。
  - in-app schedule：任务创建、执行、审计、失败重试。
- **E2E**
  - workspace A/B 隔离。
  - 知识库切换问数。
  - 表数据 + API 数据混合问答与图表展示。
  - 多 dashboard、新建站内 schedule、受限用户访问知识库。
- **Observability**
  - login success/failure rate。
  - agent path 命中率、fallback rate、SQL success rate、skill success rate。
  - pgvector retrieval latency / recall 对比。
  - schedule success rate、permission deny rate。

## Requirements Summary
1. 新增 workspace 多租户、内建账号体系与权限管理；但保留未来接企业 SSO / OIDC 的扩展位。
2. 产品层只保留 knowledge base；**不保留 Project 命名与产品概念**。
3. 一个 workspace 下支持多个 knowledge base；每个 knowledge base 下支持系统内建表数据路径，以及**用户自定义 skill 路径**。
4. skill 由用户编写；它既可以连接 API，也可以直接连数据库，甚至可以采用类似 deepagents 官方 text-to-sql 示例的方式自行做数据库问答。
5. 默认采用 PostgreSQL + pgvector 作为 metadata + vector 主存储。
6. 使用 deepagents + skills 接管 ask 编排；查不到再回落到现有 WrenAI / Wren Engine 的内建 NL2SQL 能力（`docs/需求V1.md:6`）。
7. 评估 Haystack/Hamilton 在新 ask runtime 下的保留边界，而不是默认整栈替换（`docs/需求V1.md:7-8`）。
8. Dashboard 支持多个看板，但定时报表首期只做站内任务与站内查看（`docs/需求V1.md:9-11`）。
9. 权限首期只做 workspace 级和 knowledge base 级；行级/列级作为后续扩展。
10. thread 首期只做**个人私有**，且 thread 在创建时必须绑定 `knowledge_base_id`；同一 thread 内不允许切换知识库，避免上下文污染。
11. knowledge base 的运行态版本直接支持**多环境 / 多版本并存**；每次问答、dashboard、schedule 都必须绑定明确的 `kb_snapshot_id + deploy_hash`。
12. V1 UI 对 `kb_snapshot` 先只暴露**一个统一 snapshot 选择器**，不拆成“环境 + 版本”两层选择。
13. secret 先采用**应用层加密 + 环境主密钥**；V1 不做自动轮换，但要预留 `key_version` 与历史密文重加密脚本。
14. 参考 UI 目标形态是 workspace / 知识库 / 资产 / 规则中心 / 数据看板 / 历史对话 / 定时任务，而不是当前单 project 建模流（`docs/refer_dula/01.png` ~ `docs/refer_dula/11.png`）。

## Current State and Gap Analysis

### 1. 产品信息架构仍是单 project OSS 形态
- 路由只有 `/home`、`/modeling`、`/setup/*`、`/knowledge/*`、`/api-management/*`，没有 workspace / knowledge base / dashboard center / schedule center 路由（`wren-ui/src/utils/enum/path.ts:1-15`）。
- Header 只有 `Home / Modeling / Knowledge / API` 四个一级入口（`wren-ui/src/components/HeaderBar.tsx:34-92`）。
- 当前 `Knowledge` 也只包含 SQL pair 和 instruction 两页（`wren-ui/src/pages/knowledge/question-sql-pairs.tsx:127-194`, `wren-ui/src/pages/knowledge/instructions.tsx:168-233`）。

**Gap**：与参考设计中的“知识库工作台 + 资产管理 + 规则中心 + 数据看板 + 定时任务”差距很大。

### 2. 服务端核心上下文仍是“当前 project”
- `ProjectRepository.getCurrentProject()` 永远按 `id asc limit 1` 取第一条 project（`wren-ui/src/apollo/server/repositories/projectRepository.ts:199-208`）。
- settings / updateCurrentProject 等 resolver 都依赖 `getCurrentProject()`（`wren-ui/src/apollo/server/resolvers/projectResolver.ts:70-87`, `wren-ui/src/apollo/server/resolvers/projectResolver.ts:98-107`）。
- Dashboard 初始化和读取同样绑定当前 project（`wren-ui/src/apollo/server/services/dashboardService.ts:128-147`）。

**Gap**：这不支持 workspace -> knowledge base -> project 的上下文切换，也不支持同租户多个活跃项目。

### 3. 元数据库默认仍是 sqlite，不满足 SaaS 化需求
- `bootstrapKnex()` 只在 `DB_TYPE=pg` 时走 PostgreSQL，否则回落到 `better-sqlite3`（`wren-ui/src/apollo/server/utils/knex.ts:8-30`）。
- Docker 默认 `wren-ui` 仍配置为 `DB_TYPE: sqlite` 且将数据写入 `/app/data/db.sqlite3`（`docker/docker-compose.yaml:83-118`）。

**Gap**：需求明确默认 PostgreSQL + pgvector；当前默认部署与目标相反。

### 3.5 当前没有账号 / 会话 / 成员域
- `wren-ui` 现有 migration 主要围绕 project / model / relation / dashboard / knowledge asset，没有用户、workspace member、session、role 等账号域实体。
- `IContext` 当前只暴露 project/query/dashboard 等服务，没有 auth / identity / membership 服务（`wren-ui/src/apollo/server/types/context.ts:42-84`）。

**Gap**：用户已明确先做内建账号体系，但当前仓库并无可直接复用的认证控制面。

### 4. 知识增强只到 project 级 instruction / SQL pair
- `sql_pair` 表只有 `project_id`, `sql`, `question`（`wren-ui/migrations/20250102074256_create_sql_pair_table.js:5-17`）。
- `instruction` 表只有 `project_id`, `instruction`, `questions`, `is_default`（`wren-ui/migrations/20250311046282_create_instruction_table.js:5-21`）。
- UI 也只暴露这两类知识资产（`wren-ui/src/pages/knowledge/question-sql-pairs.tsx:127-194`, `wren-ui/src/pages/knowledge/instructions.tsx:168-233`）。

**Gap**：没有 knowledge base、glossary、analysis rules、SQL templates、asset catalog。

### 5. Dashboard 虽有数据表，但 OSS 服务层仍按一个 dashboard 设计
- migration 已有 `dashboard`、`dashboard_item`、`dashboard_item_refresh_job`（`wren-ui/migrations/20250102074255_create_dashboard_table.js:5-29`, `wren-ui/migrations/20250102074256_create_dashboard_item_table.js:5-37`, `wren-ui/migrations/20250423000000_create_dashboard_cache_refresh_table.js:1-35`）。
- 但 `initDashboard()` 注释明确写了 `only support one dashboard for oss`（`wren-ui/src/apollo/server/services/dashboardService.ts:128-138`）。
- background tracker 刷缓存时取的也是“当前 project”，不是 dashboard 自己所属 project（`wren-ui/src/apollo/server/backgrounds/dashboardCacheBackgroundTracker.ts:98-108`）。

**Gap**：数据模型已有萌芽，但服务设计仍是单 dashboard / 单 project 语义。

### 6. 当前 query 执行链路只面向表型数据源
- `QueryService.preview()` 依赖 `project + manifest + sql`，然后在 Wren Engine 与 ibis adaptor 之间二选一执行（`wren-ui/src/apollo/server/services/queryService.ts:98-140`）。
- `initComponents()` 里服务构成也只有 project / mdl / deploy / asking / dashboard / instruction / sqlPair 等模块（`wren-ui/src/common.ts:49-220`）。

**Gap**：没有“系统内建语义 SQL 路径 + 用户自定义 skill 路径”的统一执行抽象。

### 7. AI service 是 pipeline/RAG 服务，不是 agent runtime
- 官方设计文档明确把代码分成 `API endpoints / Services / Pipelines / Providers`（`wren-ai-service/docs/code_design.md:28-36`）。
- `BasicPipeline` 直接包裹 `haystack.Pipeline | hamilton.AsyncDriver | Driver`（`wren-ai-service/src/core/pipeline.py:14-19`）。
- `create_service_container()` 里 AskService、ChartService、SqlAnswerService 都是 pipeline 组合（`wren-ai-service/src/globals.py:39-215`）。
- AskService 当前流程先做 historical retrieval、再 SQL pair/instruction retrieval、再 intent classification，之后才进入 SQL generation/correction（`wren-ai-service/src/web/v1/services/ask.py:192-245`）。

**Gap**：这条链路没有显式的 tool/skill router，也没有 API-first 查询分流。

### 8. 现有 provider 层可复用，不该被轻易推翻
- `litellm_llm` 已支持统一模型访问、fallback、streaming（`wren-ai-service/src/providers/llm/litellm.py:22-166`）。
- `litellm_embedder` 已支持统一 embedding provider（`wren-ai-service/src/providers/embedder/litellm.py:165-201`）。
- `pyproject.toml` 已集成 `haystack-ai`, `qdrant-haystack`, `sf-hamilton`, `litellm`（`wren-ai-service/pyproject.toml:15-37`）。

**Gap**：问题不在于模型接入能力缺失，而在于编排层和 metadata schema 不适配新产品形态。

## Target Product and Architecture

### Domain Model（建议作为一期先决条件）
新增并统一以下核心实体：
- `workspace`
- `user`
- `auth_identity`
- `auth_session`
- `identity_provider_config`（V1 可为空，用于保留 SSO/OIDC 扩展位）
- `workspace_member`
- `role` / `permission`
- `knowledge_base`
- `kb_snapshot`（内部运行态知识库版本/快照；支持多环境 / 多版本并存）
- `connector`
- `skill_definition`（用户自定义 skill）
- `skill_binding`（skill 与 knowledge_base / connector / secret 的绑定）
- `asset`（table / view / api / file / metric / semantic-model）
- `asset_binding`（asset 与 knowledge_base / kb_snapshot / connector 的映射）
- `glossary_term`
- `analysis_rule`
- `sql_template`
- `dashboard`
- `dashboard_item`
- `schedule_job`
- `data_policy`（V1: workspace / knowledge_base；future: row / column）

### Domain Boundary Clarification（关键补充）
- `workspace`：租户与权限隔离边界。负责成员、角色、系统级配置。
- `user` / `auth_identity` / `auth_session`：认证与会话边界。V1 先做内建账号；未来企业 SSO/OIDC 通过 `identity_provider_config` 扩展，而不是重写账号表。
- `knowledge_base`：用户面对的核心运营边界。负责 connectors、skills、assets、glossary、analysis rules、SQL templates、dashboards、schedules。它应映射参考设计中的“知识库”一级对象，而不是现有 project 替身（参考当前 Knowledge 页面仅有 SQL pair / instruction，`wren-ui/src/pages/knowledge/question-sql-pairs.tsx:127-194`, `wren-ui/src/pages/knowledge/instructions.tsx:168-233`）。
- `kb_snapshot`：**仅作为内部运行态知识库版本/快照**。它承接现有 model/relation/view/deploy/manifest 体系，用来替代当前代码中深度耦合的 `project_id` 运行语义（`wren-ui/migrations/20240125070643_create_project_table.js:6-53`, `wren-ui/migrations/20240125071855_create_model_table.js:7-56`, `wren-ui/migrations/20240125083821_create_relation_table.js:5-20`）。同一 knowledge base 可并存多个 snapshot（例如 dev / staging / prod 或多个发布版本）。
- `connector`：描述连接方式与 secret 绑定；主要服务系统内建 DB 路径，也可为 skill 提供底层连接信息。
- `skill_definition`：用户自定义执行单元。它可以连 API，也可以连数据库，或封装一个多步 agent 流程；系统只要求它遵守统一输入/输出/审计合同。
- 结论：V1 在产品层只保留 **workspace -> knowledge base** 两级显式对象；内部不再保留 `project` 命名，而改为 `kb_snapshot` 承接 manifest、deploy、线程与调度上下文。

### Runtime Identity Contract（Phase 0 必须定稿）
当前链路存在两套身份：UI 到 AI service 的 ask/deploy 仍主要传 `id/deployId/hash`（`wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts:235-242`, `wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts:338-345`），而 AI service 的运行链路和 retrieval/indexing 仍主要按 `project_id` 过滤（`wren-ai-service/src/web/v1/services/__init__.py:57-66`, `wren-ai-service/src/web/v1/services/semantics_preparation.py:76-79`, `wren-ai-service/src/web/v1/services/ask.py:192-245`, `wren-ai-service/src/pipelines/retrieval/sql_pairs_retrieval.py:38-81`, `wren-ai-service/src/pipelines/retrieval/instructions.py:59-105`）。当前代码中 `project_id` 在 `wren-ai-service/src/web` 出现 **47** 次，在 `wren-ai-service/src/pipelines` 出现 **166** 次，说明这不是局部字段，而是运行时主索引。

因此 Phase 0 必须统一为一套不含 Project 命名的 canonical contract：
- `workspace_id`：租户与授权边界
- `knowledge_base_id`：知识运营边界
- `kb_snapshot_id`：内部知识库版本/快照标识
- `deploy_hash`：对应 manifest 版本
- `actor_claims`：`user_id`、`workspace_member_id`、角色/权限快照
- `thread_id` / `dashboard_id` / `schedule_job_id`：调用来源上下文
- 其中 `thread_id` 创建时必须固化 `knowledge_base_id`，禁止在同一 thread 中切换知识库；必要时新建 thread

**落地规则**
1. UI / Apollo / adaptor 层不得再只传 `id`；要显式传 `knowledge_base_id + kb_snapshot_id + deploy_hash + actor_claims`。
2. AI service 的 `BaseRequest`、`AskRequest`、`SemanticsPreparationRequest`、chart/sql answer 等请求模型统一接受这套身份合同；旧 `id` 仅作为兼容 alias，逐步删除（`wren-ai-service/src/web/v1/services/semantics_preparation.py:16-22`, `wren-ai-service/src/web/v1/services/ask.py:22-33`）。
3. retrieval/indexing 仍可暂保留 `project_id` 物理字段，但语义上映射到 `kb_snapshot_id`；迁移期间允许双字段映射。
4. thread / dashboard / schedule 持久化时必须写入 `knowledge_base_id + kb_snapshot_id + deploy_hash` 快照，禁止运行时再回退到 `getCurrentProject()`。
5. 因为 V1 直接支持多环境 / 多版本并存，所以 `kb_snapshot_id` 必须作为一等运行态身份保留，不能只靠 `knowledge_base_id` 代替。
6. thread 创建时应同时固化 `knowledge_base_id + kb_snapshot_id + deploy_hash`；知识库切换必须通过新建 thread 完成，不允许在原 thread 中漂移上下文。

### Scope-Cutover Appendix（移除 `getCurrentProject()` 的强制清单）
当前 `getCurrentProject()` 在 `wren-ui/src` 中共有 **85** 个调用点，不能只按“几个 touchpoints”处理（`wren-ui/src/apollo/server/repositories/projectRepository.ts:199-208`）。

按改造面分组：
- **API handlers：12 个调用点 / 12 个文件**
  - `wren-ui/src/pages/api/v1/ask.ts`
  - `wren-ui/src/pages/api/v1/generate_sql.ts`
  - `wren-ui/src/pages/api/v1/generate_summary.ts`
  - `wren-ui/src/pages/api/v1/generate_vega_chart.ts`
  - `wren-ui/src/pages/api/v1/run_sql.ts`
  - `wren-ui/src/pages/api/v1/stream/ask.ts`
  - `wren-ui/src/pages/api/v1/stream/generate_sql.ts`
  - `wren-ui/src/pages/api/v1/models.ts`
  - `wren-ui/src/pages/api/v1/knowledge/sql_pairs/index.ts`
  - `wren-ui/src/pages/api/v1/knowledge/sql_pairs/[id].ts`
  - `wren-ui/src/pages/api/v1/knowledge/instructions/index.ts`
  - `wren-ui/src/pages/api/v1/knowledge/instructions/[id].ts`
- **GraphQL resolvers：47 个调用点 / 7 个文件**
  - `wren-ui/src/apollo/server/resolvers/askingResolver.ts`
  - `wren-ui/src/apollo/server/resolvers/dashboardResolver.ts`
  - `wren-ui/src/apollo/server/resolvers/diagramResolver.ts`
  - `wren-ui/src/apollo/server/resolvers/instructionResolver.ts`
  - `wren-ui/src/apollo/server/resolvers/modelResolver.ts`
  - `wren-ui/src/apollo/server/resolvers/projectResolver.ts`
  - `wren-ui/src/apollo/server/resolvers/sqlPairResolver.ts`
- **Services：23 个调用点 / 5 个文件**
  - `wren-ui/src/apollo/server/services/askingService.ts`
  - `wren-ui/src/apollo/server/services/dashboardService.ts`
  - `wren-ui/src/apollo/server/services/mdlService.ts`
  - `wren-ui/src/apollo/server/services/modelService.ts`
  - `wren-ui/src/apollo/server/services/projectService.ts`
- **Background trackers：2 个调用点 / 2 个文件**
  - `wren-ui/src/apollo/server/backgrounds/dashboardCacheBackgroundTracker.ts`
  - `wren-ui/src/apollo/server/backgrounds/textBasedAnswerBackgroundTracker.ts`
- **Repository root：1 个调用点 / 1 个文件**
  - `wren-ui/src/apollo/server/repositories/projectRepository.ts`

**执行要求**
1. Phase 0 先建立 scoped context resolver。
2. Phase 1 前必须完成以上 5 个桶的 inventory 与迁移策略。
3. 任何新代码禁止再新增 `getCurrentProject()` 入口。
4. 线程、dashboard、scheduler 是重点高风险流，必须优先完成“显式 runtime identity”改造。

### Target System Layers

#### 1) Control Plane（`wren-ui` + metadata DB）
职责：
- built-in auth / session / future OIDC provider config
- workspace / member / role / permission 管理
- knowledge base / asset / connector / skill 管理
- glossary / rule / sql template 管理
- dashboard / in-app schedule 管理
- context selector（workspace / knowledge base；`kb_snapshot` 作为内部版本/环境上下文，V1 UI 先用统一 snapshot selector 暴露）

建议落点：
- 以 `wren-ui/src/common.ts` 为 composition root，拆出 auth、workspace、knowledge-base scoped repositories / services（当前集中装配在 `initComponents()`，`wren-ui/src/common.ts:49-220`）。
- 重构 `wren-ui/src/utils/enum/path.ts` 和 `wren-ui/src/components/HeaderBar.tsx`，改成知识库工作台信息架构（`wren-ui/src/utils/enum/path.ts:1-15`, `wren-ui/src/components/HeaderBar.tsx:34-92`）。
- 新增 Apollo repository / resolver / service 层，禁止继续以 `getCurrentProject()` 充当全局上下文。
- skill 管理界面需要支持：用户代码/模板、secret 绑定、connector 引用、能力声明、审计策略。
- secret 管理先采用应用层加密 + 环境主密钥；V1 同时落 `key_version` 字段与离线重加密脚本，不做自动轮换。

#### 2) Runtime Orchestrator（`wren-ai-service`）
职责：
- `deepagents` ask orchestrator：统一接管 query planning、tool routing、mixed-result composition
- context assembly：按 workspace / knowledge base / kb_snapshot 拉取 glossary / rule / sql template / policies
- retrieval：继续承担 SQL pairs / instructions / schema / historical question 召回
- 内建 NL2SQL fallback：复用现有 SQL generation / correction / execution 能力
- 用户自定义 skill 调用：skill 可连 API、DB 或复合 agent 流程
- chart plan / answer synthesis / skill result normalization

建议落点：
- 在 `wren-ai-service` 中新增 `DeepAgentsAskOrchestrator`，并把 `ask.py` 入口改为先进入它；legacy AskService 退为 deepagents 可调用的 tool / fallback flow，而不是继续做主编排（当前 ask 链路入口在 `wren-ai-service/src/web/v1/services/ask.py:133-245`）。
- 在 `wren-ai-service/src/globals.py` 增加 deepagents runtime、skill runner、policy-aware retrieval service，并把原 ask/chart/sql_answer pipeline 包在 orchestrator 后面（`wren-ai-service/src/globals.py:39-215`）。
- `src/core/pipeline.py` 可以暂时保留，作为 legacy deterministic pipeline 抽象；但 ask 主路径的编排决策不再放在这里（`wren-ai-service/src/core/pipeline.py:14-19`）。
- **职责边界收敛建议**：
  - `deepagents`：负责在线 ask orchestration、skill/tool routing、多步决策、mixed-result composition。
  - `Haystack`：继续负责向量检索与 document store 适配，尤其是 schema / SQL pair / instruction / docs retrieval。
  - `Hamilton`：若保留，只作为 deepagents 背后的 deterministic 子流程承载 SQL generation / correction / execution，不再直接决定高层运行路径（`wren-ai-service/src/pipelines/generation/intent_classification.py:373-375`, `wren-ai-service/src/pipelines/generation/sql_generation.py:184-186`, `wren-ai-service/src/pipelines/retrieval/sql_executor.py:73-75`）。
  - `skill runner`：只负责执行用户 skill、注入 claims/secret、采集 trace、校验输出合同，不决定整体编排。
  - 这样可以尽快替换 ask 主脑，同时允许用户 skill 覆盖 API、DB 与复合 agent 场景。

#### 3) Semantic / Execution Layer（`wren-engine` + ibis）
职责：
- 语义模型（MDL）
- SQL planning / transpile / execute
- 多数据源连接
- 权限策略编译后的执行约束承接

建议边界：
- 保留 Wren Engine 为 semantic layer 和 SQL 执行底座（`wren-engine/README.md:26-27`, `wren-engine/README.md:62-75`）。
- `ibis-server` 继续负责计划/转译/执行（`wren-engine/ibis-server/README.md:1-2`）。
- 不把 API skill 数据硬塞进 Wren Engine；API 结果可作为 tool output / temporary context / materialized cache 供上层编排使用。

#### 4) Storage Layer
建议一期目标：
- metadata / auth / dashboard / schedule / audit：统一 PostgreSQL
- vector store：**直接统一到 pgvector 作为主路径**，不再把 qdrant 作为默认组件；但迁移窗口内保留回滚脚本与快照
- optional cache：按性能需求决定是否加 Redis；V1 非必须

**工程含义**：当前 docker、example config、provider 注册、pipeline 默认值都深度绑定 qdrant，因此“直接切 pgvector”意味着要同步调整 compose、配置模板、provider 注册与数据迁移（`docker/docker-compose.yaml:70-79`, `docker/config.example.yaml:67-168`, `wren-ai-service/src/providers/__init__.py:175-213`, `wren-ai-service/src/providers/document_store/qdrant.py:367-425`）。

## Recommended Technical Decisions

### Decision 1 — 保留 Wren Engine，不用 deepagents 替换语义层
**Why**：Wren Engine 已明确定位为 semantic engine，且当前 queryService 已围绕 manifest + SQL 接口集成（`wren-engine/README.md:26-27`, `wren-ui/src/apollo/server/services/queryService.ts:98-140`）。替换它不会直接解决 workspace、知识库、用户 skill 等产品问题，反而扩大改造面。

### Decision 2 — 让 deepagents 尽快替换现有 ask 编排，但不替换 Wren Engine 与底层检索/生成能力
**Why**：你的优先级已经明确是“尽快替换现有 ask 编排”。当前 `AskService` 既承担历史召回、知识召回、意图判断，又承担后续 SQL 生成路径的调度，是最需要收口的中心点（`wren-ai-service/src/web/v1/services/ask.py:192-245`）。因此 V1 不应继续让 legacy AskService 做主脑，而应把它拆成可被 `deepagents` 调用的能力模块。

**Boundary refinement**：
- `deepagents` 负责 query planning、tool routing、fallback decision、mixed-answer composition。
- Haystack 继续负责 embedding / document store / retrieval adapter。
- Hamilton 若保留，只作为 deterministic subflow，不再决定 ask 主流程。
- 必须保留 `ASK_RUNTIME_MODE=legacy|deepagents` 回退开关，并建立 golden regression 与 trace 观测。

### Decision 3 — 一期不启用开放式长期 memory，只做显式 scoped memory
建议：
- 保留会话历史（session/thread scoped）
- 知识资产显式化：glossary / rule / sql template / sql pair / instruction
- 如需 memory，只允许 workspace / knowledge_base / thread scoped short-term memory

**Why**：问数系统更适合“可审核知识资产”，不适合引入不可控 agent memory 影响 SQL 正确性；而且产品层已经去掉 Project，memory 也不应继续按 `project` 做用户可见边界。

### Decision 4 — skill 是用户自定义执行单元；它可以连 API，也可以直接连数据库
- `skill_definition` 由用户编写，不预设它只能访问 API。
- skill 可以：
  - 调业务 API / 第三方 SaaS API；
  - 直接访问数据库；
  - 采用类似 deepagents 官方 text-to-sql 示例的方式，自己完成某一路数据库问答；
  - 封装多步 agent/tool 流程。
- 系统内建仍保留一条 **Wren Engine 语义 SQL 路径**，用于标准化的语义层问数。
- ask orchestrator 要能在 **内建语义 SQL 路径** 与 **用户自定义 skill 路径** 之间选择或组合。
- 为了支持图表、审计和混合回答，skill 输出必须归一到统一 contract，例如：`tabular_frame | metric_series | text | chart_spec | citation_bundle`。
- connector 描述底层连接和 secret；skill 决定是否以及如何使用 connector。

**Why**：这是你明确提出的核心约束：skill 的实现方式由用户决定，系统不能把 skill 硬编码成“只会调 API 的 connector”。

### Decision 5 — V1 权限先收敛到 workspace / knowledge_base 级，但执行链路仍必须 deny-by-default
- UI 负责配置 workspace / knowledge_base membership 与授权
- metadata store 持久化 membership / permission / knowledge-base scope
- runtime 负责把 scope 注入 ask、SQL、skill、dashboard、schedule
- V1 不把 row / column policy 作为首发门槛，但数据模型与执行接口要保留扩展位

**Enforcement refinement**：
- **认证/成员资格** 在 control plane。
- **授权决策** 在 shared policy service。
- **最终强制执行** 仍要落到执行链路：
  - 内建 SQL 路径至少按 knowledge base 绑定的 `kb_snapshot` / manifest scope 限定；
  - 用户 skill 路径至少要注入 `actor_claims`、scope、secret policy，并保留输出过滤/审计钩子。
- 当前这点尚未成立：`IContext` 只有 project/query/dashboard 等服务，没有 user/policy 服务（`wren-ui/src/apollo/server/types/context.ts:42-84`）；`ask`/`run_sql` API 直接通过 `getCurrentProject()` 进入执行（`wren-ui/src/pages/api/v1/ask.ts:53-92`, `wren-ui/src/pages/api/v1/run_sql.ts:60-80`）。

**Future extension contract**：
1. 行级/列级权限不进入 V1 上线门槛，但 schema 要预留 `data_policy` 扩展字段。
2. 后续若上行级/列级，内建 SQL 路径优先编译到 Wren Engine MDL `rls/cls`；用户 skill 路径扩展为字段过滤/脱敏/二次校验 contract（`wren-engine/wren-core-base/manifest-macro/src/lib.rs:166-182`, `wren-engine/wren-core-base/src/mdl/builder.rs:210-228`, `wren-engine/wren-core-base/src/mdl/cls.rs:24-37`）。
3. V1 发布门槛是 workspace / knowledge_base 级 deny-by-default，而不是 row / column 级完备治理。

### Decision 6 — thread 首期只做个人私有，并且必须与 knowledge base + kb_snapshot 强绑定
**Why**：当前 ask/history/thread 链路已存在跟随上下文重写问题（`wren-ui/src/pages/api/v1/ask.ts:76-80`）；如果允许在同一 thread 内切换知识库，会把历史问答、召回上下文、推荐问题、图表和后续追问全部污染。

**Implementation rule**：
- thread 首期只对创建者本人可见。
- thread 创建时写入 `user_id + workspace_id + knowledge_base_id + kb_snapshot_id + deploy_hash`。
- 即使同一 knowledge base 下存在多个环境/版本，thread 也必须固定到其中一个 kb_snapshot。
- 同一 thread 内禁止切换 knowledge base；UI 如果切换知识库，必须提示用户开启新 thread。
- 如需后续支持共享/协作 thread，必须在 Phase 4 以后再引入独立权限模型与审计。

### Decision 7 — 用户 skill 运行时按 deepagents 最佳实践走隔离执行
**Why**：deepagents 官方文档明确把 sandbox 作为代码执行的隔离边界，并说明无隔离的 Local shell 只适用于受控开发环境，不适合作为通用生产模式。

**Implementation rule**：
- V1 skill runtime 采用 **Python-only + isolated worker/container**。
- 主 ask 服务不直接执行用户 skill 代码。
- skill 通过受控 runner 获取 `actor_claims`、secret、connector 配置与资源限制。
- 为后续多语言扩展预留协议，但不进入 V1 首发。

### Decision 8 — 认证先做内建账号体系，但从一开始预留企业 SSO / OIDC 扩展槽
**Why**：当前仓库没有现成 auth domain，先落本地账号体系最直接；但如果把账号、会话、identity provider 写死，后续企业接入会造成二次拆改。

**Implementation rule**：
- `user`、`auth_identity`、`auth_session` 作为基础表。
- 登录方式先支持内建账号。
- `identity_provider_config`、OIDC callback / token mapping interface 先设计好但可不启用。
- control plane 与 runtime 只消费统一的 `actor_claims`，不耦合具体登录方式。

### Decision 9 — `kb_snapshot` 在 V1 UI 先用统一 selector 暴露，不拆环境/版本两层
**Why**：V1 已经同时引入 workspace、knowledge base、kb_snapshot、skill、dashboard、schedule，如果再把 snapshot 拆成环境+版本双层，会明显增加首发 UI 和上下文切换复杂度。

**Implementation rule**：
- V1 UI 提供单一 `kb_snapshot` 选择器。
- 选择器后端仍支持多环境 / 多版本并存，但前端不强制分别建模。
- 若后续用户运营上确实需要“环境”和“版本”分层，再在 Phase 4 拆分。

### Decision 10 — secret 采用应用层加密 + 环境主密钥；V1 不做自动轮换
**Why**：当前仓库还没有 KMS/Vault/密钥生命周期能力，V1 先把密文存储、密钥版本、离线重加密能力打牢，收益最高。

**Implementation rule**：
- 所有 connector/skill secret 以应用层加密后入库。
- 主密钥从环境变量或部署密钥注入。
- secret 记录 `key_version`。
- V1 提供历史密文重加密脚本，但不实现在线自动轮换。
- KMS/Vault 与自动轮换进入后续 phase。

## Implementation Plan

### Phase 0 — 基线建模与防返工准备
**Objective**：先冻结产品边界、身份合同和迁移策略，避免后续返工。

**Primary touchpoints**
- `wren-ui/src/apollo/server/repositories/projectRepository.ts:185-208`
- `wren-ui/src/apollo/server/resolvers/projectResolver.ts:70-107`
- `wren-ui/src/common.ts:49-220`
- `wren-ui/src/apollo/server/types/context.ts:42-84`
- `wren-ui/src/apollo/server/backgrounds/dashboardCacheBackgroundTracker.ts:61-108`
- `wren-ai-service/src/web/v1/services/ask.py:133-245`
- `wren-ai-service/src/globals.py:39-215`
- `wren-ui/migrations/20240125070643_create_project_table.js:6-53`

**Tasks**
1. 定义 canonical domain schema：workspace / user / auth / knowledge base / kb_snapshot / connector / skill / asset / dashboard / schedule。
2. 明确“产品层只有 knowledge base，内部不再保留 Project 命名”的边界，并整理所有 UI/API DTO。
3. 设计 built-in auth 数据模型与 session 机制，同时定义 `identity_provider_config` 扩展槽。
4. 冻结 canonical runtime identity contract：`workspace_id / knowledge_base_id / kb_snapshot_id / deploy_hash / actor_claims`。
5. 定义用户 skill contract：输入参数、claims 注入、secret 绑定、输出归一格式、trace/audit 字段。
6. 定义 secret encryption contract：密文字段、`key_version`、主密钥注入、离线重加密脚本。
7. 设计 isolated skill runner：worker/container 生命周期、资源限制、网络/文件系统边界。
8. 做 `getCurrentProject()` scope inventory，按 API handlers / resolvers / services / backgrounds / repository 五个桶列出迁移清单。
9. 产出 deepagents 方案设计：包选择、tool surface、legacy tool 包装方式、`ASK_RUNTIME_MODE=legacy|deepagents` 回退方案、trace 字段。
10. 设计 sqlite/qdrant 到 PostgreSQL + pgvector 的直接切换策略，包括导入脚本、回滚快照、基准对比。
11. 补回归测试，锁定当前 ask 主链路效果，形成 golden regression 套件。

**Deliverables**
- ERD / migration design doc
- auth + session spec
- runtime identity contract spec
- user skill contract spec
- secret encryption + key version spec
- isolated skill runner spec
- deepagents orchestrator ADR / rollback plan
- PostgreSQL + pgvector cutover plan
- compatibility test list

### Phase 1 — 控制面与存储基座重构
**Objective**：先把存储、账号、知识库控制面改成目标形态。

**Primary touchpoints**
- `wren-ui/src/utils/enum/path.ts:1-15`
- `wren-ui/src/components/HeaderBar.tsx:34-92`
- `wren-ui/src/common.ts:49-220`
- `wren-ui/src/apollo/server/utils/knex.ts:8-30`
- `docker/docker-compose.yaml:70-118`
- `docker/config.example.yaml:67-168`
- `wren-ai-service/src/providers/__init__.py:175-213`
- `wren-ui/migrations/*.js`

**Tasks**
1. 把默认 metadata、auth、vector 主存储全部切到 PostgreSQL + pgvector；qdrant/sqlite 不再作为主路径依赖。
2. 新增 workspace / user / auth_identity / auth_session / workspace_member / role / knowledge_base / kb_snapshot / connector / skill_definition / skill_binding / asset / dashboard / schedule 等 migration 和 repository。
3. 实现内建账号体系与 session；SSO/OIDC 仅保留 provider config、callback interface 和 claims mapping 扩展位。
4. 重构路由与导航：知识库、资产中心、规则中心、数据看板、历史对话、站内定时任务；去掉对终端用户暴露的 Project 概念。
5. 提供 skill 管理：用户 skill 注册/编辑、secret 绑定、connector 绑定、能力声明。
6. 落 secret 存储：应用层加密、`key_version` 字段、管理命令/脚本。
7. 部署 isolated skill runner（Python-only），打通主服务到 runner 的调用、超时、重试、审计。
8. 将现有 knowledge 页面改造成 knowledge center：SQL pair、instruction、glossary、analysis rule、SQL template、skill 六类资产并列。
9. 改造 UI / Apollo / adaptor 请求合同，让 ask / chart / SQL / scheduler / dashboard 路径都显式携带 `knowledge_base_id + kb_snapshot_id + deploy_hash + actor_claims`，不再仅靠 legacy `id` alias（`wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts:235-242`, `wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts:338-345`）。
10. 为 V1 UI 提供统一 `kb_snapshot` selector，而不是环境/版本双层 UI。
11. 提供 legacy project -> knowledge_base + kb_snapshot 的导入/兼容脚本。

### Phase 2 — deepagents 接管 Ask Runtime
**Objective**：让 deepagents 成为 ask 主编排，现有 Wren pipeline 退到可调用能力层。

**Primary touchpoints**
- `wren-ai-service/src/web/v1/services/ask.py:133-245`
- `wren-ai-service/src/globals.py:39-215`
- `wren-ai-service/src/core/pipeline.py:14-19`
- `wren-ai-service/src/providers/llm/litellm.py:22-166`
- `wren-ai-service/src/providers/embedder/litellm.py:165-201`
- `wren-ui/src/apollo/server/services/queryService.ts:98-140`

**Tasks**
1. 新增 `DeepAgentsAskOrchestrator`，并让 ask 入口默认进入它；legacy AskService 拆成可调用 tools / fallback flows。
2. 保留 `ASK_RUNTIME_MODE=legacy|deepagents` 回退开关；必要时增加 shadow run / trace compare。
3. 新增 `SkillRouter` 与 `AssetResolver`：根据 query、knowledge base assets、权限判断走内建语义 SQL 路径、用户 skill 路径、还是 mixed answer。
4. 在 runtime 中落地 workspace / knowledge_base 级 deny-by-default：缺少 `actor_claims` 或 scope 时拒绝执行，不回退到宽松默认。
5. 保留现有 retrieval：historical question、SQL pair、instruction、schema retrieval 继续服务内建 NL2SQL fallback。
6. 为用户 skill 增加 claims/secret 注入与结果归一，输出 tabular frame / metric series / text / chart-ready payload。
7. 增加 mixed-answer composer：合并 skill 结果和内建 SQL 结果，输出 answer / chart-ready data。
8. 将 glossary / rule / sql template 注入 Ask runtime context，用于提高 NL2SQL 精度。
9. 改造 AI service request/response 模型：从当前 `id/mdl_hash` alias 与 `project_id` 双轨状态，过渡为 canonical runtime identity contract，并打通 semantics preparation、retrieval filters、ask/chart/sql answer 链路（`wren-ai-service/src/web/v1/services/semantics_preparation.py:16-22`, `wren-ai-service/src/web/v1/services/__init__.py:57-66`）。
10. 以 golden regression、线上 trace、回退演练作为 deepagents 切主路径的上线门槛。

### Phase 3 — Dashboard、站内 Schedule 与商用化收尾
**Objective**：把多看板、站内任务、审计和兼容性补齐。

**Primary touchpoints**
- `wren-ui/src/apollo/server/services/dashboardService.ts:128-147`
- `wren-ui/src/apollo/server/backgrounds/dashboardCacheBackgroundTracker.ts:61-108`
- `wren-ui/migrations/20250102074255_create_dashboard_table.js:5-29`
- `wren-ui/migrations/20250102074256_create_dashboard_item_table.js:5-37`
- `wren-ui/migrations/20250423000000_create_dashboard_cache_refresh_table.js:1-35`

**Tasks**
1. 移除 single-dashboard 假设，支持 knowledge base 维度多个 dashboard。
2. 补 `schedule_job` 与站内任务中心，只做站内查看/触发/审计，不做邮件/IM 分发。
3. 为 dashboard refresh / report generation 增加审计日志、trace_id、权限校验与失败重试。
4. 把 dashboard refresh 的执行上下文从“当前 project”改为“dashboard 绑定的 knowledge_base + kb_snapshot + deploy_hash”。
5. 完成 legacy 数据导入、兼容视图、回滚文档与运维手册。

### Phase 4 — 后续扩展（不阻塞 V1）
**Objective**：把已预留的扩展位逐步打开，而不是塞进首发。

**Tasks**
1. 评估并接入企业 SSO / OIDC。
2. 在已完成的 workspace / knowledge_base 权限基础上，扩展 row / column policy，并优先对接 Wren Engine `rls/cls`。
3. 评估共享/协作 thread 的权限模型与审计。
4. 评估 skill 的运行时治理：模板化、沙箱化、审核流、限流与资源配额。
5. 评估 Hamilton 是否仍需保留；若 deepagents ask runtime 已稳定，再考虑继续收缩旧编排。

## Acceptance Criteria
1. **账号体系**：实例内可创建/登录内建账号；workspace membership 与 session 生命周期可验证；SSO/OIDC 扩展接口已文档化但可未启用。
2. **产品边界**：用户主路径只看到 workspace / knowledge base；系统内外都不再以 Project 作为正式命名概念。
3. **知识库**：每个 workspace 至少可管理多个 knowledge base；每个 knowledge base 至少支持多 `kb_snapshot` 并存，以及 1 条系统内建表数据路径和 1 个用户自定义 skill。
4. **Snapshot 暴露方式**：V1 UI 通过统一 `kb_snapshot` selector 完成版本/环境选择，不强制拆成环境+版本双层。
5. **Skill 能力**：用户自定义 skill 至少可接入一种真实外部/内部数据访问方式（API 或 DB），并能在 isolated runner 中返回受支持的标准化结果格式。
6. **默认存储**：默认部署主路径使用 PostgreSQL + pgvector；启动主路径不依赖 sqlite 或 qdrant。
7. **Ask runtime**：deepagents 成为 ask 主编排；legacy runtime 仅作为 feature-flag fallback，不再承担主路径编排。
8. **知识增强**：glossary、analysis rule、SQL template 能进入问数上下文，并可通过回归测试证明对 SQL 生成或 answer planning 有影响。
9. **多 dashboard**：同一 knowledge base 下可维护多个 dashboard，刷新不会串 knowledge base / kb_snapshot。
10. **线程边界**：thread 首期仅个人私有；thread 在创建时绑定 knowledge base + kb_snapshot，且同一 thread 不允许切换知识库。
11. **权限治理**：workspace 级、knowledge base 级权限都能阻止越权 ask / SQL / skill 结果返回；缺少 claims 时默认拒绝。
12. **站内定时任务**：可配置站内 schedule job，并记录任务状态、开始/结束时间、失败原因；不要求邮件/IM 推送。
13. **Secret 管理**：secret 以应用层加密形式存储，具备 `key_version` 字段和离线重加密脚本；V1 不要求自动轮换。
14. **兼容性**：现有单 project 体验在 migration 后仍可被兼容导入到新模型。
15. **身份合同统一**：UI、Apollo adaptor、AI service、scheduler、dashboard refresh 都能传递并持久化 `workspace_id / knowledge_base_id / kb_snapshot_id / deploy_hash / actor_claims`。
16. **单项目单例清理完成**：生产主路径中的 `getCurrentProject()` 调用为 0，或只剩文档化 compatibility shim，且不再参与 ask / run_sql / scheduler / dashboard refresh 默认决策。
17. **扩展不被锁死**：当前 auth / policy / skill 设计都已为 SSO/OIDC、row/column policy、更多 skill/runtime 治理能力保留扩展槽。

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| 单 project 假设散布过多，改造范围失控 | 高 | 先做 Phase 0 scope inventory，禁止在新代码里继续引入 `getCurrentProject()` 风格接口 |
| 完全移除 Project 命名后，运行态身份设计不稳，导致线程/看板/调度无法绑定正确语义版本 | 高 | 用 `kb_snapshot_id + deploy_hash` 取代 project 语义，并优先打通全链路传递 |
| deepagents 直接接管 ask 主路径导致效果回退 | 高 | 用 `ASK_RUNTIME_MODE` 回退开关、golden regression、shadow/trace compare 控制上线 |
| PostgreSQL + pgvector 直接切换影响召回质量或运维稳定性 | 高 | 在切主路径前完成导入脚本、基准测试、回滚快照与压测 |
| 内建账号体系未预留企业身份接入，后续重写 | 中 | 设计 `auth_identity` + `identity_provider_config` + claims mapping interface |
| 用户自定义 skill 绕过权限或返回不可控结果 | 高 | 统一 skill contract、claims/secret 注入、输出归一、trace/audit 与 deny-by-default |
| knowledge base 与 kb_snapshot 边界不清，导致 UI/DTO 泄漏内部概念 | 高 | 统一 DTO 和路由命名，内部只在 runtime contract 中保留 `kb_snapshot_id` |

## Verification Steps
1. 审查 migration 与 compose/config，确认默认主路径完全使用 PostgreSQL + pgvector，而不是 sqlite/qdrant。
2. 为 built-in auth、workspace membership、session 生命周期写单测和集成测试。
3. 对当前 ask 主链路建立 golden regression：historical -> retrieval -> SQL generation -> correction -> chart generation。
4. 验证 deepagents 主编排 + legacy fallback：在 `ASK_RUNTIME_MODE=deepagents` 与 `legacy` 下都能跑通核心问数案例。
5. 为用户自定义 skill 建 integration tests：claims 注入、secret 注入、API/DB 访问、输出 normalization、mixed answer。
6. 验证 secret 加密/解密、`key_version` 写入与离线重加密脚本可用。
7. 做 workspace / knowledge_base 隔离 e2e 测试，验证跨租户、跨知识库访问被拒绝。
8. 验证 dashboard refresh 使用 dashboard 自身绑定的 runtime identity，而不是 `getCurrentProject()`。
9. 验证站内 schedule job 有审计日志、trace_id、失败可重试。
10. 验证 payload propagation：UI adaptor -> AI service request model -> semantics preparation -> retrieval/indexing filter -> scheduler/background tracker，identity contract 全链路不丢字段。
11. 验证 deny-by-default：当 actor_claims 或 knowledge base scope 缺失时，SQL 与 skill 路径都拒绝执行。
12. 验证产品层已隐藏 Project：主导航、主要 CRUD、站内术语都只暴露 knowledge base。
13. 验证 `getCurrentProject()` 清理结果：对 API handlers / resolvers / services / backgrounds 四类生产主路径做静态扫描，结果为 0 或只命中 compatibility shim 白名单。

## ADR
- **Decision**：采用“Wren Engine 保留 + deepagents 尽快接管 ask orchestration + knowledge-base-only 产品层 + built-in auth 优先 + PostgreSQL/pgvector 直切”的渐进式方案，并且**内部也不保留 Project 命名，改用 `kb_snapshot` 作为运行态身份**。
- **Drivers**：用户已明确要求内建账号、知识库优先、workspace/knowledge_base 权限、站内 schedule、PostgreSQL + pgvector、deepagents 替换 ask，并明确 skill 由用户编写，可连 API 或 DB；当前代码单 project 假设明显；现有 retrieval/provider/engine 栈具备复用价值（`wren-ui/src/apollo/server/repositories/projectRepository.ts:199-208`, `wren-ai-service/src/globals.py:115-215`, `docker/config.example.yaml:67-168`）。
- **Alternatives considered**：
  - Option A：继续让 legacy AskService 主导，只加轻量 router。
  - Option C：deepagents 主导且同步移除 Haystack/Hamilton 大量旧栈。
- **Why chosen**：Option B-prime 同时满足“尽快替换 ask 编排”和“避免整栈重写”两个目标；它把最该改的主脑先换掉，但保留 Wren Engine 与底层生成/检索能力，并允许用户 skill 自由定义数据访问方式。
- **Consequences**：短期内 ask 主链路改造风险上升；需要 feature flag、golden regression、trace compare 与回滚演练；PostgreSQL + pgvector 直切比 staged migration 工作量更大，但部署拓扑更简单；row/column policy 与 SSO/OIDC 将进入后续 phase，而不是 V1 首发门槛；skill runtime 还需要额外的治理与审计设计。
- **Follow-ups**：Phase 0 先完成 auth/runtime/skill/storage 四份合同；Phase 4 再根据商用需求打开 SSO/OIDC、row/column policy、skill 沙箱与审核流。

## Available-Agent-Types Roster
- `planner`：细化执行任务、拆 story
- `architect`：审查模块边界、schema、runtime 设计
- `critic`：审查 plan / acceptance / verification
- `executor`：具体实现
- `debugger`：迁移、runtime、scheduler 故障分析
- `test-engineer`：测试策略、回归矩阵
- `security-reviewer`：RBAC、row/column policy、越权路径审查
- `dependency-expert`：deepagents / pgvector / auth 方案对比
- `writer`：补文档和迁移说明
- `verifier`：最终验收与证据归档

## Follow-up Staffing Guidance

### If executed via `$ralph`
- Lane 1（high, `architect` / `planner`）：先落 schema、scope model、policy model。
- Lane 2（high, `executor`）：`wren-ui` 控制面与 metadata migration。
- Lane 3（high, `executor`）：`wren-ai-service` runtime orchestration。
- Lane 4（medium, `test-engineer` + `security-reviewer`）：补权限与回归测试。
- Lane 5（medium, `verifier`）：阶段性验收与 evidence 收集。

### If executed via `$team`
建议至少 4 条 worker lane：
1. **Control plane lane**：UI IA、routes、repos、migrations。
2. **Runtime lane**：ask orchestration、skill router、policy compiler。
3. **Dashboard/governance lane**：multi-dashboard、schedule、audit。
4. **QA lane**：migration、integration、e2e、security review。

## Launch Hints
```bash
# 顺序执行
$ralph ".omx/plans/ralplan-wrenai-v1-rebuild.md"

# 团队并行执行
$team ".omx/plans/ralplan-wrenai-v1-rebuild.md"
# 或
omx team start .omx/plans/ralplan-wrenai-v1-rebuild.md
```

## Team Verification Path
1. Control plane lane 证明：workspace / knowledge base / asset CRUD + context switching 可用。
2. Runtime lane 证明：skill-first + NL2SQL fallback + mixed query trace 可用。
3. Dashboard/governance lane 证明：多 dashboard、schedule、policy enforcement 可用。
4. QA lane 证明：migration、integration、e2e、security case 通过。
5. Ralph/leader 最终证明：默认部署以 PostgreSQL + pgvector 为主路径；无 `getCurrentProject()` 残余作为主流程依赖；核心问数链路无回归。

## Open Questions
1. 当前已无新的阻塞性产品决策；剩余实现细节在 Phase 0 设计中继续收敛。

## Consensus Changelog
- 初版采用保守的渐进式架构；本轮已改为 **Option B-prime**，即 deepagents 尽快接管 ask orchestration。
- 已按你的要求去掉内部 Project 命名，改为中性的 `kb_snapshot`；产品层和实现层都不再把 Project 作为正式概念。
- 已新增 built-in auth 优先、SSO/OIDC 扩展预留的方案约束。
- 已把 skill 明确定义为“用户自定义执行单元”，它可以连 API，也可以直接连数据库或封装 agent 流程。
- 已把权限范围从首发 row/column 治理收敛为 workspace / knowledge_base 级 deny-by-default，并保留后续扩展合同。
- 已确认 thread 首期只做个人私有，并且与 knowledge base 强绑定；同一 thread 禁止切换知识库。
- 已确认 runtime 版本模型改名为 `kb_snapshot`，并直接支持多环境 / 多版本并存。
- 已确认 V1 UI 先通过统一 `kb_snapshot` selector 暴露版本/环境选择。
- 已确认 skill runtime 按 deepagents 官方推荐走隔离执行，而不是开放执行。
- 已确认 secret 先做应用层加密 + 环境主密钥，V1 不做自动轮换，但预留 `key_version` 与重加密脚本。
- 已确认知识召回采用结构化优先 + 向量兜底。
- 已确认 schedule 执行器采用 DB-backed job + 独立 worker。
- 已把存储策略从 staged pgvector 改为 PostgreSQL + pgvector 直切，并补充迁移/回滚要求。
- 已把定时报表范围收敛为站内 schedule / 站内查看，不做邮件/IM 分发。
- 已保留 `getCurrentProject()` 的 repo-wide inventory、五类迁移桶和清零/compatibility shim 退出标准。
- 已更新 canonical runtime identity contract，覆盖 UI adaptor、AI service、retrieval/indexing、scheduler、dashboard refresh 全链路。
