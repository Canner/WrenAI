# 用户 / 角色 / 权限体系设计（多租户完整版）

更新时间：2026-04-13

> 本文档用于定义 WrenAI 在多租户前提下的完整用户、角色、权限目标架构。
> 当前系统已经具备最小可用的认证与 workspace 级权限闭环，但还不是完整的企业级身份与授权体系。
> 本方案给出推荐的业界实践、目标形态、数据模型、授权入口与分阶段实施路径。
>
> 落地拆解见：`docs/user-role-permission-implementation-plan.md`

---

## 1. 背景

当前系统已经有：

- `user`
- `auth_identity`
- `auth_session`
- `workspace`
- `workspace_member`
- 平台级 `isPlatformAdmin`
- workspace 级 `owner / admin / member`

并且已经实现了：

- 以 `workspace` 为多租户边界
- 用户可加入多个 workspace
- 默认 workspace（系统样例空间）
- 业务 workspace 创建、邀请、加入、审批
- 关键接口上的基础权限校验

但当前仍属于**最小可用权限模型**，主要问题是：

1. 权限判断分散在 route / service 中
2. 缺少统一 permission registry
3. 缺少完整审计模型
4. 没有 service account / API token 授权体系
5. 没有企业身份集成闭环（OIDC / SAML / SCIM）
6. 还不是可扩展的完整 RBAC / ABAC 授权系统

因此需要收敛出一版完整、可扩展、适合 SaaS 多租户的用户/角色/权限架构。

---

## 2. 设计目标

本方案目标：

1. **认证（AuthN）与授权（AuthZ）解耦**
2. **Workspace 继续作为唯一租户边界**
3. **以 tenant-aware RBAC 为主，必要处补 ABAC / ReBAC**
4. **所有后端权限统一走集中授权入口**
5. **所有关键管理动作具备可审计性**
6. **支持未来接入企业身份协议**
7. **支持服务账号、API Token、自动化调用**

---

## 3. 核心设计原则

### 3.1 认证外部化，授权内部化

推荐原则：

- **“你是谁”**：优先交给标准身份协议与外部 IdP
- **“你能做什么”**：保留在业务系统内部控制

也即：

- AuthN：OIDC / SAML / MFA / Passkey
- AuthZ：workspace、role、permission、resource policy、audit

### 3.2 Workspace 是唯一租户边界

保持当前方向不变：

- Workspace 决定可见性与隔离边界
- KB / Snapshot / Dashboard / Connector 等资源都必须属于某个 workspace
- 不允许跨 workspace 访问资源

### 3.3 RBAC 做底，ABAC / ReBAC 做补充

不采用“纯角色硬编码”方案，而采用：

```text
RBAC（角色权限）
  + ABAC（资源属性判断）
  + ReBAC（关系判断，按需引入）
```

示例：

- RBAC：`workspace_admin` 可以管理成员
- ABAC：但不能修改 `system_sample` KB
- ReBAC：仅能管理自己所在 workspace 的资源

### 3.4 默认拒绝

授权策略必须遵循：

- deny by default
- least privilege
- 每个请求都校验权限
- 不信任前端传入的权限状态

### 3.5 审计先行

所有管理动作必须可追溯：

- 谁
- 在哪个 workspace
- 对哪个资源
- 做了什么
- 是否成功
- 变更前后摘要

---

## 4. 目标架构

### 4.1 分层

```text
Identity Layer
  - user
  - auth_identity
  - auth_session
  - identity_provider

Tenant Layer
  - workspace
  - workspace_member

Authorization Layer
  - role
  - permission
  - role_permission
  - principal_role_binding

Governance Layer
  - workspace_invitation
  - access_request
  - audit_event
  - access_review

Automation Layer
  - service_account
  - api_token
```

### 4.2 统一授权入口

所有后端写操作与敏感读操作必须统一走：

```ts
authorize(actor, action, resource, context)
```

示例：

```ts
authorize(actor, 'workspace.create', null, ctx)
authorize(actor, 'workspace.member.invite', workspace, ctx)
authorize(actor, 'knowledge_base.update', knowledgeBase, ctx)
authorize(actor, 'dashboard.schedule.manage', dashboard, ctx)
authorize(actor, 'connector.rotate_secret', connector, ctx)
```

该入口内部统一处理：

1. 是否已认证
2. 是否在同一 workspace / tenant
3. 是否命中角色权限
4. 是否命中资源属性约束
5. 是否命中特殊业务约束
6. 默认拒绝

---

