# User / Role / Permission 实施计划

> 历史说明（2026-04-16）：本文保留的是 Apollo/GraphQL 时代的设计、排障或执行记录。当前 `wren-ui` 运行时前端已经切到 REST，代码目录也已收口到 `src/server/*` 与 `src/pages/api/v1/*`；文中的旧 GraphQL 入口、resolver 与 Apollo 上下文描述仅作历史背景，不再代表当前主链路。

更新时间：2026-04-13

> 本文档是 `docs/user-role-permission-architecture.md` 的落地实施说明。
> 目标：基于当前仓库真实代码结构，把“workspace 多租户 + 本地账号 + 平台 admin + workspace member”这套现状，渐进收敛到统一授权内核、可扩展角色权限模型、企业身份接入与治理能力。

---

## 1. 实施原则

本计划遵循以下硬约束：

1. **Workspace 是唯一租户边界**
   - 不引入第二套 tenant / org / account 边界
2. **Phase 1 先统一授权入口，不先推翻 service 层接口**
   - 先在 route / controller / 历史 resolver 收口
   - service 层继续负责资源归属与 invariant 校验
3. **复用现有表与字段，不平地起高楼**
   - 复用 `user.is_platform_admin`
   - 复用 `workspace_member.role_key`
   - 复用 `audit_event`
4. **SSO 采用 workspace 级配置**
   - 与现有 `identity_provider_config.workspace_id` 一致
5. **当前前端仍以 local auth 为主**
   - OIDC / SAML / SCIM 属于后续阶段目标能力
6. **先收敛判断逻辑，再做角色/权限表结构化**
   - 先 `authorize()`
   - 后 `role / permission / principal_role_binding`

---

## 2. 当前代码基线

结合当前仓库，已有能力如下：

### 2.1 已存在

- 本地账号登录 / 注册 / bootstrap
  - `wren-ui/src/pages/api/auth/login.ts`
  - `wren-ui/src/pages/api/auth/register.ts`
  - `wren-ui/src/pages/api/auth/bootstrap.ts`
- 会话校验与 actor claims
  - `wren-ui/src/server/services/authService.ts`
  - `wren-ui/src/server/context/actorClaims.ts`
- 平台 admin 兼容字段
  - `user.is_platform_admin`
- workspace 级成员关系
  - `workspace_member.role_key`
  - `workspace_member.status`
- workspace 级 IdP 配置表
  - `identity_provider_config.workspace_id`
- 审计基础表
  - `audit_event`
- 背景任务执行链路
  - `wren-ui/src/server/backgrounds/scheduleWorker.ts`

### 2.2 当前缺口

- 没有统一 `authorize()` 服务
- 权限判断散落在 route / controller / 历史 resolver / util 中
- `permissionScopes` 仍是粗粒度兼容值，不是细粒度 permission registry
- `audit_event` 字段还不足以承载完整授权审计
- `/api/auth/login`、`/api/auth/bootstrap`、`/api/auth/register` 缺少限流/防暴破
- 没有 `role / permission / role_permission / principal_role_binding`
- 没有 `service_account / api_token`
- 没有企业 SSO 登录入口、callback、workspace discovery

---

## 3. 总体分期

按 5 个阶段推进：

1. **Phase 1：授权内核收敛**
2. **Phase 2：角色体系结构化**
3. **Phase 3：自动化主体与令牌**
4. **Phase 4：企业身份接入**
5. **Phase 5：治理增强**

推荐顺序：

- 先完成 Phase 1
- 再做 Phase 2 + Phase 3
- 最后做 Phase 4 + Phase 5

原因：

- 当前最大风险不是“没有更多表”，而是“授权判断分散、不可审计、不可复用”

---

## 4. Phase 1：授权内核收敛

目标：把当前散落的权限判断收敛为统一授权入口，但不一次性重写所有 service。

### 4.1 新增模块

建议新增目录：

```text
wren-ui/src/server/authz/
```

建议文件：

1. `permissionRegistry.ts`
   - 定义 `Action` 枚举
   - 定义 Phase 1 的 action -> description -> scope
2. `authorizationActor.ts`
   - 定义 `AuthorizationActor`
   - 提供从 `validatedSession` / background context 构造 actor 的 helper
3. `legacyRolePolicy.ts`
   - 定义 `legacyRolePolicyMap`
   - owner/admin/member -> action 列表
