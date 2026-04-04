# Phase 0 — WrenAI V1 详细实施拆解

## 1. 目标
把总方案从“方向正确”推进到“可以直接开工”。本阶段不大改业务行为，先冻结：
- schema
- runtime identity
- auth/session
- skill runner contract
- secret contract
- schedule worker contract
- deepagents 切主路径 ADR

## 2. 当前工程里最需要先处理的风险源
1. `wren-ui` 与 `wren-ai-service` 都默认围绕 `project_id` 运转。
2. `getCurrentProject()` 以“取第一条 project”为默认上下文，已经渗透到 API、service、background。
3. thread / ask / dashboard refresh / api_history 都没有统一的 runtime identity。
4. 连接信息和 secret 仍混在 `project.connection_info` / `credentials` 遗留模型里。
5. schedule 现在只是 dashboard refresh tracker，不是独立的 job worker。

## 3. 推荐执行顺序
1. 先定 schema 与 ID 策略。
2. 再定 runtime identity 与 context resolver。
3. 然后定 auth/session 与 actor claims。
4. 再定 knowledge_base / kb_snapshot / deploy 绑定。
5. 再定 secret / connector / skill contract。
6. 最后定 schedule worker 与 deepagents ask ADR。

---

## 4. Workstream A — Schema 冻结

### A.1 主键与兼容策略
- 新域对象统一 UUID 主键。
- 旧 `project.id`、`deploy_log.id` 可保留为兼容字段，不再作为对外 canonical ID。
- `kb_snapshot.legacy_project_id` 用于桥接迁移窗口。

### A.2 目标表设计

#### `workspace`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | workspace 主键 |
| slug | text unique | 路由/显示稳定标识 |
| name | text | workspace 名称 |
| status | text | active / disabled |
| settings | jsonb | 租户级配置 |
| created_by | uuid | 创建人 |
| created_at / updated_at | timestamptz | 时间戳 |

#### `user`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | 用户主键 |
| email | citext unique | 登录账号 |
| display_name | text | 展示名 |
| locale | text | 语言偏好 |
| status | text | active / invited / disabled |
| last_login_at | timestamptz | 最近登录时间 |
| created_at / updated_at | timestamptz | 时间戳 |

#### `auth_identity`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | 身份记录 |
| user_id | uuid fk | 对应 user |
| provider_type | text | local / oidc |
| provider_subject | text | provider 内 subject |
| password_hash | text nullable | 本地账号才有 |
| password_algo | text nullable | bcrypt / argon2 等 |
| email_verified_at | timestamptz nullable | 邮箱验证时间 |
| metadata | jsonb | 扩展字段 |

#### `auth_session`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | session id |
| user_id | uuid fk | 用户 |
| auth_identity_id | uuid fk | 登录来源 |
| session_token_hash | text | 服务端保存 hash |
| expires_at | timestamptz | 过期时间 |
| revoked_at | timestamptz nullable | 撤销时间 |
| last_seen_at | timestamptz | 最近访问 |
| ip_address | inet nullable | 审计 |
| user_agent | text nullable | 审计 |

#### `workspace_member`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | 成员关系 |
| workspace_id | uuid fk | workspace |
| user_id | uuid fk | user |
| role_key | text | owner / admin / member |
| status | text | active / invited / disabled |

#### `knowledge_base`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | 知识库 |
| workspace_id | uuid fk | 所属 workspace |
| slug | text | KB 稳定标识 |
| name | text | 名称 |
| description | text | 描述 |
| default_kb_snapshot_id | uuid nullable | 默认 snapshot |
| created_by | uuid | 创建人 |
| archived_at | timestamptz nullable | 归档时间 |

#### `kb_snapshot`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | 运行态快照 |
| knowledge_base_id | uuid fk | 所属知识库 |
| snapshot_key | text | 统一 selector 实际值 |
| display_name | text | 给用户看的名称 |
| environment | text nullable | dev/staging/prod，可不在 V1 UI 暴露 |
| version_label | text nullable | 版本名，可不在 V1 UI 拆分暴露 |
| deploy_hash | text | 当前 deploy hash |
| manifest_ref | jsonb | manifest 存储引用/摘要 |
| legacy_project_id | integer nullable | 旧 project 桥接 |
| status | text | active / archived / draft |

