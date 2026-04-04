# RALPLAN — WrenAI V1 改造方案（Draft）

## Meta
- Mode: `ralplan --consensus --deliberate`
- Scope: 基于 `docs/需求V1.md` 与 `docs/refer_dula/*`，在当前 WrenAI 代码基础上规划一版可执行的产品与架构改造路线。
- Planning only: 本文档只定义改造方案、分期和验证，不直接修改业务代码。

## RALPLAN-DR Summary

### Principles
1. **保留有效底座，避免整栈重写**：继续复用 Wren Engine 的语义层与 SQL 执行能力，而不是把其替换成全新的 agent runtime（`wren-engine/README.md:26-27`, `wren-engine/README.md:101-105`）。
2. **控制面与运行面分层**：把 workspace / knowledge base / asset / rule / dashboard 等管理能力放在 UI + metadata store，把问数编排、检索、NL2SQL、图表生成放在 AI service。
3. **统一资产抽象，兼容表和 API**：未来的数据来源不能只是假设为 project 下的数据库表；需要抽象为可以由 table source 或 API skill source 驱动的 asset。
4. **治理前置**：多租户、项目隔离、行列级权限、定时报表都要在模型和执行链路里显式建模，而不是后补过滤。
5. **渐进迁移**：先把单项目 OSS 改成多 workspace / 多 knowledge-base 的 SaaS 架构，再逐步把 deepagents 放进问数编排；一期不做大规模技术栈替换。

### Decision Drivers
1. **需求驱动**：V1 明确要求 workspace、多知识库、多数据源、术语表、PostgreSQL+pgvector、deepagents+skill、多个 dashboard、数据权限、定时报表（`docs/需求V1.md:2-11`）。
2. **现状约束**：当前 UI/服务几乎都围绕“当前 project”展开，且默认元数据库仍是 sqlite，不满足 SaaS 化与治理要求（`wren-ui/src/apollo/server/repositories/projectRepository.ts:185-208`, `docker/docker-compose.yaml:83-118`）。
3. **改造成本**：当前 AI service 已有 LiteLLM provider、Haystack 检索、Hamilton / Pipeline 组织方式；直接推翻重做风险高于渐进演进（`wren-ai-service/pyproject.toml:15-37`, `wren-ai-service/src/core/pipeline.py:14-37`, `wren-ai-service/src/providers/llm/litellm.py:22-166`）。

### Viable Options

#### Option A — deepagents 前置编排，保留 Wren Engine + 现有 retrieval/pipeline（推荐）
**Approach**：在 `wren-ai-service` 新增 agent orchestration / skill routing 层，先路由 API / skill 查询，命不中或不足时再回落到当前 retrieval + NL2SQL + chart generation 链路；Wren Engine 继续负责语义层与 SQL 执行。

**Pros**
- 复用现有 `AskService`、retrieval、LiteLLM provider、Wren Engine，迁移风险最低（`wren-ai-service/src/web/v1/services/ask.py:192-245`, `wren-ai-service/src/globals.py:115-166`, `wren-engine/ibis-server/README.md:1-2`）。
- 能较快支持“API 数据 + 表数据”混合问答。
- 便于分阶段验证 deepagents 的价值，而不是一次性替换核心链路。

**Cons**
- 一段时间内会出现“双编排”结构：agent router + 旧 pipeline 并存。
- 需要明确 skill 命中、fallback、权限和 observability 边界。

#### Option B — 用 deepagents 替换 AskService 编排，但保留 indexing / retrieval / Wren Engine
**Approach**：`AskService` 改成 deepagents 主流程，Haystack 仅做知识召回/索引，Wren Engine 继续执行 SQL。

**Pros**
- 运行链路更统一，问数编排更 agent-native。
- 后续扩展复杂多步查询、工具调用更自然。

**Cons**
- 需要重写当前 ask 状态机、缓存、pipeline 接口与部分 API 契约（`wren-ai-service/src/web/v1/services/ask.py:133-180`）。
- 切换成本明显高于 Option A。

#### Option C — deepagents 主导，Haystack/Hamilton 大幅退出
**Approach**：把 query routing、knowledge retrieval、tool use、memory 都迁到 deepagents，仅保留 Wren Engine 作为执行器。

**Pros**
- 技术叙事最统一。
- 长远看组件数更少。

**Cons**
- 对现有可运行链路破坏最大。
- 会同时触发检索、索引、问数、反馈、chart、评估链路重写，V1 风险过高。

### Recommendation
选择 **Option A**：**保留 Wren Engine；以 deepagents 作为前置编排层；Haystack/Hamilton 一期保留，后续再收缩**。

