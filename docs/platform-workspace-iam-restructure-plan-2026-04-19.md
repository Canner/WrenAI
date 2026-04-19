# 平台权限 / 工作空间治理重构执行方案

更新时间：2026-04-19  
状态：Proposal / 可直接进入实施排期

> 本文档面向当前 `WrenAI` 设置中心与工作空间治理链路的下一轮收口。目标不是继续给现有“用户管理 / 权限管理 / 工作空间管理”打补丁，而是把**平台级治理**和**工作空间级治理**彻底拆清。

---

## 1. Requirements Summary

本轮改造按以下产品决策执行：

1. **用户管理改为平台级能力**
   - 负责系统用户目录、平台角色、默认工作空间、所属工作空间查看与分配。
2. **权限管理改为平台级能力**
   - 负责平台菜单权限、API capability、平台角色与高风险平台动作控制。
3. **工作空间内的成员与空间权限治理下沉到“工作空间管理”**
   - 每个 workspace 内单独管理成员、owner/viewer 权限、加入/邀请/审批。
4. **workspace 权限先简化为两级**
   - `owner`
   - `viewer`
5. **“创建者”不是权限角色，只是元数据**
   - `createdBy` 保留为审计与展示字段，不参与 ACL 判定。
6. **现有 workspace 自定义角色 / 细粒度绑定不再作为主 UI 路径继续扩张**
   - 先冻结、兼容、下沉；后续若确有业务需要，再重新扩展。

---

## 2. 当前代码与数据事实（作为实施依据）

### 2.1 当前权限模型是“平台 + workspace + legacy 兼容”混合态

- `wren-ui/src/server/services/authService.ts:43-47`
  - 仍保留 legacy 角色：`owner / admin / member`
- `wren-ui/src/server/authz/roleMapping.ts:4-16`
  - legacy 角色会映射到 structured role：
    - `owner -> workspace_owner`
    - `admin -> workspace_admin`
    - `member -> workspace_viewer`
- `wren-ui/src/server/services/authService.ts:837-894`
  - 会同时聚合：workspace bindings、platform bindings、granted actions、legacy fallback
- `wren-ui/src/server/authz/authorize.ts:99-122`
  - workspace action 若 `actor.isPlatformAdmin` 为真，可直接放行
- `wren-ui/src/server/authz/authorize.ts:171-205`
  - workspace 写权限还有 platform admin 特判

**结论**：当前并不是单一 RBAC，而是**legacy workspace 角色 + structured role binding + platform admin 特权**三层并存。

### 2.2 当前“权限管理”页面心智更像平台权限中心，但实现其实是 workspace scope

- `wren-ui/src/server/authz/permissionRegistry.ts:1-18,150-175`
  - `workspace.create` 是 `platform` scope
  - `workspace.member.*`、`role.manage`、`audit.read` 是 `workspace` scope
- `wren-ui/src/pages/api/v1/workspace/roles/index.ts`
- `wren-ui/src/pages/api/v1/workspace/role-bindings/index.ts`
  - 当前角色目录与绑定 API 都挂在 `/api/v1/workspace/*`
- `wren-ui/src/server/authz/adminCatalog.ts:653-710`
  - 当前 role binding 甚至要求目标用户必须已是该 workspace 成员

**结论**：当前页面像平台权限中心，但后端/数据模型仍主要围绕“当前 workspace 授权”工作，心智与实现不一致。

### 2.3 当前“用户管理”页面本质上是“当前工作空间成员管理”

- `wren-ui/src/pages/settings/users.tsx:40-72`
  - 页面数据来自 `workspaceOverview.permissions` 与 `/api/v1/workspace/members`
- `wren-ui/src/features/settings/users/UsersMembersSection.tsx:423-439`
  - 明确文案：通过成员邀请进入当前工作空间
- `wren-ui/src/pages/api/v1/workspace/members/index.ts`
- `wren-ui/src/pages/api/v1/workspace/members/[id].ts`
  - 当前成员增删改全部是 workspace scoped API

**结论**：当前“用户管理”命名不准确，实际是 workspace members 页面。

### 2.4 “创建工作空间”后端已具备，但前端入口缺失