#### `connector`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | connector |
| workspace_id | uuid fk | workspace scope |
| knowledge_base_id | uuid fk nullable | 可选 KB 作用域 |
| type | text | postgres / mysql / rest_json / ... |
| display_name | text | 名称 |
| config_json | jsonb | 非 secret 配置 |
| secret_record_id | uuid nullable | 绑定 secret |
| created_by | uuid | 创建人 |

#### `secret_record`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | secret 主键 |
| workspace_id | uuid fk | 作用域 |
| scope_type | text | connector / skill / system |
| scope_id | uuid | 对应对象 |
| ciphertext | text | 密文 |
| iv | text | 初始化向量 |
| auth_tag | text | AEAD tag |
| aad | text nullable | 附加认证数据 |
| key_version | integer | 主密钥版本 |
| created_by | uuid | 创建人 |

#### `skill_definition`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | skill |
| workspace_id | uuid fk | workspace scope |
| name | text | 名称 |
| runtime_kind | text | isolated_python |
| source_type | text | inline / bundle |
| source_ref | text | 代码引用 |
| entrypoint | text | 执行入口 |
| manifest_json | jsonb | 能力声明 |
| created_by | uuid | 创建人 |

#### `skill_binding`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | skill 绑定 |
| knowledge_base_id | uuid fk | 绑定 KB |
| kb_snapshot_id | uuid fk nullable | 可选绑定到 snapshot |
| skill_definition_id | uuid fk | 对应 skill |
| connector_id | uuid nullable | 可选 connector |
| binding_config | jsonb | 运行配置 |
| enabled | boolean | 是否启用 |

#### `asset`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | 资产 |
| knowledge_base_id | uuid fk | 所属 KB |
| kb_snapshot_id | uuid fk nullable | snapshot 级资产 |
| kind | text | table / view / api / semantic-model / metric |
| display_name | text | 名称 |
| source_ref | jsonb | 来源引用 |
| metadata | jsonb | 扩展元数据 |

#### `dashboard`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | dashboard |
| knowledge_base_id | uuid fk | KB 作用域 |
| kb_snapshot_id | uuid fk | 绑定 snapshot |
| deploy_hash | text | 绑定 deploy |
| name | text | 名称 |
| created_by | uuid | 创建人 |

#### `schedule_job`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | job |
| workspace_id | uuid fk | workspace |
| knowledge_base_id | uuid fk | KB |
| kb_snapshot_id | uuid fk | snapshot |
| deploy_hash | text | deploy |
| target_type | text | dashboard_refresh / report_generation / ask_like |
| target_id | uuid/text | 目标对象 |
| cron_expr | text | cron |
| timezone | text | 时区 |
| status | text | active / paused / failed |
| next_run_at | timestamptz | 下次执行 |
| last_run_at | timestamptz nullable | 最近执行 |
| last_error | text nullable | 错误 |
| created_by | uuid | 创建人 |

#### `thread`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | thread |
| user_id | uuid fk | 创建者 |
| workspace_id | uuid fk | workspace |
| knowledge_base_id | uuid fk | 绑定 KB |
| kb_snapshot_id | uuid fk | 绑定 snapshot |
| deploy_hash | text | 绑定 deploy |
| title | text nullable | 线程标题 |
| summary | text nullable | 摘要 |

#### `thread_response`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | 回复 |
| thread_id | uuid fk | 所属 thread |
| asking_task_id | uuid fk nullable | 关联 asking task |
| question | text | 用户问题 |
| sql_text | text nullable | 生成 SQL |
| response_kind | text | ask / answer / chart / adjustment |
| detail_json | jsonb | 结果详情 |
| status | text | 任务状态 |

#### `asking_task`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | ask 异步任务 |
| query_id | text unique | AI service query id |
| thread_id | uuid fk nullable | thread |
| thread_response_id | uuid fk nullable | thread response |
| workspace_id | uuid fk | workspace |
| knowledge_base_id | uuid fk | KB |
| kb_snapshot_id | uuid fk | snapshot |
| deploy_hash | text | deploy |
| task_kind | text | ask / answer / chart / adjust |
| status | text | pending / running / finished / failed / cancelled |
| detail_json | jsonb | 扩展信息 |