## 5. 认证体系（AuthN）

### 5.1 推荐形态

#### 本地账号

保留，但用途收敛为：

- 本地开发
- bootstrap 首个管理员
- break-glass 应急账号

#### OIDC

推荐作为正式环境主路径：

- Google / Microsoft / Okta / Auth0 / Keycloak 等
- 支持标准 OIDC 登录
- 用户首次登录时可 JIT provisioning
- **V1 明确采用 workspace 级 IdP 配置模型**
  - 即：一个 workspace 可独立配置自己的 OIDC / SAML
  - 该选择与当前 `identity_provider_config.workspace_id` 的 schema 一致
  - 更适合 SaaS 多租户场景：每个企业客户可绑定自己的企业 IdP
  - 对于单租户 / 自部署场景，可通过“仅启用一个业务 workspace”近似实现平台统一 SSO
  - 若未来需要真正的平台级统一 IdP，再新增 `platform` scope 的 identity provider 配置，而不是在 V1 文档里保留歧义

#### SAML

面向企业版补充：

- 与企业 IdP 集成
- 满足企业统一登录要求
- 同样遵循 **workspace 级 IdP 配置**

#### SCIM

作为企业目录同步能力：

- 自动创建/停用用户
- 自动同步 group / membership

#### MFA / Passkey

推荐用于：

- 平台管理员
- 企业租户管理员
- 高风险登录

当前代码现状说明：

- 登录页当前仍是**本地账号登录 / 注册**
- 设置页文案也明确为“当前版本支持本地账号体系，后续会扩展企业 SSO / OIDC”
- 因此本文里的 OIDC / SAML / SCIM 均属于**目标架构与分阶段落地能力**，不是已上线现状

### 5.2 认证侧数据模型

建议新增或扩展：

- `identity_provider`
- `identity_provider_config`
- `mfa_enrollment`
- `passkey_credential`
- `sso_session`

说明：

- `identity_provider_config` 在 V1 中以 **workspace scope** 为准
- 不在本阶段引入“同一套 schema 同时支持 platform 级和 workspace 级 IdP”双语义
- 避免实现时出现到底按平台统一登录还是按租户独立登录的歧义

### 5.3 SSO 身份绑定主键

当前代码里：

- `user.email` 是全局唯一
- `auth_identity(provider_type, provider_subject)` 是全局唯一
- `identity_provider_config` 是 workspace 级

因此如果要真正落地 **workspace 级 SSO**，不能把 email 当成外部身份唯一键。

V1 目标约束：

- SSO 身份绑定主键应为：
  - `identity_provider_config_id + external_subject`
  - 或语义等价的 `issuer + subject`
- email 仅作为辅助声明与展示字段，不作为 SSO 主身份键

实现建议：

- Phase 4 落地 SSO 前，扩展 `auth_identity` 结构，使其能表达：
  - `identityProviderConfigId`
  - `issuer`
  - `externalSubject`
- 如果过渡期不立即改列结构，至少要保证 `provider_subject` 存储的是**带命名空间的 subject**，例如：
  - `<identity_provider_config_id>#<subject>`
  - 或 `<issuer>#<subject>`

### 5.4 Workspace 级 SSO 的登录发现（discovery）

由于 V1 明确采用 workspace 级 IdP 配置，因此必须定义用户如何找到正确的 IdP。

V1 建议采用：

- `workspaceSlug` 驱动的登录发现

推荐流程：

1. 用户访问统一登录页
2. 输入 `workspaceSlug` 或进入 `/auth/sso/start?workspaceSlug=<slug>`
3. 服务端按 `workspaceSlug -> identity_provider_config` 解析启用中的 IdP
4. 跳转到对应 workspace 的 OIDC / SAML
5. callback 后恢复到该 workspace 的 runtime selector

不建议在 V1 同时混用：

- email domain discovery
- 多子域自动发现
- workspace 选择器 + email first 多入口

否则实现会复杂化。

---

## 6. 授权体系（AuthZ）

## 6.1 Scope 模型

权限作用域建议固定为：

- `platform`
- `workspace`
- `knowledge_base`
- `dashboard`
- `connector`
- `api_token`

初期可以先重点落：

- `platform`
- `workspace`
- `knowledge_base`

### 6.2 角色模型

#### 平台级角色

- `platform_admin`
- `support_readonly`
- `support_impersonator`（严格审计，默认关闭）

#### Workspace 级角色

- `workspace_owner`
- `workspace_admin`
- `workspace_editor`
- `workspace_viewer`

