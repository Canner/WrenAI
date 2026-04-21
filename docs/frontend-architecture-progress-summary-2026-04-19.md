# Frontend Architecture Progress Summary — 2026-04-19

对应：

- `docs/frontend-architecture-backlog-2026-04-18.md`
- `docs/frontend-architecture-review-2026-04-18.md`
- `docs/frontend-architecture-next-batch-2026-04-19.md`

## 一句话结论

当前前端架构收口整体进度约 **89%**。

- **结构性重构** 基本完成
- **统一性治理** 已大幅推进，但仍有尾项
- **依赖/技术栈治理** 已启动并有落地成果，但尚未完整收尾

---

## Fresh verification evidence

### 1. giant-file 主目标已完成

按当前标准（**仅看非测试代码，500 行以内即达标**）：

- `wren-ui/src` 中 **非测试代码 >500 行文件数 = 0**

补充观察：

- 仍有一批文件处在 `450~500` 行区间，例如：
  - `src/pages/api/v1/workspace/current.ts`（500）
  - `src/components/pages/home/promptThread/ChartAnswer.tsx`（500）
  - `src/server/services/askingServiceRuntimeSupport.ts`（499）
  - `src/server/dataSource.ts`（498）
  - `src/server/adaptors/ibisAdaptor.ts`（498）
- 这些文件 **未超过** 当前阈值，因此 giant-file 主线可视为完成。

### 2. route inventory / allowlist 已落地

已确认以下产物存在：

- `docs/frontend-route-inventory-2026-04-18.md`
- `docs/frontend-legacy-route-inventory-2026-04-18.md`
- `docs/frontend-giant-file-inventory-2026-04-18.md`
- `wren-ui/scripts/check_pages_routes.mjs`
- `wren-ui/scripts/pages-route-allowlist.json`

并且：

- `pages-route-allowlist.json` 当前锁定 **168** 条 route entry / compatibility route。

### 3. route entry -> feature page 收口已基本成型

已确认以下页面入口已经收成 route-facing re-export 或极薄兼容层：

- `src/pages/settings/connectors.tsx`
- `src/pages/settings/users.tsx`
- `src/pages/settings.tsx`
- `src/pages/knowledge/index.tsx`
- `src/pages/home/[id].tsx`

其对应的 feature 实现也已存在，例如：

- `src/features/settings/connectors/ManageConnectorsPage.tsx`
- `src/features/settings/profile/ManageProfilePage.tsx`
- `src/features/knowledgePage/routes/KnowledgeHomePage`
- `src/features/home/thread/routes/HomeThreadPage`
- `src/features/modeling/ModelingCompatibilityRedirectPage.tsx`

### 4. 请求原语统一已推进，但还未完全收口

已确认当前非测试代码内存在约 **18 处** `useRestRequest` 实际调用点，例如：

- `src/hooks/useDeployStatusRest.ts`
- `src/hooks/useModelList.ts`
- `src/hooks/useCheckOnboarding.tsx`
- `src/hooks/useRuntimeSelectorState.tsx`
- `src/hooks/useApiHistoryList.ts`
- `src/hooks/useAuthSession.ts`
- `src/hooks/useAutoComplete.tsx`
- `src/hooks/useHomeSidebar.tsx`
- `src/hooks/useKnowledgeDiagramData.ts`
- `src/hooks/useThreadDetail.ts`
- `src/hooks/useSkillsControlPlaneData.ts`
- `src/features/home/dashboard/useManageDashboardData.ts`（list/detail 两处）
- `src/features/settings/connectors/useConnectorCatalog.ts`
- `src/features/settings/skills/useSkillConnectors.ts`
- `src/features/settings/systemTasks/ManageSystemTasksPage.tsx`
- `src/features/settings/useWorkspaceGovernanceOverview.ts`
- `src/features/settings/permissions/usePermissionsRoleCatalog.ts`

另外，Wave 4 最近又完成了两类“重复状态机收口”：

- `src/hooks/runtimeSelectorStateRequest.ts`：runtime selector 的 URL / request-key /
  GET request / initial-loading 判断已下沉到独立 request helper，`useRuntimeSelectorState.tsx`
  主体只保留 provider 与 `useRestRequest` 编排