### Pre-mortem（deliberate mode）
1. **失败场景 1：多租户模型先天不清，导致单项目假设散落全栈，后续不停返工。**
   - 信号：`getCurrentProject()` 之类接口继续存在于 resolver/service/background 中（`wren-ui/src/apollo/server/repositories/projectRepository.ts:199-208`, `wren-ui/src/apollo/server/backgrounds/dashboardCacheBackgroundTracker.ts:104-108`）。
   - 预防：先完成 canonical domain model 和 scoped context resolver，再进入 UI 和 runtime 改造。
2. **失败场景 2：过早用 deepagents 替换整条 ask 链路，导致问数稳定性回退。**
   - 信号：历史问题召回、SQL pair / instruction 召回、chart 生成的回归无法快速定位（`wren-ai-service/src/globals.py:115-215`）。
   - 预防：一期只把 deepagents 放在 router/skill 层；原 retrieval/NL2SQL 链路继续保底。
3. **失败场景 3：权限只做在 UI 或 agent 层，执行层无约束，最终越权。**
   - 信号：行列级规则无法影响 Wren Engine/ibis 执行 SQL；API skill 返回数据未做 scope filter。
   - 预防：权限策略下沉到 metadata + runtime policy compiler，执行前统一注入。

### Expanded Test Plan（deliberate mode）
- **Unit**
  - scoped context resolver：workspace / knowledge base / project / asset 解析。
  - policy compiler：项目级、行级、列级规则编译。
  - skill router：API hit / table fallback / mixed answer 选择。
- **Integration**
  - metadata store 从 sqlite 迁到 PostgreSQL + pgvector 后的 migration / rollback。
  - ask 链路：skill 命中、NL2SQL fallback、chart generation、dashboard schedule。
  - asset onboarding：table source、API source、glossary/rule/sql template 索引生效。
- **E2E**
  - workspace A/B 隔离。
  - knowledge base 切换问数。
  - 多 dashboard、新建 schedule、权限受限用户问数。
- **Observability**
  - agent path 命中率、fallback rate、SQL success rate、permission deny rate、schedule success rate、vector retrieval latency。

## Requirements Summary
1. 新增 workspace 多租户、用户管理与权限管理（`docs/需求V1.md:2`）。
2. 一个 workspace 下支持多个知识库；每个知识库下支持多个数据源；用户可切换项目做问数和报表（`docs/需求V1.md:3`）。
3. 增加术语表，增强 NL2SQL 准确率（`docs/需求V1.md:4`）。
4. 默认采用 PostgreSQL + pgvector 存储（`docs/需求V1.md:5`）。
5. 使用 deepagents + skills 先查 skill，查不到再走 WrenAI 的 NL2SQL（`docs/需求V1.md:6`）。
6. 评估 Haystack/Hamilton 和 deepagents memory 的角色边界（`docs/需求V1.md:7-8`）。
7. Dashboard 支持多个看板（`docs/需求V1.md:9`）。
8. 数据权限支持项目隔离，以及行/列级隔离（`docs/需求V1.md:10`）。
9. 支持定时生成报表（`docs/需求V1.md:11`）。
10. 参考 UI 明显是 workspace / 知识库 / 资产 / 规则中心 / 数据看板 / 历史对话 / 定时任务的产品形态，而不是当前单 project 建模流（`docs/refer_dula/01.png` ~ `docs/refer_dula/11.png`）。

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

**Gap**：没有 API source / skill source 的统一执行抽象。

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
- `workspace_member`
- `role` / `permission`
- `knowledge_base`
- `project`（保留，但从“全局唯一 current project”改成 knowledge base 下的语义项目）
- `connector`
- `asset`（table / view / api / file / metric / semantic-model）
- `asset_binding`（asset 与 project / skill / connector 的映射）
- `glossary_term`
- `analysis_rule`
- `sql_template`
- `dashboard`
- `dashboard_item`
- `schedule_job`
- `data_policy`（project-level / row-level / column-level）

