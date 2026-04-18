# Frontend Architecture Review — 2026-04-18

基于当前 `wren-ui` 最新代码，对前端进行一次整体检视，覆盖：

- 架构设计
- 模块划分
- 路由设计
- 组件设计
- 调用关系
- 代码结构
- 依赖版本
- 性能

---

## 1. 结论摘要

当前前端整体评价：

- **可维护性：7/10**
- **架构清晰度：6.5/10**
- **扩展性：7/10**
- **性能意识：7/10**
- **一致性：6/10**

一句话结论：

> 这套前端已经具备平台型工作台应用的雏形，方向基本正确，但还处在“基础骨架已成、收口未完成”的阶段。

它不是一个散乱项目，但也还没有达到“结构非常干净、边界非常明确”的状态。当前最大的风险不是功能不可用，而是**继续叠加功能会持续放大结构复杂度**。

---

## 2. 当前做得比较好的部分

### 2.1 Runtime Scope 基础设施层已经比较成熟

关键文件：

- `wren-ui/src/runtime/client/runtimeScope.ts`
- `wren-ui/src/hooks/useRuntimeScopeNavigation.tsx`
- `wren-ui/src/hooks/useRuntimeSelectorState.tsx`

优点：

- workspace / knowledge base / snapshot / deployHash 有统一 selector 模型
- URL / storage / fallback / hydration 关系比较完整
- 对多 workspace / 多 knowledge base 是一套可继续扩展的底层抽象

结论：

- 这是当前前端里最像“平台基础设施”的部分
- 值得继续保留并作为后续页面统一接入的核心约束层

---

### 2.2 Shell / 导航体系已经形成统一抽象

关键文件：

- `wren-ui/src/pages/_app.tsx`
- `wren-ui/src/components/reference/PersistentConsoleShell.tsx`
- `wren-ui/src/components/reference/DolaAppShell.tsx`
- `wren-ui/src/components/reference/ConsoleShellLayout.tsx`

优点：

- 左侧导航、历史对话、账户区域不再每页重写
- 已有 persistent shell / console shell / page shell 的统一抽象
- 工作台页面已经具备统一的壳层体验

结论：

- 这是正确方向
- 问题主要不在“有没有 shell”，而在“shell 逻辑是否完全收束”

---

### 2.3 Knowledge Page 已开始 feature 化

关键目录：

- `wren-ui/src/features/knowledgePage/*`
- `wren-ui/src/hooks/useKnowledge*.ts`

优点：

- knowledge workbench 已经从单纯的页面堆砌，向 feature module 演进
- 知识库相关 hooks 数量多且测试较全
- 这部分是全项目里最接近“按业务域组织”的区域

结论：

- knowledge page 是当前最接近目标态的业务域
- 但 feature 化仍未彻底闭环

---

### 2.4 对重型组件已有性能意识

已采用动态加载的典型位置：

- `wren-ui/src/components/pages/modeling/ModelingWorkspace.tsx`
- `wren-ui/src/components/pages/home/dashboardGrid/index.tsx`
- `wren-ui/src/components/pages/home/promptThread/ChartAnswer.tsx`
- `wren-ui/src/components/pages/home/promptThread/ViewSQLTabContent.tsx`

说明：

- diagram / chart / SQL viewer 不是全部强塞进首屏 bundle
- 至少在明显重型组件上，已经有 lazy load 意识

---

## 3. 主要问题与优化建议

---

## P0-1. `src/pages` 目录被污染，混入大量非路由组件

### 现状

以下文件位于 `src/pages/knowledge/`，但本质上是组件而非页面入口：

- `wren-ui/src/pages/knowledge/assetDetailContent.tsx`
- `wren-ui/src/pages/knowledge/assetWizardModal.tsx`
- `wren-ui/src/pages/knowledge/knowledgeBaseModal.tsx`
- `wren-ui/src/pages/knowledge/mainStage.tsx`

### 问题

在 Next.js Pages Router 下，`pages` 目录应尽量只承载路由入口。当前这种组织方式会带来：