- `wren-ui/src/pages/api/v1/workspace/index.ts:35-68`
  - 已支持 `POST /api/v1/workspace`
  - 要求 `workspace.create`
  - 要求 `initialOwnerUserId`
- `wren-ui/src/pages/api/v1/workspace/current.ts:293-317`
  - overview 已返回 `permissions.actions['workspace.create']`
- `wren-ui/src/features/workspace/workspacePageDerivedState.ts:48-50`
  - 前端派生状态已计算 `canCreateWorkspace`
- `wren-ui/src/pages/workspace.tsx:85-114`
  - 实际页面没有创建入口

**结论**：这是前端 IA/入口缺失，不是后端能力缺失。

### 2.5 当前数据库存在授权脏数据，需要在重构时顺手清理

基于 2026-04-19 对当前 PostgreSQL 的只读检查：

- `user` 表中 admin 用户已同时具备：
  - `is_platform_admin = true`
  - 多个 `workspace_member.role_key = owner`
  - `principal_role_binding(scope_type='platform', role='platform_admin')`
- 但 `principal_role_binding(scope_type='workspace')` 中存在**指向不存在 workspace 的孤儿绑定**。

**结论**：主问题仍是设计与模型过渡态，但数据层确实有历史脏 binding，必须纳入改造任务。

---

## 3. ADR（本轮决策）

### Decision

把权限与治理分成两层：

1. **平台层（Platform IAM / Governance）**
   - 用户管理
   - 权限管理
   - 工作空间管理
2. **工作空间层（Workspace Governance）**
   - 成员管理
   - owner/viewer 分配
   - 空间内资源治理

### Drivers

1. 当前“用户管理 / 权限管理 / 工作空间管理”职责重叠，用户心智混乱。
2. 当前页面形态已经更像平台控制台，但底层仍按 workspace scoped API 运作。
3. 现有 `workspace_owner` 与 `workspace_admin` 权限集等价，说明 workspace 角色当前过度设计。
4. 后续若要补“给用户分配哪些 workspace”，平台级用户视角不可避免。

### Alternatives considered

#### 方案 A：保留当前结构，只微调文案
- 优点：改动小
- 缺点：核心混乱不解，后续还会反复返工

#### 方案 B：把所有权限都做成平台级
- 优点：看起来统一
- 缺点：违背资源边界；workspace 内成员/资源治理仍天然是 workspace scope

#### 方案 C：平台治理和 workspace 治理彻底拆层（**本方案**）
- 优点：职责清楚，兼容当前代码中的双 scope 模型
- 缺点：需要一次 IA、API、数据兼容、UI 路由的联动改造

### Why chosen

方案 C 最符合当前代码现实：

- 底层已有 `platform` / `workspace` 双 scope；
- 前端已有平台治理入口雏形（`wren-ui/src/pages/settings/platform.tsx`）；
- workspace members、workspace create、workspace role binding 已经天然是分层能力。

### Consequences

1. 当前 `/settings/users` 不能再继续代表“平台用户管理”；
2. 当前 `/settings/permissions` 不能再继续承载“workspace 成员授权主入口”；
3. `workspace_admin` 需要降级/迁移；
4. 需要新增平台级 API 与页面；
5. 需要做一轮数据对账与孤儿 binding 清理。

### Follow-ups

1. 先完成 IA 与 API 收口，再做 UI 细节优化。
2. 先冻结 workspace 自定义角色主路径，再决定是否保留进阶模式。
3. owner/viewer 上线后，再评估是否真的需要 editor/admin 细化层。

---

## 4. Target State

## 4.1 平台级信息架构

```text
设置
├─ 个人资料
├─ 平台用户管理           /settings/platform/users
├─ 平台权限管理           /settings/platform/permissions
├─ 工作空间管理           /settings/platform/workspaces
├─ 审计日志               /settings/audit
├─ 调用诊断               /settings/diagnostics
└─ 系统任务               /settings/system-tasks
```

其中：

- `平台用户管理`
  - 用户列表
  - 用户详情
  - 平台角色
  - 默认 workspace
  - 所属 workspace
  - 分配/移除 workspace
