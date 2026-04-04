# PRD — WrenAI V1 重构

## 1. 目标
在现有 WrenAI 工程上，完成一版面向商用演进的 V1 重构基线：
- 产品显式对象只保留 `workspace` 与 `knowledge_base`
- 运行态使用 `kb_snapshot` 承接版本/环境/manifest 绑定
- 内建账号体系先落地，同时保留未来企业 SSO/OIDC 扩展位
- Ask 主编排尽快切到 `deepagents`，Wren Engine 继续保留为语义层与 SQL 执行底座
- 主存储直接统一到 PostgreSQL + pgvector

## 2. 输入与约束
### 2.1 输入文档
- `docs/需求V1.md`
- `docs/refer_dula/*`
- `.omx/plans/ralplan-wrenai-v1-rebuild.md`

### 2.2 已冻结决策
1. 内建账号优先，预留 SSO/OIDC 扩展。
2. 产品层不再保留 Project 命名。
3. thread 首期只做个人私有，并且创建时强绑定知识库与 snapshot。
4. skill 由用户定义，可连 API、DB，也可自己封装 agent 流程。
5. skill runtime 按 deepagents 最佳实践走隔离执行，V1 先做 Python-only。
6. secret 采用应用层加密 + 环境主密钥，V1 不做自动轮换。
7. 知识召回采用结构化优先 + 向量兜底。
8. schedule 先做站内，执行器采用 DB-backed job + 独立 worker。
9. Ask 编排尽快切到 deepagents，并保留 `ASK_RUNTIME_MODE=legacy|deepagents` 回退开关。

## 3. V1 范围
### 3.1 In Scope
- workspace / user / auth / knowledge_base / kb_snapshot 基础域模型
- built-in auth + session
- knowledge base 级资产管理：connector / skill / glossary / analysis rule / SQL template
- 多 dashboard
- 站内 schedule
- ask runtime identity 统一
- deepagents ask orchestrator 主路径
- PostgreSQL + pgvector 主路径

### 3.2 Out of Scope
- 企业 SSO/OIDC 真正接入
- row / column policy 真正执行
- 多语言 skill runtime
- 邮件/IM 推送
- 协作 thread / 共享 thread
- 自动 secret 轮换 / KMS / Vault 集成

## 4. 用户主路径
1. 用户登录实例，进入自己可访问的 workspace。
2. 在 workspace 下选择 knowledge base。
3. 在 knowledge base 内选择一个 `kb_snapshot` 作为当前运行态上下文。
4. 用户发起问答、查看 dashboard、配置站内 schedule。
5. ask runtime 先在 skill / asset / rule 范围内规划，查不到再回落 Wren Engine 语义 SQL 路径。
6. 每次 ask / dashboard refresh / schedule run 都显式绑定 `workspace_id + knowledge_base_id + kb_snapshot_id + deploy_hash`。

## 5. 核心域模型
### 5.1 新对象
- `workspace`
- `user`
- `auth_identity`
- `auth_session`
- `workspace_member`
- `knowledge_base`
- `kb_snapshot`
- `connector`
- `secret_record`
- `skill_definition`
- `skill_binding`
- `asset`
- `glossary_term`
- `analysis_rule`
- `sql_template`
- `dashboard`
- `dashboard_item`
- `thread`
- `thread_response`
- `asking_task`
- `schedule_job`
- `schedule_job_run`
- `api_history`
- `audit_event`

### 5.2 产品边界
- `workspace`：租户隔离与成员边界。
- `knowledge_base`：用户看得见、运营得动的核心对象。
- `kb_snapshot`：仅作为运行态快照；V1 UI 只提供统一 selector，不拆环境/版本双层 UI。
- `connector`：连接信息与 secret 绑定。
- `skill_definition`：用户编写的能力单元。
- `asset`：table / view / api / semantic-model / metric 等统一资源抽象。

## 6. Canonical Runtime Identity
### 6.1 标准字段
- `workspace_id`
- `knowledge_base_id`
- `kb_snapshot_id`
- `deploy_hash`
- `actor_claims`
- `thread_id` / `dashboard_id` / `schedule_job_id`（按调用来源可选）

