# Frontend Architecture Backlog — 2026-04-18

基于：

- `docs/frontend-architecture-review-2026-04-18.md`

将前端架构收口工作拆成可执行 backlog，按优先级推进。

---

## 目标

在不打断当前业务迭代的前提下，完成以下收口：

1. 清理 `pages/` 目录污染
2. 收敛 shell 选择与页面嵌套逻辑
3. 拆解超大页面 / 超大壳组件
4. 统一请求 / 缓存原语
5. 推进 feature 化目录组织
6. 规范 legacy route / compatibility route
7. 收敛依赖版本漂移

---

## 执行原则

- 优先做**低风险、高收益**重构
- 每一波都要求：
  - 小步提交
  - 有回归验证
  - 不改变现有业务语义
- 先做“结构搬迁与抽象收口”，再做“依赖与技术栈升级”

---

# Wave 0 — 基线与约束

## 目标

建立后续重构的边界与基线，避免越改越散。

## 任务

### W0-1. 建立页面/组件/路由 inventory

- 盘点 `src/pages` 下哪些文件是真正 route entry
- 盘点哪些是页面内组件、modal、drawer、section
- 输出迁移清单

### W0-2. 建立 legacy route inventory

- 盘点：
  - compatibility route
  - deprecated route
  - alias route
- 标明：
  - canonical route
  - 当前调用方
  - 删除门槛

### W0-3. 建立大文件拆分清单

- 标出首批要拆的超大文件
- 为每个文件列出拆分方向

## 验收标准

- 有明确 inventory 文档
- 每个需要改造的对象都有 owner/type/目标位置

---

# Wave 1 — 清理 `pages/` 目录污染

## 目标

让 `src/pages` 只保留 route entry，不再承载业务组件。

## 任务

### W1-1. 迁出 knowledge 组件型文件

将以下文件迁离 `src/pages/knowledge/`：

- `assetDetailContent.tsx`
- `assetWizardModal.tsx`
- `knowledgeBaseModal.tsx`
- `mainStage.tsx`

建议目标目录：

- `src/features/knowledgePage/sections/*`
- `src/features/knowledgePage/modals/*`
- `src/features/knowledgePage/drawers/*`

### W1-2. 清理 pages 目录中的非路由默认导出组件

- 检查 `src/pages` 下其他类似模式
- 避免继续新增非 route 文件

### W1-3. 建立 pages 目录约束

- 补充开发约定：
  - `pages/` 仅允许 route entry
  - 页面子组件必须放在 feature 或 components 目录

## 验收标准

- `src/pages` 下仅保留 route entry
- knowledge 工作台的 modal / section / drawer 已迁出
- 页面路由不变、功能不变

## 建议验证

- knowledge 页面打开/切换/抽屉/向导全链路 smoke test
- 相关单测通过

---

# Wave 2 — 收敛 shell 架构

## 目标

统一 shell 选择逻辑，页面不再直接感知 `embedded`。

## 任务

### W2-1. 收拢 shell 决策入口

- 统一由 app-level / route-level 决定：
  - 是否使用 persistent shell
  - 是否使用 console shell
  - 是否裸页面渲染

### W2-2. 页面去掉 `usePersistentShellEmbedded` 分支

优先处理：

- `src/pages/home/index.tsx`
- `src/pages/knowledge/index.tsx`

页面应只输出内容，不再自己判断是否外包 `DolaAppShell`。

### W2-3. 收敛 `DolaAppShell` / `ConsoleShellLayout` / `PersistentConsoleShell` 的边界

明确：

- `PersistentConsoleShell`：route 级外壳
- `ConsoleShellLayout`：标准工作台 layout
- `DolaAppShell`：纯壳组件，不负责 route-level 决策

## 验收标准

- 页面不再直接判断 `embedded`
- shell 选择逻辑集中在统一入口
- sidebar / history / nav 行为不回归

## 建议验证

- `/home`
- `/home/[id]`
- `/home/dashboard`
- `/knowledge`
- `/settings/*`
- `/workspace`

各页切换时壳层行为一致

---

# Wave 3 — 拆分超大文件

## 目标

把当前最重的几个文件拆到可维护范围。

## 任务

### W3-1. 拆 `src/pages/home/index.tsx`

建议拆为：

- page entry
- home screen orchestrator
- prompt composer section
- recommendations section
- knowledge/skill picker section
- local cache helper

### W3-2. 拆 `src/components/reference/DolaAppShell.tsx`

建议拆为：

- `ShellFrame`
- `ShellSidebar`
- `ShellHistoryList`
- `ShellWorkspaceSwitcher`
- `ShellAccountMenu`
- `ShellPrefetchController`

### W3-3. 拆 `src/pages/knowledge/mainStage.tsx`

建议按 section 拆：

- overview
- assets
- modeling entry
- sql templates
- analysis rules
- right drawer / detail panel

### W3-4. 拆 `src/features/knowledgePage/index.styles.ts`