### Domain Boundary Clarification（关键补充）
- `workspace`：租户与权限隔离边界。负责成员、角色、系统级配置。当前代码中不存在这层抽象（代码搜索未见 workspace/member/auth domain；现有核心上下文仍是 project，`wren-ui/src/apollo/server/repositories/projectRepository.ts:199-208`）。
- `knowledge_base`：用户面对的知识运营边界。负责 connectors、assets、glossary、analysis rules、SQL templates、dashboards、schedules。它应映射参考设计中的“知识库”一级对象，而不是现有 project 替身（参考当前 Knowledge 页面仅有 SQL pair / instruction，`wren-ui/src/pages/knowledge/question-sql-pairs.tsx:127-194`, `wren-ui/src/pages/knowledge/instructions.tsx:168-233`）。
- `project`：**建议保留为运行态语义项目（runtime semantic project）**，而不是继续作为 UI 首要对象。它承接现有 model/relation/view/deploy/manifest 体系，因为当前这些表和服务都绑定 `project_id`（`wren-ui/migrations/20240125070643_create_project_table.js:6-53`, `wren-ui/migrations/20240125071855_create_model_table.js:7-56`, `wren-ui/migrations/20240125083821_create_relation_table.js:5-20`）。
- 结论：V1 应避免在产品层同时把 knowledge base 和 project 都做成并列一级导航；更合理的是 **knowledge base 对用户可见，project 对系统内部可见**。knowledge base 下可以有一个或多个 runtime project（如草稿版/发布版/分环境版）。

### Runtime Identity Contract（Phase 0 必须定稿）
当前链路存在两套身份：UI 到 AI service 的 ask/deploy 仍主要传 `id/deployId/hash`（`wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts:235-242`, `wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts:338-345`），而 AI service 的运行链路和 retrieval/indexing 仍主要按 `project_id` 过滤（`wren-ai-service/src/web/v1/services/__init__.py:57-66`, `wren-ai-service/src/web/v1/services/semantics_preparation.py:76-79`, `wren-ai-service/src/web/v1/services/ask.py:192-245`, `wren-ai-service/src/pipelines/retrieval/sql_pairs_retrieval.py:38-81`, `wren-ai-service/src/pipelines/retrieval/instructions.py:59-105`）。当前代码中 `project_id` 在 `wren-ai-service/src/web` 出现 **47** 次，在 `wren-ai-service/src/pipelines` 出现 **166** 次，说明这不是局部字段，而是运行时主索引。

因此 Phase 0 必须统一为一套 canonical contract：
- `workspace_id`：租户与授权边界
- `knowledge_base_id`：知识运营边界
- `runtime_project_id`：运行态语义项目 / environment 标识
- `deploy_hash`：对应 manifest 版本
- `actor_claims`：`user_id`、`workspace_member_id`、角色/权限快照
- `thread_id` / `dashboard_id` / `schedule_job_id`：调用来源上下文

**落地规则**
1. UI / Apollo / adaptor 层不得再只传 `id`；要显式传 `runtime_project_id + deploy_hash + actor_claims`。
2. AI service 的 `BaseRequest`、`AskRequest`、`SemanticsPreparationRequest`、chart/sql answer 等请求模型统一接受这套身份合同；旧 `id` 仅作为兼容 alias，逐步删除（`wren-ai-service/src/web/v1/services/semantics_preparation.py:16-22`, `wren-ai-service/src/web/v1/services/ask.py:22-33`）。
3. retrieval/indexing 仍可保留 `project_id` 物理字段，但语义上改名为 `runtime_project_id`；迁移期间允许双字段映射。
4. thread / dashboard / schedule 持久化时必须写入 `runtime_project_id + deploy_hash` 快照，禁止运行时再回退到 `getCurrentProject()`。

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
- workspace / member / role / permission 管理
- knowledge base / asset / connector 管理
- glossary / rule / sql template 管理
- dashboard / schedule 管理
- context selector（workspace / knowledge base / project/environment）

建议落点：
- 以 `wren-ui/src/common.ts` 为 composition root，拆出 workspace-scoped repositories / services（当前集中装配在 `initComponents()`，`wren-ui/src/common.ts:49-220`）。
- 重构 `wren-ui/src/utils/enum/path.ts` 和 `wren-ui/src/components/HeaderBar.tsx`，改成知识库工作台信息架构（`wren-ui/src/utils/enum/path.ts:1-15`, `wren-ui/src/components/HeaderBar.tsx:34-92`）。
- 新增 Apollo repository / resolver / service 层，而不是继续滥用 `getCurrentProject()`。

#### 2) Runtime Orchestrator（`wren-ai-service`）
职责：
- query router：判断走 API skill、table NL2SQL、还是 mixed answer
- context assembly：按 workspace / knowledge base / project 拉取 glossary / rule / sql template / policies
- retrieval：继续承担 SQL pairs / instructions / schema / historical question 召回
- NL2SQL fallback：保留现有 ask 生成/纠错链路
- chart plan / answer synthesis / tool result merge