- `平台权限管理`
  - 平台角色目录
  - 平台菜单/API capability
  - 高风险平台动作控制
- `工作空间管理`
  - workspace 列表
  - 新建 workspace
  - workspace 详情
  - 成员管理
  - owner/viewer 管理

## 4.2 工作空间级信息架构

每个 workspace 详情内包含：

```text
Workspace Detail
├─ 基本信息
├─ 成员管理
├─ 资源概览
└─ 审计 / 设置（按需）
```

成员管理只保留：

- `owner`
- `viewer`

映射规则：

- 旧 `owner` -> 新 `owner`
- 旧 `admin` -> 新 `owner`（当前权限等价）
- 旧 `member` -> 新 `viewer`
- `createdBy` 保留为字段，不参与角色判断

## 4.3 权限真相源

### 平台权限

平台角色控制：

- 菜单可见性
- 页面入口
- 平台 API capability
- 高风险平台动作

### 工作空间权限

工作空间权限只控制：

- workspace 成员管理
- workspace 资源治理
- workspace 默认进入 / 申请加入等成员行为

### 重要原则

**菜单不是独立权限真相源。**

统一采用：

- API capability / permission registry 为主
- 前端菜单只是 capability 投影

避免出现：

- 菜单能看但接口没权限
- 菜单隐藏了但接口仍可调用

---

## 5. 非目标（本轮不做）

1. 不在本轮把整个授权内核重写为全新系统。
2. 不在本轮扩张 workspace 细粒度角色体系。
3. 不在本轮引入 org / tenant / account 新边界。
4. 不在本轮做复杂 ABAC / policy engine。
5. 不在本轮让 workspace custom role 继续前台主流程扩张。

---

## 6. Acceptance Criteria

### 6.1 IA / 页面职责

1. 设置中心中存在明确的平台级：
   - 用户管理
   - 权限管理
   - 工作空间管理
2. 原“用户管理”不再代表当前 workspace 成员页。
3. workspace 成员管理入口移动到工作空间管理内部。

### 6.2 权限行为

1. 非平台管理员不可见平台用户管理 / 平台权限管理 / 新建 workspace。
2. 平台管理员可创建 workspace、管理平台用户、查看平台权限页。
3. workspace 成员管理仅作用于所选 workspace。
4. workspace 角色最终只显示 `owner / viewer`。

### 6.3 数据与兼容

1. `workspace_member.role_key` 完成兼容迁移：`admin -> owner`、`member -> viewer`。
2. `principal_role_binding` 中不存在指向不存在 workspace 的孤儿 binding。
3. 旧 API / 旧路由在过渡期返回兼容跳转或兼容结果，不发生硬中断。

### 6.4 测试

1. 平台管理员与普通用户的导航、接口权限测试通过。
2. workspace 创建、成员邀请、成员角色调整流程通过。
3. 用户分配到 workspace 的平台路径可用。
4. 权限变更后菜单与 API 判断一致。

---

## 7. 实施步骤（可直接排期）

## Phase 0：冻结方向与兼容边界（0.5 ~ 1 天）

### 目标

先冻结目标态，避免一边改 IA、一边继续往旧模型加功能。

### 动作

1. 冻结以下旧主路径，不再继续增强：
   - `wren-ui/src/pages/settings/users.tsx`
   - `wren-ui/src/pages/settings/permissions.tsx`
   - `wren-ui/src/pages/api/v1/workspace/roles/*`
   - `wren-ui/src/pages/api/v1/workspace/role-bindings/*`
2. 明确过渡策略：
   - 旧“用户管理”页面重命名为“成员管理（过渡）”
   - 旧 workspace role 页面仅保留兼容，不做新能力入口
3. 在 `docs/` 补充实施方案（即本文）并作为本轮基线

### 产出

- 冻结清单
- 路由重命名清单
- 兼容窗口说明

---

## Phase 1：后端模型与数据兼容收口（1.5 ~ 2.5 天）

### 目标

先把后端的角色语义、数据清理、兼容映射理顺。

### 代码范围

