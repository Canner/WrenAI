# 平台权限 / 工作空间治理重构 P0 / P1 / P2 执行清单

更新时间：2026-04-19  
主方案：`docs/platform-workspace-iam-restructure-plan-2026-04-19.md`

> 本文档把主方案进一步压缩成可排期、可指派、可验收的 P0 / P1 / P2 执行清单。

---

## 1. 分期原则

### P0
先把**模型、入口、命名**纠正，避免继续在错误 IA 上叠加功能。

### P1
补齐真正缺失的**平台级能力闭环**：
- 平台用户管理
- 平台权限管理
- 工作空间管理
- 新建 workspace
- 用户分配 workspace

### P2
做**兼容删除、数据清理、细节收口**，把旧模型降噪。

---

## 2. P0：先把方向摆正（必须先做）

### P0 目标

1. 不再让“用户管理”继续承担 workspace 成员管理语义。
2. 不再让“权限管理”继续承担 workspace 成员授权主入口语义。
3. 明确平台治理与 workspace 治理的边界。
4. 冻结旧 workspace 自定义角色主路径，防止继续扩张。

### P0 范围

#### 信息架构 / 命名收口
- [ ] 把当前 `用户管理` 定位为过渡页，不再代表平台用户目录
- [ ] 把当前 workspace 内成员操作统一表述为 `成员管理`
- [ ] 明确导航中新增/预留：
  - [ ] 平台用户管理
  - [ ] 平台权限管理
  - [ ] 工作空间管理

#### 前端入口收口
- [ ] 审查 `wren-ui/src/components/reference/novaShellNavigation.tsx`
- [ ] 审查 `wren-ui/src/features/settings/settingsShell.ts`
- [ ] 审查 `wren-ui/src/pages/settings/users.tsx`
- [ ] 审查 `wren-ui/src/pages/settings/permissions.tsx`
- [ ] 审查 `wren-ui/src/pages/settings/platform.tsx`
- [ ] 决定旧入口是：
  - [ ] redirect
  - [ ] 过渡说明页
  - [ ] 兼容 alias

#### 后端模型冻结
- [ ] 冻结以下旧主路径，不再继续增强业务能力：
  - [ ] `/api/v1/workspace/roles/*`
  - [ ] `/api/v1/workspace/role-bindings/*`
- [ ] 明确 workspace 目标主角色只保留：
  - [ ] `owner`
  - [ ] `viewer`
- [ ] 明确 `createdBy` 只是字段，不是角色

#### 数据盘点
- [ ] 导出当前 `workspace_member.role_key` 分布
- [ ] 导出当前 `principal_role_binding(scope_type='workspace')` 分布
- [ ] 标记 orphan workspace bindings
- [ ] 标记 legacy `admin`、`member` 的存量数量

### P0 产出

- [ ] 新导航草图
- [ ] 兼容路由清单
- [ ] 角色映射表（旧 -> 新）
- [ ] 数据 inventory 结果
- [ ] workspace custom role 冻结说明

### P0 DoD

- [ ] 团队对目标 IA 无歧义
- [ ] 平台治理 / workspace 治理边界已写死在文档和任务单中
- [ ] 不再接受新的“在旧用户管理 / 旧权限管理上加功能”的需求实现

---

## 3. P1：补齐真正可用的主路径（核心交付）

### P1 目标

做出新的主链路，让系统真正符合：

- 平台级：用户管理 / 权限管理 / 工作空间管理
- workspace 级：成员管理

### P1-A 平台用户管理

#### 功能
- [ ] 平台用户列表页
- [ ] 用户详情抽屉/详情页
- [ ] 显示字段：
  - [ ] 姓名
  - [ ] 账号
  - [ ] 手机号（如有）
  - [ ] 状态
  - [ ] 平台角色
  - [ ] 默认 workspace
  - [ ] 所属 workspace 数量
- [ ] 支持查看该用户属于哪些 workspace
- [ ] 支持给用户分配 workspace
- [ ] 支持把用户从 workspace 移除
- [ ] 支持调整平台角色（至少 platform admin）

#### API
- [ ] `GET /api/v1/platform/users`
- [ ] `GET /api/v1/platform/users/[id]`
- [ ] `GET /api/v1/platform/users/[id]/workspaces`
- [ ] `POST/PATCH /api/v1/platform/users/[id]/workspaces`

#### 代码范围
- [ ] `wren-ui/src/pages/settings/platform/users.tsx`
- [ ] `wren-ui/src/features/settings/platform-users/*`
- [ ] `wren-ui/src/pages/api/v1/platform/users/*`

---

### P1-B 平台权限管理

#### 功能
- [ ] 平台权限管理页只承载平台权限
- [ ] 展示平台角色目录
- [ ] 展示平台 capability / API 权限目录
- [ ] 展示菜单可见性与 capability 的映射说明
- [ ] 高风险平台动作权限说明：
  - [ ] `workspace.create`
  - [ ] `impersonation.start`
  - [ ] `break_glass.manage`

#### 明确不做
- [ ] 不再把 workspace 成员角色调整放在这里做主路径
- [ ] 不再把 workspace 自定义角色作为主内容展示

#### API
- [ ] `GET /api/v1/platform/permissions`

#### 代码范围
- [ ] `wren-ui/src/pages/settings/platform/permissions.tsx`
- [ ] `wren-ui/src/features/settings/platform-permissions/*`
- [ ] `wren-ui/src/pages/api/v1/platform/permissions/index.ts`

---

### P1-C 工作空间管理

#### 功能
- [ ] 工作空间列表页
- [ ] 新建 workspace 按钮
- [ ] workspace 详情页/抽屉
- [ ] 详情中包含：
  - [ ] 基本信息
  - [ ] 成员管理
  - [ ] 资源概览