#### 资源级角色（按需引入）

- `kb_admin`
- `kb_editor`
- `kb_viewer`
- `dashboard_editor`

> 默认不要一开始就大量引入资源级角色；优先用 workspace 级角色 + 资源属性规则收口。

### 6.2.1 当前角色到新角色的过渡映射

当前仓库实际角色是：

- `owner`
- `admin`
- `member`

建议在迁移期按以下方式映射：

| 当前角色 | 新模型对应 | 说明 |
|---|---|---|
| `owner` | `workspace_owner` | 直接映射 |
| `admin` | `workspace_admin` | 直接映射 |
| `member` | `workspace_viewer` | V1 先按只读成员理解 |

说明：

- `workspace_editor` 是未来新增角色，不要求在 Phase 1/2 与现有 `member` 一次性对齐
- 在 Phase 2 之前，数据库中仍可继续存 `owner/admin/member`
- 新角色命名主要用于目标模型与 permission registry 设计

### 6.3 Permission Registry

建议显式定义权限枚举，而不是继续散落字符串判断。

示例：

- `workspace.create`
- `workspace.read`
- `workspace.update`
- `workspace.member.invite`
- `workspace.member.approve`
- `workspace.member.remove`
- `workspace.default.set`
- `knowledge_base.create`
- `knowledge_base.update`
- `knowledge_base.archive`
- `knowledge_base.read`
- `connector.create`
- `connector.update`
- `connector.rotate_secret`
- `dashboard.create`
- `dashboard.update`
- `dashboard.schedule.manage`
- `api_token.create`
- `api_token.revoke`

### 6.4 管理后台信息架构（Admin IA）

为了避免用户把权限体系误解为“只是 workspace 页里的几个管理模块”，目标态应明确区分：

- **工作空间运营（Workspace Operations）**
- **访问治理（Access Governance）**
- **平台治理（Platform Governance）**

推荐的设置菜单结构：

#### 所有已登录用户可见

- `设置 / 个人设置`

#### 当前 workspace 上下文内可见

- `设置 / 用户与访问`
  - 成员管理
  - 角色与权限
  - 企业身份（OIDC / SAML / SCIM）
  - 目录组
  - 服务账号
  - API Token
  - Access Review
  - Break-glass / Impersonation

#### 仅 `platform_admin` 可见

- `设置 / 平台管理`
  - 平台管理员治理
  - workspace 创建 / 状态治理
  - 平台级审计 / 高风险操作审计
  - 平台级 break-glass / 支持人员代理策略（如启用）

边界说明：

1. **“用户与访问”不是全平台用户后台**
   - 默认语义是：**当前 workspace 的身份与权限治理中心**
   - 因为 V1 / V2 模型中 `workspace` 仍是唯一租户边界
2. **“平台管理”才承载全局治理**
   - 仅对 `platform_admin` 开放
3. **`/workspace` 页面不应继续承载主权限治理操作**
   - `workspace` 页应收敛为工作空间资料、偏好、运营状态
   - 权限治理操作应收口到设置域下的独立入口

命名建议：

- 一级菜单优先使用 **“用户与访问”**
- 若需要更技术化命名，可接受 **“访问治理”**
- 不建议继续把权限系统主入口命名成“工作空间设置”

### 6.5 ABAC / ReBAC 规则

以下规则不适合只靠角色表达，应在 `authorize()` 中补：

- `resource.workspaceId == actor.workspaceId`
- `knowledgeBase.kind != 'system_sample'`
- `workspace.kind != 'default'`
- `snapshot is latest executable`
- `connector belongs to current knowledge base`
- `actor cannot manage owner membership unless actor is owner`
- `actor cannot remove self in current workspace`

---

## 7. 数据模型建议

## 7.1 身份表

### `user`

保留并扩展：

- `id`
- `email`
- `display_name`
- `locale`
- `status`
- `is_platform_admin`（兼容期可保留）
- `default_workspace_id`

> 长期建议将 `is_platform_admin` 退化为 platform scope 下的角色绑定，而不是永远保留布尔字段。
>
> 但在 **Phase 1 过渡期**，`is_platform_admin` 仍然是实际有效字段，`authorize()` 的 actor 构造必须显式携带它，不能假设仅靠 `actorClaims` 就能表达平台级权限。
>
> 也就是说：
>
> - **短期兼容字段**：`user.is_platform_admin`
> - **长期单一真相**：`platformRoleKeys` / `principal_role_binding`

### `auth_identity`

保留：