建议落点：
- 在 `wren-ai-service/src/web/v1/services/ask.py` 前半段插入 `SkillRouter / ToolPlanner / AnswerComposer`，而不是直接重写整条 AskService（当前 ask 链路入口在 `wren-ai-service/src/web/v1/services/ask.py:133-245`）。
- 在 `wren-ai-service/src/globals.py` 增加新的 orchestration services 与 policy-aware retrieval service，并把原 ask/chart/sql_answer pipeline 包在新 runtime 后面（`wren-ai-service/src/globals.py:39-215`）。
- `src/core/pipeline.py` 保留，作为旧 pipeline 的兼容抽象；不要一期强拆（`wren-ai-service/src/core/pipeline.py:14-19`）。
- **职责边界收敛建议**：
  - `deepagents`：只负责在线 query orchestration、skill/tool routing、多步决策、mixed-result composition。
  - `Haystack`：继续负责向量检索与 document store 适配，尤其是 schema / SQL pair / instruction / docs retrieval。
  - `Hamilton`：当前仍直接承载在线 intent classification / SQL generation / SQL execution 等 pipeline substrate（`wren-ai-service/src/pipelines/generation/intent_classification.py:373-375`, `wren-ai-service/src/pipelines/generation/sql_generation.py:184-186`, `wren-ai-service/src/pipelines/retrieval/sql_executor.py:73-75`）。因此一期不能强行拔掉；更现实的目标是让 deepagents 变成外层 orchestrator，而不是与 Hamilton 并列抢主脑。
  - 这样可以避免一期出现两个“在线大脑”，同时避免为移除 Hamilton 额外引爆在线链路重写。

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
- metadata：PostgreSQL（一期必须）
- vector store：**目标默认是 pgvector，但落地节奏应拆开**：先引入 pgvector provider 与兼容测试，再替换当前 qdrant 默认。原因是当前 docker、example config、provider 注册、pipeline 默认值都深度绑定 qdrant（`docker/docker-compose.yaml:70-79`, `docker/config.example.yaml:67-168`, `wren-ai-service/src/providers/__init__.py:175-213`, `wren-ai-service/src/providers/document_store/qdrant.py:367-425`）。
- optional cache：按性能需求决定是否加 Redis；V1 非必须

## Recommended Technical Decisions

### Decision 1 — 保留 Wren Engine，不用 deepagents 替换语义层
**Why**：Wren Engine 已明确定位为 semantic engine，且当前 queryService 已围绕 manifest + SQL 接口集成（`wren-engine/README.md:26-27`, `wren-ui/src/apollo/server/services/queryService.ts:98-140`）。替换它不会直接解决 workspace、知识库、API source 等产品问题，反而扩大改造面。

### Decision 2 — deepagents 只作为前置编排层，不直接替换全部 Haystack/Hamilton
**Why**：当前 retrieval 与 generation pipeline 已跑通 Ask/Chart/SqlAnswer 多条链路（`wren-ai-service/src/globals.py:115-215`）。V1 最重要的是新增 skill routing、上下文拼装与权限治理，不是先推倒已有 pipeline。

**Boundary refinement**：
- deepagents 不负责 embedding / document store / schema indexing。
- Haystack 不负责高层 query routing 与 tool planning。
- Hamilton 在当前代码里仍承载在线 pipeline substrate；Phase 1 先保留现状，避免重写 ask 主链路。等 deepagents 外层 orchestrator 稳定后，再评估是否把 Hamilton 收缩到更偏 deterministic 的 pipeline。

### Decision 3 — 一期不启用开放式长期 memory，只做显式 scoped memory
建议：
- 保留会话历史（session/thread scoped）
- 知识资产显式化：glossary / rule / sql template / sql pair / instruction
- 如需 memory，只允许 workspace/project scoped short-term memory

**Why**：问数系统更适合“可审核知识资产”，不适合引入不可控 agent memory 影响 SQL 正确性。

### Decision 4 — 把“表数据”和“API 数据”统一成 asset，但执行方式保持双轨
- `asset.type = table | view | api | file | metric`
- `connector` 与 `asset` 分离：connector 描述连接方式；asset 描述可用业务对象；runtime capability 决定它能否 NL2SQL、direct fetch、materialize、chart。
- table/view 走 Wren Engine / ibis / NL2SQL
- api 走 skill/tool adapter
- mixed query 由 orchestrator 做 plan，再合成 answer / chart
- 图表能力不能假设 API 数据天然可画图；需要增加 normalization contract，把 API 返回统一成 tabular frame 或 metric series，再交给现有 chart generation（当前 chart service 默认基于 SQL executor 输出，`wren-ai-service/src/globals.py:187-204`）

**Why**：统一的是元数据和产品体验，不必强求底层执行统一。