- `wren-ui/src/server/services/authService.ts`
- `wren-ui/src/server/authz/roleMapping.ts`
- `wren-ui/src/server/authz/legacyRolePolicy.ts`
- `wren-ui/src/server/authz/permissionRegistry.ts`
- `wren-ui/src/server/services/workspaceService.ts`
- 新增：`wren-ui/scripts/*` 数据清理脚本

### 动作

1. 调整 workspace 目标角色语义：
   - 保留底层兼容映射
   - 对外目标语义收口到 `owner / viewer`
2. 补迁移脚本：
   - `workspace_member.role_key: admin -> owner`
   - `workspace_member.role_key: member -> viewer`（若决定沿用新 key）
   - 或保留 DB key 不变、先做 service 层映射，但 UI 不再暴露 `admin/member`
3. 清理 `principal_role_binding` 孤儿记录：
   - scopeType=`workspace` 但 scopeId 不存在于 `workspace`
4. 清理/对齐 workspace binding：
   - `workspace_admin` -> `workspace_owner`
   - `workspace_viewer` 保持 viewer 语义
5. 明确 platform role 不变：
   - `platform_admin` 继续保留

### 建议

- 若想降低一次性风险：
  - **第一步先改展示语义与 service 映射**
  - **第二步再改底层 role key**

### 验证

- auth session 返回的 actor claims 与页面菜单一致
- platform admin 与 workspace owner/viewer 能力分层清晰
- 数据库中不存在孤儿 workspace binding

---

## Phase 2：新增平台级 API（2 ~ 3 天）

### 目标

把“平台用户管理 / 平台权限管理 / 工作空间管理”需要的 API 补齐。

### 新 API 建议

```text
/api/v1/platform/users
/api/v1/platform/users/[id]
/api/v1/platform/users/[id]/workspaces
/api/v1/platform/permissions
/api/v1/platform/workspaces
/api/v1/platform/workspaces/[id]
/api/v1/platform/workspaces/[id]/members
```

### 代码范围

- 新增：`wren-ui/src/pages/api/v1/platform/*`
- 复用：
  - `wren-ui/src/server/services/workspaceService.ts`
  - `wren-ui/src/server/authz/*`
  - `wren-ui/src/server/repositories/*`

### 动作

1. 平台用户列表 API
   - 返回用户基础信息、平台角色、默认 workspace、所属 workspace 数量
2. 平台用户详情 API
   - 返回该用户所属 workspace 列表
3. 平台用户 workspace 分配 API
   - 本质复用 workspace membership service
   - 但从平台视角操作
4. 平台权限目录 API
   - 返回平台角色、平台 capability、菜单 capability 映射
5. 平台 workspace 管理 API
   - 列表
   - 创建
   - 查看 workspace 成员
   - 调整 owner/viewer

### 兼容原则

- 平台侧“给用户分配 workspace”与 workspace 侧“邀请成员”最终应复用同一 service 层，不允许出现两套写法。

### 验证

- 普通用户访问 `/api/v1/platform/*` 返回 403
- platform admin 可完整操作
- 平台分配 workspace 后，workspace 成员列表立即可见

---

## Phase 3：前端 IA 重组（2 ~ 4 天）

### 目标

把当前设置导航、页面归属与操作入口彻底改顺。

### 代码范围

- `wren-ui/src/components/reference/novaShellNavigation.tsx`
- `wren-ui/src/features/settings/settingsShell.ts`
- `wren-ui/src/pages/settings/platform.tsx`
- `wren-ui/src/pages/settings/users.tsx`
- `wren-ui/src/pages/settings/permissions.tsx`
- `wren-ui/src/pages/workspace.tsx`
- `wren-ui/src/features/workspace/components/WorkspacePrimaryPanel.tsx`
- 新增：
  - `wren-ui/src/pages/settings/platform/users.tsx`
  - `wren-ui/src/pages/settings/platform/permissions.tsx`
  - `wren-ui/src/pages/settings/platform/workspaces.tsx`

### 动作

1. 调整导航结构
   - 平台用户管理
   - 平台权限管理
   - 工作空间管理
2. 把当前 `/settings/users` 改造成：
   - 过渡期跳转页，或直接改名“成员管理（旧入口）”
