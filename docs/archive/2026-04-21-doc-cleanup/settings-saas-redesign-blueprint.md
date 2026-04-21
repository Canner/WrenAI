# 设置中心 SaaS 极简风改版蓝图

## 1. 目标

把现有“工作空间治理逐步从 workspace 页拆出”的过渡态，收口成一套更清晰的 SaaS 控制台信息架构：

- **设置中心 = 控制中心**，不是治理摘要墙
- **Workspace 页 = 运营首页**，只保留概览与跳转
- **治理能力按职责拆分**，避免所有能力继续堆在 `/settings/access`
- 视觉上采用**极简、克制、表格/列表主导**的 B2B SaaS 风格

## 2. 视觉原则

### 2.1 Visual thesis

冷静、专业、收敛的 SaaS 控制台：减少卡片墙，强化标题、表格、列表与右侧详情层级，用少量强调色承载状态和动作。

### 2.2 视觉规则

- 默认少卡片，优先用：
  - section
  - table
  - list + detail
  - toolbar + filter
- 减少大面积渐变与装饰性阴影
- 一个页面只保留 2~4 个必要指标
- 主操作统一放页头或 section header 右侧
- 状态通过 tag / alert / empty state 表达，不靠说明卡堆砌

## 3. 信息架构（目标态）

```text
设置
├─ 我的账户                /settings
├─ 登录与安全              /settings/security
├─ 成员与权限              /settings/access
├─ 身份与目录              /settings/identity
├─ 自动化身份              /settings/automation
├─ 审计日志                /settings/audit
├─ 调用诊断                /settings/diagnostics
├─ 系统任务                /settings/system-tasks
└─ 平台治理                /settings/platform   (仅 platform_admin)
```

### 3.1 页面职责

#### `/settings`
- 个人资料
- 当前会话 / 当前 runtime scope
- 默认进入 workspace
- 最近使用工作空间语义说明
- 与其他治理页的入口

#### `/settings/security`
- 登录方式
- 会话安全状态
- 密码 / MFA / Passkey 的当前状态
- 尚未落地能力的占位说明

#### `/settings/access`
- 成员
- 角色目录
- 角色绑定
- Explain / Simulate
- Access review / break-glass / impersonation

#### `/settings/identity`
- OIDC / SAML provider
- metadata / discovery / certificate 健康
- SCIM 状态
- directory group 与 role mapping

#### `/settings/automation`
- service account
- API token
- last used / expiry / revoke
- 机器身份生命周期治理

#### `/settings/audit`
- audit event 查询
- actor / action / resource / result 过滤
- 高风险治理动作审计

#### `/settings/diagnostics`
- API history
- Ask diagnostics
- shadow compare
- 请求维度筛选

#### `/settings/system-tasks`
- schedule job
- recent runs
- retry / disable / edit schedule

#### `/settings/platform`
- 平台角色与平台视角治理
- workspace 生命周期治理入口
- 高风险平台操作收口
- 平台治理后续能力占位

## 4. Workspace 页的收口原则

`/workspace` 继续保留，但只做：

- 当前 workspace 运营摘要
- 工作空间切换 / 默认进入设置
- 去知识库 / 看板 / 设置子页的快捷入口
- 申请加入、邀请接受等 workspace 流程

明确不再承担：

- identity provider 详情治理
- service account / token 详情治理
- audit 主视图
- 平台管理主入口内容承载

## 5. 交互原则

### 5.1 Interaction thesis

通过轻量切换和列表-详情结构，让设置页像控制台而不是营销 dashboard：导航切换干净、筛选即时、详情就地展开。

### 5.2 动效范围

- 设置导航切换：轻微 fade + translateY / translateX
- 列表筛选：轻量 layout shift
- 抽屉 / 详情面板：快速滑入
- 禁止大面积 decorative animation

## 6. 实施策略

### Phase A：IA 收口
- 增加 settings 子路由
- 更新 settings 导航
- 将 diagnostics / system tasks 纳入 settings 域
- workspace 页改为摘要 + 快捷入口

### Phase B：访问治理拆页
- access 保留成员/角色/Explain/紧急流程
- identity 拆出企业身份与目录
- automation 拆出 service account / token
- audit 拆出审计中心

### Phase C：平台与安全页补齐
- security 页承接 MFA / Passkey 等安全能力
- platform 页从“说明页”升级为平台治理控制台

## 7. 本轮会一起处理的内容

- 新增 settings 子页与导航拆分
- 旧的 `/api-management/history` 与 `/workspace/schedules` 兼容保留，但主入口迁到 settings 域
- workspace 页按钮与文案改为指向新的 settings 子页
- 个人设置 / 平台管理页文案与布局向极简控制台收口

## 8. 本轮仍会保留为“未完全实现”的部分

以下能力会进入 IA 与页面占位，但不承诺本轮一次做完完整产品化：

- MFA / Passkey 真正可用链路
- access_request / invitation 的完整独立视图
- support_readonly / support_impersonator 的独立平台治理面板
- resource-level 角色（如 `kb_admin` / `dashboard_editor`）的完整 UI
- 平台治理页中的 workspace lifecycle 深度操作

## 9. 验收标准

- 设置中心中可见拆分后的独立菜单
- workspace 页不再承担大量治理说明卡
- diagnostics / system tasks 从信息架构上归入 settings 域
- identity / automation / audit 拥有独立页面入口
- 整体视觉更像 SaaS 控制台，而不是历史功能叠加页