### Decision 5 — 权限必须做成 policy compiler + runtime enforcement
- UI 只负责配置
- metadata store 持久化 policy
- runtime 负责把 policy 注入 SQL generation context、execution filters、API scope filters
- project / row / column policy 都要有统一 policy model

**Enforcement refinement**：
- **认证/成员资格** 在 control plane。
- **授权决策与 policy compilation** 在 runtime/control-plane shared policy service。
- **最终强制执行** 必须落到执行层：SQL 路径落到 Wren Engine / ibis 查询约束；API 路径落到 skill adapter/filter。不能只在 prompt 或 planner 层做“软约束”。
- 当前这点尚未成立：`IContext` 只有 project/query/dashboard 等服务，没有 user/policy 服务（`wren-ui/src/apollo/server/types/context.ts:42-84`）；`ask`/`run_sql` API 直接通过 `getCurrentProject()` 进入执行（`wren-ui/src/pages/api/v1/ask.ts:53-92`, `wren-ui/src/pages/api/v1/run_sql.ts:60-80`）。

**Compiler target（必须明确）**：
1. **SQL 路径主目标**：把 `data_policy` 编译进 Wren Engine 可消费的 MDL 安全结构，优先落到 `rls/cls` 能力上。Wren Engine 已在 manifest/column 结构里暴露 `rls`/`cls`，builder 可写入 `RowLevelSecurity` / `ColumnLevelSecurity`，并已有 `cls` 评估逻辑（`wren-engine/wren-core-base/manifest-macro/src/lib.rs:166-182`, `wren-engine/wren-core-base/src/mdl/builder.rs:210-228`, `wren-engine/wren-core-base/src/mdl/cls.rs:24-37`）。
2. **SQL 路径传递方式**：优先生成 `scoped_manifest` 并随查询一起下发；当前 engine provider 每次查询都会发送 `manifestStr + connectionInfo + sql`，因此技术上允许按请求注入带安全裁剪的 manifest（`wren-ai-service/src/providers/engine/wren.py:175-181`）。
3. **SQL 路径兜底**：对暂时不能表达成 MDL `rls/cls` 的策略，runtime 先做 query-time guard / deny-by-default，直到 engine 侧能力补齐。
4. **API 路径目标**：生成 `api_scope_filter_contract`，在 skill adapter 内完成参数裁剪、结果过滤、字段脱敏与拒绝返回。
5. **审计要求**：无论 SQL 还是 API，命中的 policy、被拒绝的原因、裁剪后的 scope 都要进入 trace / audit log。
6. **发布门槛**：skill-first hybrid runtime 不得先于 deny-by-default policy enforcement 上线；最晚必须在 Phase 2 GA 前落地 SQL 与 API 两条路径的硬授权。

## Implementation Plan

### Phase 0 — 基线建模与防返工准备
**Objective**：在不动核心业务逻辑的前提下，先建立正确的域模型和 scope 边界。

**Primary touchpoints**
- `wren-ui/src/apollo/server/repositories/projectRepository.ts:185-208`
- `wren-ui/src/apollo/server/resolvers/projectResolver.ts:70-107`
- `wren-ui/src/common.ts:49-220`
- `wren-ui/src/apollo/server/backgrounds/dashboardCacheBackgroundTracker.ts:61-108`
- `wren-ui/migrations/20240125070643_create_project_table.js:6-53`
- `wren-ui/migrations/20240125071855_create_model_table.js:7-56`
- `wren-ui/migrations/20240125083821_create_relation_table.js:5-20`

**Tasks**
1. 定义 canonical domain schema：workspace / knowledge base / asset / policy / schedule / dashboard。
2. 明确 `workspace -> knowledge_base -> runtime project` 三层边界，并决定 project 是否对终端用户隐藏。
3. 设计 scoped context resolver，替代 `getCurrentProject()` 这种全局单例语义。
4. 定义 canonical runtime identity contract：`workspace_id / knowledge_base_id / runtime_project_id / deploy_hash / actor_claims`。
5. 明确 policy compiler target：SQL 侧编译到 Wren Engine MDL `rls/cls` + query-time guard，API 侧编译到 skill adapter filter contract。
6. 做 `getCurrentProject()` scope inventory，按 API handlers / resolvers / services / backgrounds / repository 五个桶列出迁移清单。
7. 增加 `deepagents` 设计/依赖 spike：当前仓库没有 deepagents 代码或依赖，只有需求文档提到该方向（`docs/需求V1.md:6-8`）。默认评估候选为 **LangChain `deepagents` Python SDK**；需要先产出 package 选择、tool/skill adapter surface、rollback 开关（如 `ASK_RUNTIME_MODE=legacy|hybrid`）与 observability 方案，再进入 Phase 2。
8. 补回归测试，锁定当前单 project 行为，避免后续改造引入不可见回归。
9. 明确 metadata migration strategy：sqlite -> PostgreSQL；qdrant -> pgvector 的兼容方案。

