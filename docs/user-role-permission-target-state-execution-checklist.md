# User / Role / Permission 目标态执行清单

> 历史说明（2026-04-16）：本文保留的是 Apollo/GraphQL 时代的设计、排障或执行记录。当前 `wren-ui` 运行时前端已经切到 REST，代码目录也已收口到 `src/server/*` 与 `src/pages/api/v1/*`；文中的旧 GraphQL 入口、resolver 与 Apollo 上下文描述仅作历史背景，不再代表当前主链路。

更新时间：2026-04-15  
状态：Closed / Verified

> 本文档原用于按 Wave 跟踪执行。当前已转为 closeout checklist，用于记录 Wave 0 ~ Wave 6 的最终完成状态与验证证据。

---

## 1. 总体结论

- [x] Wave 0：基线冻结与盘点
- [x] Wave 1：统一授权真相源
- [x] Wave 2：补齐授权覆盖
- [x] Wave 3：访问治理 UI 收口
- [x] Wave 4：可见性与审计运营
- [x] Wave 5：身份与机器治理硬化
- [x] Wave 6：高阶能力（自定义角色 / Explain / 规则层扩展点）

---

## 2. Wave 0：基线冻结与盘点

- [x] 固定回归命令集合
- [x] 固定 authz / audit / SSO / service account 核心测试集
- [x] 盘点 REST / 历史 GraphQL / service / background actor 入口
- [x] 盘点 legacy 依赖路径（`is_platform_admin` / `workspace_member.role_key`）
- [x] 盘点 `/workspace` vs `/settings/access` 职责边界
- [x] 明确后续文件级改造范围

交付结果：

- 授权入口矩阵完成
- legacy 依赖清单完成
- 页面职责边界完成

---

## 3. Wave 1：统一授权真相源

- [x] 复核结构化授权表与 seed
- [x] 复核系统角色 / permission 集合完整性
- [x] 复核 binding sync 路径：workspace member / platform admin / service account / directory group
- [x] 提供 binding 缺失时的 backfill 脚本与策略
- [x] session claims 优先读取 binding / permission
- [x] `grantedActions` 成为在线授权主来源
- [x] `AuthorizationActor` 默认携带结构化 `grantedActions`
- [x] 删除 binding 后权限可立即失效
- [x] legacy 字段降级为兼容 / 展示语义
- [x] binding-only 场景在测试环境稳定通过

关键文件：

- [x] `wren-ui/src/server/services/authService.ts`
- [x] `wren-ui/src/server/authz/authorizationActor.ts`
- [x] `wren-ui/src/server/authz/authorize.ts`
- [x] `wren-ui/src/pages/api/auth/session.ts`
- [x] `wren-ui/src/pages/api/v1/workspace/current.ts`
- [x] `wren-ui/src/server/authz/bindingSync.ts`
- [x] `wren-ui/scripts/backfill_principal_role_bindings.ts`

---

## 4. Wave 2：补齐授权覆盖

- [x] REST 管理写接口统一接 `authorize()`
- [x] REST 敏感读接口统一接 `authorize()`
- [x] 历史 GraphQL 管理/敏感 resolver 统一接 `authorize()`
- [x] service / background actor 明确 principalType / scope
- [x] system / scheduled job 主路径不再依赖 legacy 角色判断
- [x] 敏感写操作统一补审计
- [x] deny 场景统一写 deny audit
- [x] `workspaceAccess.ts` 降级为兼容薄封装
- [x] 可复用资源规则沉入 `authz/rules.ts`

关键文件：

- [x] `wren-ui/src/pages/api/v1/**`
- [x] `wren-ui/src/pages/api/auth/**`
- [x] `wren-ui/src/server/controllers/**`
- [x] `wren-ui/src/server/services/*.ts`
- [x] `wren-ui/src/server/backgrounds/**`
- [x] `wren-ui/src/server/authz/rules.ts`
- [x] `wren-ui/src/server/repositories/auditEventRepository.ts`

---

## 5. Wave 3：访问治理 UI 收口

- [x] `/settings/access` 成为 workspace 级治理中心
- [x] 成员/角色治理保留在 `/settings/access`
- [x] identity provider 完整 CRUD / 健康展示进入 `/settings/access`
- [x] directory group 管理进入 `/settings/access`
- [x] service account 管理进入 `/settings/access`
- [x] API token 管理进入 `/settings/access`
- [x] access review / break-glass / impersonation 保持在 `/settings/access`
- [x] `/workspace` 收缩为运营摘要与跳转
- [x] settings 菜单 IA 清晰区分用户与访问 vs 平台管理
- [x] 权限不足态 / 空态 / 错误态可用

关键文件：

- [x] `wren-ui/src/pages/settings/access.tsx`
- [x] `wren-ui/src/pages/workspace.tsx`
- [x] `wren-ui/src/pages/settings.tsx`
- [x] `wren-ui/src/components/reference/novaShellNavigation.tsx`