- `src/hooks/usePollingRequestLoop.ts`：thread response / recommended questions
  两条轮询链路已共享同一套 polling coordinator，不再各自维护 session/timer/loading 状态机
- `src/hooks/homeSidebarRequests.ts`：sidebar threads 的主 GET / rename / delete
  request 已统一迁到独立 request helper，`useHomeSidebar.tsx` 主体不再直接持有
  `fetch + response.json().catch(() => null)` 细节
- `src/hooks/recommendedQuestionsInstructionHelpers.ts`：推荐问题入口的 empty-task /
  grouping / polling-loader / settlement 逻辑已下沉成纯 helper，`useRecommendedQuestionsInstruction.tsx`
  当前改为基于 `usePollingRequestLoop` 承接主轮询链路
- `src/hooks/deployStatusRestHelpers.ts`：deploy status 的 unsynchronized fallback /
  polling continuation 判断已下沉到纯 helper，`useDeployStatusRest.ts` 当前改为
  复用 `PollingRequestCoordinator`

同时，粗扫 hooks/features/pages 后，仍能看到数量不小的 `fetch/refetch/loading/requestUrl` 风格残留模式，说明：

- **统一请求原语已经推进**
- 但 **还没有完全统一到位**

### 5. Wave 7 已完成关键事实收口，并新增固定 audit 入口，但仍未形成治理闭环

已确认存在：

- `docs/frontend-dependency-audit-2026-04-18.md`

并且 `wren-ui/package.json` 中以下版本已经对齐：

- `next = 14.2.35`
- `eslint-config-next = 14.2.35`
- `@next/bundle-analyzer = 14.2.35`

另外：

- `cron-parser` 仅保留 `dependencies` 一份，`devDependencies` 中重复声明已移除。
- `frontend-architecture-review` 中早期记录的 `@next/bundle-analyzer = 15.x`、`eslint-config-next = 14.2.21`、`cron-parser` 双声明，已不应再视为当前 repo 事实。
- `wren-ui/package.json` 已补上固定入口：
  - `yarn deps:audit`
  - `yarn deps:audit:check`
  - `yarn deps:why:cron-parser`
- `vega-embed` 已升级到 `^7.1.0`，以匹配当前 `vega 6` / `vega-lite 6` 组合
- `styled-components` 的 `react-is` peer 已由 direct dependency `react-is@18.2.0` 显式满足
- `yarn dedupe --check` 已无可继续 dedupe 的包；`yarn install --mode=skip-build` 仍有依赖树内部的 peer warning 噪音，但 Wave 7 当前最直接的 workspace 级告警已收口
- `deps:audit:check` 已接入 `.github/workflows/ui-lint.yaml`
- `ts-essentials`、`@testing-library/react`、`duckdb-async`、`duckdb`、`micro`、`micro-cors`、`pg-cursor`、`@google-cloud/bigquery` 与 `@google-cloud/storage` 已作为首批“可疑依赖”收口样本被移除；`rg` / `yarn why` / `yarn deps:audit:check` / `yarn check-types` 均支持该决策
- 当前技术栈评估面主要集中在：
  - `antd`（repo 中约 290 个文件直接 import）
  - `styled-components`（repo 中约 93 个文件直接使用）
  - `src/styles/**/*.less`（约 23 个 Less 文件）
- 新鲜复核还显示：
  - `npm view antd dist-tags --json` 显示 `latest = 6.3.6`、`latest-5 = 5.29.3`、`latest-4 = 4.24.16`
  - `npm view @ant-design/icons dist-tags --json` 显示 `latest = 6.1.1`
  - `npm view antd@6 peerDependencies --json` 显示 `react` / `react-dom` 需要 `>=18.0.0`
  - 非测试代码里约 **278 个文件** 直接 import `antd`
  - `src/import/antd.ts` 当前维护 **47** 个 Antd 4 alias export
  - Antd prep Batch 0A 落地前约 **21 个非测试文件** 直接 import `antd/lib/*` 或 `antd/es/*`
  - 当前已先清掉其中 **14** 个纯 low-risk internal import 文件，剩余 **7** 个 internal-import 文件
  - 约 **45** 处 `visible=`、**4** 处 `onVisibleChange` / `onDropdownVisibleChange`
  - 约 **12** 处 `Tabs.TabPane`、**19** 处 `bodyStyle` / `maskStyle` / `overlayStyle` / `dropdownClassName` 等旧 prop
  - 约 **18** 处 `moment`
  - `next.config.js` + `_app.tsx` + `src/styles/index.less` + `src/styles/antd-variables.less`
    仍共同维持 `next-with-less` / Antd Less 主题链
  - `src/pages/_document.tsx` 当前仍只做 `styled-components` SSR，尚未接 Antd CSS-in-JS 的 Next Pages Router SSR