**Deliverables**
- ERD / migration design doc
- scope resolution spec
- runtime identity contract spec
- policy compiler target spec
- deepagents spike ADR / rollback plan
- compatibility test list

### Phase 1 — Metadata 和 SaaS 控制面改造
**Objective**：把产品从单 project OSS 改成 workspace / knowledge base 驱动。

**Primary touchpoints**
- `wren-ui/src/utils/enum/path.ts:1-15`
- `wren-ui/src/components/HeaderBar.tsx:34-92`
- `wren-ui/src/common.ts:49-220`
- `wren-ui/src/apollo/server/utils/knex.ts:8-30`
- `docker/docker-compose.yaml:83-118`
- `docker/config.example.yaml:67-168`
- `wren-ai-service/src/providers/__init__.py:175-213`
- `wren-ai-service/src/providers/document_store/qdrant.py:367-425`
- `wren-ui/migrations/*.js`

**Tasks**
1. 把默认 metadata DB 切到 PostgreSQL；保留 sqlite 仅作 dev fallback 或彻底下线。
2. 新增 workspace/member/role/knowledge_base/connector/asset 等 migration 和 repository。
3. 新增认证与成员体系；若一期不接外部 SSO，至少先支持本地账号 + workspace membership。当前仓库尚无 user/workspace/rbac domain（`wren-ui/migrations` 中未见 user/workspace/role/member 表；`wren-ui/src/apollo/server/types/context.ts:42-84` 也无对应服务）。
4. 重构路由与导航：知识库、知识花园/规则中心、数据看板、历史对话、定时任务。
5. 设计 connector onboarding：数据库连接、API skill 注册、资产导入向导。
6. 将现有 knowledge 页面改造成 knowledge center：SQL pair、instruction、glossary、analysis rule、SQL template 五类资产并列。
7. 改造 UI / Apollo / adaptor 请求合同，让 ask / chart / SQL / scheduler / dashboard 路径都显式携带 `runtime_project_id + deploy_hash + actor_claims`，不再仅靠 legacy `id` alias（`wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts:235-242`, `wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts:338-345`）。

### Phase 2 — Query Runtime Hybrid 化（deepagents + Wren pipeline）
**Objective**：实现“先 skill / API，再 NL2SQL fallback”的运行链路。

**Primary touchpoints**
- `wren-ai-service/src/web/v1/services/ask.py:133-245`
- `wren-ai-service/src/globals.py:39-215`
- `wren-ai-service/src/core/pipeline.py:14-19`
- `wren-ai-service/src/providers/llm/litellm.py:22-166`
- `wren-ai-service/src/providers/embedder/litellm.py:165-201`
- `wren-ui/src/apollo/server/services/queryService.ts:98-140`

**Tasks**
1. **Phase 2 入口门槛**：只有当以下条件满足时，才允许上线 skill-first runtime：  
   - canonical runtime identity 已全链路打通；  
   - SQL 与 API 两条路径都已启用 deny-by-default policy enforcement；  
   - `getCurrentProject()` 在生产主路径上已清零，或只剩显式标注、受控的 compatibility shim。  
2. 新增 `SkillRouter`：根据 query、workspace context、knowledge base assets、policy 判断是否先走 skill/tool。
3. 新增 `AssetResolver`：把 connector + asset + capability 解析成可执行计划。
4. 在 Query Runtime 中落地 MVP policy compiler：  
   - SQL 路径生成 `scoped_manifest` / `rls/cls` / query-time guard；  
   - API 路径生成 `api_scope_filter_contract` 并在 skill adapter 中执行。  
5. 保留现有 retrieval：historical question、SQL pair、instruction、schema retrieval 继续服务 NL2SQL fallback。
6. 增加 API result normalization，把 API 返回变成 tabular frame / metric series，才能复用 chart generation。
7. 增加 mixed-answer composer：合并 skill 结果和 SQL 结果，输出 answer / chart-ready data。
8. 将 glossary / rule / sql template 注入 Ask runtime context，用于提高 NL2SQL 精度。
9. 引入 pgvector provider，并做与 qdrant 的召回/延迟/兼容对比；通过后再把 pgvector 设为默认向量存储。
10. 改造 AI service request/response 模型：从当前 `id/mdl_hash` alias 与 `project_id` 双轨状态，过渡为 canonical runtime identity contract，并打通 semantics preparation、retrieval filters、ask/chart/sql answer 链路（`wren-ai-service/src/web/v1/services/semantics_preparation.py:16-22`, `wren-ai-service/src/web/v1/services/__init__.py:57-66`）。