- `provider_type`
- `provider_subject`
- `password_hash`
- `metadata`

### `auth_session`

保留并增强：

- `ip_address`
- `user_agent`
- `mfa_level`
- `impersonator_user_id`（如支持代理登录）

---

## 7.2 租户表

### `workspace`

保留：

- `id`
- `name`
- `slug`
- `kind`
- `status`
- `settings`

### `workspace_member`

保留：

- `workspace_id`
- `user_id`
- `role_key`
- `status`

成员状态：

- `active`
- `invited`
- `pending`
- `rejected`
- `inactive`

---

## 7.3 授权表

### `role`

```text
id
name
scope_type
description
is_system
```

### `permission`

```text
id
name
scope_type
description
```

### `role_permission`

```text
role_id
permission_id
```

### `principal_role_binding`

```text
id
principal_type   -- user / service_account / group
principal_id
role_id
scope_type       -- platform / workspace / knowledge_base / dashboard
scope_id
created_by
```

该模型支持：

- 用户在 platform 下有角色
- 用户在 workspace 下有角色
- 后续 group / service_account 复用同一模型

---

## 7.4 治理与审计表

### `workspace_invitation`

如果不再只靠 `workspace_member.status='invited'`，建议单独建表：

- 邀请人
- 被邀请邮箱 / 用户
- workspace
- role
- token / 过期时间
- 状态

### `access_request`

记录申请加入或更高权限申请：

- 申请人
- 目标 scope
- 申请角色
- 原因
- 状态

### `audit_event`

当前仓库已经存在 `audit_event` 表，因此推荐策略是：

- **扩展现有 `audit_event`**
- 不新增一张并行的 `audit_log`

强制落库字段建议：

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
- `created_at`

### `access_review`

用于后续企业版：

- 周期性权限复核
- owner/admin 确认成员是否应保留访问权限

---

## 7.5 自动化主体

### `service_account`

建议新增：

- `id`
- `workspace_id`
- `name`
- `status`
- `created_by`

### `api_token`

建议新增：

- `id`
- `service_account_id` 或 `user_id`
- `name`
- `token_hash`
- `scope_type`
- `scope_id`
- `expires_at`
- `revoked_at`

---

## 8. 当前代码库的演进建议

## 8.1 保留现有能力

现有这些能力可以继续保留作为过渡层：

- `user.isPlatformAdmin`
- `workspace_member.roleKey`
- `workspace_member.status`
- 默认 workspace / 业务 workspace 设计
- `workspace` 作为唯一租户边界
- `audit_event` 作为现有审计表基础

## 8.2 第一阶段不要推翻重做

不建议立刻把全仓库改成复杂权限系统。

应该先做：

1. permission registry
2. 统一 `authorize()`
3. 审计事件扩表（基于 `audit_event`）
4. service account / api token
5. OIDC 接入

而不是先做：

- 复杂 group 嵌套
- 重型资源图授权系统
- 全量自定义角色 UI

---

## 9. 统一授权层设计

### 9.1 接口

建议新增统一授权服务：

```ts
type Action =
  | 'workspace.create'
  | 'workspace.member.invite'
  | 'knowledge_base.update'
  | 'connector.update'
  | 'dashboard.schedule.manage';

authorize({
  actor,
  action,
  resource,
  context,
});
```

### 9.2 输入

- `actor`
  - userId / principalType
  - active workspace
  - workspace roles
  - platform roles
  - permissions
- `resource`
  - resourceType
  - resourceId
  - workspaceId
  - ownerId
  - attributes
- `context`
  - requestId
  - ip
  - session
  - runtime scope

### 9.2.1 Phase 1 的 actor 结构（过渡态）

由于当前代码里：

- workspace 级角色主要来自 `validatedSession.actorClaims`
- 平台级权限主要来自 `validatedSession.user.isPlatformAdmin`
- 当前 `actorClaims.permissionScopes` 仍是粗粒度兼容字段（如 `workspace:*` / `knowledge_base:*`）

所以 **Phase 1 的 `authorize()` 不能只吃 `actorClaims`**，必须构造一个显式的统一 actor：

```ts
type AuthorizationActor = {
  principalType: 'user' | 'service_account';
  principalId: string;
  workspaceId?: string | null;
  workspaceMemberId?: string | null;
  workspaceRoleKeys: string[];
  permissionScopes: string[];
  isPlatformAdmin: boolean; // 过渡期兼容字段
  platformRoleKeys: string[]; // Phase 1 可由 isPlatformAdmin 映射得出
};
```

