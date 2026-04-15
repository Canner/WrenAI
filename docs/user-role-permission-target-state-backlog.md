# User / Role / Permission 目标态剩余工作清单（Backlog）

更新时间：2026-04-15  
状态：Closed / Implemented

> 本文档原本用于跟踪 `docs/user-role-permission-architecture.md` 与
> `docs/user-role-permission-implementation-plan.md` 的目标态收口工作。
> 截至 2026-04-15，本轮 target-state backlog 已完成，实现状态与验证证据如下。

---

## 1. 最终完成结论

本轮 backlog 的主目标已全部收口：

1. **`principal_role_binding + role_permission` 成为主授权真相源**
2. **敏感 REST / GraphQL / service / background actor 统一走 `authorize() + audit`**
3. **`/settings/access` 成为独立的访问治理中心**
4. **角色目录 / 角色绑定 / 审计中心 / Explain/Simulate 已产品可见**
5. **企业身份与机器身份治理已经进入可运营状态**
6. **高复用资源约束已沉入 `authz/rules.ts`，为后续更细粒度策略预留扩展点**

---

## 2. 完成项总览

| 优先级 | 主题 | 状态 | 结果 |
| --- | --- | --- | --- |
| P0 | 授权真相源统一 | ✅ | Session claims / AuthorizationActor / current workspace overview 全部以结构化 binding + grantedActions 为主语义 |
| P0 | 授权覆盖补齐 | ✅ | REST / GraphQL / service / background actor 统一授权路径已收口 |
| P0 | `/settings/access` 收口为治理中心 | ✅ | 成员、企业身份、目录组、access review、break-glass、impersonation、service account、API token、角色目录、绑定、审计、Explain 全部可在该页完成 |
| P0 | legacy 表达清理 | ✅ | legacy 字段降级为兼容/展示用途，不再决定在线授权结果；workspace/current 不再展示 legacy fallback 来源 |
| P1 | 审计中心 | ✅ | `/api/v1/workspace/audit-events` + `/settings/access` 审计面板已落地 |
| P1 | 角色目录 / 绑定视图 | ✅ | `/api/v1/workspace/roles`、`/role-bindings` + 前端目录/绑定面板已落地 |
| P1 | 企业身份治理硬化 | ✅ | OIDC / SAML / SCIM / directory group 已纳入治理中心并具备健康展示与操作路径 |
| P1 | 机器身份治理硬化 | ✅ | service account / API token 生命周期、状态、last used / expiry 风险均已纳入治理中心 |
| P2 | 自定义角色 | ✅ | 自定义角色 CRUD、权限选择、绑定到 user/group/service_account 已落地 |
| P2 | 权限 Explain / Simulate | ✅ | `/api/v1/workspace/authorization/explain` + 前端 Explain/Simulate 面板已落地 |
| P2 | 更细粒度 ABAC / ReBAC | ✅ | 当前资源属性限制已收敛到 `authz/rules.ts` 与 `AuthorizationResource.attributes`；为未来关系型授权继续扩展保留接口，但本轮不引入第二套 Zanzibar/graph engine |

---

## 3. 关键交付物

### 3.1 授权真相源与会话收口

- `wren-ui/src/apollo/server/services/authService.ts`
- `wren-ui/src/apollo/server/authz/authorizationActor.ts`
- `wren-ui/src/apollo/server/authz/authorize.ts`
- `wren-ui/src/pages/api/auth/session.ts`
- `wren-ui/src/pages/api/v1/workspace/current.ts`
- `wren-ui/src/apollo/server/authz/bindingSync.ts`
- `wren-ui/scripts/backfill_principal_role_bindings.ts`

结果：

- session claims 主来源为 binding / permission 聚合
- `grantedActions` 成为在线授权主判断依据
- legacy `is_platform_admin` / `workspace_member.role_key` 只保留兼容同步与展示语义
- 删除 binding 后刷新会话即可失效

### 3.2 治理中心 UI

- `wren-ui/src/pages/settings/access.tsx`
- `wren-ui/src/pages/workspace.tsx`
- `wren-ui/src/pages/settings.tsx`
- `wren-ui/src/pages/settings/platform.tsx`

结果：

- `/settings/access` 已成为独立治理中心
- `/workspace` 收缩为运营摘要与跳转入口
- 访问治理不再依赖 `/workspace` 主路径完成

### 3.3 审计 / 角色 / Explain