### Phase 3 — Governance、Dashboard、Schedule
**Objective**：把治理、多看板、定时任务补齐成可商用能力。

**Primary touchpoints**
- `wren-ui/src/apollo/server/services/dashboardService.ts:128-147`
- `wren-ui/src/apollo/server/backgrounds/dashboardCacheBackgroundTracker.ts:61-108`
- `wren-ui/migrations/20250102074255_create_dashboard_table.js:5-29`
- `wren-ui/migrations/20250102074256_create_dashboard_item_table.js:5-37`
- `wren-ui/migrations/20250423000000_create_dashboard_cache_refresh_table.js:1-35`

**Tasks**
1. 移除 single-dashboard 假设，支持 knowledge base / project 维度多个 dashboard。
2. 补 `schedule_job` 与 report delivery 抽象，不把 schedule 逻辑散落在 dashboard cache job 里。
3. 在已完成的 MVP policy compiler 基础上，扩展 project/row/column policy 到 dashboard、scheduler、审计与多角色运营流。
4. 为 dashboard refresh / report generation 增加审计日志与权限校验。
5. 把 dashboard refresh 的执行上下文从“当前 project”改为“dashboard 绑定的 runtime project”。

### Phase 4 — 稳定性、可观测性、技术收敛
**Objective**：在新架构跑稳后，再决定是否削减旧组件。

**Tasks**
1. 统计 skill hit rate、fallback rate、SQL correction retries、retrieval latency、schedule success rate。
2. 评估 Haystack 是否仍需承担全部 retrieval；如果 glossary/rules/template 已完全结构化，可逐步弱化对通用向量召回的依赖。
3. 评估 Hamilton 是否仍有必要作为 pipeline glue；若 deepagents orchestration 已稳定，再考虑替换部分流程。
4. 梳理 qdrant compatibility mode 是否保留。

## Acceptance Criteria
1. **多租户**：用户能在同一实例中创建/切换多个 workspace，且元数据与权限隔离可验证。
2. **知识库**：每个 workspace 至少可管理多个 knowledge base，每个 knowledge base 至少支持 1 个 table source 和 1 个 API source；若存在多个 runtime project/environment，用户可显式切换。
3. **知识增强**：glossary、analysis rule、SQL template 能进入问数上下文，并可通过回归测试证明对 SQL 生成有影响。
4. **默认存储**：Phase 1 默认 metadata 使用 PostgreSQL；Phase 2 在 provider parity 通过后，将向量存储默认切到 pgvector，并保留 qdrant 兼容模式。
5. **混合查询**：问数时可先命中 skill/API；未命中时自动回落到现有 NL2SQL 链路；两条路径都有 trace。
6. **多 dashboard**：同一 knowledge base / project 下可维护多个 dashboard，定时刷新不会串 project。
7. **权限治理**：项目级、行级、列级权限都能阻止越权 SQL 或越权 API 结果返回。
8. **定时报表**：可配置 schedule job，并记录任务状态、开始/结束时间、失败原因。
9. **兼容性**：现有单 project 体验在 migration 后仍可被兼容导入到新模型。
10. **边界清晰**：knowledge base 是用户一级对象，runtime project 是内部语义/发布对象；执行和权限判定都不再依赖“当前 project 第一条记录”语义。
11. **身份合同统一**：UI、Apollo adaptor、AI service、scheduler、dashboard refresh 都能传递并持久化 `workspace_id / knowledge_base_id / runtime_project_id / deploy_hash / actor_claims`。
12. **单项目单例清理完成**：生产主路径中的 `getCurrentProject()` 调用为 0，或只剩文档化的 compatibility shim，且不再参与 ask / run_sql / scheduler / dashboard refresh 的默认决策。

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| 单 project 假设散布过多，改造范围失控 | 高 | 先做 Phase 0 scope inventory，禁止在新代码里继续引入 `getCurrentProject()` 风格接口 |
| deepagents 与旧 pipeline 并存导致维护复杂 | 中 | 用明确 runtime boundary：router/tool planner 在前，legacy NL2SQL 在后 |
| pgvector 替换 qdrant 影响召回质量或性能 | 中 | 不与 metadata Postgres 迁移捆绑；先补 pgvector provider 和基准测试，再切默认 |
| 权限模型落不到执行层 | 高 | policy compiler 设计时同步覆盖 SQL runtime 与 skill runtime |
| UI 改造过大，节奏拖慢 | 中 | 先做信息架构与核心流程，视觉细节第二阶段跟进 |
| knowledge base 与 project 边界不清，导致模型层重复 | 高 | 明确 knowledge base 面向运营，project 面向运行/部署；若 V1 不需要多 runtime project，先隐藏 project UI |

