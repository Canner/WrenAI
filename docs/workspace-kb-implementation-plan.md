# Workspace / Knowledge Base 实施计划

更新时间：2026-04-12

> 本文档是 `docs/workspace-kb-design.md` 的落地实施说明。
> 目标：把“默认 workspace = 系统样例空间、业务数据只进入业务 workspace、多 workspace 记忆与默认进入”这套设计，收敛为一组可以直接实现的 schema / service / API / 前端改造任务。

---

## 1. 实施目标

本次实施完成后，系统应满足以下最终状态：

1. 系统内存在且仅存在 **1 个默认 workspace**，其用途仅为承载系统样例 KB
2. 默认 workspace 自动预置 **HR / ECOMMERCE / MUSIC / NBA** 4 个 sample KB
3. 默认 workspace 中的 sample KB 为 **系统托管只读资产**：
   - 不允许创建业务 KB
   - 不允许接入业务 connector
   - 不允许用户删除 / 隐藏 / 归档 / 重命名 / 改写
4. **新注册用户** 自动加入默认 workspace，角色为 `member`
5. **仅平台级 admin** 可以创建业务 workspace
6. 创建业务 workspace 时，必须指定一个**已有用户**作为初始 `owner`
7. 业务 workspace 的成员进入方式收敛为：
   - manager 邀请（`invited`）
   - 用户申请（`pending`）
   - manager 审批为 `active`
8. 业务 workspace 中的普通 KB 仅支持 `archive / unarchive`，不支持硬删除
9. 多 workspace 进入优先级固定为：
   - URL 显式 selector
   - 本地上次成功 selector
   - 用户服务端 `defaultWorkspaceId`
   - 系统默认 workspace

---

## 2. 需要定死的实现决策

### 2.1 数据模型决策

#### `user`
新增字段：

- `is_platform_admin boolean not null default false`
- `default_workspace_id text null references workspace(id)`

说明：

- `is_platform_admin` 用于控制“创建业务 workspace”权限
- `default_workspace_id` 是账号级默认进入 workspace 的唯一来源
- 不新增 user settings JSON；本期直接落列，减少读写分叉

#### `workspace`
新增字段：

- `kind text not null check (kind in ('default', 'regular'))`

约束：

- 仅允许 **1 条 `kind='default'`** 的 workspace 记录（唯一约束 / partial unique index）
- 默认 workspace 仍可通过 `workspace.id` 正常参与现有 runtime scope 逻辑
- 不再用 `settings.joinPolicy` 承担“公开/邀请/申请”策略控制

#### `knowledge_base`
新增字段：

- `kind text not null check (kind in ('system_sample', 'regular'))`

约束：

- 默认 workspace 下只允许 `kind='system_sample'`
- 业务 workspace 下只允许 `kind='regular'`
- `kind='system_sample'` 的 KB 必须满足：
  - `sample_dataset is not null`
  - `archived_at is null`
- 不依赖 `sampleDataset` 单独推断“是否系统样例”，统一以 `knowledge_base.kind` 为准

#### `workspace_member`
沿用现有字段与状态：

- 角色：`owner / admin / member`
- 状态：`active / invited / pending / rejected / inactive`

本期不新增 KB 级成员关系表。

---

### 2.2 Bootstrap 决策

bootstrap 流程改为**幂等初始化**：

1. 若不存在 `kind='default'` 的 workspace，则创建默认 workspace
2. 若默认 workspace 缺少 sample KB，则补齐缺失的样例 KB
3. 第一个 bootstrap 用户：
   - `is_platform_admin = true`
   - 成为默认 workspace 的 `owner`
4. bootstrap 后续重复执行时：
   - 不重复创建默认 workspace
   - 不重复创建 sample KB
   - 不覆盖已有业务数据

默认 workspace 名称可沿用现有“系统工作空间 / Demo Workspace”文案，但数据库语义以 `kind='default'` 为准。

---

### 2.3 注册 / 邀请决策

#### 新用户注册
新增 `POST /api/auth/register`：