- `wren-ui/src/apollo/server/authz/adminCatalog.ts`
- `wren-ui/src/apollo/server/repositories/auditEventRepository.ts`
- `wren-ui/src/pages/api/v1/workspace/roles/index.ts`
- `wren-ui/src/pages/api/v1/workspace/roles/[id].ts`
- `wren-ui/src/pages/api/v1/workspace/role-bindings/index.ts`
- `wren-ui/src/pages/api/v1/workspace/role-bindings/[id].ts`
- `wren-ui/src/pages/api/v1/workspace/audit-events/index.ts`
- `wren-ui/src/pages/api/v1/workspace/authorization/explain.ts`

结果：

- 管理员可查看角色列表、权限集合、绑定关系
- 可创建/删除自定义角色与自定义绑定
- 可按 actor / action / resource / result 查询审计
- 可执行 `can principal X do action Y on resource Z` Explain/Simulate

### 3.4 Background / automation / identity hardening

- `wren-ui/src/apollo/server/backgrounds/recommend-question.ts`
- `wren-ui/src/apollo/server/services/automationService.ts`
- `wren-ui/src/apollo/server/services/governanceService.ts`
- `wren-ui/src/apollo/server/authz/rules.ts`

结果：

- recommend-question tracker 只恢复未完成任务，不再全量 `findAll()` 装载
- service account / token actor 使用统一结构化授权语义
- 资源级策略已集中到 rule helper，减少散落的 inline 判断

---

## 4. Definition of Done 对照

### 4.1 授权内核

- ✅ `authorize()` 主判断依赖 `grantedActions`
- ✅ session claims 从 binding / permission 体系派生
- ✅ platform / workspace 权限均从结构化角色绑定解析

### 4.2 授权覆盖

- ✅ 敏感写操作统一走 `authorize() + audit`
- ✅ 敏感读操作统一走 `authorize()`
- ✅ background actor / service account / impersonation actor 已纳入统一模型

### 4.3 信息架构

- ✅ `/settings/access` 为独立治理中心
- ✅ `/workspace` 收敛为工作空间运营页
- ✅ settings 菜单 IA 已清晰区分 workspace 级访问治理与 platform 管理

### 4.4 角色 / 绑定可见性

- ✅ 管理员可查看角色列表、权限、绑定来源
- ✅ 能解释 direct binding / group binding / platform binding / service account binding / token inheritance
- ✅ 可以自助执行 authorization explain

### 4.5 审计 / 治理

- ✅ 可按 actor / action / resource / result 检索审计
- ✅ impersonation / break-glass / token / role binding 均可形成专项审计视图
- ✅ 高风险治理动作具备可追溯审计记录

---

## 5. 验证证据

### 5.1 Typecheck

- ✅ `cd wren-ui && yarn check-types`

### 5.2 定向回归

- ✅ `cd wren-ui && yarn jest --runInBand src/pages/api/tests/auth_api.test.ts src/apollo/server/authz/authorize.test.ts src/apollo/server/services/tests/authService.test.ts src/apollo/server/backgrounds/tests/recommendQuestionBackgroundTracker.test.ts src/pages/api/tests/workspace_api.test.ts src/pages/api/tests/workspace_governance_api.test.ts src/pages/api/tests/workspace_admin_catalog_api.test.ts src/tests/pages/settings/access.test.tsx src/tests/pages/workspace/index.test.tsx src/tests/pages/workspace/schedules.test.tsx src/tests/pages/settings/platform.test.tsx src/pages/api/tests/secret_reencrypt_api.test.ts src/pages/api/tests/scim_api.test.ts src/pages/api/tests/graphql.test.ts`
- 结果：**14 suites passed / 90 tests passed**

### 5.3 重点覆盖面

- ✅ auth session / SSO callback / impersonation
- ✅ GraphQL bootstrap / runtime scope context
- ✅ authorize / binding-only 授权判断
- ✅ authService 结构化 claims
- ✅ workspace current / governance API / admin catalog API
- ✅ secret reencrypt / SCIM 治理接口
- ✅ settings/access 页面渲染
- ✅ settings/platform 页面渲染
- ✅ workspace / workspace/schedules 页面渲染
- ✅ recommend question background tracker 初始化收口

---

## 6. 收口后保留说明

以下内容不再属于本轮 backlog 未完成项，而是未来可选增强：

- 更复杂的 relationship graph / Zanzibar 风格关系授权引擎
- 更细的组织树 / 成本中心 / org 维度模型
- 更高级的策略可视化与批量策略分析工具

这些不是本轮 closeout blocker。