- [ ] 成员管理只支持：
  - [ ] owner
  - [ ] viewer
- [ ] 支持邀请成员 / 审批加入 / 调整 owner/viewer / 移除成员

#### API
- [ ] `GET /api/v1/platform/workspaces`
- [ ] `POST /api/v1/platform/workspaces`
- [ ] `GET /api/v1/platform/workspaces/[id]`
- [ ] `GET /api/v1/platform/workspaces/[id]/members`
- [ ] `PATCH /api/v1/platform/workspaces/[id]/members`

#### 代码范围
- [ ] `wren-ui/src/pages/settings/platform/workspaces.tsx`
- [ ] `wren-ui/src/features/settings/platform-workspaces/*`
- [ ] `wren-ui/src/pages/api/v1/platform/workspaces/*`
- [ ] 复用/改造 `wren-ui/src/server/services/workspaceService.ts`

---

### P1-D 角色模型主路径收口

#### 功能
- [ ] workspace UI 主路径只显示 `owner / viewer`
- [ ] legacy `owner/admin/member` 不再作为主 UI 术语
- [ ] `workspace_admin` 语义并入 `owner`
- [ ] `workspace_viewer` 对应 `viewer`

#### 代码范围
- [ ] `wren-ui/src/features/settings/workspaceGovernanceShared.ts`
- [ ] `wren-ui/src/features/settings/users/UsersMembersSection.tsx`
- [ ] `wren-ui/src/pages/api/v1/workspace/current.ts`
- [ ] `wren-ui/src/server/authz/roleMapping.ts`
- [ ] `wren-ui/src/server/authz/legacyRolePolicy.ts`

### P1 DoD

- [ ] 平台管理员可以新建 workspace
- [ ] 平台管理员可以从平台用户页查看并调整用户所属 workspace
- [ ] workspace 成员管理已经移动到工作空间管理里
- [ ] 平台权限管理页不再混入 workspace 成员权限主流程
- [ ] workspace UI 主路径已只剩 owner/viewer

---

## 4. P2：清理、兼容、降噪（上线前必须完成）

### P2 目标

把旧模型的残留影响降到最低，让新结构可长期维护。

### P2-A 数据清理
- [ ] 清理 orphan `principal_role_binding`
- [ ] 对齐 `workspace_member` 与 binding 数据
- [ ] 执行 `admin -> owner` 映射清理
- [ ] 执行 `member -> viewer` 映射清理（或保留底层兼容映射但 UI 全隐藏）
- [ ] 迁移前做 dry-run 报告
- [ ] 迁移后做对账报告

### P2-B 旧路由与旧页面兼容
- [ ] `/settings/users` 做重定向或兼容页
- [ ] `/settings/permissions` 收口为平台权限页
- [ ] `/settings/access` 清理历史别名
- [ ] workspace custom role 页面降级为：
  - [ ] 隐藏入口
  - [ ] 只读入口
  - [ ] 管理员高级模式（仅必要时）

### P2-C 测试与验证
- [ ] 补平台用户管理 API tests
- [ ] 补平台 workspace 管理 API tests
- [ ] 补 capability gate tests
- [ ] 补导航可见性 tests
- [ ] 补 e2e：
  - [ ] 创建 workspace
  - [ ] 分配用户到 workspace
  - [ ] workspace owner/viewer 调整
  - [ ] 非平台管理员访问平台页被拒绝

### P2-D 文案与设计统一
- [ ] 全局替换错误术语：
  - [ ] 用户管理（旧） -> 成员管理（若指 workspace）
  - [ ] admin/member -> owner/viewer（主 UI）
- [ ] 删除无效说明卡、重复副标题、过渡性误导文案
- [ ] 确保菜单、页面标题、按钮动作命名一致

### P2 DoD

- [ ] 旧路径只承担兼容，不再承担主功能
- [ ] 数据库中无 orphan workspace bindings
- [ ] 平台/工作空间边界稳定
- [ ] 新老用户都能从主路径完成关键操作

---

## 5. 推荐执行顺序

### Sprint / Wave 1
- [ ] P0 全部完成
- [ ] P1-A 平台用户管理骨架
- [ ] P1-C 工作空间管理骨架

### Sprint / Wave 2
- [ ] P1-B 平台权限管理
- [ ] P1-C 新建 workspace + 成员管理闭环
- [ ] P1-D owner/viewer 主路径收口

### Sprint / Wave 3
- [ ] P2-A 数据清理
- [ ] P2-B 旧路由兼容
- [ ] P2-C 测试补齐
- [ ] P2-D 文案与视觉收口

---

## 6. 推荐负责人拆分

### Lane 1：后端 IAM / API
- authz
- platform APIs
- migration scripts
- service reuse

### Lane 2：设置导航与平台页
- settings nav
- platform users
- platform permissions
- platform workspaces

### Lane 3：workspace 成员治理
- workspace detail
- members table
- owner/viewer actions
- 兼容旧成员流

### Lane 4：验证与清理
- API tests
- E2E
- orphan binding inventory / cleanup
- 文案与路由兼容检查

---

## 7. 最终上线门槛

只有同时满足以下条件，才建议把新结构作为默认主路径上线：

- [ ] 平台管理员主路径完整可用
- [ ] workspace 成员管理已迁入工作空间管理
- [ ] owner/viewer 两级角色已可稳定闭环
- [ ] 旧 workspace custom role 不再误导主流程
- [ ] 数据清理完成且有结果记录
- [ ] 测试覆盖平台与 workspace 两层核心链路

