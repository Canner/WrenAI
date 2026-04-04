# Phase 1 — 开发任务包拆分

## 1. 目的
把已经完成的方案拆解，进一步收敛成可以直接按 PR / lane 开工的任务包。
本文件回答四个问题：
1. 先做什么
2. 哪些能并行
3. 每包改哪些文件
4. 每包怎么验收

## 2. 总体原则
- `wren-engine` 暂时不改，继续按远程/外部依赖使用。
- 先拆 control plane 与 runtime identity，再碰 ask 主编排。
- 先把 `getCurrentProject()` 从主路径赶出去，再谈多知识库、多快照、多线程上下文。
- 先锁迁移与回滚，再切 PostgreSQL + pgvector 与 deepagents。

## 3. 任务包总览
| 包 | 名称 | 依赖 | 可并行 | 结果 |
|---|---|---|---|---|
| P1-01 | 基础 schema 与兼容桥接 | 无 | 否 | 新域模型 migration 草案与桥接策略 |
| P1-02 | 内建 auth / session / workspace 基线 | P1-01 | 是 | 登录、session、actor claims 基线 |
| P1-03 | runtime scope resolver 与 UI 控制面上下文 | P1-01,P1-02 | 否 | 不再靠 current project 推导上下文 |
| P1-04 | thread / history / async task 迁移 | P1-03 | 是 | thread/asking/api_history 固化 runtime identity |
| P1-05 | dashboard / schedule runtime binding | P1-03 | 是 | dashboard refresh / schedule 不再串库 |
| P1-06 | connector / secret service | P1-01,P1-02 | 是 | secret 加密与 connector 新模型 |
| P1-07 | skill 管理面与 isolated runner 壳层 | P1-03,P1-06 | 是 | skill_definition / binding / runner skeleton |
| P1-08 | AI service runtime identity 重构 | P1-03 | 是 | BaseRequest 与 web/services 不再以 project_id 为主索引 |
| P1-09 | deepagents ask orchestrator 接线 | P1-07,P1-08,P1-11 | 否 | deepagents 接管 ask 主入口 |
| P1-10 | PostgreSQL + pgvector 主路径切换 | P1-01,P1-08 | 是 | 默认部署不再依赖 sqlite/qdrant |
| P1-11 | 验证与回归基线 | P1-01 | 是 | golden regression / contract / static scan |

## 4. 推荐执行顺序
### 顺序主链
1. P1-01
2. P1-02
3. P1-03
4. 并行：P1-04 / P1-05 / P1-06 / P1-08 / P1-11
5. P1-07
6. P1-10
7. P1-09

### 并行 lane 建议
- Lane A：P1-01 → P1-02 → P1-03
- Lane B：P1-04 + P1-05
- Lane C：P1-06 + P1-07
- Lane D：P1-08 + P1-09
- Lane E：P1-11 全程跟跑
- Lane F：P1-10 在 schema 稳定后插入

---

## 5. 任务包详情

## P1-01 — 基础 schema 与兼容桥接
**目标**
- 把 workspace / auth / knowledge_base / kb_snapshot / connector / secret / thread / schedule / audit 这些核心表落成 migration 方案。
- 保留旧 `project`/`deploy_log` 的桥接字段与兼容导入位。

**主要触点**
- 现有：`wren-ui/migrations/20240125070643_create_project_table.js`
- 现有：`wren-ui/migrations/20240319083758_create_deploy_table.js`
- 现有：`wren-ui/migrations/20240327030000_create_ask_table.js`
- 现有：`wren-ui/migrations/20250423000000_create_dashboard_cache_refresh_table.js`
- 现有：`wren-ui/migrations/20250509000000_create_asking_task.js`
- 现有：`wren-ui/migrations/20250511000000-create-api-history.js`
- 新增：`wren-ui/migrations/20*_create_workspace_auth_kb_tables.js`
- 新增：`wren-ui/migrations/20*_create_connector_secret_skill_tables.js`
- 新增：`wren-ui/migrations/20*_create_schedule_audit_tables.js`

**输出**
- 新 migration 文件
- legacy bridge mapping 说明
- schema README / ERD 更新

**验收命令**
- `cd wren-ui && yarn check-types`
- `cd wren-ui && yarn migrate`
- `cd wren-ui && yarn rollback`

**完成标准**
- 新表结构可迁移、可回滚。
- `kb_snapshot_id + deploy_hash` 已能作为统一 runtime binding 基础字段。

---

## P1-02 — 内建 auth / session / workspace 基线
**目标**
- 补齐 user / auth_identity / auth_session / workspace_member 的 repository/service/context。
- 形成最小登录闭环：首个 owner bootstrap、登录、session 校验、登出。