构造规则：

- `workspaceRoleKeys` 来自 `validatedSession.actorClaims.roleKeys`
- `permissionScopes` 来自 `validatedSession.actorClaims.permissionScopes`
- `isPlatformAdmin` 来自 `validatedSession.user.isPlatformAdmin`
- `platformRoleKeys` 在 Phase 1 中可按：
  - `true -> ['platform_admin']`
  - `false -> []`

### 9.2.2 Phase 1 的权限来源

当前代码里的 `permissionScopes` 粒度较粗，不能直接覆盖未来的细粒度 permission registry。

因此 Phase 1 建议明确采用：

- **代码内 `legacyRolePolicyMap` / `actionPolicyMap` 作为真正授权来源**
- `actorClaims.permissionScopes` 仅作为兼容输入与调试辅助信息

示意：

```ts
const legacyRolePolicyMap = {
  owner: ['workspace.member.invite', 'knowledge_base.update', 'dashboard.schedule.manage'],
  admin: ['workspace.member.invite', 'knowledge_base.update', 'dashboard.schedule.manage'],
  member: ['workspace.read', 'knowledge_base.read'],
};
```

也就是说：

- Phase 1：`authorize()` 主要根据
  - `workspaceRoleKeys`
  - `platformRoleKeys`
  - `resource attributes`
  - `runtime constraints`
  来判断
- Phase 2：当 `role / permission / role_permission` 落地后，再把其升级为真正单一真相来源

### 9.2.3 Phase 2 之后的收敛方向

当 `principal_role_binding` 落地后：

- `isPlatformAdmin` 退为兼容字段
- `platformRoleKeys` 成为真正来源
- 平台级与 workspace 级角色统一从 role binding 解析

### 9.3 行为

- 返回 allow / deny
- 返回 deny reason
- 可直接抛标准授权异常

### 9.4 最佳实践

- 所有写操作必须调用
- 敏感读操作也必须调用
- 所有 deny 都可审计
- 任何 fallback 都不能绕过它

### 9.5 Phase 1 的落点：先在 route / controller 收口，历史 resolver 仅补迁移期存量

当前代码库的 service 层普遍以：

- `workspaceId`
- `knowledgeBaseId`
- `memberId`

作为参数，不直接接收 actor。

因此 **Phase 1 不要求一次性把所有 service 改成 actor-aware**，否则改动面会过大。

V1 推荐策略：

1. **先在 route / controller / mutation 入口构造 `AuthorizationActor`，历史 resolver 迁移期同步补齐**
2. 在进入 service 前调用统一 `authorize()`
3. service 层继续保留：
   - 租户一致性校验
   - 资源归属校验
   - invariant 校验
4. 对高复用、跨多个入口共享的敏感 service，再在 Phase 2 逐步引入 actor-aware wrapper

也即：

- **Phase 1：入口层统一授权**
- **Phase 2：按需下沉到 service 边界**

这样更符合当前仓库的迁移成本与风险控制。

### 9.6 非请求主体（background / system actor）

当前仓库已存在：

- `schedule_job.created_by`
- `scheduleWorker`
- 背景任务 / 定时任务执行链路

因此完整授权模型必须覆盖**非请求型主体**。

建议扩展 `AuthorizationActor.principalType`：

- `user`
- `service_account`
- `system`
- `scheduled_job`

V1 语义建议：

1. **调度任务的“创建/修改/启停”** 仍以真实用户权限校验
2. **调度任务真正执行时** 不依赖 live user session
3. 执行 actor 采用：
   - `principalType = 'system'`
   - 并在上下文 / 审计中保留：
     - `requestedByUserId`
     - `createdByUserId`
     - `scheduleJobId`
4. 后台执行时继续强制校验：
   - workspace / KB / snapshot binding
   - 资源仍然存在且仍属同 tenant
   - 任务状态仍允许执行

这样可避免：

- 用户 session 过期导致后台任务无法运行
- 在 worker 里伪造用户 session
- 审计中分不清“谁创建的任务”和“谁实际执行了任务”

---

## 10. 审计与安全治理

## 10.1 强制审计的动作

至少包括：

- 用户创建 / 停用
- workspace 创建
- workspace 成员邀请 / 审批 / 降权 / 移除
- KB 创建 / 归档 / 恢复 / 删除（若未来开放）
- connector 创建 / 更新 / rotate secret
- service account / token 创建与吊销
- 支持人员代理登录 / break-glass 访问
- 调度任务创建 / 修改 / 执行 / 失败