#### `schedule_job_run`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | job run |
| schedule_job_id | uuid fk | 对应 job |
| trace_id | text | trace |
| status | text | queued / running / success / failed |
| started_at | timestamptz | 开始时间 |
| finished_at | timestamptz nullable | 完成时间 |
| error_message | text nullable | 错误 |

#### `api_history`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | API 历史 |
| workspace_id | uuid fk | workspace |
| knowledge_base_id | uuid fk | KB |
| kb_snapshot_id | uuid fk | snapshot |
| deploy_hash | text | deploy |
| user_id | uuid fk nullable | 调用人 |
| thread_id | uuid fk nullable | 线程 |
| api_type | text | ask / sql / chart / ... |
| request_payload | jsonb | 请求 |
| response_payload | jsonb | 响应 |
| status_code | integer | 状态码 |

#### `audit_event`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | 审计事件 |
| workspace_id | uuid fk | workspace |
| actor_user_id | uuid fk nullable | 操作者 |
| entity_type | text | connector / skill / schedule / dashboard / auth |
| entity_id | uuid/text | 对象 |
| event_type | text | created / updated / executed / denied / failed |
| payload_json | jsonb | 审计负载 |
| created_at | timestamptz | 时间 |

### A.3 旧表迁移关注点
- `project`：拆成 `knowledge_base + kb_snapshot + connector + secret_record`。
- `deploy_log`：继续保留 manifest/history，但新增 `kb_snapshot_id + deploy_hash` 绑定。
- `api_history`：去掉只靠 `project_id` 的单字段设计，补 runtime identity 快照。
- `dashboard_item_refresh_job`：未来并入 `schedule_job_run` / `audit_event` 视角，不再独立依赖 current project。
- `thread` / `thread_response` / `asking_task`：从 project 绑定改成 knowledge base + snapshot + deploy 绑定。
- `api_history`：从 project-only 记录改成 runtime identity + actor 记录。

### A.4 文件触点
- `wren-ui/migrations/20240125070643_create_project_table.js`
- `wren-ui/migrations/20240319083758_create_deploy_table.js`
- `wren-ui/migrations/20250423000000_create_dashboard_cache_refresh_table.js`
- `wren-ui/migrations/20250511000000-create-api-history.js`
- `wren-ui/src/apollo/server/repositories/projectRepository.ts`
- `wren-ui/src/common.ts`

---

## 5. Workstream B — Runtime Identity & Context Resolver

### B.1 Canonical contract
```ts
interface RuntimeIdentity {
  workspaceId: string;
  knowledgeBaseId: string;
  kbSnapshotId: string;
  deployHash: string;
  actorClaims: {
    userId: string;
    workspaceMemberId: string;
    roleKeys: string[];
    permissionScopes: string[];
  };
  threadId?: string;
  dashboardId?: string;
  scheduleJobId?: string;
}
```

### B.2 规则
1. UI 只提交可选的 scope selector，不提交未验证 claims。
2. Apollo 层从 session 补全 `actorClaims`。
3. adaptor 层向 AI service 传完整 runtime identity。
4. AI service request model 统一接收这套字段。
5. 兼容期旧 `id` / `project_id` 只保留 alias，不参与主流程决策。

### B.3 现有代码触点
- `wren-ui/src/pages/api/v1/ask.ts`
- `wren-ui/src/pages/api/v1/generate_sql.ts`
- `wren-ui/src/pages/api/v1/run_sql.ts`
- `wren-ui/src/pages/api/v1/stream/ask.ts`
- `wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts`
- `wren-ai-service/src/web/v1/services/__init__.py`
- `wren-ai-service/src/web/v1/services/ask.py`
- `wren-ai-service/src/web/v1/services/semantics_preparation.py`

### B.4 新增模块建议
- `wren-ui/src/apollo/server/context/runtimeScope.ts`
- `wren-ui/src/apollo/server/context/actorClaims.ts`
- `wren-ai-service/src/core/runtime_identity.py`
- `wren-ai-service/src/web/v1/services/runtime_models.py`