**主要触点**
- `wren-ui/src/apollo/server/types/context.ts`
- `wren-ui/src/common.ts`
- 新增：`wren-ui/src/apollo/server/repositories/userRepository.ts`
- 新增：`wren-ui/src/apollo/server/repositories/authIdentityRepository.ts`
- 新增：`wren-ui/src/apollo/server/repositories/authSessionRepository.ts`
- 新增：`wren-ui/src/apollo/server/repositories/workspaceRepository.ts`
- 新增：`wren-ui/src/apollo/server/repositories/workspaceMemberRepository.ts`
- 新增：`wren-ui/src/apollo/server/services/authService.ts`
- 新增：`wren-ui/src/apollo/server/services/workspaceService.ts`
- 新增：`wren-ui/src/pages/api/auth/*`

**输出**
- built-in auth 最小闭环
- actor claims 解析函数
- owner bootstrap 机制

**验收命令**
- `cd wren-ui && yarn check-types`
- `cd wren-ui && yarn test --runInBand src/apollo/server/services/tests`

**完成标准**
- session 可解析出 `actorClaims`。
- workspace membership 能作为后续 runtime scope 的前置约束。

---

## P1-03 — runtime scope resolver 与 UI 控制面上下文
**目标**
- 让请求上下文从 “current project” 切换为 “workspace + knowledge_base + kb_snapshot + deploy_hash”。
- 先收敛控制面，不先碰 deepagents。

**主要触点**
- `wren-ui/src/apollo/server/repositories/projectRepository.ts`
- `wren-ui/src/apollo/server/services/projectService.ts`
- `wren-ui/src/apollo/server/types/context.ts`
- `wren-ui/src/common.ts`
- `wren-ui/src/pages/api/v1/ask.ts`
- `wren-ui/src/pages/api/v1/generate_sql.ts`
- `wren-ui/src/pages/api/v1/run_sql.ts`
- `wren-ui/src/pages/api/v1/stream/ask.ts`
- `wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts`
- 新增：`wren-ui/src/apollo/server/context/runtimeScope.ts`
- 新增：`wren-ui/src/apollo/server/context/actorClaims.ts`

**输出**
- `RuntimeScopeResolver`
- API / adaptor 新 DTO
- current project compatibility shim 方案

**验收命令**
- `cd wren-ui && yarn check-types`
- `cd wren-ui && yarn test --runInBand src/apollo/server/adaptors/tests/wrenAIAdaptor.test.ts`
- `cd wren-ui && yarn test --runInBand src/apollo/server/services/tests/askingService.test.ts`

**完成标准**
- ask / sql / chart / deploy 请求都能显式拿到 runtime identity。
- 新主路径不再必须调用 `getCurrentProject()`。

---

## P1-04 — thread / history / async task 迁移
**目标**
- 把 thread、thread_response、asking_task、api_history、answer background tracker 的上下文完全绑定到 runtime identity。

**主要触点**
- `wren-ui/migrations/20240327030000_create_ask_table.js`
- `wren-ui/migrations/20250509000000_create_asking_task.js`
- `wren-ui/migrations/20250509000001_add_task_id_to_thread.js`
- `wren-ui/migrations/20250511000000-create-api-history.js`
- `wren-ui/src/apollo/server/services/askingService.ts`
- `wren-ui/src/apollo/server/services/askingTaskTracker.ts`
- `wren-ui/src/apollo/server/backgrounds/textBasedAnswerBackgroundTracker.ts`
- `wren-ui/src/apollo/server/repositories/threadRepository.ts`
- `wren-ui/src/apollo/server/repositories/threadResponseRepository.ts`
- `wren-ui/src/apollo/server/repositories/apiHistoryRepository.ts`

**输出**
- 新 thread/history schema
- tracker 恢复/取消/重跑时使用持久化 runtime identity
- thread 不允许中途切知识库

**验收命令**
- `cd wren-ui && yarn check-types`
- `cd wren-ui && yarn test --runInBand src/apollo/server/services/tests/askingService.test.ts`

**完成标准**
- `textBasedAnswerBackgroundTracker` 不再回查 current project。
- `api_history` 持久化 actor + runtime scope。

---

## P1-05 — dashboard / schedule runtime binding
**目标**
- 去掉 single-dashboard + current project 假设。
- 让 dashboard refresh 与 schedule worker 按 dashboard 自身 binding 执行。

**主要触点**
- `wren-ui/src/apollo/server/services/dashboardService.ts`
- `wren-ui/src/apollo/server/backgrounds/dashboardCacheBackgroundTracker.ts`
- `wren-ui/src/apollo/server/repositories/dashboardRepository.ts`
- `wren-ui/src/apollo/server/repositories/dashboardItemRepository.ts`
- `wren-ui/src/apollo/server/repositories/dashboardItemRefreshJobRepository.ts`
- `wren-ui/migrations/20250102074255_create_dashboard_table.js`
- `wren-ui/migrations/20250102074256_create_dashboard_item_table.js`
- `wren-ui/migrations/20250423000000_create_dashboard_cache_refresh_table.js`
- 新增：`wren-ui/src/apollo/server/services/scheduleService.ts`
- 新增：`wren-ui/src/apollo/server/backgrounds/scheduleWorker.ts`