4. `authorize.ts`
   - 核心 `authorize({ actor, action, resource, context })`
   - 输出 allow / deny / reason
5. `authorizationAudit.ts`
   - 包装基于 `audit_event` 的授权审计写入

说明：

- Phase 1 **不要**直接从数据库读 `role_permission`
- Phase 1 以 `legacyRolePolicyMap + resource constraints` 为准

### 4.2 Phase 1 的 `AuthorizationActor`

沿用架构文档中的过渡态：

```ts
type AuthorizationActor = {
  principalType: 'user' | 'service_account' | 'system' | 'scheduled_job';
  principalId: string;
  workspaceId?: string | null;
  workspaceMemberId?: string | null;
  workspaceRoleKeys: string[];
  permissionScopes: string[];
  isPlatformAdmin: boolean;
  platformRoleKeys: string[];
};
```

构造来源：

- `workspaceRoleKeys`：`validatedSession.actorClaims.roleKeys`
- `permissionScopes`：`validatedSession.actorClaims.permissionScopes`
- `isPlatformAdmin`：`validatedSession.user.isPlatformAdmin`
- `platformRoleKeys`：
  - `true -> ['platform_admin']`
  - `false -> []`

### 4.3 Phase 1 的 Action 清单

第一批先落与现有代码最贴近的动作：

- `workspace.create`
- `workspace.read`
- `workspace.default.set`
- `workspace.member.invite`
- `workspace.member.approve`
- `workspace.member.reject`
- `workspace.member.remove`
- `workspace.member.role.update`
- `workspace.schedule.manage`
- `knowledge_base.create`
- `knowledge_base.read`
- `knowledge_base.update`
- `knowledge_base.archive`
- `connector.create`
- `connector.update`
- `connector.rotate_secret`
- `skill.create`
- `skill.update`
- `skill.delete`

### 4.4 Phase 1 的资源约束

`authorize()` 除角色外，必须统一处理这些约束：

1. `resource.workspaceId === actor.workspaceId`
2. 默认 workspace / sample KB 特殊限制
3. owner/admin/member 的层级限制
4. 不能修改 owner membership（除 owner 专门流）
5. 不能删除/降权自己
6. schedule / connector / KB 必须属于当前 workspace
7. 敏感读也要经过授权，不只写操作

### 4.5 Phase 1 的入口接入顺序（REST route/controller 优先，历史 resolver 次之）

#### 第一批：直接写接口

优先接入：

- `wren-ui/src/pages/api/v1/workspace/index.ts`
- `wren-ui/src/pages/api/v1/workspace/preferences.ts`
- `wren-ui/src/pages/api/v1/workspace/members/index.ts`
- `wren-ui/src/pages/api/v1/workspace/members/[id].ts`
- `wren-ui/src/pages/api/v1/workspace/schedules.ts`
- `wren-ui/src/pages/api/v1/workspace/schedules/[id].ts`

#### 第二批：KB / connector / skill 管理接口

- `wren-ui/src/pages/api/v1/knowledge/bases/index.ts`
- `wren-ui/src/pages/api/v1/knowledge/bases/[id].ts`
- `wren-ui/src/pages/api/v1/knowledge/instructions/index.ts`
- `wren-ui/src/pages/api/v1/knowledge/instructions/[id].ts`
- `wren-ui/src/pages/api/v1/knowledge/sql_pairs/index.ts`
- `wren-ui/src/pages/api/v1/knowledge/sql_pairs/[id].ts`
- `wren-ui/src/pages/api/v1/connectors/index.ts`
- `wren-ui/src/pages/api/v1/connectors/[id].ts`
- `wren-ui/src/pages/api/v1/secrets/reencrypt.ts`
- `wren-ui/src/pages/api/v1/skills/index.ts`
- `wren-ui/src/pages/api/v1/skills/[id].ts`

#### 第三批：历史 GraphQL resolver（迁移期存量入口）

优先补齐仍带管理动作的历史 resolver：

- dashboard / schedule
- skill
- project / model 变更类 mutation

### 4.6 Phase 1 的 service 边界

Phase 1 不强推把以下 service 全改成 actor-aware：

- `WorkspaceService`
- `KnowledgeBaseService`
- `ConnectorService`
- `SkillService`

策略是：

1. route / controller 先做统一授权，历史 resolver 同步补齐
2. service 保留原有归属校验
3. 高风险高复用 service 再补 `authorize()` wrapper

### 4.7 审计收敛