### 6.2 规则
1. 浏览器不直接提交任意 `actor_claims`；由 control plane 从 session 解析并注入。
2. UI -> Apollo -> adaptor -> AI service 全链路统一传递同一套 runtime identity。
3. thread / dashboard / schedule 创建时固化 `knowledge_base_id + kb_snapshot_id + deploy_hash`，后续不漂移。
4. 兼容期允许保留旧 `id`/`project_id` alias，但只作为 shim，不能再作为主路径唯一上下文。

## 7. Phase 0 可执行工作分解

### Story 0.1 — 冻结 control plane schema
**目标**：把新域模型的表结构、主键策略、外键关系、兼容字段一次定清。

**关键触点**
- 现有：`wren-ui/migrations/20240125070643_create_project_table.js`
- 现有：`wren-ui/migrations/20240319083758_create_deploy_table.js`
- 现有：`wren-ui/migrations/20250511000000-create-api-history.js`
- 新增：`wren-ui/migrations/20260xxxxxxx_create_workspace_and_auth_tables.js`
- 新增：`wren-ui/migrations/20260xxxxxxx_create_knowledge_base_tables.js`

**冻结内容**
- 新表使用 UUID 主键。
- `kb_snapshot` 保留 `legacy_project_id` 兼容桥接字段，供迁移期映射旧 `project.id`。
- `deploy_hash` 从 `deploy_log.hash` 升级为所有在线执行链路的一等身份字段。
- `api_history`、thread、dashboard、schedule 统一带 runtime identity 快照。

**完成标准**
- ERD 定稿。
- 所有新表和旧表兼容映射关系写清。
- 明确哪些旧表保留、哪些仅作迁移桥。

### Story 0.2 — 冻结 auth / session contract
**目标**：明确 built-in auth 的数据模型、session 生命周期和未来 OIDC 扩展槽。

**关键触点**
- 现有：`wren-ui/src/apollo/server/types/context.ts`
- 现有：`wren-ui/src/common.ts`
- 新增：`wren-ui/src/apollo/server/repositories/userRepository.ts`
- 新增：`wren-ui/src/apollo/server/repositories/authSessionRepository.ts`
- 新增：`wren-ui/src/apollo/server/services/authService.ts`

**冻结内容**
- `user`：账号主档。
- `auth_identity`：provider 维度身份记录；`provider_type=local|oidc`。
- `auth_session`：session token hash、过期时间、撤销时间、最近活跃时间。
- `workspace_member`：workspace 成员关系与 role。
- session cookie / bearer token 二选一的服务端消费方式。
- 首个 owner 用户 bootstrap 机制（初始化管理员）与密码重置入口最小闭环。

**完成标准**
- 登录、登出、session 校验、claims 解析 contract 定稿。
- `identity_provider_config` 扩展槽写入 schema 说明，但 V1 不启用。

### Story 0.3 — 清理 current project 单例假设
**目标**：让 runtime context 从 `getCurrentProject()` 迁出，改成显式 scope resolver。

**关键触点**
- `wren-ui/src/apollo/server/repositories/projectRepository.ts`
- `wren-ui/src/apollo/server/services/projectService.ts`
- `wren-ui/src/pages/api/v1/ask.ts`
- `wren-ui/src/pages/api/v1/generate_sql.ts`
- `wren-ui/src/pages/api/v1/run_sql.ts`
- `wren-ui/src/pages/api/v1/stream/ask.ts`
- `wren-ui/src/apollo/server/services/dashboardService.ts`
- `wren-ui/src/apollo/server/backgrounds/dashboardCacheBackgroundTracker.ts`

**冻结内容**
- 引入 `RuntimeScopeResolver`，解析 session + request 中的 `workspace_id / knowledge_base_id / kb_snapshot_id / deploy_hash`。
- API handlers / resolvers / services / backgrounds 四类主路径都不再兜底读取“第一条 project”。
- 定义 compatibility shim 生命周期：仅迁移窗口内保留，且不得进入 ask/run_sql/schedule/dashboard refresh 主流程。