3. 把当前 `/settings/permissions` 改造成：
   - 平台权限管理首页
   - 不再默认承载 workspace 成员授权
4. 把 `workspace` 页中的成员治理入口下沉到“工作空间管理 -> workspace 详情”
5. 在工作空间管理页补：
   - 新建 workspace 按钮
   - workspace 详情抽屉/页
   - 成员管理 tab

### 视觉/交互要求

- 平台页：表格主导，清晰筛选与操作栏
- workspace 详情：抽屉或详情页均可，但必须稳定承载成员管理
- 所有按钮保持正常尺寸，避免 small

### 验证

- 导航语义正确
- 页面标题、面包屑、菜单高亮一致
- 原 workspace members 操作可以从新入口完整走通

---

## Phase 4：workspace 权限简化与 UI 主路径收口（1.5 ~ 2.5 天）

### 目标

停止把 workspace 权限当成平台权限页的主要内容；把 workspace 权限收口到 owner/viewer。

### 代码范围

- `wren-ui/src/features/settings/users/*`
- `wren-ui/src/features/settings/permissions/*`
- `wren-ui/src/features/settings/workspaceGovernanceShared.ts`
- `wren-ui/src/pages/api/v1/workspace/members/*`
- `wren-ui/src/server/authz/adminCatalog.ts`

### 动作

1. UI 主路径只显示：
   - owner
   - viewer
2. workspace custom role 相关能力：
   - 从主 UI 下沉
   - 过渡期可隐藏到高级模式或直接只读展示
3. `PermissionsRoleCatalogSection` 从“workspace 权限主界面”改为：
   - 平台权限页使用平台权限目录
   - workspace 仅保留极简成员角色展示
4. `ROLE_OPTIONS` 收口
   - 不再对最终用户直接展示 legacy `admin/member`

### 验证

- 任一 workspace 中成员操作不再要求理解复杂角色体系
- owner/viewer 两级逻辑可闭环
- 旧 role binding 能力不会误导普通管理员进入错误路径

---

## Phase 5：清理与删除（1 ~ 2 天）

### 目标

完成路由兼容、文案收口、旧逻辑降噪与测试补齐。

### 动作

1. 清理旧文案
   - “用户管理”若仍指向 workspace members，全部改为“成员管理”
2. 对旧路由做兼容跳转
   - `/settings/users` -> 新平台用户页或 workspace 成员页（按最终 IA）
   - `/settings/access`、`/settings/permissions` 做清晰重定向
3. 清理过时 UI 入口
   - workspace role binding 主入口
   - workspace custom role 主入口
4. 补测试
   - route guard
   - capability gate
   - migration / seed / service tests

### 退出条件

- 主导航中不再存在语义重复入口
- 旧页只承担兼容，不再承担主功能
- 文档与实际 IA 一致

---

## 8. 文件级实施清单

## 必改（后端）

- `wren-ui/src/server/services/authService.ts`
- `wren-ui/src/server/authz/roleMapping.ts`
- `wren-ui/src/server/authz/legacyRolePolicy.ts`
- `wren-ui/src/server/authz/permissionRegistry.ts`
- `wren-ui/src/server/authz/adminCatalog.ts`
- `wren-ui/src/server/services/workspaceService.ts`
- `wren-ui/src/pages/api/v1/workspace/current.ts`
- `wren-ui/src/pages/api/v1/workspace/index.ts`
- `wren-ui/src/pages/api/v1/workspace/members/index.ts`
- `wren-ui/src/pages/api/v1/workspace/members/[id].ts`

## 新增（后端）

- `wren-ui/src/pages/api/v1/platform/users/index.ts`
- `wren-ui/src/pages/api/v1/platform/users/[id].ts`
- `wren-ui/src/pages/api/v1/platform/users/[id]/workspaces.ts`
- `wren-ui/src/pages/api/v1/platform/permissions/index.ts`
- `wren-ui/src/pages/api/v1/platform/workspaces/index.ts`
- `wren-ui/src/pages/api/v1/platform/workspaces/[id].ts`
- `wren-ui/src/pages/api/v1/platform/workspaces/[id]/members.ts`
- `wren-ui/scripts/clean_orphan_workspace_role_bindings.ts`
- `wren-ui/scripts/migrate_workspace_roles_to_owner_viewer.ts`