---

## 6. Wave 4：可见性与审计运营

- [x] 增加角色来源 / binding 来源展示
- [x] UI 区分 platform role / workspace role
- [x] 角色目录页 / 面板落地
- [x] principal 绑定视图落地
- [x] 审计查询 API 落地
- [x] 审计列表页 / 面板落地
- [x] 审计支持 actor / action / resource / result / query 过滤
- [x] impersonation / break-glass / role binding / identity provider / service account / token 可作为专项审计视图筛选
- [x] 管理员可解释当前 principal 的关键权限来源

关键文件：

- [x] `wren-ui/src/server/authz/adminCatalog.ts`
- [x] `wren-ui/src/pages/api/v1/workspace/roles/index.ts`
- [x] `wren-ui/src/pages/api/v1/workspace/roles/[id].ts`
- [x] `wren-ui/src/pages/api/v1/workspace/role-bindings/index.ts`
- [x] `wren-ui/src/pages/api/v1/workspace/role-bindings/[id].ts`
- [x] `wren-ui/src/pages/api/v1/workspace/audit-events/index.ts`
- [x] `wren-ui/src/pages/settings/access.tsx`

---

## 7. Wave 5：身份与机器治理硬化

- [x] OIDC / SAML / SCIM 继续统一纳入 workspace 级治理
- [x] identity provider 健康状态、metadata / certificate / discovery 信息可见
- [x] directory group 与 role binding 联动可见
- [x] service account 生命周期治理（create / update / deactivate / delete）完成
- [x] API token 生命周期治理（create / revoke / expire 风险展示）完成
- [x] last used / active token / expiry 风险可见
- [x] 人类身份 / 自动化身份分层展示
- [x] background tracker 初始化不再全量恢复历史任务

关键文件：

- [x] `wren-ui/src/server/services/automationService.ts`
- [x] `wren-ui/src/server/services/governanceService.ts`
- [x] `wren-ui/src/pages/api/v1/workspace/service-accounts/**`
- [x] `wren-ui/src/pages/api/v1/workspace/api-tokens/**`
- [x] `wren-ui/src/server/backgrounds/recommend-question.ts`

---

## 8. Wave 6：高阶能力

- [x] 自定义角色 CRUD
- [x] 自定义角色 permission 选择
- [x] 支持绑定到 user / group / service_account
- [x] 系统角色保护策略
- [x] Explain / Simulate API
- [x] 输出命中的 role / permission / binding / decision
- [x] 当前资源属性限制已收敛到规则层
- [x] 为未来关系型授权继续扩展保留接口（不引入第二套引擎）

关键文件：

- [x] `wren-ui/src/server/authz/permissionRegistry.ts`
- [x] `wren-ui/src/server/authz/adminCatalog.ts`
- [x] `wren-ui/src/server/authz/rules.ts`
- [x] `wren-ui/src/pages/api/v1/workspace/authorization/explain.ts`
- [x] `wren-ui/src/pages/settings/access.tsx`

---

## 9. 验证与证据

### 9.1 Typecheck

- [x] `cd wren-ui && yarn check-types`

### 9.2 重点回归

- [x] `cd wren-ui && yarn jest --runInBand src/pages/api/tests/auth_api.test.ts src/server/authz/authorize.test.ts src/server/services/tests/authService.test.ts src/server/backgrounds/tests/recommendQuestionBackgroundTracker.test.ts src/pages/api/tests/workspace_api.test.ts src/pages/api/tests/workspace_governance_api.test.ts src/pages/api/tests/workspace_admin_catalog_api.test.ts src/tests/pages/settings/access.test.tsx src/tests/pages/workspace/index.test.tsx src/tests/pages/workspace/schedules.test.tsx src/tests/pages/settings/platform.test.tsx src/pages/api/tests/secret_reencrypt_api.test.ts src/pages/api/tests/scim_api.test.ts src/runtime/client/tests/runtimeScope.test.ts`
- [x] 结果：**14 suites passed / 90 tests passed**

### 9.3 覆盖面说明

- [x] deny 场景
- [x] cross-workspace / workspace current 场景
- [x] service_account 场景
- [x] group binding 场景
- [x] impersonation / break-glass 场景
- [x] auth session / SSO / session cookie 场景
- [x] runtime scope bootstrap / REST 场景
- [x] secret reencrypt / SCIM 治理接口
- [x] UI：settings/access、workspace、workspace/schedules
- [x] UI：settings/platform
- [x] background actor：recommend question tracker

---

## 10. 收口备注

- [x] 架构文档、backlog、execution checklist 已同步到 closeout 状态
- [x] 本轮不再存在阻断交付的未完成项
- [x] 未来若继续演进更复杂的 org / graph auth，引入新文档单独规划，不回滚本次完成态