### B.5 Done 标准
- ask / deploy / chart / scheduler / dashboard refresh 请求 DTO 全部有 runtime identity 字段。
- thread / dashboard / schedule 持久化时固化 runtime identity 快照。
- `getCurrentProject()` 不再被用作默认 context resolver。

---

## 6. Workstream C — Auth / Session / Actor Claims

### C.1 目标
先做 built-in auth，但让 runtime 永远只消费 `actor_claims`，不关心登录方式是 local 还是未来 OIDC。

### C.2 关键设计
- `authService` 负责登录、登出、session refresh、claims 解析。
- `policyService` 负责 workspace / knowledge_base 级授权。
- `IContext` 扩展 auth、workspace、knowledge base、policy 服务，不再只有 project/query/dashboard 服务。

### C.3 关键触点
- `wren-ui/src/apollo/server/types/context.ts`
- `wren-ui/src/common.ts`
- 新增 auth repositories/services/resolvers

### C.4 Done 标准
- session -> actor claims 解析链路清楚。
- workspace / KB deny-by-default 规则写清。
- 未来 OIDC 仅需新增 provider adapter，而不是重写 runtime。

---

## 7. Workstream D — Skill Contract 与 Isolated Runner

### D.1 Skill 输入
```json
{
  "query": "本月华东区 GMV",
  "runtime_identity": {"workspace_id": "...", "knowledge_base_id": "...", "kb_snapshot_id": "...", "deploy_hash": "..."},
  "actor_claims": {"user_id": "...", "workspace_member_id": "...", "role_keys": ["member"]},
  "connectors": [{"id": "...", "type": "postgres"}],
  "secret_refs": ["secret-id"],
  "history_window": [],
  "skill_config": {}
}
```

### D.2 Skill 输出归一
```json
{
  "result_type": "tabular_frame",
  "rows": [],
  "columns": [],
  "chart_spec": null,
  "citations": [],
  "trace": {"skill_run_id": "..."}
}
```
允许值：
- `tabular_frame`
- `metric_series`
- `text`
- `chart_spec`
- `citation_bundle`
- `error`

### D.3 Runner 边界
- 主 ask 服务不执行用户代码。
- 通过 isolated worker/container 执行。
- 只开放 Python runtime。
- 带 timeout / memory / network allowlist / stdout size 限制。

### D.4 关键触点
- `wren-ai-service/src/web/v1/services/ask.py`
- `wren-ai-service/src/globals.py`
- 新增 `wren-ai-service/src/core/skill_runner/*`
- 新增 `wren-ai-service/src/core/skill_contract.py`

### D.5 Done 标准
- skill manifest、runner request、runner result、fallback 规则全部定稿。
- 明确失败时如何记录审计与 trace。

---

## 8. Workstream E — Secret Contract

### E.1 加密方案
- 算法：AEAD（实现时再定具体库）。
- 主密钥：环境变量注入。
- DB：仅保存密文与解密元数据。
- 审计：日志不落明文。

### E.2 关键规则
1. connector secret 与 skill secret 统一进 `secret_record`。
2. `key_version` 为强制字段。
3. 提供离线重加密脚本，不做自动轮换。
4. 明文只允许在应用内存与 runner 注入阶段短暂存在。

### E.3 触点
- `wren-ui/migrations/20240125070643_create_project_table.js`
- `wren-ui/migrations/20240530062133_update_project_table.js`
- 新增 `wren-ui/src/apollo/server/services/secretService.ts`
- 新增 `scripts/re_encrypt_secrets.ts`

---

## 9. Workstream F — Dashboard / Schedule Worker

### F.1 问题
当前 dashboard refresh 逻辑：
- 从 `dashboard` 找 item
- 再调用 `projectService.getCurrentProject()`
- 再取当前部署并执行 SQL
这会导致多 knowledge base / 多 snapshot 场景串上下文。

### F.2 重构方向
- `dashboard` 自己保存 `knowledge_base_id + kb_snapshot_id + deploy_hash`。
- `schedule_job` 独立为 DB-backed job。
- `scheduleWorker` 只消费 DB job，不直接依赖“当前 project”。
- dashboard refresh 与 ask-like job 都统一写 audit / trace。