- 创建本地用户与本地身份
- 自动加入默认 workspace，角色 `member`，状态 `active`
- 创建 session 并直接登录
- 若默认 workspace 不存在则报系统配置错误（不在 register 中补建）

#### 邀请语义（V1）
业务 workspace 邀请仅支持**邀请已注册用户**：

- manager 输入 email
- 若该 email 对应用户不存在，则返回明确错误
- 不做站外邮件邀请链路
- 邮件通知 / magic link 继续保持 out of scope

#### 申请语义（V1）
用户可以对**业务 workspace**发起加入申请：

- 创建或复用一条 `workspace_member(status='pending')`
- manager 审批后转为 `active`

#### 接受邀请
`/api/v1/workspace/join` 保留，但语义收敛为：

- 仅用于把 `invited -> active`
- 不再承担 `open/public` 直接加入逻辑

#### 移除的策略
不再支持：

- `open`
- `invite_only`
- `request`

业务 workspace 固定支持：

- 管理员邀请
- 用户申请

默认 workspace 不走 join/apply，注册即自动加入。

---

## 3. 后端改造计划

## 3.1 Migration / Schema

新增 migration：

1. `user`
   - add `is_platform_admin`
   - add `default_workspace_id`
2. `workspace`
   - add `kind`
   - 为 `kind='default'` 建唯一约束
3. `knowledge_base`
   - add `kind`
4. 数据回填：
   - 现有 workspace 默认回填为 `regular`
   - 现有 knowledge_base 默认回填为 `regular`
   - bootstrap 创建的系统样例 KB 回填为 `system_sample`

迁移顺序：

1. 先加列并回填默认值
2. 再加约束
3. 最后切业务逻辑

---

## 3.2 Service 层

### `AuthService`
需要新增/调整：

- `bootstrapOwner()`
  - 创建首个用户时同时赋予 `is_platform_admin=true`
  - 确保默认 workspace 已存在并建立 owner membership
- `registerLocalUser()`
  - 去掉“必须传 workspaceId”的主路径要求
  - 改为服务端解析默认 workspace 并自动挂载 membership
- `login()` / `validateSession()`
  - 返回 `isPlatformAdmin`
  - 返回 `defaultWorkspaceId`

### `WorkspaceService`
需要新增/调整：

- `createWorkspace()`
  - 仅允许平台 admin 调用
  - 入参必须包含 `initialOwnerUserId`
  - 创建 `kind='regular'` 的 workspace
  - 同事务创建该 owner 的 `workspace_member(roleKey='owner', status='active')`
- `inviteMemberByEmail()`
  - 仅限业务 workspace
  - 仅邀请已注册用户
  - 创建/更新为 `invited`
- `applyToWorkspace()`（新增）
  - 仅限业务 workspace
  - 创建/更新为 `pending`
- `approveMember()` / `rejectMember()`
  - 统一收敛 `pending/invited -> active/rejected`

### `KnowledgeBaseService`
需要新增/调整：

- `createKnowledgeBase()`
  - 默认 workspace 一律拒绝
  - 业务 workspace 只能创建 `kind='regular'`
- `updateKnowledgeBase()`
  - `kind='system_sample'` 一律只读拒绝
  - `kind='regular'` 允许普通元数据更新
  - archive/unarchive 只允许 `owner/admin`
- 删除路径不新增 hard delete 能力

### Sample KB Seed Service（新增）
新增一个专门的 seed/initializer：

- `ensureDefaultWorkspace()`
- `ensureSampleKnowledgeBases()`

职责：

- 只负责默认 workspace 与 sample KB 的幂等初始化
- 不与普通业务 KB 创建逻辑混用

---

## 3.3 API 层

### Auth
新增：

- `POST /api/auth/register`

调整：

- `GET /api/auth/session`
  - 返回 `isPlatformAdmin`
  - 返回 `defaultWorkspaceId`
  - runtime selector 默认选择逻辑不在 session 里硬编码覆盖，而由 bootstrap/selector 统一计算

### Workspace
新增：

- `POST /api/v1/workspace`
  - 仅平台 admin 可调用
  - body: `{ name, slug?, initialOwnerUserId }`