- 路由语义污染
- 新人误判文件角色
- 后续迁移 App Router / route 分层时额外成本
- `pages` 目录扫描面与认知负担持续变大

### 建议

将这些文件迁移到：

- `src/features/knowledgePage/sections/*`
- 或 `src/components/pages/knowledge/*`

原则：

> `src/pages` 只保留 route entry，不放业务组件。

---

## P0-2. `wren-ui` 实际是前后端混合单体，但命名与结构不够显式

### 现状

关键文件：

- `wren-ui/src/common.ts`
- `wren-ui/src/pages/api/v1/*`
- `wren-ui/src/server/*`

API route 大量直接依赖：

- `import { components } from '@/common'`

### 问题

`wren-ui` 从命名上像“前端包”，但实际上同时承载了：

- UI 层
- BFF/API route 层
- server/service/repository 层

这会导致：

- ownership 边界不清
- 代码审视时“前端”和“服务端”混在一起
- 依赖管理与构建心智复杂

### 建议

短期不一定拆包，但至少先：

1. 将 `src/common.ts` 改名为更明确的服务容器名  
   例如：
   - `src/serverContainer.ts`
   - `src/applicationContext.ts`

2. 明确目录约定：
   - `src/pages/api + src/server` = BFF / backend-for-frontend
   - `src/pages + src/components + src/hooks + src/utils` = UI 层

---

## P0-3. Shell 体系存在重复包装，页面仍感知壳层实现细节

### 现状

关键位置：

- `_app.tsx` 已统一包裹 `PersistentConsoleShell`
- `src/pages/home/index.tsx`
- `src/pages/knowledge/index.tsx`
- `src/components/reference/ConsoleShellLayout.tsx`

页面仍然显式处理：

- `usePersistentShellEmbedded()`
- 手动决定是否再渲染 `DolaAppShell`

### 问题

这意味着 shell 选择逻辑分散在：

- `_app`
- `PersistentConsoleShell`
- `ConsoleShellLayout`
- page 本身

带来的问题：

- page 仍要知道自己是否被 shell 包裹
- loading / embedded / shell 分支重复
- 后续修改 sidebar / topbar 逻辑时需要跨多层同步

### 建议

目标态：

> shell 由 route-level / app-level 决定，page 只负责内容。

也就是说：

- page 不再直接感知 `embedded`
- shell 选择逻辑统一收口

---

## P1-1. 模块划分策略不一致：技术分层与业务分层混用

### 现状

当前项目同时存在两种组织方式：

#### 技术分层

- `components/`
- `hooks/`
- `utils/`

#### 业务分层

- `features/knowledgePage/`

### 问题

knowledge page 已开始 feature 化，但其他核心域没有同步演进：

- home 仍主要散落在 `pages/home + hooks + utils`
- settings 同样以页面 + hooks + utils 为主
- modeling 也属于混合形态

结果就是：

> 项目处于“已经开始转 feature module，但还没完全转完”的状态。

### 建议

继续沿 feature module 推进，至少对主要业务域逐步完成收口：

- `features/home/*`
- `features/knowledge/*`
- `features/settings/*`
- `features/modeling/*`

每个 feature 尽量收纳：

- route entry 的业务编排
- section components
- domain hooks
- local utils
- local types

---

## P1-2. 大文件过多，说明复杂度没有真正被分解

### 现状

当前若干关键文件体积已经明显过大：

- `src/features/knowledgePage/index.styles.ts` — 2415 行
- `src/server/services/askingService.ts` — 2360 行
- `src/pages/home/index.tsx` — 1983 行
- `src/pages/knowledge/mainStage.tsx` — 1865 行
- `src/pages/settings/connectors.tsx` — 1754 行
- `src/components/reference/DolaAppShell.tsx` — 1714 行
- `src/pages/home/[id].tsx` — 1405 行
- `src/pages/settings/permissions.tsx` — 1413 行

### 问题

超大文件会带来：

- review 成本高
- 改动范围不透明
- bug 定位困难
- 组件职责边界弱
- 测试颗粒度不自然