**完成标准**
- Phase 0 列出所有高风险调用点与迁移顺序。
- `getCurrentProject()` 只剩 compatibility shim 说明，不再是默认路径。

### Story 0.4 — 定稿 knowledge base / snapshot contract
**目标**：让 `knowledge_base` 与 `kb_snapshot` 的职责清晰，不再混淆产品对象与运行态对象。

**关键触点**
- `wren-ui/src/apollo/server/services/mdlService.ts`
- `wren-ui/src/apollo/server/services/deployService.ts`
- `wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts`
- `wren-ai-service/src/web/v1/services/semantics_preparation.py`

**冻结内容**
- `knowledge_base` 管运营对象。
- `kb_snapshot` 管 manifest/deploy/runtime identity。
- `deploy_hash` 与 `kb_snapshot_id` 必须同时存在，不能只靠单字段推导。
- V1 UI 用统一 snapshot selector；内部 schema 允许同时记录 `environment` 与 `version_label`。

**完成标准**
- deploy、ask、dashboard、schedule 的绑定字段全部定义完。
- legacy project -> knowledge_base + kb_snapshot 的映射策略定稿。

### Story 0.5 — 冻结 skill contract 与 isolated runner contract
**目标**：让用户 skill 的输入、输出、secret 注入、隔离执行协议一次定清。

**关键触点**
- `wren-ai-service/src/web/v1/services/ask.py`
- `wren-ai-service/src/globals.py`
- 新增：`wren-ai-service/src/core/skill_runner/*`
- 新增：`wren-ai-service/src/core/skill_contract.py`
- 新增：`wren-ui/src/apollo/server/services/skillService.ts`

**冻结内容**
- 输入：`query`, `runtime_identity`, `actor_claims`, `connectors`, `secrets`, `history_window`, `skill_config`。
- 输出归一：`tabular_frame | metric_series | text | chart_spec | citation_bundle | error`。
- 执行方式：Python-only isolated worker/container。
- 控制项：timeout、max memory、network allowlist、审计 trace。

**完成标准**
- skill manifest 定稿。
- 主 ask 服务与 skill runner 的 RPC/queue contract 定稿。
- 明确 skill 失败时如何回退到内建 NL2SQL 路径。

### Story 0.6 — 冻结 secret encryption contract
**目标**：明确密文存储格式、解密边界和重加密机制。

**关键触点**
- 现有：`wren-ui/migrations/20240125070643_create_project_table.js`
- 现有：`wren-ui/migrations/20240530062133_update_project_table.js`
- 新增：`wren-ui/src/apollo/server/services/secretService.ts`
- 新增：`scripts/re_encrypt_secrets.ts`

**冻结内容**
- `secret_record` 至少包含：`id`, `workspace_id`, `ciphertext`, `iv`, `auth_tag`, `aad`, `key_version`, `created_by`, `updated_at`。
- 主密钥由环境注入。
- 应用层完成加解密，不把明文 secret 写入 DB。
- 离线重加密脚本从旧 `key_version` 批量迁到新版本。

**完成标准**
- connector / skill secret 的存储与引用方式定稿。
- 明确审计日志中哪些字段永不落明文。

### Story 0.7 — 定稿 deepagents ask orchestrator ADR
**目标**：把 deepagents 接管 ask 的边界、回退策略和集成方式写清。

**关键触点**
- `wren-ai-service/src/web/v1/services/ask.py`
- `wren-ai-service/src/globals.py`
- `wren-ai-service/src/core/pipeline.py`
- `wren-ai-service/src/providers/llm/litellm.py`
- `wren-ai-service/src/providers/embedder/litellm.py`

**冻结内容**
- `DeepAgentsAskOrchestrator` 作为 ask 主入口。
- legacy AskService 拆成 tools/subflows/fallback。
- `ASK_RUNTIME_MODE=legacy|deepagents`。
- `SkillRouter`、`AssetResolver`、`MixedAnswerComposer` 责任边界。
- Haystack/Hamilton 暂时保留为底层能力，不再做 ask 主脑。

**完成标准**
- ask 路线图、shadow run、golden regression、rollback 标准写清。