- `PATCH /api/v1/workspace/preferences`
  - body: `{ defaultWorkspaceId }`
  - 仅允许设置为当前用户已有 active membership 的 workspace

调整：

- `GET /api/v1/workspace/current`
  - 返回 `workspace.kind`
  - 返回用户 `defaultWorkspaceId`
  - `discoverableWorkspaces` 仅包含 `kind='regular'`
- `POST /api/v1/workspace/apply`
  - 仅允许对 `kind='regular'` 发起申请
- `POST /api/v1/workspace/join`
  - 仅允许接受 `invited` 状态邀请
  - 删除 `open/public join` 分支
- `POST /api/v1/workspace/members`
  - 仅允许邀请业务 workspace 成员
- `PATCH/DELETE /api/v1/workspace/members/[id]`
  - 保持审批/拒绝/角色更新逻辑

### Knowledge Base
调整：

- `POST /api/v1/knowledge/bases`
  - 默认 workspace 返回 403
- `PATCH /api/v1/knowledge/bases/[id]`
  - `system_sample` 返回 403（除纯读取外全部禁止）
  - `regular` 支持 archive/unarchive
- 不新增 `DELETE /knowledge/bases/[id]`

---

## 4. 前端改造计划

## 4.1 Runtime Scope / Bootstrap

保留现有 `ClientRuntimeScopeSelector` 持久化方案，新增/调整以下行为：

### 本地持久化
继续沿用现有 `wren.runtimeScope`：

- 保存“上次成功使用的 selector”
- 仅在服务端校验通过后写入

### 服务端偏好
新增 `defaultWorkspaceId` 作为账号级偏好：

- 跨设备生效
- 仅决定 fallback，不覆盖显式 URL / 本地有效 selector

### 启动优先级
在 `RuntimeScopeBootstrap` / `runtimeSelectorResolver` 中统一实现：

1. URL 显式 selector
2. 本地已持久化 selector
3. 服务端 `defaultWorkspaceId`
4. 系统默认 workspace

### 失效回退
若本地 selector 指向：

- 无权限 workspace
- 已归档 / 不可执行 KB
- 无效 snapshot / deploy

则清理本地 selector 并按下一优先级回退。

---

## 4.2 Workspace 页面

`/workspace` 页面需要收敛为以下行为：

- 展示当前用户所在的 active workspace 列表
- 展示可申请加入的业务 workspace 列表
- 默认 workspace 显示为“系统样例空间”标签
- 当前 workspace 可设置为“默认进入 workspace”
- 若当前用户是平台 admin，展示“创建 workspace”入口
- 业务 workspace 显示：
  - 申请加入
  - 已邀请待接受
  - 已申请待审批
- 不再展示 `open / request / invite_only` 三态文案

---

## 4.3 Knowledge Base 页面

`/knowledge` 与首页中的 KB 入口需要新增规则：

- 默认 workspace 中的 sample KB：
  - 显示“系统样例”标识
  - 不显示编辑 / archive / delete / connector 绑定入口
- 业务 workspace 中的 regular KB：
  - owner/admin 可 archive / unarchive
  - member 只读
- 默认 workspace 中不显示“新建 KB”“接入数据源”等入口

---

## 4.4 Auth / Session 页面

- 登录成功后，如果 URL 未指定 workspace：
  - 先走 bootstrap selector 优先级解析
- 注册成功后：
  - 直接落入默认 workspace
- session payload 统一暴露：
  - `isPlatformAdmin`
  - `defaultWorkspaceId`

---

## 5. 文件级实施建议

优先改这些模块：

### 后端 / API
- `wren-ui/src/apollo/server/services/authService.ts`
- `wren-ui/src/apollo/server/services/workspaceService.ts`
- `wren-ui/src/apollo/server/services/knowledgeBaseService.ts`
- `wren-ui/src/pages/api/auth/*`
- `wren-ui/src/pages/api/v1/workspace/*`
- `wren-ui/src/pages/api/v1/knowledge/bases/*`