## 必改（前端）

- `wren-ui/src/components/reference/novaShellNavigation.tsx`
- `wren-ui/src/features/settings/settingsShell.ts`
- `wren-ui/src/pages/settings/platform.tsx`
- `wren-ui/src/pages/settings/users.tsx`
- `wren-ui/src/pages/settings/permissions.tsx`
- `wren-ui/src/pages/workspace.tsx`
- `wren-ui/src/features/workspace/components/WorkspacePrimaryPanel.tsx`
- `wren-ui/src/features/settings/workspaceGovernanceShared.ts`
- `wren-ui/src/features/settings/users/UsersMembersSection.tsx`
- `wren-ui/src/features/settings/permissions/*`

## 新增（前端）

- `wren-ui/src/pages/settings/platform/users.tsx`
- `wren-ui/src/pages/settings/platform/permissions.tsx`
- `wren-ui/src/pages/settings/platform/workspaces.tsx`
- `wren-ui/src/features/settings/platform-users/*`
- `wren-ui/src/features/settings/platform-permissions/*`
- `wren-ui/src/features/settings/platform-workspaces/*`

---

## 9. 风险与缓解

### 风险 1：一次性改 role key 影响范围过大

**缓解**：
先改 UI 语义和 service 映射；DB key 改造延后到第二步。

### 风险 2：平台分配 workspace 与 workspace 邀请逻辑分叉

**缓解**：
平台 API 只做 controller 层封装，底层统一复用 `workspaceService`。

### 风险 3：旧自定义角色能力还被某些页面依赖

**缓解**：
先将 custom role 能力降级为隐藏/只读，不直接删库删接口；完成依赖盘点后再清理。

### 风险 4：菜单权限与接口权限再次分叉

**缓解**：
所有菜单显隐统一来源于 capability / action 判定；禁止单独维护一套路由白名单。

### 风险 5：历史脏 binding 导致迁移脚本误判

**缓解**：
迁移前先做只读 inventory；执行脚本先 dry-run，再正式 apply。

---

## 10. Verification Steps

### 单元测试

- `authService` actor claims 聚合测试
- `authorize()` scope 判定测试
- workspace member role 映射测试
- 平台用户 / 平台 workspace API handler 测试

### 集成测试

- 平台管理员：
  - 查看平台用户
  - 创建 workspace
  - 给用户分配 workspace
- 非平台管理员：
  - 访问平台页被拒绝
- workspace owner：
  - 邀请成员
  - 调整 owner/viewer

### E2E

1. 登录 platform admin
2. 打开平台工作空间管理
3. 新建 workspace
4. 打开该 workspace 成员管理
5. 给用户分配 viewer
6. 将 viewer 提升为 owner
7. 验证目标用户切换后只能看到其能力范围内菜单

### 数据验证

- `workspace_member` 不再出现旧 UI 不识别的 role
- `principal_role_binding` 不存在 orphan workspace scope records
- 平台角色与 workspace 角色总数符合预期

---

## 11. 推荐排期

### Wave 1
- Phase 0
- Phase 1

### Wave 2
- Phase 2
- Phase 3（先上新入口与新页面骨架）

### Wave 3
- Phase 4
- Phase 5

推荐顺序：

1. **先把模型和 API 对齐**
2. **再切前端入口**
3. **最后删旧路径**

不要反过来先改 UI 再补后端，否则会继续陷入“看起来是平台页，实际上还是 workspace 页面”的混乱。

---

## 12. 实施完成定义（Definition of Done）

以下条件同时成立，才视为本方案完成：

1. 平台用户管理、平台权限管理、工作空间管理三者职责清晰。
2. 当前“用户管理 = workspace members”这一错误心智已经消失。
3. 新建 workspace 有明确平台入口。
4. 用户属于哪些 workspace 可以从平台视角查看和调整。
5. workspace 权限只保留 owner/viewer 主路径。
6. workspace custom role 不再作为主界面核心路径。
7. 平台菜单权限与 API capability 一致。
8. 数据库中孤儿 workspace binding 已清理。