基于现有 `audit_event` 做扩展。

#### 当前字段 vs 目标字段

当前 migration 中，`audit_event` 只有这些字段：

- `id`
- `workspace_id`
- `actor_user_id`
- `entity_type`
- `entity_id`
- `event_type`
- `payload_json`
- `created_at`
- `updated_at`

目标字段建议为：

- `id`
- `workspace_id`
- `actor_type`
- `actor_id`
- `actor_user_id`（兼容期可保留）
- `action`
- `resource_type`
- `resource_id`
- `result`
- `reason`
- `before_json`
- `after_json`
- `payload_json`
- `request_id`
- `session_id`
- `ip_address`
- `user_agent`
- `created_at`
- `updated_at`

差异说明：

- 这不是“只补 1~2 个字段”的轻量改动
- Wave B 应按一次**中等规模 schema 扩展**来估算成本
- 但它仍然优于新建并行 `audit_log`，因为：
  - 可复用现有 repository / 用法
  - 可保留历史审计数据
  - 可避免两套审计表并存

建议扩展字段：

- `actor_type`
- `actor_id`
- `workspace_id`
- `action`
- `resource_type`
- `resource_id`
- `result`
- `reason`
- `before_json`
- `after_json`
- `request_id`
- `session_id`
- `ip_address`
- `user_agent`

落地要求：

- 所有关键管理动作
- 所有授权 deny
- 所有 schedule create/update/run/fail
- 后续 impersonation / break-glass

### 4.8 auth 限流

新增统一限流工具，建议位置：

```text
wren-ui/src/server/utils/rateLimit.ts
```

#### 技术选型

Phase 1 / Wave B 建议**不引入新依赖**，直接在仓库内实现一个轻量限流抽象：

```ts
type RateLimitStore = {
  consume(key: string, options: { windowMs: number; max: number }): Promise<{
    allowed: boolean;
    retryAfterMs?: number;
    remaining?: number;
  }>;
};
```

实现分两层：

1. `MemoryRateLimitStore`
   - 用 `Map` + 过期时间实现
   - 用于本地开发 / 单进程测试 / CI
2. `RedisRateLimitStore`
   - 作为生产环境接口实现
   - 放到后续部署接入时再落，不阻塞 Phase 1 授权内核

原因：

- 当前 `wren-ui/package.json` 没有现成 rate limit / Redis 依赖
- Next.js API routes 也没有内建限流
- 先定义项目内统一接口，后续是否接 Redis 不会影响调用层
- 这样能避免 Wave B 为了“选库”先引入额外依赖和大面积适配

第一批接入端点：

- `wren-ui/src/pages/api/auth/login.ts`
- `wren-ui/src/pages/api/auth/register.ts`
- `wren-ui/src/pages/api/auth/bootstrap.ts`

V1 方案建议：

- 本地开发：使用 `MemoryRateLimitStore`
- 正式环境：切 `RedisRateLimitStore` / shared storage
- key 维度至少包含：
  - IP
  - email / identity
  - endpoint

建议默认策略：

- `login`
  - `IP + endpoint`
  - `email + endpoint`
- `register`
  - `IP + endpoint`
- `bootstrap`
  - `IP + endpoint`
  - 更严格窗口

### 4.9 Phase 1 测试

新增/补强：

- `wren-ui/src/pages/api/tests/auth_api.test.ts`
- `wren-ui/src/pages/api/tests/workspace_api.test.ts`
- `wren-ui/src/pages/api/tests/workspace_schedule_actions_api.test.ts`
- 新增 `wren-ui/src/server/authz/*.test.ts`

至少覆盖：

1. owner/admin/member 对各 action 的 allow/deny
2. `isPlatformAdmin` 与 platform action
3. workspace 越权访问拒绝
4. self-remove / self-demote 拒绝
5. owner member 受保护
6. deny 写审计
7. auth rate limit 触发 429

### 4.10 Phase 1 完成标准

满足以下条件才算完成：

1. 管理类接口不再直接散落 `if (roleKey === ...)`
2. 所有关键写操作先走 `authorize()`
3. 关键 deny 有审计
4. auth 端点已有限流
5. 现有 workspace 多租户边界不被削弱

---

## 5. Phase 2：角色体系结构化

目标：把 Phase 1 的代码内映射升级为数据库层可扩展角色模型。

### 5.1 Migration

新增表：