特别是：

- `features/knowledgePage/index.styles.ts` 2415 行，说明“样式被挪走了，但复杂度没有被拆开”

### 建议

优先拆分以下文件：

1. `src/pages/home/index.tsx`
2. `src/pages/knowledge/mainStage.tsx`
3. `src/components/reference/DolaAppShell.tsx`
4. `src/features/knowledgePage/index.styles.ts`

拆分方式建议按职责切：

- shell / layout
- orchestration state
- section renderer
- modal / drawer
- action handlers
- styles by section

---

## P1-3. 路由层仍存在兼容别名与废弃路径负担

### 现状

典型例子：

- `src/pages/api/v1/settings/data-source.ts`
  - 实际只是转发到 `./connection`
- `src/pages/api/v1/generate_vega_chart.ts`
  - 文件头明确标注 deprecated compatibility endpoint
- `src/pages/api/ask_task/streaming.ts`
- `src/pages/api/ask_task/streaming_answer.ts`

### 问题

当前 route tree 中同时存在：

- canonical route
- compatibility alias
- deprecated endpoint

如果缺少显式 inventory，会造成：

- 清理成本越来越高
- 新接口设计时继续复制 legacy 路径
- 前后端认知分裂

### 建议

补一份 route inventory：

- canonical routes
- compatibility aliases
- deprecated routes
- removal gate

---

## P1-4. `/modeling` 已经退化为兼容跳转入口，应纳入后续路由清理

### 现状

`src/pages/modeling.tsx` 当前逻辑：

- 并不承载真实建模页面
- 而是在加载后直接跳转到知识库工作台建模分区

### 判断

这符合当前产品结构方向，即：

> 语义建模属于知识库工作台，而不是独立主页面

### 风险

如果长期不标记它的角色，它会变成另一个“默认保留的 alias”。

### 建议

将 `/modeling` 明确标记为：

- compatibility route
- 是否继续保留的判断条件
- 未来删除门槛

---

## P1-5. `DolaAppShell` 已接近 god component

### 现状

文件：

- `src/components/reference/DolaAppShell.tsx` — 1714 行

当前承载职责包括：

- sidebar
- top shell
- history list
- workspace switcher
- account menu
- prefetch
- virtualization
- shell UI state

### 问题

这已经不是单一组件，而是一个 shell 子系统。

### 建议

继续拆分为更明确的子模块：

- `ShellSidebar`
- `ShellHistoryList`
- `ShellWorkspaceSwitcher`
- `ShellAccountMenu`
- `ShellPrefetchController`
- `ShellFrame`

---

## P1-6. 请求与缓存原语没有完全收敛

### 现状

已经存在统一请求原语：

- `src/hooks/useRestRequest.ts`

但使用范围仍有限：

- 使用 `useRestRequest` 的 hooks 数量较少
- 直接 `fetch(` 的 hook 仍然不少

同时缓存 TTL / storage 逻辑分散在多处：

- `src/hooks/useAuthSession.ts`
- `src/hooks/useHomeSidebar.tsx`
- `src/utils/dashboardRest.ts`
- `src/utils/knowledgeDiagramRest.ts`
- `src/pages/home/index.tsx`
- `src/utils/runtimePagePrefetch.ts`
- `src/hooks/useResponsePreviewData.ts`

### 问题

导致：

- loading/error/cancel 行为不完全一致
- cache key 与 TTL 策略分散
- invalidation 难统一
- hook 行为标准不稳定

### 建议

下一步应继续收敛到统一的数据请求层，至少统一：

- request cancel
- loading / error shape
- cache key
- TTL
- invalidation
- stale-while-revalidate 策略

---

## P1-7. 页面 orchestration 仍然偏重

### 现状

几个主页面仍然承担大量状态编排职责：

- `src/pages/home/index.tsx`
- `src/pages/home/[id].tsx`
- `src/pages/knowledge/index.tsx`
- `src/pages/home/dashboard.tsx`