## Verification Steps
1. 审查 migration 设计是否完全去掉默认 sqlite 路径。
2. 为 scope resolver、policy compiler、skill router 写单测。
3. 对当前 ask 主链路做回归测试：historical -> retrieval -> SQL generation -> correction。
4. 为 mixed query 建 integration tests：API hit、NL2SQL fallback、mixed composition。
5. 做 workspace 隔离和 row/column policy 的 e2e 测试。
6. 验证 dashboard refresh 使用 dashboard 自身上下文，而不是 `getCurrentProject()`。
7. 验证 schedule job 有审计日志、trace_id、失败可重试。
8. 验证 API result normalization 后可进入 chart generation，且失败时能清晰回退为表格/文本答案。
9. 验证 payload propagation：UI adaptor -> AI service request model -> semantics preparation -> retrieval/indexing filter -> scheduler/background tracker，identity contract 全链路不丢字段。
10. 验证 deny-by-default：当 actor_claims 或 policy 缺失时，SQL 与 API 路径都拒绝执行，而不是回退到宽松默认。
11. 验证 deploy hash / runtime_project_id mismatch：manifest 版本与 runtime project 不一致时显式失败，不允许静默查询错误版本语义模型。
12. 验证 `getCurrentProject()` 清理结果：对 API handlers / resolvers / services / backgrounds 四类生产主路径做静态扫描，结果为 0 或只命中 compatibility shim 白名单。

## ADR
- **Decision**：采用“Wren Engine 保留 + deepagents 前置编排 + PostgreSQL metadata 默认化 + pgvector staged migration + SaaS 控制面重建”的渐进式方案。
- **Drivers**：需求包含多租户、权限、迁移、skill first 查询、多个 dashboard；当前代码单 project 假设明显；现有 ask/retrieval/provider 栈具备复用价值（`docs/需求V1.md:2-11`, `wren-ui/src/apollo/server/repositories/projectRepository.ts:199-208`, `wren-ai-service/src/globals.py:115-215`）。
- **Alternatives considered**：
  - Option B：deepagents 替换 AskService 编排，但保留 retrieval/Wren Engine。
  - Option C：deepagents 主导，Haystack/Hamilton 大幅退出。
- **Why chosen**：Option A 最符合 V1 的风险/收益比，能优先交付 SaaS 能力和 hybrid query，而不是陷入整栈重写。
- **Consequences**：短期内会保留两层编排；Phase 1 会出现 PostgreSQL metadata + qdrant retrieval 的过渡形态；需要更严密的 trace、policy 和 fallback 设计；还需要显式限制 deepagents/Haystack/Hamilton 的职责边界。
- **Follow-ups**：Phase 0 先完成 runtime identity contract、policy compiler target、deepagents spike；Phase 4 再根据实际命中率和复杂度决定是否继续收缩 Haystack/Hamilton。

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
1. 鉴权是直接内建账号体系，还是优先接企业 SSO / OIDC？
2. schedule 的交付目标只做站内 dashboard refresh，还是要发邮件/IM 报告？
3. API source 的连接器范围首期支持哪些协议：REST、GraphQL、内部 SDK、MCP tool？
4. glossary / rule / template 是都做向量检索，还是优先结构化召回？

## Consensus Changelog
- 初版采用保守的渐进式架构，避免 deepagents 一步替换整条 ask 链路。
- deliberate mode 已补 pre-mortem 与 expanded test plan。
- 已补充 workspace / knowledge base / runtime project 三层边界，避免把 `project` 继续作为产品一级对象。
- 已明确 pgvector 迁移节奏：metadata PostgreSQL 一期必须，vector store 先做 provider parity 再切默认。
- 已把权限 enforcement 边界收紧为 control plane + runtime policy service + execution layer 三段式，不接受仅在 prompt 层做软约束。
- 已补 `getCurrentProject()` 的 repo-wide inventory、五类迁移桶和清零/compatibility shim 退出标准。
- 已补 canonical runtime identity contract，覆盖 UI adaptor、AI service、retrieval/indexing、scheduler、dashboard refresh 全链路。
- 已将 deny-by-default policy enforcement 提前为 Phase 2 上线门槛，不允许 skill-first runtime 先于硬授权发布。
- 已补 deepagents Phase 0 spike、默认候选、feature flag rollback 与 observability 要求。