## 10.2 安全基线

建议明确：

- deny by default
- least privilege
- 平台管理员操作需二次验证（后续）
- 高风险动作写审计
- 不允许未审计的 impersonation
- `/api/auth/login`、`/api/auth/bootstrap`、`/api/auth/register` 必须具备速率限制
- 必须有基础暴力破解防护（IP / identity / session 维度限流与退避）
- 认证失败事件需要进入安全审计或至少进入安全计数器

---

## 11. 分阶段实施路线

## Phase 1：授权内核收敛

目标：把当前“散落 if 判断”升级为统一授权内核。

交付：

1. `permission registry`
2. `authorize()` 服务
3. 将核心 API / controller 入口接入统一授权层（历史 resolver 仅保留迁移期补齐）
4. 基于现有 `audit_event` 扩展审计模型
5. 敏感管理动作落审计
6. `AuthorizationActor` 过渡模型（显式包含 `isPlatformAdmin`）
7. auth 端点速率限制与暴力破解防护
8. `legacyRolePolicyMap` 作为 Phase 1 权限来源
9. background / schedule actor 语义收敛

Phase 1 的实现边界：

- 以 **route / controller 入口统一授权** 为主（历史 resolver 仅作迁移期兼容）
- 不要求所有 service 同步改成 actor-aware
- service 继续承担资源归属与 invariant 校验

## Phase 2：角色体系结构化

目标：从固定角色判断过渡到可扩展角色权限表。

交付：

1. `role / permission / role_permission`
2. `principal_role_binding`
3. 平台级与 workspace 级角色显式化
4. 兼容 `isPlatformAdmin -> platform role`

## Phase 3：自动化主体与令牌

目标：支持后端自动化、API 管理、集成调用。

交付：

1. `service_account`
2. `api_token`
3. token scope 与 revoke 机制
4. token 审计

## Phase 4：企业身份接入

目标：接入标准企业身份体系。

交付：

1. OIDC SSO
2. SAML SSO
3. SCIM Provisioning（先以 user provisioning / deprovisioning 为主）
4. MFA / Passkey

说明：

- Phase 4 的 SCIM V1 先聚焦：
  - 用户创建
  - 用户停用
  - 基础 workspace membership provisioning（如需要）
- **不要求在该阶段完成 group -> role 自动映射**
- 登录 UI / SSO discovery / callback 编排也都属于该阶段交付，不应误解为当前前端已经具备企业登录入口

## Phase 5：治理增强

目标：达到企业可管控水平。

交付：

1. access review
2. impersonation with audit
3. break-glass policy
4. group-based role binding
5. SCIM / directory group 到 role binding 的自动映射

---

## 12. 非目标

本阶段不做：

- 引入 KB 级成员表作为默认访问模型
- 立即构建 Zanzibar 风格全图关系授权系统
- 前端可视化自定义角色编辑器
- 站外邮件邀请全链路
- 复杂组织树 / 部门树 / 成本中心模型

---

## 13. 验收标准

完成 V1 后，系统至少满足：

1. 所有关键后端管理动作都经过统一授权入口
2. 所有资源访问都强制受 workspace 边界约束
3. 平台角色与 workspace 角色可清晰区分
4. 权限模型不再散落为大量手写判断
5. 所有关键权限变更具备审计记录
6. 支持 OIDC 接入的演进路径清晰

---

## 14. 对当前仓库的最终建议

基于当前代码状态，推荐的现实路线是：

### 先做

1. `permission registry`
2. `authorize()` 集中授权
3. 扩展现有 `audit_event`
4. `service_account / api_token`
5. OIDC 接入

### 后做

1. SAML
2. SCIM
3. access review
4. group / directory integration

### 暂不做

1. 重型资源图权限系统
2. KB 级成员模型
3. 大而全的自定义角色中心

---

## 15. 参考资料

- OWASP Authorization Cheat Sheet  
  https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

- NIST RBAC Model  
  https://www.nist.gov/publications/nist-model-role-based-access-control-towards-unified-standard

- NIST: Adding Attributes to Role-Based Access Control  
  https://www.nist.gov/publications/adding-attributes-role-based-access-control

- NIST SP 800-63B  
  https://pages.nist.gov/800-63-4/sp800-63b.html

- OpenID Connect Core 1.0  
  https://openid.net/specs/openid-connect-core-1_0-18.html

- SCIM Protocol (RFC 7644)  
  https://www.rfc-editor.org/rfc/rfc7644