- `role`
- `permission`
- `role_permission`
- `principal_role_binding`

### 5.2 迁移策略

采用 **双轨兼容**：

1. 先建新表
2. 回填系统角色与权限
3. 将现有 `workspace_member.role_key` 映射到新 role binding
4. 一段时间内保留：
   - `workspace_member.role_key`
   - `user.is_platform_admin`
5. `authorize()` 优先读取新绑定；缺失时回退 legacy 映射

### 5.3 系统角色

首批只引入：

- `platform_admin`
- `workspace_owner`
- `workspace_admin`
- `workspace_viewer`

`workspace_editor` 可延后，不要求和当前 `member` 一起落。

### 5.4 Phase 2 完成标准

1. `authorize()` 已可从 role binding 取角色
2. `isPlatformAdmin` 仅作为兼容字段
3. 新角色与权限变更可审计

---

## 6. Phase 3：自动化主体与令牌

目标：支持非用户主体的受控调用。

### 6.1 Migration

新增：

- `service_account`
- `api_token`

### 6.2 授权语义

支持：

- `principalType = 'service_account'`
- token scope：
  - `workspace`
  - `knowledge_base`
  - `api_token`

### 6.3 现有背景任务对齐

当前 `scheduleWorker` 已是最接近 system actor 的链路。

需要补：

- schedule run 审计统一到 `AuthorizationActor`
- 区分：
  - `createdByUserId`
  - `requestedByUserId`
  - `executedBy = system / scheduled_job`

### 6.4 Phase 3 完成标准

1. 后端自动化不依赖伪造用户 session
2. token 可吊销、可审计
3. background actor 语义统一

---

## 7. Phase 4：企业身份接入

目标：在 workspace 级 IdP 语义下接入企业 SSO。

### 7.1 数据与身份绑定

扩展 `auth_identity` 或其等价模型，使其表达：

- `identityProviderConfigId`
- `issuer`
- `externalSubject`

硬约束：

- 不使用 email 作为 SSO 主键
- 使用：
  - `identity_provider_config_id + external_subject`
  - 或 `issuer + subject`

### 7.2 前后端改造点

后端：

- `POST /api/auth/sso/start`
- `GET /api/auth/sso/callback`
- workspaceSlug -> IdP discovery

前端：

- `wren-ui/src/pages/auth.tsx`
- 增加 workspace 级 SSO 入口
- 支持：
  - 输入 `workspaceSlug`
  - 跳转对应 IdP
  - callback 后回到 workspace selector

设置页：

- `wren-ui/src/pages/settings.tsx`
- 增加企业登录配置状态展示

### 7.3 Phase 4 范围控制

本阶段包含：

- OIDC
- SAML
- SCIM user provisioning / deprovisioning

本阶段不强制包含：

- group -> role 自动绑定
- 复杂 email domain discovery
- 多入口 discovery 编排

### 7.4 Phase 4 完成标准

1. workspace 级 OIDC 登录打通
2. SSO 身份绑定不依赖 email
3. login UI 与 callback 语义一致

---

## 8. Phase 5：治理增强

目标：达到企业可管理水平。

交付：

1. `access_review`
2. impersonation with audit
3. break-glass policy
4. group-based role binding
5. SCIM group -> role binding

说明：

- Phase 5 再做 group / directory 权限联动
- 不前置到 Phase 4

### 8.1 设置菜单与治理信息架构收口

Phase 5 之后，前端信息架构应明确收敛为：

- `设置 / 个人设置`
- `设置 / 用户与访问`
- `设置 / 平台管理`（仅 `platform_admin` 可见）

其中：

#### `设置 / 用户与访问`

默认是**当前 workspace 的 IAM 治理中心**，承载：

- 成员管理
- 角色与权限
- 企业身份（OIDC / SAML / SCIM）
- 目录组
- 服务账号
- API Token
- Access Review
- Break-glass / Impersonation

#### `设置 / 平台管理`

仅承载平台级治理，不与 workspace 级治理混用，例如：

- 平台管理员治理
- workspace 生命周期治理
- 平台级审计 / 高风险操作审计

### 8.2 `/workspace` 页职责收缩

实施过程中应避免继续把主权限治理入口堆回 `/workspace`。

目标状态：

- `/workspace`
  - 工作空间基础信息
  - 偏好设置
  - 运营状态 / 说明
- `/settings/access`
  - 访问治理主入口

迁移策略：