- 剩余 `yarn explain peer-requirements` 的 `✘` 项已整理成决策表，当前统一按 **non-blocking transitive warning** 处理：
  - `p89e94` (`@typescript-eslint/utils` / `typescript`)
  - `p8d462` (`babel-plugin-styled-components` / `@babel/core`)
  - `p98b67` (`react-resizable` / `react-dom`)
- Wave 7 的首版“可疑依赖清单”也已补出，当前重点候选包括：
  - 运行时 / server 侧：首轮候选已清空
  - dev / tooling 侧：首轮候选已清空，后续若再发现 workspace-only 工具包再补入

这意味着 Wave 7 已经从 **dependency closure** 进入更偏 **路线图产出 / 技术栈升级窗口评估** 的阶段，而不是立即发起大规模样式栈迁移。对当前仓库而言，“Antd 4 → 最新稳定版”应理解为 **v4 → v5 → v6 的分波次迁移**，而不是顺手升级一个包。

---

## Wave-by-Wave 进度判断

| Wave | 主题 | 当前判断 | 完成度 |
| --- | --- | --- | --- |
| Wave 0 | 基线 / inventory | 已完成 | 95%+ |
| Wave 1 | 清理 `pages/` 目录污染 | 主目标完成 | 90%+ |
| Wave 2 | shell 架构收敛 | 主边界已成型 | 85%~90% |
| Wave 3 | giant-file 拆分 | 按当前标准已完成 | 95%+ |
| Wave 4 | 请求 / 缓存原语统一 | 已推进但未完全收口 | 80%~87% |
| Wave 5 | feature module 化 | 主体基本成型 | ~90% |
| Wave 6 | legacy route / compatibility 收口 | 主体已落地，可能仍有尾项 | 85%~90% |
| Wave 7 | 依赖 / 技术栈治理 | 已完成事实收口、固定 audit 入口、首版可疑依赖清单，并连续关闭九项可疑依赖 | 85%~92% |

---

## 各 Wave 备注

### Wave 0

已具备：

- route inventory
- legacy route inventory
- giant-file inventory
- pages route allowlist

### Wave 1

已可确认：

- `src/pages/knowledge/*` 组件型文件已迁离
- `src/pages/api/v1` 下共享 helper 已下沉到 server/helper 层
- setup 页已有 route-entry re-export 收口

### Wave 2

`DolaAppShell` 已拆出多个子模块，例如：

- `dolaShellUtils.ts`
- `DolaShellNavPane.tsx`
- `DolaShellHistoryPane.tsx`
- `DolaShellFooterPanel.tsx`
- `useDolaAppShellSidebarState.tsx`

说明 shell 主边界已不再是单体壳组件。

### Wave 3

是完成度最高的一波之一：

- knowledge / home / thread 页面大块拆分已经完成
- server 侧 controller / service / adaptor / repository 多数已完成瘦身
- 非测试 giant-file 已清零

### Wave 4

当前更像“主路径已经迁，长尾还在”的状态：

- runtime selector / onboarding / connectors / permissions / governance overview 等关键链路已接入 `useRestRequest`
- thread response / recommended questions 两条 polling 链路已共用 `usePollingRequestLoop`
- runtime selector 的 request helper 已拆到 `runtimeSelectorStateRequest.ts`
- 推荐问题 instruction 入口也已接入 `usePollingRequestLoop`，不再自管重复 poll-timer 状态机
- deploy status 轮询已改为基于 `PollingRequestCoordinator` 调度，不再自管 `timerRef`
- 但 direct fetch / request state machine 还没有完全归一

### Wave 5

feature 化已经非常深入：

- knowledge 域：已具备 route / sections / hooks / modals / page frame / controller 分层
- home 域：thread / landing / sidebar / prompt composer 已拆成 feature 目录
- settings 域：connectors / profile / skills / permissions / identity 等子域已经成立