建议拆为：

- shared tokens / primitives
- overview styles
- assets styles
- editor styles
- modal / drawer styles

## 验收标准

- 目标文件显著缩小
- 拆分后模块职责明确
- 页面行为与视觉不回归

---

# Wave 4 — 统一请求 / 缓存原语

## 目标

把请求状态机、缓存 TTL、storage key、错误处理收敛为统一模式。

## 任务

### W4-1. 扩展 `useRestRequest`

补齐统一能力：

- cancel
- reset
- stale handling
- retry 策略入口
- 可选 cache/invalidation 接口

### W4-2. 逐步迁移 direct fetch hooks

优先迁移：

- `useHomeSidebar`
- `useAuthSession`
- `useApiHistoryList`
- `useSkillsControlPlaneData`
- `useKnowledge*` 中重复的 fetch 状态机

### W4-3. 统一 cache key / TTL 管理

将以下零散缓存收拢：

- auth session
- home sidebar
- runtime page prefetch
- dashboard rest
- knowledge diagram
- skill option cache
- preview data cache

### W4-4. 统一错误反馈策略

明确：

- 静默失败场景
- 用户可见失败场景
- 页面级错误场景

## 验收标准

- 新增请求逻辑优先使用统一原语
- direct fetch hook 数量显著下降
- cache key / ttl 命名规则统一

---

# Wave 5 — 推进 feature module 化

## 目标

把主要业务域从“页面 + hooks + utils 平铺”推进到 feature module。

## 任务

### W5-1. knowledge 域闭环

形成类似结构：

- `features/knowledgePage/routes`
- `features/knowledgePage/sections`
- `features/knowledgePage/modals`
- `features/knowledgePage/drawers`
- `features/knowledgePage/state`
- `features/knowledgePage/styles`

### W5-2. home 域 feature 化

建议目标：

- `features/home/routes`
- `features/home/sections`
- `features/home/composer`
- `features/home/sidebar`
- `features/home/state`

### W5-3. settings 域 feature 化

按 settings 子域拆：

- users
- permissions
- connectors
- identity
- automation
- diagnostics

### W5-4. modeling 域 feature 化

- diagram
- metadata
- relationships
- deploy/status

## 验收标准

- 主要业务域目录边界更清晰
- 本地组件 / hooks / utils 更多地内聚到 feature 中
- `components/` 与 `utils/` 中跨域杂项逐步减少

---

# Wave 6 — legacy route 与兼容层收口

## 目标

建立 canonical route 体系，限制 alias 持续扩散。

## 任务

### W6-1. route inventory 落文档

为每条兼容路由标明：

- canonical route
- 使用场景
- 删除门槛
- 当前调用方

### W6-2. 清理单纯 re-export alias route

优先关注：

- `settings/data-source.ts`
- `/modeling` 兼容跳转
- 旧 streaming ask 路径

### W6-3. 标准化废弃流程

统一模式：

- deprecated header
- 注释模板
- 删除 gate

## 验收标准

- route tree 中 legacy 路由可解释、可跟踪
- 新需求不再复制旧 alias 模式

---

# Wave 7 — 依赖与技术栈整理

## 目标

先解决版本漂移和重复依赖，再评估中长期升级路线。

## 任务

### W7-1. 清理版本漂移

重点：

- `next`
- `eslint-config-next`
- `@next/bundle-analyzer`

### W7-2. 清理重复 / 可疑依赖

例如：

- `cron-parser`

### W7-3. 做前端依赖审计

- 当前必须保留的包
- 历史遗留包
- 潜在升级风险

### W7-4. 技术栈演进评估

中长期评估：

- Antd 4 → 后续路线
- less / `next-with-less`
- styled-components 路线

## 验收标准

- package 版本更整齐
- 重复依赖消失
- 有明确技术栈升级路线图

---

## 推荐执行顺序

### 先做

1. Wave 0
2. Wave 1
3. Wave 2
4. Wave 3

### 再做

5. Wave 4
6. Wave 5
7. Wave 6

### 最后做

8. Wave 7

---

## 建议的完成定义（Definition of Done）

每个 wave 完成时都应满足：

- 对应结构性问题已有明确收口
- 路由/交互无回归
- 关键页面 smoke 测试通过
- 定向单测通过
- 文档同步更新

---

## 建议首批直接开工项

如果立即开始执行，建议首批任务是：

1. `pages/knowledge/*` 非 route 文件迁出
2. `home/index.tsx` 去除页面内 shell 判定
3. `knowledge/index.tsx` 去除页面内 shell 判定
4. 拆 `DolaAppShell`
5. 为 legacy route 建立 inventory 文档

---

## 最终目标态

目标不是“把代码全部重写”，而是实现：

- `pages/` 目录干净
- shell 决策集中
- feature module 明确
- 请求 / 缓存原语统一
- legacy route 可控
- 依赖版本整齐

届时前端将从“能持续迭代”提升到“能低摩擦持续演进”。