### Story 0.8 — 定稿 PostgreSQL + pgvector cutover
**目标**：在不做 staged migration 的前提下，把默认存储直接切到目标主路径。

**关键触点**
- `wren-ui/src/apollo/server/utils/knex.ts`
- `docker/docker-compose.yaml`
- `docker/config.example.yaml`
- `wren-ai-service/src/providers/__init__.py`
- `wren-ai-service/src/providers/document_store/qdrant.py`

**冻结内容**
- 默认 compose 不再依赖 sqlite/qdrant。
- pgvector provider 的注册、索引初始化、导数脚本与回滚快照策略。
- 旧数据导入与校验脚本。

**完成标准**
- 完整 cutover runbook。
- 回滚入口与验收指标定义完成。

### Story 0.9 — 定稿 thread / history / async task runtime binding
**目标**：把 thread、thread_response、asking_task、api_history 和异步 background tracker 的上下文绑定一次补齐。

**关键触点**
- `wren-ui/migrations/20240327030000_create_ask_table.js`
- `wren-ui/migrations/20250509000000_create_asking_task.js`
- `wren-ui/migrations/20250509000001_add_task_id_to_thread.js`
- `wren-ui/migrations/20250511000000-create-api-history.js`
- `wren-ui/src/apollo/server/backgrounds/textBasedAnswerBackgroundTracker.ts`
- `wren-ui/src/apollo/server/services/askingTaskTracker.ts`

**冻结内容**
- `thread` 创建时写入 `user_id + workspace_id + knowledge_base_id + kb_snapshot_id + deploy_hash`。
- `thread_response` / `asking_task` / `api_history` 全部补 runtime identity 快照字段。
- `textBasedAnswerBackgroundTracker`、`askingTaskTracker` 这类异步链路不得再运行时回查 current project。

**完成标准**
- thread/history/async 路径的上下文 contract 与迁移顺序明确。
- 异步任务恢复、取消、重试时不丢 runtime identity。

### Story 0.10 — 定稿 dashboard / schedule runtime binding
**目标**：把多 dashboard 和站内 schedule 的运行身份与执行器边界定清。

**关键触点**
- `wren-ui/src/apollo/server/services/dashboardService.ts`
- `wren-ui/src/apollo/server/backgrounds/dashboardCacheBackgroundTracker.ts`
- `wren-ui/migrations/20250423000000_create_dashboard_cache_refresh_table.js`
- 新增：`wren-ui/src/apollo/server/services/scheduleService.ts`
- 新增：`wren-ui/src/apollo/server/backgrounds/scheduleWorker.ts`

**冻结内容**
- `dashboard` 必须绑定 `knowledge_base_id + kb_snapshot_id + deploy_hash`。
- `schedule_job` 使用 DB-backed job 表，由独立 worker 消费。
- dashboard refresh 不再读取当前 project，而读取 dashboard 自己的 runtime binding。

**完成标准**
- schedule job schema、worker contract、审计字段和失败重试策略定稿。

## 8. Phase 1 实施顺序建议
1. schema 与 auth 先行。
2. runtime scope resolver 紧跟落地，先切掉 `getCurrentProject()` 主路径依赖。
3. 再切 knowledge base / snapshot / deploy identity。
4. 然后接 skill runner 与 secret service。
5. 最后再让 deepagents 接管 ask 主编排。

## 9. 上线门槛
- 默认部署主路径使用 PostgreSQL + pgvector。
- `getCurrentProject()` 不再参与生产 ask / run_sql / scheduler / dashboard refresh 默认决策。
- thread / dashboard / schedule 都固化 runtime identity。
- deepagents 已能跑通 golden regression，legacy 只作为 feature flag fallback。
- secret 不落明文，skill 运行在隔离 worker 中。

## 10. 本 PRD 的产出物
- `.omx/plans/phase0-wrenai-v1-execution.md`
- `.omx/plans/test-spec-wrenai-v1-rebuild.md`
- `.omx/plans/phase1-task-packages.md`
- `.omx/plans/ralplan-wrenai-v1-rebuild.md`