这些文件内 `useMemo` / `useCallback` / `useEffect` 数量非常密集。

### 问题

这通常意味着：

- page 仍承担过多 orchestration 责任
- hooks 虽然存在，但并未完全下沉复杂性
- UI 层本身仍然偏重

### 建议

继续拆为：

- page entry
- screen orchestrator
- section renderer
- view components

---

## P2-1. 依赖栈整体稳定，但偏老且有版本漂移

### 当前关键版本

- `next`: `14.2.35`
- `react`: `18.2.0`
- `antd`: `4.20.4`
- `styled-components`: `5.3.6`
- `next-with-less`: `3.0.1`
- `@next/bundle-analyzer`: `15.3.0`
- `eslint-config-next`: `14.2.21`
- `@types/node`: `18.16.9`

### 问题

#### 1. Antd 4 + Less 栈偏老

当前能跑，但：

- 主题系统偏重
- 依赖链较老
- 后续升级成本会越来越高

#### 2. Next 生态存在版本漂移

例如：

- `next` 14.x
- `@next/bundle-analyzer` 15.x
- `eslint-config-next` 14.x

#### 3. 重复依赖

- `cron-parser` 同时出现在 `dependencies` 和 `devDependencies`

#### 4. Node 类型版本偏旧

- `@types/node` 偏老，未来与实际 Node 运行环境可能漂移

### 建议

短期先做：

- 对齐 Next 相关版本
- 清理重复依赖
- 做一次 package audit

中期再评估：

- Antd 4 / less / styled-components 的演进路线

---

## P2-2. Knowledge Workbench 仍缺 section 级别的懒加载

### 现状

knowledge workbench 已经很重，但目前未见明显按主分区进行更彻底的 section-level lazy split。

### 风险

- 首屏 bundle 偏大
- workbench 越做越重
- 后续每加一个分区，首页包体进一步膨胀

### 建议

按主分区做懒加载：

- overview
- assets
- modeling
- SQL templates
- analysis rules
- heavy drawer / detail panel

---

## 4. 当前调用关系判断

当前代码大致已经形成以下层次：

### UI 层

- `src/pages/*`
- `src/components/*`
- `src/features/*`

### orchestration 层

- `src/hooks/*`
- `src/runtime/client/*`

### 请求 / helper 层

- `src/utils/*Rest.ts`
- `src/utils/runtimePagePrefetch.ts`
- 各种 editor / workbench helper

### BFF 层

- `src/pages/api/v1/*`

### server / service 层

- `src/common.ts`
- `src/server/*`

### 判断

这套分层“事实上存在”，但还没有被目录和命名非常明确地约束出来。  
所以结构是有的，但边界感还不够强。

---

## 5. 优先级建议

### 第一优先级（高收益）

1. 清理 `src/pages` 目录污染
2. 收敛 shell 选择逻辑
3. 拆分超大文件

优先拆：

- `src/pages/home/index.tsx`
- `src/pages/knowledge/mainStage.tsx`
- `src/components/reference/DolaAppShell.tsx`
- `src/features/knowledgePage/index.styles.ts`

---

### 第二优先级（中期）

4. 收敛请求 / 缓存原语
5. 推进 feature 化目录组织

建议优先推进：

- `features/home`
- `features/knowledge`
- `features/settings`
- `features/modeling`

---

### 第三优先级（中长期）

6. 依赖栈与样式体系现代化评估

包括：

- 对齐 Next 生态版本
- package audit
- 评估 Antd4 / less / styled-components 后续路线

---

## 6. 最终判断

当前前端不是“设计错误”，而是一个典型的：

> 从单页/散页开发，逐步向平台型工作台架构演进中的项目

它最大的问题不是“不合理”，而是：

- 结构开始成型了，但还没收完
- 壳层、业务域、路由层、请求层都已经有了雏形
- 但还存在多套旧方式并存的问题

如果继续只做功能，不继续做架构收口，后续维护成本会明显上升。

因此建议：

> 进入“功能继续做，但同步推进前端架构收口”的阶段。