1. 先在 `/settings/access` 补齐完整治理能力
2. 再把 `/workspace` 中对应治理操作降级为摘要 / 跳转
3. 最后清理重复主操作入口

### 8.3 Phase 5 完成标准补充

除治理能力本身外，还应满足：

1. 管理员无需进入 `/workspace` 即可完成所有访问治理动作
2. 用户能清晰区分“工作空间运营”和“访问治理”
3. `platform_admin` 能看到与 workspace 级治理区分清晰的平台治理入口

---

## 9. 代码落点清单

### 9.1 主要后端文件

- `wren-ui/src/common.ts`
  - 注册新的 authz service / rate limiter / audit wrapper
- `wren-ui/src/server/services/authService.ts`
  - 继续作为 session / local auth / actorClaims 来源
- `wren-ui/src/server/context/actorClaims.ts`
  - 补充统一 actor 构造 helper 的接线
- `wren-ui/src/pages/api/v1/**` / `wren-ui/src/server/context/**`
  - 当前 REST route / server context 中注入 `AuthorizationActor` 并完成授权前置装配
- （历史）GraphQL gateway / resolver 接入方案
  - 仅作为迁移背景保留，不再代表当前主链实现
- `wren-ui/src/server/utils/workspaceAccess.ts`
  - Phase 1 迁入 `authz/`，最终收敛为**兼容薄封装或废弃**
- `wren-ui/src/utils/workspaceGovernance.ts`
  - 保留“workspace / KB 类型治理常量与纯计算 helper”
  - 不再继续承载角色/权限判断
- `wren-ui/src/server/backgrounds/scheduleWorker.ts`
  - system / scheduled_job actor 收敛

### 9.1.1 `workspaceAccess.ts` / `workspaceGovernance.ts` 的去向

明确收口策略：

#### `workspaceAccess.ts`

当前职责里包含：

- manager 角色判断
- 成员管理层级判断

这些都属于**授权规则**，Phase 1 后不应继续作为独立权限入口扩张。

目标状态：

1. 将规则迁入 `wren-ui/src/server/authz/rules/`
2. route / controller 改为调用 `authorize()`，历史 resolver 迁移期继续调用 `authorize()`
3. `workspaceAccess.ts` 仅保留短期兼容导出，或在 Phase 1 收口后删除

一句话：

- **`workspaceAccess.ts` 是待退休文件，不是长期权限中心。**

#### `workspaceGovernance.ts`

当前职责混合了两类内容：

1. 领域常量 / 类型判断
   - `WORKSPACE_KINDS`
   - `KNOWLEDGE_BASE_KINDS`
   - `isDefaultWorkspace`
   - `isSystemSampleKnowledgeBase`
2. 带角色语义的可变更判断
   - `canMutateKnowledgeBase`

目标状态：

1. **保留**领域常量与不依赖 actor 的纯治理 helper
2. 将涉及角色/权限的函数迁入 `authz/`
3. 前端只继续使用纯 UI 能力提示 helper，不使用它做最终安全判断

一句话：

- **`workspaceGovernance.ts` 保留为治理/常量模块，不保留为权限判定模块。**

### 9.1.2 历史 resolver 授权接入路径（仅保留迁移背景）

Wave C 当时采用**请求上下文注入 + resolver 入口显式调用**，不做 directive 方案。

当前状态：

- 运行时主链已经改为 REST route / controller / server context 接入
- `AuthorizationActor` 的组装与读取应以 `src/pages/api/v1/**`、`src/server/context/**`、`src/server/authz/**` 为准
- 下面这段 GraphQL / resolver 方案仅用于说明当时为什么没有选择 directive

当时的决策原因：

- 历史 GraphQL gateway 已经会构造：
  - `runtimeScope`
  - `requestActor`
- 直接复用当时的 request context 形态，改动最小
- directive 需要额外 schema 装饰与 resolver 包装，超出当时 Phase 1 范围

历史实施方式摘要：

1. 当时 `ctx.requestActor` 只有：
   - `sessionToken`
   - `actorClaims`
   - `userId`
   - `workspaceId`
   并**不包含 `isPlatformAdmin`**
2. 因此当时的 GraphQL 方案是：
   - 在 request context 构造阶段新增 `authorizationActor`
   - 不让 resolver 自己重复拼装
3. `authorizationActor` 的来源：
   - 复用已有 session 解析结果
   - 必要时扩展 `resolveRequestActor()` 返回值
   - 或新增 `resolveAuthorizationActorFromRequest()` 专用 helper