### Wave 6

已经不只是 inventory，而是有工具与代码约束：

- route allowlist 已建立
- compatibility helper 已建立
- `/modeling` 等兼容入口已进入统一收口路径
- 一批 route 已直接指向 canonical feature page

### Wave 7

当前已落地的部分：

- dependency audit 文档存在，且已与当前 package 状态重新对齐
- Next 生态关键版本已对齐
- 重复依赖已清理一部分（`cron-parser` 双声明已移除）
- 本地固定审计入口已补上（`deps:audit` / `deps:audit:check`）
- UI lint workflow 已开始执行 `deps:audit:check`
- lockfile 级 dedupe 已收口，且 `vega` / `react-is` 两类 workspace 级依赖告警也已收口
- `ts-essentials`、`@testing-library/react`、`duckdb-async`、`duckdb`、`micro`、`micro-cors`、`pg-cursor`、`@google-cloud/bigquery` 与 `@google-cloud/storage` 已完成“无源码命中 → 移除 → 重新验证”的首批可疑依赖治理闭环
- 剩余 peer warning 已有明确 defer 决策，不再作为 Wave 7 当前阻塞项
- 首版可疑依赖清单已经清空，Wave 7 的重点开始转向长期技术栈路线图
- 当前更明确的路线是：
  - 先冻结新增 `antd/lib/*` / `antd/es/*` / 全局 Less / 新 feature 中的 `styled-components` 扩张
  - 再清桥接层（Antd internal imports / Less variable surface）；其中 pure low-risk internal import 已先收掉一批，剩余重点转向 private surface 与 facade
  - 最后才决定是否拆 Antd 5 / Antd 6 / Less 退场 / styled-components 收缩波次
- 技术栈迁移波及面已基本明确：Antd / Less / styled-components 都是大范围改动

但尚未看到完整闭环，例如：

- 更完整的升级路线图
- 更持续化的依赖治理机制

---

## 当前最值得继续推进的三批事情

下一批可执行清单见：`docs/frontend-architecture-next-batch-2026-04-19.md`

### P1. Wave 4 收尾

目标：把剩余 direct fetch / ad-hoc 请求状态机继续收进统一原语。

建议优先：

- 剩余 mixed-mode 的高频 hook / page helper
- 仍自管 timeout 或附加状态的轮询链路（例如 `useDeployStatusRest.ts`）
- runtime scope / selector 相关但尚未完全 helper 化的边界请求

### P2. Wave 6 长尾收口

目标：减少 compatibility / alias route 的尾部复杂度。

建议优先：

- 仍有额外重定向逻辑的入口
- 仍依赖旧路径语义的薄兼容页面
- 仍散落在页面侧的 route 判定 helper

### P3. Wave 7 做完整

目标：把依赖与技术栈治理从“已有 audit 结果”推进到“完整执行波次”。

建议优先：

- 先把 `antd/lib/*` / `antd/es/*` 入口压回统一边界，再输出 `antd` / `less` / `next-with-less` / `styled-components` 的正式迁移波次
- 评估 Next / React / TypeScript 的升级窗口
- 把依赖审计从本地脚本继续推进到 CI / 发布门禁，而不只停留在手工执行

---

## 结论

这份 backlog 当前更适合这样理解：

- **主结构改造已经基本完成**
- **统一性治理还剩少量尾项**
- **依赖治理已经完成事实收口并开始连续逐包去脂，但还没有完全收尾**

如果后续继续按收益排序推进，最优先建议是：

1. 收 Wave 4 的 direct fetch 长尾
2. 收 Wave 6 的 compatibility route 长尾
3. 把 Wave 7 从“有 audit”推进到“有治理闭环”

---

## Verification snapshot（2026-04-19 二次复核）

本摘要补充了一轮独立快照验证，结果如下：

- 非测试代码 `>500` 行文件数：**0**
- near-threshold 非测试文件 Top 5：
  - `src/pages/api/v1/workspace/current.ts`（500）
  - `src/components/pages/home/promptThread/ChartAnswer.tsx`（500）
  - `src/server/services/askingServiceRuntimeSupport.ts`（499）
  - `src/server/dataSource.ts`（498）
  - `src/server/adaptors/ibisAdaptor.ts`（498）