**输出**
- 多 dashboard 绑定到 KB/snapshot/deploy
- DB-backed schedule job + run records
- dashboard refresh runtime identity 固化

**验收命令**
- `cd wren-ui && yarn check-types`
- `cd wren-ui && yarn test --runInBand src/apollo/server/services/tests/dashboardService.test.ts`

**完成标准**
- refresh / schedule 不再依赖 current project。
- 同一 workspace 下多个 dashboard 不串知识库。

---

## P1-06 — connector / secret service
**目标**
- 从旧 `project.connection_info` / `credentials` 拆出 connector 与 secret_record。
- 实现应用层加解密、key_version、注入边界。

**主要触点**
- `wren-ui/src/apollo/server/repositories/projectRepository.ts`
- `wren-ui/migrations/20240125070643_create_project_table.js`
- `wren-ui/migrations/20240530062133_update_project_table.js`
- `wren-ui/migrations/20240530062809_transfer_project_table_data.js`
- 新增：`wren-ui/src/apollo/server/repositories/connectorRepository.ts`
- 新增：`wren-ui/src/apollo/server/repositories/secretRepository.ts`
- 新增：`wren-ui/src/apollo/server/services/secretService.ts`
- 新增：`wren-ui/src/apollo/server/services/connectorService.ts`
- 新增：`scripts/re_encrypt_secrets.ts`

**输出**
- connector/secret repository + service
- app-layer encryption contract
- re-encrypt 脚本

**验收命令**
- `cd wren-ui && yarn check-types`
- `cd wren-ui && yarn test --runInBand src/apollo/server/services/tests`

**完成标准**
- DB 不再持久化明文 secret。
- 后续 skill / runtime 可以按 secret id 注入，而不是读 project 原字段。

---

## P1-07 — skill 管理面与 isolated runner 壳层
**目标**
- 先落 skill_definition / skill_binding / control plane 管理接口。
- 再给 AI service 接一个 isolated runner skeleton，不在主服务里直接执行用户代码。

**主要触点**
- 新增：`wren-ui/src/apollo/server/repositories/skillDefinitionRepository.ts`
- 新增：`wren-ui/src/apollo/server/repositories/skillBindingRepository.ts`
- 新增：`wren-ui/src/apollo/server/services/skillService.ts`
- 新增：`wren-ui/src/pages/api/v1/skills/*`
- `wren-ai-service/src/globals.py`
- 新增：`wren-ai-service/src/core/skill_contract.py`
- 新增：`wren-ai-service/src/core/skill_runner/__init__.py`
- 新增：`wren-ai-service/src/core/skill_runner/runner_client.py`
- 新增：`wren-ai-service/src/core/skill_runner/models.py`

**输出**
- skill 管理接口
- runner request/response contract
- isolated execution skeleton

**验收命令**
- `cd wren-ui && yarn check-types`
- `cd wren-ai-service && poetry run pytest tests/pytest/services -q`

**完成标准**
- skill 可被注册、绑定到 knowledge base。
- AI service 可调用 runner 壳层并拿到标准化返回。

---

## P1-08 — AI service runtime identity 重构
**目标**
- 让 `wren-ai-service` 的 request model、services、retrieval filters 开始从 `project_id` 主索引过渡到 runtime identity。

**主要触点**
- `wren-ai-service/src/web/v1/services/__init__.py`
- `wren-ai-service/src/web/v1/services/ask.py`
- `wren-ai-service/src/web/v1/services/semantics_preparation.py`
- `wren-ai-service/src/web/v1/routers/ask.py`
- `wren-ai-service/src/web/v1/routers/semantics_preparation.py`
- `wren-ai-service/src/pipelines/retrieval/*`
- `wren-ai-service/src/pipelines/indexing/*`
- 新增：`wren-ai-service/src/core/runtime_identity.py`
- 新增：`wren-ai-service/src/web/v1/services/runtime_models.py`

**输出**
- `BaseRequest` / `AskRequest` / `SemanticsPreparationRequest` 新 contract
- `project_id` 到 `kb_snapshot_id` 的兼容 alias shim
- retrieval/indexing filter 新输入模型

**验收命令**
- `cd wren-ai-service && poetry run pytest tests/pytest/services/test_ask.py -q`
- `cd wren-ai-service && poetry run pytest tests/pytest/services/test_semantics_description.py -q`

**完成标准**
- web/service 主入口可消费 runtime identity。
- 不再把 `project_id` 当唯一运行态边界。