### Runtime / 前端
- `wren-ui/src/apollo/client/runtimeScope.ts`
- `wren-ui/src/components/runtimeScope/RuntimeScopeBootstrap.tsx`
- `wren-ui/src/apollo/server/resolvers/runtimeSelectorResolver.ts`
- `wren-ui/src/hooks/useAuthSession.ts`
- `wren-ui/src/pages/workspace.tsx`
- `wren-ui/src/pages/knowledge/index.tsx`

### Migration / Repository
- `wren-ui/migrations/*`
- `wren-ui/src/apollo/server/repositories/userRepository.ts`
- `wren-ui/src/apollo/server/repositories/workspaceRepository.ts`
- `wren-ui/src/apollo/server/repositories/knowledgeBaseRepository.ts`

---

## 6. 测试计划

## 6.1 Migration / Bootstrap

- 迁移后仅存在 1 个 `kind='default'` workspace
- bootstrap 重跑不会重复创建默认 workspace
- bootstrap 重跑不会重复创建 4 个 sample KB
- 第一个 bootstrap 用户具备：
  - `is_platform_admin=true`
  - 默认 workspace owner membership

## 6.2 Auth / Register / Session

- register 自动加入默认 workspace
- session 返回 `isPlatformAdmin` 与 `defaultWorkspaceId`
- defaultWorkspaceId 只能设置为自己有 active membership 的 workspace

## 6.3 Workspace 管理

- 非平台 admin 创建 workspace 返回 403
- 平台 admin 创建 workspace 必须传 `initialOwnerUserId`
- initial owner 必须是已存在用户
- apply 仅允许 regular workspace
- join 仅允许 invited membership 接受邀请
- pending 申请只能由 workspace owner/admin 审批

## 6.4 Knowledge Base 限制

- 默认 workspace 创建 KB 返回 403
- 默认 workspace 绑定 connector 返回 403
- `system_sample` KB PATCH 返回 403
- regular KB 可 archive/unarchive
- member 归档 regular KB 返回 403

## 6.5 Runtime Selector

- URL selector 优先于本地 selector
- 本地 selector 优先于 `defaultWorkspaceId`
- `defaultWorkspaceId` 优先于系统默认 workspace
- 本地 selector 失效时自动回退并清理
- 默认 workspace 没有可执行 KB 时，仍能稳定落到 workspace 级页面，不报致命错误

---

## 7. 推荐实施顺序

### Phase 1 — Schema + Bootstrap
- 加 `user/workspace/knowledge_base` 新字段
- 完成默认 workspace / sample KB 幂等 seed

### Phase 2 — Auth + Platform Admin
- 打通 `is_platform_admin`
- 加 `register` 与 `defaultWorkspaceId`

### Phase 3 — Workspace 控制面
- 加创建业务 workspace API
- 收敛 apply / join / invite 语义
- workspace/current 返回新偏好字段

### Phase 4 — KB 生命周期与默认空间限制
- 封死默认 workspace 的业务资源入口
- regular KB 改为 archive-only

### Phase 5 — Runtime Selector 与前端体验
- 接入默认 workspace / 上次选择优先级
- workspace 页面与 knowledge 页面同步收口

### Phase 6 — 回归与验收
- API tests
- service tests
- runtime selector tests
- 页面级 smoke / e2e

---

## 8. 完成标准

满足以下条件即可视为该方案落地完成：

1. 代码和数据库中能明确区分：
   - 默认 workspace
   - 业务 workspace
   - system sample KB
   - regular KB
2. 新用户注册后自动进入默认 workspace
3. 平台 admin 才能创建业务 workspace
4. 业务 workspace 的 owner/admin 可以邀请与审批成员
5. 默认 workspace 中无法新增业务数据或修改 sample KB
6. 业务 KB 只能 archive/unarchive，不能硬删除
7. 多 workspace 启动顺序符合：
   - URL > 本地上次成功选择 > 用户默认 workspace > 系统默认 workspace
8. 所有相关 API / service / selector / page tests 通过

---

## 9. 本期不做

以下内容明确排除在本次实施之外：

- KB 级 ACL
- sample KB 用户个性化隐藏
- 业务 KB 硬删除
- 邮件邀请 / 站外注册链接
- row / column 级权限
- 平台 admin 的细粒度权限系统