4. `IContext` 增加：
   - `authorizationActor?: AuthorizationActor | null`
5. resolver 侧统一读取：
   - `ctx.authorizationActor`
   - 不直接拼 `ctx.requestActor`
6. 历史 GraphQL mutation / 敏感 query 在 resolver 入口先调用：
   - `authorize({ actor, action, resource, context })`
7. resolver 通过授权后，再进入现有 service

不采用：

- schema directive
- resolver 外自动反射式授权（未采用）
- 在 Phase 1 强制所有 service actor-aware

### 9.2 首批需要接授权的 API

- `wren-ui/src/pages/api/v1/workspace/**`
- `wren-ui/src/pages/api/v1/knowledge/**`
- `wren-ui/src/pages/api/v1/connectors/**`
- `wren-ui/src/pages/api/v1/skills/**`
- `wren-ui/src/pages/api/auth/**`

### 9.3 Migration 目录

后续新增 migration 建议按以下主题拆分：

1. `add_authorization_audit_fields`
2. `create_role_permission_tables`
3. `create_service_account_and_api_token_tables`
4. `expand_auth_identity_for_workspace_sso`
5. `create_access_review_and_impersonation_tables`

---

## 10. 回归验证

每个阶段都要跑：

### 10.1 后端测试

- API tests
- service tests
- repository tests

### 10.2 人工验证

至少覆盖：

1. bootstrap owner
2. local register/login/logout
3. 平台 admin 创建 workspace
4. owner/admin/member 差异行为
5. 邀请 / 审批 / 拒绝 / 移除
6. 默认 workspace 与业务 workspace 的边界
7. schedule 创建、执行、失败审计

### 10.3 安全回归

必须验证：

1. workspace 越权读写不能成功
2. 未登录不可触发管理动作
3. rate limit 生效
4. 审计记录可追踪 actor / resource / result

### 10.4 迁移安全机制（替换 inline check 时）

Phase 1 替换现有手写：

- `if (roleKey === 'owner')`
- `isWorkspaceManagerRole(...)`
- `canMutateKnowledgeBase(...)`

时，采用**轻量双判定迁移**，不是单次硬切。

策略：

1. 在被改造的 route / controller / 历史 resolver 中：
   - 先执行新 `authorize()`
   - 同时保留旧 inline check
2. 在过渡期：
   - 若新旧结果不一致，打 warning log / telemetry / 审计备注
3. 首轮合入时：
   - 以旧逻辑结果为最终行为
   - 新逻辑仅做镜像比对
4. 确认一轮回归无偏差后：
   - 切换为新逻辑生效
   - 旧逻辑退化为断言或直接删除

说明：

- 不单独建设“shadow compare 平台”
- 只在被改造的 endpoint / controller / 历史 resolver 局部双判定
- 目标是降低 Wave A/B/C 的静默授权回归风险

---

## 11. 推荐实施顺序

建议按以下小步推进：

### Wave A

- 落 `authz/` 目录
- 定义 `Action`、`AuthorizationActor`、`legacyRolePolicyMap`
- 先接 workspace 管理接口

### Wave B

- 扩 `audit_event`
- 接 auth 限流
- 接 workspace schedule / member 相关动作

### Wave C

- 接 KB / connector / skill 管理接口
- 补历史 GraphQL 管理 mutation（仅迁移期存量）

### Wave D

- 建 `role / permission / principal_role_binding`
- 做 dual-read / dual-write 过渡

### Wave E

- 建 `service_account / api_token`
- 收敛 background actor

### Wave F

- 接 workspace 级 OIDC / SAML / SCIM

---

## 12. 明确不在本计划首批做的事

首批不做：

1. Zanzibar/ReBAC 全图授权系统
2. 复杂组织树 / 部门树
3. 通用自定义角色 UI
4. 多套 tenant 概念并存
5. 以 KB 级成员表替代 workspace 级权限模型

---

## 13. 最终建议

对当前仓库，最现实的路线是：

1. **先做 Phase 1**
   - 这是最小风险、最高收益的部分
2. **Phase 2 与 Phase 3 紧接着做**
   - 把兼容字段收敛成结构化模型
3. **Phase 4 最后做**
   - 因为它涉及 UI、认证流程、外部身份协议

一句话总结：

- **先收口授权内核，再做角色结构化，再接企业身份。**