---

## P1-09 — deepagents ask orchestrator 接线
**目标**
- 让 deepagents 接 ask 主入口。
- legacy AskService 退成 tool/fallback。

**主要触点**
- `wren-ai-service/src/web/v1/services/ask.py`
- `wren-ai-service/src/globals.py`
- `wren-ai-service/src/core/pipeline.py`
- 新增：`wren-ai-service/src/core/deepagents_orchestrator.py`
- 新增：`wren-ai-service/src/core/tool_router.py`
- 新增：`wren-ai-service/src/core/mixed_answer_composer.py`
- 新增：`wren-ai-service/src/core/legacy_ask_tool.py`

**输出**
- `ASK_RUNTIME_MODE=legacy|deepagents`
- deepagents orchestrator
- fallback / trace compare / shadow run 接线

**验收命令**
- `cd wren-ai-service && poetry run pytest tests/pytest/services/test_ask.py -q`
- `cd wren-ai-service && poetry run pytest tests/pytest/test_usecases.py -q`

**完成标准**
- deepagents 成为 ask 主入口。
- 失败时能可靠回退到 legacy。

---

## P1-10 — PostgreSQL + pgvector 主路径切换
**目标**
- 改默认部署与 provider 配置，让主路径不再依赖 sqlite/qdrant。

**主要触点**
- `wren-ui/src/apollo/server/utils/knex.ts`
- `docker/docker-compose.yaml`
- `docker/config.example.yaml`
- `wren-ai-service/src/providers/__init__.py`
- `wren-ai-service/src/providers/document_store/qdrant.py`
- 新增：`wren-ai-service/src/providers/document_store/pgvector.py`
- 新增：`misc/pgvector/*` 或 `scripts/*`

**输出**
- pgvector provider
- docker/config 默认值切换
- 数据导入/回滚脚本

**验收命令**
- `cd wren-ui && yarn check-types`
- `cd wren-ai-service && poetry run pytest tests/pytest/providers -q`
- `docker compose -f docker/docker-compose.yaml config`

**完成标准**
- 默认 compose 配置不再要求 sqlite/qdrant。
- 检索链路能在 pgvector 上跑通。

---

## P1-11 — 验证与回归基线
**目标**
- 把 static scan、golden regression、contract test、smoke test 先立起来。
- 它不是收尾包，是从第一天就跟跑的包。

**主要触点**
- `wren-ui/src/apollo/server/services/tests/askingService.test.ts`
- `wren-ui/src/apollo/server/services/tests/dashboardService.test.ts`
- `wren-ui/src/apollo/server/adaptors/tests/wrenAIAdaptor.test.ts`
- `wren-ai-service/tests/pytest/services/test_ask.py`
- `wren-ai-service/tests/pytest/services/test_sql_pairs.py`
- 新增：`misc/scripts/scan-current-project.sh`
- 新增：`tests/fixtures/runtime_identity/*` 或等价目录

**输出**
- `getCurrentProject()` 静态扫描脚本
- ask golden regression baseline
- runtime identity propagation tests
- secret / dashboard / schedule binding tests

**验收命令**
- `cd wren-ui && yarn test --runInBand src/apollo/server/services/tests/askingService.test.ts`
- `cd wren-ui && yarn test --runInBand src/apollo/server/services/tests/dashboardService.test.ts`
- `cd wren-ai-service && poetry run pytest tests/pytest/services/test_ask.py -q`
- `bash misc/scripts/scan-current-project.sh`

**完成标准**
- 有证据证明每个后续包没有把 current project 又带回来。
- deepagents 切主路径前已有基线对照。

---

## 6. 依赖图（简写）
```text
P1-01
 ├─ P1-02
 │   └─ P1-03
 │       ├─ P1-04
 │       ├─ P1-05
 │       ├─ P1-08
 │       │   └─ P1-09
 │       └─ P1-07
 │           └─ P1-09
 ├─ P1-06
 │   └─ P1-07
 ├─ P1-10
 └─ P1-11
```

## 7. 建议 PR 粒度
- 每个任务包尽量控制在 1 个主目标，1 组主要目录，1 组核心测试。
- `P1-03`、`P1-08`、`P1-09` 不建议混到同一个 PR。
- `P1-04` 与 `P1-05` 可并行，但不要互相改同一批 migration 文件。
- `P1-10` 不要和 deepagents 接线混做，否则问题定位会非常差。

## 8. 现在的完成度判断
- **方案拆分：完成**
- **可开工任务包拆分：完成**
- **具体实现：未开始**
- **PR 逐包落地：下一步**

## 9. 下一步建议
直接从 `P1-01` 开始，随后连续推进 `P1-02` 和 `P1-03`。
原因很简单：只要 current project 还在主路径里，后面的 skill、schedule、deepagents 都是假的多知识库架构。