### F.3 关键触点
- `wren-ui/src/apollo/server/services/dashboardService.ts`
- `wren-ui/src/apollo/server/backgrounds/dashboardCacheBackgroundTracker.ts`
- `wren-ui/migrations/20250423000000_create_dashboard_cache_refresh_table.js`
- 新增 `wren-ui/src/apollo/server/services/scheduleService.ts`
- 新增 `wren-ui/src/apollo/server/backgrounds/scheduleWorker.ts`

### F.4 Done 标准
- schedule schema、执行器、失败重试与审计字段定稿。
- dashboard refresh 不再读取 current project。

---

## 10. Workstream G — Thread / History / Async Task 迁移

### G.1 问题
当前 thread / response / asking_task / text-based answer 背景任务链路仍默认回查 current project。
这会让追问、答案流式生成、图表调整、取消/重试在多 knowledge base 场景下直接串上下文。

### G.2 必须补齐的对象
- `thread`
- `thread_response`
- `asking_task`
- `api_history`
- `textBasedAnswerBackgroundTracker`
- `askingTaskTracker`

### G.3 关键规则
1. thread 创建时固化 runtime identity，禁止中途切库。
2. thread_response 与 asking_task 必须持久化 runtime identity，不允许执行时回查 current project。
3. 异步任务恢复、取消、重跑必须复用原 runtime identity。
4. api_history 不再只记 `project_id`，而是完整记录 actor + runtime scope。

### G.4 关键触点
- `wren-ui/migrations/20240327030000_create_ask_table.js`
- `wren-ui/migrations/20250509000000_create_asking_task.js`
- `wren-ui/migrations/20250509000001_add_task_id_to_thread.js`
- `wren-ui/migrations/20250511000000-create-api-history.js`
- `wren-ui/src/apollo/server/backgrounds/textBasedAnswerBackgroundTracker.ts`
- `wren-ui/src/apollo/server/services/askingTaskTracker.ts`

---

## 11. Workstream H — Deepagents Ask ADR

### G.1 目标边界
- deepagents：主编排
- Haystack：检索
- Hamilton：必要时作为 deterministic subflow
- Wren Engine：语义层 + SQL 执行
- skill runner：执行用户 skill

### G.2 Ask 主路径
1. 解析 runtime identity 与 claims。
2. 装配 KB context：glossary / rules / SQL templates / assets / skills。
3. `SkillRouter` 判断是否优先走 skill。
4. 若 skill 不命中或结果不足，再回落到 legacy NL2SQL tool。
5. `MixedAnswerComposer` 合成结果与图表数据。

### G.3 必须保留
- `ASK_RUNTIME_MODE=legacy|deepagents`
- golden regression
- shadow run / trace compare
- rollback runbook

### G.4 关键触点
- `wren-ai-service/src/web/v1/services/ask.py`
- `wren-ai-service/src/globals.py`
- `wren-ai-service/src/core/pipeline.py`
- `wren-ai-service/src/providers/llm/litellm.py`
- `wren-ai-service/src/providers/embedder/litellm.py`

---

## 12. Workstream I — PostgreSQL + pgvector Cutover

### H.1 要改的地方
- `wren-ui/src/apollo/server/utils/knex.ts`
- `docker/docker-compose.yaml`
- `docker/config.example.yaml`
- `wren-ai-service/src/providers/__init__.py`
- 新增 pgvector provider / migration scripts

### H.2 验收指标
- 默认 compose 不再依赖 sqlite/qdrant。
- 本地启动、索引构建、召回、ask 主路径都跑在 PostgreSQL + pgvector 上。
- 旧数据有导入脚本与回滚快照。

---

## 13. 必须先产出的文档/ADR 清单
1. ERD / migration design
2. runtime identity spec
3. auth/session spec
4. skill contract spec
5. secret encryption spec
6. schedule worker spec
7. deepagents orchestrator ADR
8. pgvector cutover runbook
9. compatibility inventory / deprecation list

## 14. Phase 0 退出标准
- 上述 9 份 spec/ADR 都完成。
- `getCurrentProject()` 主路径迁移清单完整。
- canonical runtime identity 已在 UI / adaptor / AI service / schedule / dashboard 维度写清。
- 无新的阻塞性产品决策。
- 可以无歧义进入 Phase 1 开发。