- `pages-route-allowlist.json` 当前锁定路由数：**168**
- 非测试代码内 `useRestRequest` 实际调用数：**18**
- 最近一批验证已额外通过：
  - `yarn --cwd wren-ui next lint --file src/hooks/usePollingRequestLoop.ts --file src/hooks/usePollingRequestLoop.test.ts --file src/hooks/useThreadResponsePolling.ts --file src/hooks/useThreadRecommendedQuestionsPolling.ts --file src/hooks/useRuntimeSelectorState.tsx --file src/hooks/runtimeSelectorStateRequest.ts --file src/hooks/useRuntimeSelectorState.test.ts`
  - `yarn --cwd wren-ui jest src/hooks/usePollingRequestLoop.test.ts src/hooks/useThreadResponsePolling.test.ts src/hooks/useThreadRecommendedQuestionsPolling.test.ts src/hooks/useRuntimeSelectorState.test.ts --runInBand`
  - `yarn --cwd wren-ui check-types`
- 本轮继续通过：
  - `yarn --cwd wren-ui next lint --file src/hooks/useHomeSidebar.tsx --file src/hooks/useHomeSidebar.test.ts --file src/hooks/homeSidebarRequests.ts --file src/hooks/homeSidebarRequests.test.ts`
  - `yarn --cwd wren-ui jest src/hooks/useHomeSidebar.test.ts src/hooks/homeSidebarRequests.test.ts --runInBand`
  - `yarn --cwd wren-ui check-types`
- 本轮继续通过：
  - `yarn --cwd wren-ui next lint --file src/hooks/useRecommendedQuestionsInstruction.tsx --file src/hooks/recommendedQuestionsInstructionHelpers.ts --file src/hooks/recommendedQuestionsInstructionHelpers.test.ts --file src/hooks/usePollingRequestLoop.ts --file src/hooks/usePollingRequestLoop.test.ts --file src/components/pages/home/prompt/RecommendedQuestionsPrompt.tsx`
  - `yarn --cwd wren-ui jest src/hooks/recommendedQuestionsInstructionHelpers.test.ts src/hooks/usePollingRequestLoop.test.ts --runInBand`
  - `yarn --cwd wren-ui check-types`
- 本轮继续通过：
  - `yarn --cwd wren-ui next lint --file src/hooks/useDeployStatusRest.ts --file src/hooks/useDeployStatusRest.test.ts --file src/hooks/deployStatusRestHelpers.ts`
  - `yarn --cwd wren-ui jest src/hooks/useDeployStatusRest.test.ts --runInBand`
  - `yarn --cwd wren-ui check-types`
- `package.json` 关键版本对齐：
  - `next = 14.2.35`
  - `eslint-config-next = 14.2.35`
  - `@next/bundle-analyzer = 14.2.35`
- `cron-parser` 当前状态：
  - `dependencies.cron-parser = ^5.1.1`
  - `devDependencies.cron-parser = null`

另外抽样确认了以下 route entry 已经是极薄 re-export：

- `src/pages/settings/connectors.tsx`
- `src/pages/settings/users.tsx`
- `src/pages/settings.tsx`


## Residual hotspot evidence（2026-04-19）

### Wave 4 残余热点（基于 direct-fetch / request-state 启发式扫描）

以下文件仍最像“下一批统一请求原语”的优先候选：

1. `src/hooks/useKnowledgeDiagramData.ts`（11）
2. `src/hooks/useRuntimeSelectorState.tsx`（10）
3. `src/features/settings/systemTasks/ManageSystemTasksPage.tsx`（15，主 overview 读取已迁入 `useRestRequest`，残余主要是 request key 与 mutation fetch）
4. `src/hooks/useThreadDetail.ts`（14，主读取链路已迁入 `useRestRequest`，残余主要是 request-key / retry helper）
5. `src/features/home/dashboard/useManageDashboardData.ts`（14，list/detail 主读取链路已迁入 `useRestRequest`）
6. `src/hooks/useRecommendedQuestionsInstruction.tsx`（剩余主要是 timeout 提示与按钮态编排）

说明：这不是“必须重构”的精确名单，而是基于 `fetch / requestUrl / requestIdRef / setLoading / refetch / catch(() => null)` 等模式扫描出来的**高概率残留热点**。

进一步抽样复核可见：

- `src/hooks/useThreadDetail.ts`：已把主读取链路迁入 `useRestRequest`；当前启发式分值主要来自 `requestUrl` helper/重试包装，而不再是自管 fetch + loading 状态机
- `src/features/home/dashboard/useManageDashboardData.ts`：list/detail 主读取链路都已迁入 `useRestRequest`，并保留“自动读取走 cache、手动 refetch 默认 network-only”的原有语义
- `src/hooks/useKnowledgeDiagramData.ts`：已把 diagram 主读取链路迁入 `useRestRequest`；当前启发式分值主要来自 request-key / cache helper，而不再是本地 requestId + loading 状态机
- `src/hooks/useAuthSession.ts`：已迁入 `useRestRequest`，并保留 auth session 自己的 TTL cache + in-flight dedupe；当前已不再属于主要残余热点
- `src/hooks/useAutoComplete.tsx`：已迁入 `useRestRequest`；当前启发式分值主要来自 request-key / diagram helper 复用，不再是本地 cancelled + setData 请求状态机
- `src/features/settings/systemTasks/ManageSystemTasksPage.tsx`：workspace schedules 的主 overview 读取已迁入 `useRestRequest`；当前启发式分值主要来自 request key helper 与 action mutation fetch，不再是 page-level 初始加载状态机
- `src/hooks/useRuntimeSelectorState.tsx`：request helper 已拆到 `runtimeSelectorStateRequest.ts`，hook 主体已明显变薄；当前剩余启发式分值主要来自 request-key plumbing，而不再是内联 fetch/options 逻辑
- `src/hooks/useHomeSidebar.tsx`：主 GET / rename / delete request 已下沉到
  `homeSidebarRequests.ts`；当前 hook 本体已不再直接包含网络 `fetch` 与
  `response.json().catch(() => null)`，剩余复杂度主要来自 warm-cache /
  intent gate / refetch orchestration
- `src/hooks/useThreadResponsePolling.ts` / `src/hooks/useThreadRecommendedQuestionsPolling.ts`：已改为复用 `usePollingRequestLoop.ts`，不再各自维护 timer/session/loading 状态机，因此不再列为主要独立热点
- `src/hooks/useRecommendedQuestionsInstruction.tsx`：已改为复用
  `usePollingRequestLoop.ts`，并把 empty-task / grouping / settlement /
  prefetched-loader 逻辑拆到 `recommendedQuestionsInstructionHelpers.ts`；
  当前剩余复杂度主要来自 timeout 提示与按钮态编排，而不再是重复轮询状态机
- `src/hooks/useDeployStatusRest.ts`：已改为复用 `PollingRequestCoordinator`，
  并把 fallback/polling guard 逻辑拆到 `deployStatusRestHelpers.ts`；
  当前剩余主要是 `refetch().catch(() => null)` 的静默错误与 deploy-specific return
  shape，不再是自管 `timerRef + setTimeout` 循环

### Wave 6 残余热点（基于 pages route 入口扫描）

`src/pages` 目录下，除 `_app.tsx` / `_document.tsx` 之外，当前剩余更像“兼容入口而非纯 route re-export”的页面主要有：

- `src/pages/settings/security.tsx`
- `src/pages/workspace/schedules.tsx`
- `src/pages/settings/workspace.tsx`
- `src/pages/settings/access.tsx`
- `src/pages/register.tsx`
- `src/pages/api-management/history.tsx`

这些入口当前大多已经是统一的 compatibility alias / redirect helper 包装层，因此它们更接近 **Wave 6 长尾治理对象**，而不是结构性风险。

进一步抽样确认：

- `settings/security.tsx` 使用 `createCompatibilityRedirect(...) + CompatibilityRedirectPage`
- `workspace/schedules.tsx`、`settings/workspace.tsx`、`settings/access.tsx`、`register.tsx`、`api-management/history.tsx` 已统一改为 `createCompatibilityAliasPage(...)`
- `/modeling` 也已收口到 `features/modeling/ModelingCompatibilityRedirectPage.tsx`

这说明 Wave 6 当前的剩余项更像“是否还要继续删除兼容入口”的产品/治理问题，而不是架构失控问题。
