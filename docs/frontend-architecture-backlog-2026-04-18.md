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
- 大文件收口到 **500 行以内** 即视为达标，不再为拆分而拆分
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

当前进展（2026-04-18）：

- `src/pages/knowledge/*` 的组件型文件已迁出到 `src/features/knowledgePage/*`
- `src/pages/api/v1` 下共享 helper 已迁出到 `src/server/api/*`
  - `apiContext.ts`
  - `restApi.ts`
  - `dashboardRestShared.ts`
  - `threadPayloadSerializers.ts`
- `src/pages/setup/{connection,models,relationships}.tsx` 已收口为 route-entry re-export；
  实际页面实现已下沉到 `src/features/setup/*`

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

当前进展（2026-04-18）：

- 已拆出 `src/features/home/homeSkillOptions.ts`
- 已拆出 `src/features/home/homePageStyles.tsx`
- `src/features/home/homePageStyles.tsx` 已继续从约 502 行收口到约 463 行；当前改为 styled leaf 直接 inline export，移除底部集中 export block 后不再超过 500 行阈值
- 已拆出：
  - `src/features/home/components/HomeKnowledgePickerDropdown.tsx`
  - `src/features/home/components/HomeRecommendationSection.tsx`
  - `src/features/home/components/HomeSkillPickerModal.tsx`
- 已拆出 `src/features/home/components/HomeLandingStage.tsx`
- 已拆出 `src/features/home/homePageRuntime.ts`
- 已拆出 `src/features/home/useHomeLandingControls.tsx`
- 已拆出 `src/features/home/useHomeRecommendations.ts`
- 已拆出 `src/features/home/useHomeThreadCreation.ts`，将
  create-asking-task/create-thread/navigation/persistent-history-refetch
  这一条线程创建主链路从 `home/index.tsx` 继续拆到独立 feature hook
- 已拆出 `src/features/home/useHomeSuggestedQuestions.ts`，将
  首页推荐问题读取 effect 与 payload 状态从 page entry 下沉到独立数据 hook
- 已拆出 `src/features/home/useHomeSkillOptions.ts`，将
  首页技能列表的缓存命中、按 workspace 复用请求、加载态与错误反馈
  从 page entry 下沉到独立数据 hook
- 已补：
  - `src/features/home/homeSkillOptions.test.ts`
  - `src/utils/homeRest.test.ts`
  为首页技能缓存/归一化与 suggested questions REST helper 补充回归测试
- 页面内 skill option storage/cache/fetch helper 与主要渲染块已迁出
- 页面内 ask runtime selector / availability helper 与常量已迁出并由 page re-export
- 已拆出 `src/features/knowledgePage/useKnowledgeAssetWorkbench.ts`，将资产选择项 / 资产草稿预览 / detail drawer 视图聚合从 page entry 下沉到独立 workbench hook
- 已拆出 `src/features/knowledgePage/useKnowledgeWorkbenchActions.ts`，将知识库 modal / 资产向导动作 / route+save lifecycle 编排从 page entry 下沉到独立动作 hook
- 已拆出 `src/features/knowledgePage/useKnowledgeWorkbenchSyncEffects.ts`，将 pending KB sync / switch reset / bootstrap effects 从 page entry 下沉到独立 effect hook
- 已拆出 `src/features/knowledgePage/useKnowledgeWorkbenchKnowledgeState.ts`，将 runtime selector / auth session / knowledge-base selection / meta / runtime bindings 这一整段 selection-meta-runtime dataflow 从 page entry 下沉到独立 workbench state hook
- 已继续拆出 `src/features/knowledgePage/knowledgeWorkbenchKnowledgeStateTypes.ts` / `buildKnowledgeWorkbenchBaseSelectionInputs.ts` / `buildKnowledgeWorkbenchBaseMetaInputs.ts` / `buildKnowledgeWorkbenchRuntimeBindingsInputs.ts`，将 knowledge-state hook 内的 selection/meta/runtime-binding 输入组装继续下沉到 shared types + pure builders，并补齐 `buildKnowledgeWorkbenchKnowledgeStateInputs.test.ts`
- 已继续拆出 `src/features/knowledgePage/buildKnowledgeWorkbenchRuntimeContextInputs.ts` / `buildKnowledgeWorkbenchListCacheInputs.ts` / `buildKnowledgeWorkbenchSelectorFallbackInputs.ts` / `buildKnowledgeWorkbenchDataLoadersInputs.ts`，将 knowledge-state hook 内的 runtime-context/list-cache/selector-fallback/data-loader 输入组装继续下沉到 pure builders；`buildKnowledgeWorkbenchKnowledgeStateInputs.test.ts` 也同步补齐这些 builder 的回归覆盖
- 已拆出 `src/features/knowledgePage/useKnowledgeWorkbenchContentData.ts`，将 connectors / diagram / runtime-sync / assets 这一整段 content dataflow 从 page entry 下沉到独立 workbench content hook
- 已继续拆出 `src/features/knowledgePage/knowledgeWorkbenchContentDataTypes.ts` / `buildKnowledgeWorkbenchConnectorsInputs.ts` / `buildKnowledgeWorkbenchDiagramInputs.ts` / `buildKnowledgeWorkbenchRuntimeDataSyncInputs.ts` / `buildKnowledgeWorkbenchAssetsInputs.ts`，将 content-data hook 内的 connectors/diagram/runtime-sync/assets 输入组装继续下沉到 shared types + pure builders，并补齐 `buildKnowledgeWorkbenchContentDataHookInputs.test.ts`
- 已拆出 `src/features/knowledgePage/useKnowledgeWorkbenchRuleSql.ts`，将 rule/sql actions + manager 组合从 page entry 下沉到独立 workbench hook
- 已拆出 `src/features/knowledgePage/useKnowledgeWorkbenchNavigationState.ts`，将 sidebar data / section routing / asset-detail callback 组合从 page entry 下沉到独立导航 hook
- 已拆出 `src/features/knowledgePage/useKnowledgeWorkbenchPresentationState.ts`，将 asset workbench + navigation 这一组纯展示态从 view-state hook 继续拆出，和 sync effects 分层
- 已继续拆出 `src/features/knowledgePage/buildKnowledgeAssetWorkbenchInputs.ts` 与 `buildKnowledgeWorkbenchNavigationStateInputs.ts`，将 presentation-state hook 内的 asset/navigation 输入组装继续下沉到纯 builder，并补齐 `buildKnowledgeWorkbenchPresentationStateInputs.test.ts`
- 已拆出 `src/features/knowledgePage/knowledgeWorkbenchPresentationStateTypes.ts` 与 `knowledgeWorkbenchViewStateTypes.ts`，将 presentation/view-state hook 的共享参数类型噪音继续抽离到独立 types 文件
- 已拆出 `src/features/knowledgePage/useKnowledgeWorkbenchViewState.ts`，将 asset workbench / navigation state / sync effects 这一组页面视图态组合从 controller hook 继续下沉
- 已继续拆出 `src/features/knowledgePage/buildKnowledgeWorkbenchPresentationStateInputs.ts` 与 `buildKnowledgeWorkbenchSyncEffectsInputs.ts`，将 view-state hook 内的 presentation/sync-effects 输入组装继续下沉到纯 builder，并补齐 `buildKnowledgeWorkbenchViewStateInputs.test.ts`
- 已拆出 `src/features/knowledgePage/useKnowledgeWorkbenchModelingState.ts`，将 modeling summary + committed workspace key 的组合从 controller hook 继续下沉
- 已拆出 `src/features/knowledgePage/buildKnowledgeWorkbenchControllerStage.ts`，将 sidebar/main-stage/overlay 的 stage input assembly 从 controller hook 继续下沉到独立 builder
- 已拆出 `src/features/knowledgePage/buildKnowledgeWorkbenchControllerSidebarInput.ts` / `buildKnowledgeWorkbenchControllerMainStageInput.ts` / `buildKnowledgeWorkbenchControllerOverlaysInput.ts`，将 controller-stage 三条映射 lane 继续拆成独立纯函数
- 已拆出 `src/features/knowledgePage/knowledgeWorkbenchControllerStageTypes.ts`，将 controller-stage builder 共享输入类型抽到独立 types 文件，避免 builder 再次膨胀
- 已继续拆出 `src/features/knowledgePage/knowledgeWorkbenchControllerStageLocalTypes.ts` / `knowledgeWorkbenchControllerStageKnowledgeTypes.ts` / `knowledgeWorkbenchControllerStageContentTypes.ts` / `knowledgeWorkbenchControllerStageActionsTypes.ts` / `knowledgeWorkbenchControllerStageRuleSqlTypes.ts` / `knowledgeWorkbenchControllerStageViewTypes.ts` / `knowledgeWorkbenchControllerStageModelingTypes.ts`，将 controller-stage 的共享类型继续按 lane 分层，`knowledgeWorkbenchControllerStageTypes.ts` 收口为 barrel + aggregate args
- 已拆出 `src/features/knowledgePage/useKnowledgeWorkbenchControllerInteractionState.ts`，将 actions + rule/sql manager + view-state 这一组 action/form wiring 从 controller hook 继续下沉到独立组合 hook
- 已继续拆出 `knowledgeWorkbenchControllerInteractionTypes.ts`、`buildKnowledgeWorkbenchControllerInteractionOperationInputs.ts`、`buildKnowledgeWorkbenchControllerInteractionViewInputs.ts`，将 controller-interaction 的 operations/view 输入映射按 types/两条 lane 继续分层
- 已拆出 `src/features/knowledgePage/useKnowledgeWorkbenchControllerOperations.ts`，将 controller-interaction 内的 actions + rule/sql manager 组合进一步下沉到独立 operations hook
- 已继续拆出 `knowledgeWorkbenchControllerOperationsTypes.ts`、`buildKnowledgeWorkbenchControllerActionsInputs.ts`、`buildKnowledgeWorkbenchControllerRuleSqlInputs.ts`，将 controller-operations 的 actions/ruleSql 输入映射按 types/两条 lane 继续分层
- 已拆出 `src/features/knowledgePage/useKnowledgeWorkbenchControllerViewState.ts`，将 controller-interaction 内的 view-state wiring 进一步下沉到独立 view hook
- 已拆出 `src/features/knowledgePage/buildKnowledgeWorkbenchControllerViewInputs.ts` 与 `knowledgeWorkbenchControllerViewTypes.ts`，将 controller-view-state 内的大段 input mapping 与共享参数类型继续分层
- 已继续拆出 `src/features/knowledgePage/knowledgeWorkbenchControllerViewOperationTypes.ts` 与 `knowledgeWorkbenchControllerViewStateInputTypes.ts`，将 controller-view 的 operations/view-state 共享类型继续按 lane 分层，`knowledgeWorkbenchControllerViewTypes.ts` 收口为 aggregate barrel
- 已拆出 `src/features/knowledgePage/useKnowledgeWorkbenchControllerDataState.ts`，将 knowledge/content/modeling 这一组 data-state wiring 从 page controller 继续下沉到独立组合 hook
- 已继续拆出 `src/features/knowledgePage/buildKnowledgeWorkbenchKnowledgeStateInputs.ts` / `buildKnowledgeWorkbenchContentDataInputs.ts` / `buildKnowledgeWorkbenchModelingStateInputs.ts` / `knowledgeWorkbenchControllerDataStateTypes.ts`，将 controller-data-state hook 内的 knowledge/content/modeling 输入组装继续下沉到纯 builder + shared types，并补齐 `buildKnowledgeWorkbenchControllerDataStateInputs.test.ts`
- 已拆出 `src/features/knowledgePage/buildKnowledgeWorkbenchPageStage.ts`，将 sidebar/main-stage/overlay 三组 stage props 组装从 page entry 下沉到独立 builder
- 已拆出 `src/features/knowledgePage/KnowledgeWorkbenchPageFrame.tsx`，将 knowledge shell + workbench stage 组合从 route entry 下沉到独立页面壳组件
- 已拆出 `src/features/knowledgePage/useKnowledgeWorkbenchPageController.ts`，将 knowledge route entry 的剩余 hook 组合与 page-level assembly 从 route entry 下沉到独立 controller hook
- 已拆出 `src/features/knowledgePage/useKnowledgeWorkbenchPageInteractionState.ts`，将 page-level local/runtime/controller-data wiring 从 `useKnowledgeWorkbenchPageController.ts` 继续下沉
- 已拆出 `src/features/knowledgePage/buildKnowledgeWorkbenchPageInteractionInputs.ts`，将 page-interaction 内的大段 input mapping 收敛到纯 builder，便于测试和继续拆分
- 已拆出 `src/features/knowledgePage/knowledgeWorkbenchPageInteractionInputTypes.ts` 与 `buildKnowledgeWorkbenchPageInteractionLocalInputs.ts` / `buildKnowledgeWorkbenchPageInteractionKnowledgeInputs.ts` / `buildKnowledgeWorkbenchPageInteractionContentInputs.ts`，并将 page-level controller-interaction 入口参数也并入同一 types 文件，整体按 types/local/knowledge/content 四层分 lane
- 已继续拆出 `src/features/knowledgePage/knowledgeWorkbenchPageInteractionLocalTypes.ts` / `knowledgeWorkbenchPageInteractionControllerTypes.ts` / `knowledgeWorkbenchPageInteractionDataTypes.ts`，将 page-interaction 的 local/controller/data 共享类型继续按 lane 分层，`knowledgeWorkbenchPageInteractionInputTypes.ts` 收口为 aggregate barrel
- 已继续拆出 `src/features/knowledgePage/buildKnowledgeWorkbenchPageControllerInteractionArgs.ts`、`buildKnowledgeWorkbenchPageStageArgs.ts` 与 `knowledgeWorkbenchPageControllerTypes.ts`，将 page controller 内的 interaction/stage 输入组装继续按 lane builders + shared types 分层，并补齐 `buildKnowledgeWorkbenchPageControllerInputs.test.ts`
- 已补：
  - `src/features/knowledgePage/useKnowledgeAssetWorkbench.test.tsx`
  - `src/features/knowledgePage/useKnowledgeWorkbenchActions.test.tsx`
  - `src/features/knowledgePage/useKnowledgeWorkbenchSyncEffects.test.tsx`
  - `src/features/knowledgePage/useKnowledgeWorkbenchKnowledgeState.test.tsx`
  - `src/features/knowledgePage/useKnowledgeWorkbenchContentData.test.tsx`
  - `src/features/knowledgePage/useKnowledgeWorkbenchRuleSql.test.tsx`
  - `src/features/knowledgePage/useKnowledgeWorkbenchNavigationState.test.tsx`
  - `src/features/knowledgePage/useKnowledgeWorkbenchPresentationState.test.tsx`
  - `src/features/knowledgePage/useKnowledgeWorkbenchViewState.test.tsx`
  - `src/features/knowledgePage/useKnowledgeWorkbenchModelingState.test.tsx`
  - `src/features/knowledgePage/buildKnowledgeWorkbenchControllerStage.test.ts`
  - `src/features/knowledgePage/useKnowledgeWorkbenchControllerInteractionState.test.tsx`
  - `src/features/knowledgePage/buildKnowledgeWorkbenchControllerInteractionInputs.test.ts`
  - `src/features/knowledgePage/useKnowledgeWorkbenchControllerOperations.test.tsx`
  - `src/features/knowledgePage/buildKnowledgeWorkbenchControllerOperationsInputs.test.ts`
  - `src/features/knowledgePage/useKnowledgeWorkbenchControllerViewState.test.tsx`
  - `src/features/knowledgePage/buildKnowledgeWorkbenchControllerViewInputs.test.ts`
  - `src/features/knowledgePage/buildKnowledgeWorkbenchControllerStageInputs.test.ts`
  - `src/features/knowledgePage/useKnowledgeWorkbenchControllerDataState.test.tsx`
  - `src/features/knowledgePage/buildKnowledgeWorkbenchPageStage.test.ts`
  - `src/features/knowledgePage/KnowledgeWorkbenchPageFrame.test.tsx`
  - `src/features/knowledgePage/useKnowledgeWorkbenchPageInteractionState.test.tsx`
  - `src/features/knowledgePage/buildKnowledgeWorkbenchPageInteractionInputs.test.ts`
  - `src/features/knowledgePage/buildKnowledgeWorkbenchPageInteractionInputLanes.test.ts`
- `home/index.tsx` 已从 ~1983 行降到 ~273 行
- `knowledge/index.tsx` 已进一步收敛到约 37 行
- `useKnowledgeWorkbenchPageController.ts` 已继续从 ~414 行收敛到约 91 行
- 已继续新增 `src/features/knowledgePage/useKnowledgeWorkbenchPageControllerData.ts` / `useKnowledgeWorkbenchPageControllerInteraction.ts`，将 page controller 内剩余的 controller-data builder 调用与 page-interaction builder 调用继续下沉到独立组合 hook；`useKnowledgeWorkbenchPageController.ts` 已继续从约 91 行收口到约 65 行
- 已新增 `useKnowledgeWorkbenchControllerInteractionState.ts`（约 38 行），当前主要承接 controller-operations + controller-view-state 的轻量组合 wiring
- 已新增 `knowledgeWorkbenchControllerInteractionTypes.ts`（约 16 行）、`buildKnowledgeWorkbenchControllerInteractionOperationInputs.ts`（约 69 行）与 `buildKnowledgeWorkbenchControllerInteractionViewInputs.ts`（约 27 行），将 controller-interaction 内的 operations/view 输入映射继续拆为 types + 两条 builder lane
- 已新增 `useKnowledgeWorkbenchControllerOperations.ts`（约 27 行），当前只负责 controller-operations 的轻量委派
- 已新增 `knowledgeWorkbenchControllerOperationsTypes.ts`（约 61 行）、`buildKnowledgeWorkbenchControllerActionsInputs.ts`（约 61 行）与 `buildKnowledgeWorkbenchControllerRuleSqlInputs.ts`（约 23 行），将 controller-operations 内的 actions/ruleSql 输入映射继续拆为 types + 两条 builder lane
- 已新增 `useKnowledgeWorkbenchControllerViewState.ts`（约 16 行），当前只负责 controller-view-state 的轻量委派
- 已新增 `buildKnowledgeWorkbenchControllerViewInputs.ts`（约 36 行）与 `knowledgeWorkbenchControllerViewTypes.ts`（约 91 行），将 controller-interaction 内的 view-state input mapping 与共享参数类型继续分层
- 已新增 `useKnowledgeWorkbenchControllerDataState.ts`（约 35 行），并继续拆出 `buildKnowledgeWorkbenchKnowledgeStateInputs.ts`（约 35 行）/ `buildKnowledgeWorkbenchContentDataInputs.ts`（约 44 行）/ `buildKnowledgeWorkbenchModelingStateInputs.ts`（约 29 行）/ `knowledgeWorkbenchControllerDataStateTypes.ts`（约 39 行），继续承接并分层 page controller 内的 knowledge/content/modeling data-state wiring
- `buildKnowledgeWorkbenchControllerStage.ts` 已继续从约 242 行收敛到约 19 行，当前仅保留 page-stage 组装入口
- 已新增 `knowledgeWorkbenchControllerStageTypes.ts`（约 125 行），把 controller-stage 的共享输入类型继续分层
- 已新增 `buildKnowledgeWorkbenchControllerSidebarInput.ts` / `buildKnowledgeWorkbenchControllerMainStageInput.ts` / `buildKnowledgeWorkbenchControllerOverlaysInput.ts`（约 29 / 72 / 57 行），将 controller-stage 的三条映射 lane 继续拆成独立纯函数
- 已新增 `useKnowledgeWorkbenchPresentationState.ts`（约 28 行）与 `knowledgeWorkbenchPresentationStateTypes.ts`（约 67 行），并继续拆出 `buildKnowledgeAssetWorkbenchInputs.ts`（约 69 行）与 `buildKnowledgeWorkbenchNavigationStateInputs.ts`（约 35 行），将 asset workbench + navigation 这一组纯展示态组合与其输入映射继续分层
- `useKnowledgeWorkbenchViewState.ts` 已进一步从约 202 行收敛到约 26 行，并新增 `knowledgeWorkbenchViewStateTypes.ts`（约 22 行）、`buildKnowledgeWorkbenchPresentationStateInputs.ts`（约 80 行）与 `buildKnowledgeWorkbenchSyncEffectsInputs.ts`（约 58 行）；当前 hook 主要承接 sync effects + presentation-state 的轻量组合
- 已新增 `useKnowledgeWorkbenchPageInteractionState.ts`（约 17 行），当前只负责 page-interaction hook 的轻量委派
- 已新增 `buildKnowledgeWorkbenchPageInteractionInputs.ts`（约 63 行），当前只负责 page-interaction input builder 的轻量组合
- 已新增 `knowledgeWorkbenchPageInteractionInputTypes.ts`（约 92 行）与 `buildKnowledgeWorkbenchPageInteractionLocalInputs.ts` / `buildKnowledgeWorkbenchPageInteractionKnowledgeInputs.ts` / `buildKnowledgeWorkbenchPageInteractionContentInputs.ts`（约 67 / 79 / 64 行），将 page-level local/runtime/controller-data → controller-interaction 的映射与入口共享参数类型继续按 lane 拆开
- 已新增 `knowledgeWorkbenchPageControllerTypes.ts`（约 22 行）、`buildKnowledgeWorkbenchPageControllerInteractionArgs.ts`（约 72 行）与 `buildKnowledgeWorkbenchPageStageArgs.ts`（约 46 行），将 page controller 内的 interaction/stage 输入组装进一步拆成 lane builders + shared types
- 已继续移除仅做 identity passthrough 的 `buildKnowledgeWorkbenchControllerDataInputs.ts`，并把 page-controller data hook 的 runtime/route 输入直接收口回 `useKnowledgeWorkbenchPageControllerData.ts`；对应 `buildKnowledgeWorkbenchPageControllerInputs.test.ts` 已同步删除这层无意义 helper 的断言
- 已继续移除仅做 barrel re-export 的 `buildKnowledgeWorkbenchPageControllerInputs.ts`，并让 `useKnowledgeWorkbenchPageController.ts` / `useKnowledgeWorkbenchPageControllerInteraction.ts` 直接依赖真实 builder lane；page-controller 输入链路的中转层进一步下降
- 针对 knowledge workbench 当前拆分结果，相关定向回归已覆盖到 29 suites / 56 tests（含 route entry / controller composition / controller-data-state composition / controller-operations composition / controller-operations input builder / controller-view-state composition / controller-view input builder / controller-interaction composition / controller-interaction input builder / page-interaction composition / page-interaction input builder / page-interaction input lanes / controller-stage builder / controller-stage input lanes / stage builder / modeling/view-state/presentation-state 组合）
- 剩余 `home/index.tsx` 以 orchestration / state wiring 为主

### W3-2. 拆 `src/components/reference/DolaAppShell.tsx`

建议拆为：

- `ShellFrame`
- `ShellSidebar`
- `ShellHistoryList`
- `ShellWorkspaceSwitcher`
- `ShellAccountMenu`
- `ShellPrefetchController`

当前进展（2026-04-18）：

- 已拆出 `dolaShellUtils.ts`
- 已拆出 `DolaShellNavPane.tsx`
- 已拆出 `DolaShellHistoryPane.tsx`
- 已拆出 `DolaShellFooterPanel.tsx`
- 已拆出 `useDolaShellSidebarPrefetch.ts`
- 已拆出 `dolaShellStyles.ts`
- 已拆出 `useDolaAppShellSidebarState.tsx`
- `DolaAppShell.tsx` 已收敛到约 199 行，当前主要保留 sidebar assembly + frame 组合

### W3-3. 拆 `src/features/knowledgePage/sections/KnowledgeMainStage.tsx`

建议按 section 拆：

- overview
- assets
- modeling entry
- sql templates
- analysis rules
- right drawer / detail panel

当前进展（2026-04-18）：

- 已拆出：
  - `src/features/knowledgePage/sections/KnowledgeOverviewSection.tsx`
  - `src/features/knowledgePage/sections/KnowledgeSqlTemplatesSection.tsx`
  - `src/features/knowledgePage/sections/KnowledgeInstructionsSection.tsx`
  - `src/features/knowledgePage/sections/knowledgeWorkbenchShared.ts`
  - `src/features/knowledgePage/sections/useKnowledgeWorkbenchAssetGallery.ts`
  - `src/features/knowledgePage/sections/useKnowledgeWorkbenchEditors.tsx`
  - `src/features/knowledgePage/sections/useKnowledgeWorkbenchDraftState.ts`
  - `src/features/knowledgePage/sections/useKnowledgeWorkbenchSaveShortcut.ts`
  - `src/features/knowledgePage/sections/knowledgeWorkbenchEditorValueBuilders.ts`
- `KnowledgeMainStage.tsx` 已从 ~1866 行降到 ~347 行
- 已新增 `src/features/knowledgePage/sections/KnowledgeWorkbenchHeader.tsx`，将 summary card / section tabs / edit action 从 `KnowledgeMainStage.tsx` 下沉到独立 feature 组件
- 已新增 `src/features/knowledgePage/sections/KnowledgeSidebarRail.tsx` 与 `src/features/knowledgePage/sections/KnowledgeLoadingStage.tsx`，将知识库页 route entry 中的左侧知识库 rail 与 loading skeleton 下沉到 feature section 目录
- 已新增 `src/features/knowledgePage/modals/KnowledgeWorkbenchOverlays.tsx`，将知识库页底部的 knowledge-base modal / asset wizard modal 条件渲染收敛到同一 feature 组件
- 已新增 `src/features/knowledgePage/sections/buildKnowledgeModelingSummary.ts`，将 knowledge route entry 中的 modeling summary 派生收敛到纯 helper，并补齐 `buildKnowledgeModelingSummary.test.ts` 回归测试
- `pages/knowledge/index.tsx` 已从 ~742 行进一步收口到 ~461 行
- 已新增 `src/features/knowledgePage/sections/KnowledgeOverviewStats.tsx` / `KnowledgeOverviewAssetsPanel.tsx` / `KnowledgeAssetDetailDrawer.tsx` 与 `KnowledgeOverviewSection.test.tsx`，将 `KnowledgeOverviewSection.tsx` 中的统计卡、资产画廊/空状态/加载态以及详情抽屉封装拆到独立 section 组件；随后继续新增 `KnowledgeAssetCreateCard.tsx` / `KnowledgeAssetGalleryCard.tsx` / `KnowledgeOverviewAssetsEmptyState.tsx` / `KnowledgeOverviewAssetsLoadingOverlay.tsx` 与 `KnowledgeOverviewAssetsPanel.test.tsx`，把 `KnowledgeOverviewAssetsPanel.tsx` 再进一步拆到约 82 行；`KnowledgeOverviewSection.tsx` 已继续从约 330 行收口到约 114 行，并通过组件级 + knowledge 页回归锁定行为
- 已新增 `src/features/knowledgePage/sections/AssetDetailFieldOverview.tsx` / `AssetDetailUsagePanel.tsx` / `buildAssetDetailFieldColumns.tsx` / `assetDetailContentTypes.ts` 与 `AssetDetailContent.test.tsx`，将 `AssetDetailContent.tsx` 中的字段概览过滤+表格、推荐问法面板与列定义拆到独立展示片段/纯 helper；`AssetDetailContent.tsx` 已继续从约 405 行收口到约 165 行，并通过组件级 + knowledge 页回归锁定行为
- 已继续新增 `src/features/knowledgePage/sections/KnowledgeModelingSection.tsx` / `KnowledgeSqlTemplatesStage.tsx` / `KnowledgeInstructionsStage.tsx` / `knowledgeMainStageTypes.ts`，将 `KnowledgeMainStage.tsx` 中的 modeling 统计+工作区、SQL 模板 / 分析规则的 section 装配，以及主 stage props 类型继续拆到独立 stage/type 文件；随后继续新增 `KnowledgeOverviewStage.tsx`，把 overview lane 内的资产画廊分页/详情抽屉可见性逻辑也从 `KnowledgeMainStage.tsx` 下沉到独立 stage 组件；再继续新增 `buildKnowledgeMainStageSectionProps.ts` 与 `buildKnowledgeMainStageSectionProps.test.ts`，将 header / overview / modeling / SQL / 分析规则五条 stage props 映射继续收口到纯 builder helper；本轮又把这组 builder helper 再按 `overview/header/modeling`、`SQL/instruction` 与共享 types 三层拆到 `buildKnowledgeMainStageOverviewSectionProps.ts` / `buildKnowledgeMainStageEditorSectionProps.ts` / `knowledgeMainStageSectionPropTypes.ts`，并继续把共享 types 再拆到 `knowledgeMainStageOverviewSectionPropTypes.ts` / `knowledgeMainStageEditorSectionPropTypes.ts`，使 `buildKnowledgeMainStageSectionProps.ts` 收口成 10 行 barrel、`knowledgeMainStageSectionPropTypes.ts` 收口成 15 行 barrel；随后再新增 `buildKnowledgeMainStageEditorsInput.ts` 与 `buildKnowledgeMainStageEditorsInput.test.ts`，将 `KnowledgeMainStage.tsx` 内 editors hook 的长输入映射下沉到纯 helper，主组件保持在约 191 行，并通过 `eslint` + `jest`（7 suites / 25 tests）复用 knowledge 页回归确认行为未变
- dirty-guard / drawer / editor 切换已下沉到 `useKnowledgeWorkbenchEditors.tsx`
- 已新增 `src/features/knowledgePage/sections/buildKnowledgeWorkbenchEditorOpenPlan.ts`，将 SQL 模板 / 分析规则 editor 打开时的 dirty-guard 决策下沉到纯 helper，并补齐 `buildKnowledgeWorkbenchEditorOpenPlan.test.ts` 回归测试
- 已新增 `src/features/knowledgePage/sections/useKnowledgeWorkbenchDirtyGuards.tsx`，将 discard/delete confirm + dirty-guard 执行器从 `useKnowledgeWorkbenchEditors.tsx` 下沉到独立 hook，并补齐 `useKnowledgeWorkbenchDirtyGuards.test.tsx` 回归测试
- 已新增：
  - `src/features/knowledgePage/sections/useKnowledgeWorkbenchSqlActions.ts`
  - `src/features/knowledgePage/sections/useKnowledgeWorkbenchRuleActions.ts`
  - `src/features/knowledgePage/sections/useKnowledgeWorkbenchSqlActions.test.tsx`
  - `src/features/knowledgePage/sections/useKnowledgeWorkbenchRuleActions.test.tsx`
  将 SQL 模板 / 分析规则的 editor 打开、复制、删除、基于资产起草、关闭抽屉等动作按 lane 从 `useKnowledgeWorkbenchEditors.tsx` 下沉
- `useKnowledgeWorkbenchEditors.tsx` 已进一步收口到 ~171 行，当前主要保留 draft-state wiring、published view-state 与轻量组合层
- 已继续新增 `src/features/knowledgePage/sections/resolveKnowledgeWorkbenchDraftDirty.ts` 与 `resolveKnowledgeWorkbenchDraftDirty.test.ts`，将 section switch / SQL 模板打开 / 分析规则打开三处重复的 draft-dirty 判定收敛到共享 helper，并补齐纯函数回归测试
- 已新增 `src/features/knowledgePage/sections/KnowledgeWorkbenchEditorRailControls.tsx` / `KnowledgeWorkbenchEditorEmptyState.tsx` / `KnowledgeWorkbenchAssetContextPanel.tsx` / `KnowledgeWorkbenchEditorDrawerFooter.tsx`，将 SQL 模板 / 分析规则 section 里的列表 rail、空状态、参考资产面板与抽屉 footer 继续下沉到共享 editor fragments；`KnowledgeSqlTemplatesSection.tsx` / `KnowledgeInstructionsSection.tsx` 已进一步从约 368 / 395 行收口到约 294 / 313 行
- 已继续新增 `src/features/knowledgePage/sections/KnowledgeSqlTemplateList.tsx` / `KnowledgeSqlTemplateDrawer.tsx` / `KnowledgeInstructionList.tsx` / `KnowledgeInstructionDrawer.tsx`，将 SQL 模板 / 分析规则 section 再按 list vs drawer 两条 lane 分层；`KnowledgeSqlTemplatesSection.tsx` / `KnowledgeInstructionsSection.tsx` 已继续从约 294 / 313 行收口到约 119 / 119 行
- 已继续新增 `src/features/knowledgePage/sections/KnowledgeSqlTemplateCardGrid.tsx` / `KnowledgeInstructionCardGrid.tsx`，将 list lane 再按 rail controls vs card collection 分层；`KnowledgeSqlTemplateList.tsx` / `KnowledgeInstructionList.tsx` 已继续从约 167 / 176 行收口到约 83 / 86 行
- 已继续新增 `src/features/knowledgePage/sections/KnowledgeWorkbenchCreateEditorCard.tsx` / `KnowledgeSqlTemplateCard.tsx` / `KnowledgeInstructionCard.tsx`，将 card collection 再按共享 create card 与 domain item card 分层；`KnowledgeSqlTemplateCardGrid.tsx` / `KnowledgeInstructionCardGrid.tsx` 已继续从约 120 / 128 行收口到约 50 / 50 行
- 已继续新增 `src/features/knowledgePage/sections/KnowledgeWorkbenchEditorDrawerShell.tsx` / `KnowledgeSqlTemplateFormFields.tsx` / `KnowledgeInstructionFormFields.tsx`，将 drawer lane 再按共享 drawer shell 与 domain form-fields 分层；`KnowledgeSqlTemplateDrawer.tsx` / `KnowledgeInstructionDrawer.tsx` 已继续从约 118 / 132 行收口到约 81 / 81 行
- 已继续新增 `src/features/knowledgePage/sections/KnowledgeWorkbenchAssetContextEditorPanel.tsx`，将 SQL 模板 / 分析规则 drawer 里重复的参考资产动作组装、suggested-question 回填与 readonly gating 收敛到共享 editor panel；`KnowledgeSqlTemplateDrawer.tsx` / `KnowledgeInstructionDrawer.tsx` 已继续从约 81 / 81 行收口到约 73 / 73 行
- 已继续新增 `src/features/knowledgePage/sections/KnowledgeWorkbenchAssetEditorDrawer.tsx`，将 SQL 模板 / 分析规则 drawer 里重复的 drawer shell + asset-context panel 组合继续收敛到共享 asset-editor drawer；`KnowledgeSqlTemplateDrawer.tsx` / `KnowledgeInstructionDrawer.tsx` 已继续从约 73 / 73 行收口到约 69 / 69 行
- 已继续新增 `src/features/knowledgePage/sections/KnowledgeWorkbenchEditorItemCard.tsx`，并将 `KnowledgeSqlTemplateCard.tsx` / `KnowledgeInstructionCard.tsx` 收口为 domain wrapper；item card lane 已继续从约 92 / 97 行收口到约 44 / 47 行
- 已继续新增 `src/features/knowledgePage/sections/KnowledgeWorkbenchEditorItemCardMeta.tsx` / `KnowledgeWorkbenchEditorItemCardActions.tsx`，将共享 item-card 的标题+状态 meta 与 duplicate/delete action wiring 再按 meta/actions 两条 lane 分层；`KnowledgeWorkbenchEditorItemCard.tsx` 已继续从约 86 行收口到约 63 行
- 已继续新增 `src/features/knowledgePage/sections/useKnowledgeWorkbenchSectionChangeGuard.ts` 与 `useKnowledgeWorkbenchSectionChangeGuard.test.tsx`，将 editor rail 内的 section switch dirty-guard / drawer-close 编排从 `useKnowledgeWorkbenchEditors.tsx` 继续下沉到独立 hook，并补齐 hook 级回归；`useKnowledgeWorkbenchEditors.tsx` 已继续从约 225 行收口到约 207 行
- 已继续新增 `src/features/knowledgePage/sections/useKnowledgeWorkbenchAssetEditorLifecycle.ts` 与 `useKnowledgeWorkbenchAssetEditorLifecycle.test.tsx`，将 SQL 模板 / 分析规则 action hooks 中重复的 reset / submit / close-drawer / apply-context 生命周期编排收敛到共享 hook，并补齐 hook 级回归；`useKnowledgeWorkbenchSqlActions.ts` / `useKnowledgeWorkbenchRuleActions.ts` 已继续从约 234 / 236 行收口到约 214 / 218 行
- 已继续新增 `src/features/knowledgePage/sections/useKnowledgeWorkbenchEditorOpenAction.ts` 与 `useKnowledgeWorkbenchEditorOpenAction.test.tsx`，将 SQL 模板 / 分析规则 action hooks 中重复的 open-editor / section-switch / baseline-sync 编排收敛到共享 hook，并补齐 hook 级回归；`useKnowledgeWorkbenchSqlActions.ts` / `useKnowledgeWorkbenchRuleActions.ts` 已继续从约 214 / 218 行收口到约 193 / 197 行
- 已继续新增 `src/features/knowledgePage/sections/knowledgeWorkbenchEditorOpenActionTypes.ts`、`runKnowledgeWorkbenchEditorOpenEffects.ts` 与 `runKnowledgeWorkbenchEditorOpenEffects.test.ts`，将 `useKnowledgeWorkbenchEditorOpenAction.ts` 中长内联泛型参数类型与 open-editor 副作用执行段继续拆到 `types / effect` 两层；`useKnowledgeWorkbenchEditorOpenAction.ts` 已继续从约 118 行收口到约 89 行，并通过 hook + effect + knowledge 页回归锁定行为
- 已继续新增 `src/features/knowledgePage/sections/useKnowledgeWorkbenchEditorEntryActions.ts` 与 `useKnowledgeWorkbenchEditorEntryActions.test.tsx`，将 SQL 模板 / 分析规则 action hooks 中重复的 create-from-asset / duplicate / delete-entry 编排收敛到共享 hook，并补齐 hook 级回归；`useKnowledgeWorkbenchSqlActions.ts` / `useKnowledgeWorkbenchRuleActions.ts` 已继续从约 193 / 197 行收口到约 167 / 173 行
- 已继续新增 `src/features/knowledgePage/sections/knowledgeWorkbenchEditorEntryActionTypes.ts`、`runKnowledgeWorkbenchEditorEntryEffects.ts` 与 `runKnowledgeWorkbenchEditorEntryEffects.test.ts`，将 `useKnowledgeWorkbenchEditorEntryActions.ts` 中长内联参数类型与 create-from-asset / duplicate / delete-entry 副作用执行段继续拆到 `types / effect` 两层；`useKnowledgeWorkbenchEditorEntryActions.ts` 已继续从约 99 行收口到约 87 行，并通过 hook + effect + knowledge 页回归锁定行为
- 已继续新增 `src/features/knowledgePage/sections/useKnowledgeWorkbenchAssetEditorActions.ts`，将 SQL 模板 / 分析规则 action hooks 中共享的 lifecycle + open-editor + entry-actions 组合进一步收口到统一 hook；随后为保持 `KnowledgeMainStage.tsx` 现有调用契约，`useKnowledgeWorkbenchSqlActions.ts` / `useKnowledgeWorkbenchRuleActions.ts` 重新补回 domain wrapper，当前约 142 / 148 行，仍明显低于收口前的 167 / 173 行，并通过 `useKnowledgeWorkbenchSqlActions.test.tsx` / `useKnowledgeWorkbenchRuleActions.test.tsx` / `src/tests/pages/knowledge/index.test.tsx` 复用回归验证
- 已继续新增 `src/features/knowledgePage/sections/useKnowledgeWorkbenchEditorActions.ts`，将 editor rail 内的 dirty-guard / section-switch / sql-rule action lane 组合从 `useKnowledgeWorkbenchEditors.tsx` 继续下沉到独立 hook；`useKnowledgeWorkbenchEditors.tsx` 已继续从约 207 行收口到约 171 行
- 已继续新增 `src/features/knowledgePage/sections/knowledgeWorkbenchEditorActionsHelpers.ts` 与 `knowledgeWorkbenchEditorActionsHelpers.test.ts`，将 `useKnowledgeWorkbenchEditorActions.ts` 中长内联 props 类型、section-change guard/sql/rule lane input 映射、save-shortcut 输入与返回面组装继续下沉到纯 helper；`useKnowledgeWorkbenchEditorActions.ts` 已继续从约 139 行收口到约 79 行，并通过 knowledge 页 + sql/rule lane + helper 级回归锁定行为
- 已继续把上述 editor-actions helper 再按 `types / lane-input / result` 三层拆开：新增 `knowledgeWorkbenchEditorActionsTypes.ts`（约 81 行）、`buildKnowledgeWorkbenchEditorActionLaneInputs.ts`（约 109 行）、`buildKnowledgeWorkbenchEditorActionsResult.ts`（约 21 行），原 `knowledgeWorkbenchEditorActionsHelpers.ts` 继续收口成约 15 行 barrel，仅保留统一出口；继续通过 helper + knowledge 页回归锁定行为
- 已继续移除仅做 barrel re-export 的 `src/features/knowledgePage/sections/knowledgeWorkbenchEditorActionsHelpers.ts`，并让 `useKnowledgeWorkbenchEditorActions.ts` / `knowledgeWorkbenchEditorActionsHelpers.test.ts` 直接依赖 lane-input/result/types 三条真实文件，进一步降低 editor-actions 的中转层
- 已继续新增 `src/features/knowledgePage/sections/useKnowledgeWorkbenchContextAssetState.ts`、`knowledgeWorkbenchContextAssetUtils.ts` 与 `knowledgeWorkbenchContextAssetUtils.test.ts`，将 draft state 内的 context-asset 解析、无效选中清理与 selector options 组装从 `useKnowledgeWorkbenchDraftState.ts` 继续下沉到独立 hook + 纯 helper；`useKnowledgeWorkbenchDraftState.ts` 已继续从约 190 行收口到约 175 行
- 已继续新增 `src/features/knowledgePage/sections/useKnowledgeWorkbenchDraftDerivedState.ts`，将 draft state 内的 filtered list / dirty-flag memo 组合从 `useKnowledgeWorkbenchDraftState.ts` 继续下沉到独立 hook；`useKnowledgeWorkbenchDraftState.ts` 已继续从约 175 行收口到约 139 行
- 已继续新增 `src/features/knowledgePage/sections/useKnowledgeWorkbenchDraftBaselineState.ts` 与 `useKnowledgeWorkbenchDraftBaselineState.test.tsx`，将 draft state 内的 baseline read/sync 编排从 `useKnowledgeWorkbenchDraftState.ts` 继续下沉到独立 hook，并补齐 hook 级回归；`useKnowledgeWorkbenchDraftState.ts` 已继续从约 139 行收口到约 102 行
- 已继续新增 `src/features/knowledgePage/sections/useKnowledgeWorkbenchDraftUiState.ts` 与 `useKnowledgeWorkbenchDraftUiState.test.tsx`，将 SQL/规则列表筛选、scope/mode 与 drawer open 这些本地 UI state 从 `useKnowledgeWorkbenchDraftState.ts` 继续下沉到独立 hook；`useKnowledgeWorkbenchDraftState.ts` 当前约 108 行，职责收口为 baseline/context/derived 三段组合 wiring
- 已继续新增 `src/features/knowledgePage/sections/useKnowledgeWorkbenchDraftWatchValues.ts` 与 `useKnowledgeWorkbenchDraftWatchValues.test.tsx`，将 rule/sql form 的 `Form.useWatch` 读取从 `useKnowledgeWorkbenchDraftState.ts` 继续下沉到独立 hook；`useKnowledgeWorkbenchDraftState.ts` 当前约 113 行，虽然体量基本持平，但已进一步收口为 ui-state/watch-values/baseline/context/derived 五段组合 wiring，并复用知识库页回归测试确认调用契约未变
- 已继续新增 `src/features/knowledgePage/sections/knowledgeWorkbenchEditorsHelpers.ts` 与 `knowledgeWorkbenchEditorsHelpers.test.ts`，将 `useKnowledgeWorkbenchEditors.tsx` 中大段 editor-actions 输入映射与 hook result 组装下沉到纯 helper；随后继续按 `types / input / result` 三层拆出 `knowledgeWorkbenchEditorsTypes.ts`、`buildKnowledgeWorkbenchEditorActionsInput.ts`、`buildKnowledgeWorkbenchEditorsResult.ts`，并再补 `buildKnowledgeWorkbenchDraftStateInput.ts` 让 hook 改为 `args -> draftState -> editorActions -> result` 的极薄组合层；当前 barrel 已收口到约 7 行，`useKnowledgeWorkbenchEditors.tsx` 已继续从约 124 行收口到约 28 行，并通过知识库页 + helper 级回归锁定行为
- 已继续移除仅做 barrel re-export 的 `src/features/knowledgePage/sections/knowledgeWorkbenchEditorsHelpers.ts`，并让 `useKnowledgeWorkbenchEditors.tsx` / `buildKnowledgeWorkbenchDraftStateInput.ts` / `knowledgeWorkbenchEditorsHelpers.test.ts` 直接依赖 input/result/types 三条真实文件，进一步降低 editors 组合层的中转
- 已继续新增 `src/features/knowledgePage/sections/knowledgeWorkbenchAssetEditorActionConfigs.ts` 与 `knowledgeWorkbenchAssetEditorActionConfigs.test.ts`，将 SQL 模板 / 分析规则 action hooks 中大段 asset-editor config 与 open-editor 参数映射下沉到纯 helper；随后继续按 lane 拆出 `knowledgeWorkbenchSqlAssetEditorActionConfigs.ts` / `knowledgeWorkbenchRuleAssetEditorActionConfigs.ts`，并在 lane file 中补上 actions args/result builder，使 `useKnowledgeWorkbenchSqlActions.ts` / `useKnowledgeWorkbenchRuleActions.ts` 进一步收口到约 48 / 48 行；当前公共 barrel 约 16 行，SQL / Rule lane barrel 已进一步收口到约 11 / 11 行，并继续拆出 `knowledgeWorkbenchSqlAssetEditorActionTypes.ts` / `knowledgeWorkbenchRuleAssetEditorActionTypes.ts`（约 51 / 52 行）、`buildKnowledgeWorkbenchSqlAssetEditorActionsInput.ts` / `buildKnowledgeWorkbenchRuleAssetEditorActionsInput.ts`（约 93 / 98 行）、`buildKnowledgeWorkbenchSqlActionsResult.ts` / `buildKnowledgeWorkbenchRuleActionsResult.ts`（约 30 / 30 行），将 lane 内的类型、input mapper 与 result mapper 彻底拆开；继续通过 knowledge 页 + action/helper 级回归锁定行为
- 已继续新增 `src/features/knowledgePage/sections/knowledgeWorkbenchAssetEditorActionsTypes.ts` 与 `buildKnowledgeWorkbenchAssetEditorActionsResult.ts`，将 `useKnowledgeWorkbenchAssetEditorActions.ts` 中长内联泛型 props 定义与返回面组装继续下沉到 `types / result` 两层；`useKnowledgeWorkbenchAssetEditorActions.ts` 已继续从约 156 行收口到约 109 行，并复用 SQL / Rule action hooks + knowledge 页回归确认行为未变
- 已继续新增 `src/features/knowledgePage/sections/buildKnowledgeWorkbenchAssetEditorActionsInputs.ts` 与 `buildKnowledgeWorkbenchAssetEditorActionsInputs.test.ts`，将 `useKnowledgeWorkbenchAssetEditorActions.ts` 中 lifecycle/open-entry 三段子 hook 的长 input 映射继续下沉到纯 builder；当前 `useKnowledgeWorkbenchAssetEditorActions.ts` 约 118 行，体量较上一轮略回升，但主体已收口为 “子 hook 调用 + result 组装” 的薄编排层，并通过 helper + knowledge 页回归锁定行为
- 已继续把上述 asset-editor input builder 再按 `lifecycle / open / entry` 三层拆开：新增 `buildKnowledgeWorkbenchAssetEditorLifecycleInput.ts`（约 48 行）、`buildKnowledgeWorkbenchAssetEditorOpenInput.ts`（约 55 行）、`buildKnowledgeWorkbenchEditorEntryActionsInput.ts`（约 54 行），原 `buildKnowledgeWorkbenchAssetEditorActionsInputs.ts` 继续收口成约 3 行 barrel；继续通过 helper + knowledge 页回归锁定行为
- 已继续移除仅做 barrel re-export 的 `src/features/knowledgePage/sections/buildKnowledgeWorkbenchAssetEditorActionsInputs.ts`，并让 `useKnowledgeWorkbenchAssetEditorActions.ts` / `buildKnowledgeWorkbenchAssetEditorActionsInputs.test.ts` 直接依赖 lifecycle/open/entry 三条真实 builder lane，进一步降低 asset-editor actions 的中转层
- 已继续新增 `src/features/knowledgePage/sections/useKnowledgeWorkbenchAssetEditorActions.test.tsx`，并将 `useKnowledgeWorkbenchAssetEditorActions.ts` 的 orchestration 输入进一步收口为单一 `args` 对象；当前 hook 已继续从约 118 行收口到约 50 行，仅保留 lifecycle/open/entry 三段子 hook 的轻量组合与返回面装配，并通过 `eslint` + `jest`（7 suites / 27 tests）锁定行为
- 已继续新增 `src/features/knowledgePage/sections/knowledgeWorkbenchDraftStateHelpers.ts` 与 `knowledgeWorkbenchDraftStateHelpers.test.ts`，将 `useKnowledgeWorkbenchDraftState.ts` 中 derived-state 输入映射与返回面组装下沉到纯 helper；`useKnowledgeWorkbenchDraftState.ts` 已继续从约 113 行收口到约 55 行，并通过 knowledge 页 + helper 级回归锁定行为
- 已新增 `src/features/knowledgePage/useKnowledgeWorkbenchSectionRouting.ts`，将 section query 解析、modeling deep-link 覆盖、workbench section 路由切换与知识库切换 URL 构建从 `pages/knowledge/index.tsx` 下沉
- 已把知识库 runtime selector / workbench URL 构建收敛到 `src/utils/knowledgeWorkbench.ts`，并由 `useKnowledgePageActions`、`useKnowledgeWorkbenchSectionRouting`、`useKnowledgeBaseLifecycle` 复用
- 已新增 `src/features/knowledgePage/useKnowledgePageLocalState.tsx`，将知识库页本地 UI state / form / detail-filter wiring 从 route entry 下沉到 feature hook
- 已新增 `src/features/knowledgePage/useKnowledgeModelingWorkspaceKey.ts` 与 `useKnowledgeModelingWorkspaceKey.test.ts`，将 modeling workspace key 的构造与 runtime-sync 期间的 commit 语义从 route entry 下沉并补齐纯 helper 回归
- 已新增 `src/features/knowledgePage/sections/KnowledgeWorkbenchStage.tsx`，将 knowledge route entry 底部的 loading/page stage/overlay 组装从 route entry 下沉到独立 feature 组件
- 已新增 `src/features/knowledgePage/useKnowledgeWorkbenchBootstrap.ts` 与 `useKnowledgeWorkbenchBootstrap.test.ts`，将 SQL 模板 / 分析规则首屏 bootstrap effect 与其 gating 规则从 route entry 下沉到独立 hook + 纯 helper 回归
- 已新增 `src/features/knowledgePage/useKnowledgeRuntimeBindings.ts` 与 `useKnowledgeRuntimeBindings.test.ts`，将 current workspace / source options / active snapshot id / runtime selector / rule-sql cache key 这些 runtime-derived 绑定从 route entry 下沉到独立 hook + helper 回归
- 已新增 `src/features/knowledgePage/buildKnowledgeWorkbenchStageProps.ts`，将 knowledge workbench stage 相关的共享 props 类型从 route entry 侧收拢到 feature helper
- 已继续移除 `buildKnowledgeWorkbenchStageProps.ts` 中仅做 identity passthrough 的 `buildKnowledgeMainStageProps`、`buildKnowledgeSidebarProps` 与 `buildKnowledgeWorkbenchOverlaysProps`，并把 `historicalSnapshotReadonlyHint` 的注入以及 sidebar/overlay 直传直接收口到 `buildKnowledgeWorkbenchPageStage.ts`；对应 `buildKnowledgeWorkbenchStageProps.test.ts` 已删除，由 `buildKnowledgeWorkbenchPageStage.test.ts` 继续覆盖实际行为，减少无意义的中转 helper / 测试层
- 已新增 `src/features/knowledgePage/useKnowledgeWorkbenchKnowledgeState.ts`（约 127 行）与 `useKnowledgeWorkbenchKnowledgeState.test.tsx`，并继续拆出 `knowledgeWorkbenchKnowledgeStateTypes.ts`（约 41 行）/ `buildKnowledgeWorkbenchBaseSelectionInputs.ts`（约 54 行）/ `buildKnowledgeWorkbenchBaseMetaInputs.ts`（约 64 行）/ `buildKnowledgeWorkbenchRuntimeBindingsInputs.ts`（约 38 行）/ `buildKnowledgeWorkbenchRuntimeContextInputs.ts`（约 25 行）/ `buildKnowledgeWorkbenchListCacheInputs.ts`（约 28 行）/ `buildKnowledgeWorkbenchSelectorFallbackInputs.ts`（约 36 行）/ `buildKnowledgeWorkbenchDataLoadersInputs.ts`（约 19 行），将 selection/meta/runtime bindings/runtime-context/list-cache/selector-fallback/data-loader dataflow 从 route entry 下沉并继续分层到独立 hook + pure builders
- 已新增 `src/features/knowledgePage/useKnowledgeWorkbenchContentData.ts` 与 `useKnowledgeWorkbenchContentData.test.tsx`，将 connectors / diagram / runtime-sync / assets dataflow 从 route entry 下沉到独立 hook
- 已新增 `src/features/knowledgePage/knowledgeWorkbenchContentDataTypes.ts`（约 43 行）/ `buildKnowledgeWorkbenchConnectorsInputs.ts`（约 34 行）/ `buildKnowledgeWorkbenchDiagramInputs.ts`（约 24 行）/ `buildKnowledgeWorkbenchRuntimeDataSyncInputs.ts`（约 27 行）/ `buildKnowledgeWorkbenchAssetsInputs.ts`（约 32 行）/ `buildKnowledgeWorkbenchContentDataHookInputs.test.ts`，并将 `useKnowledgeWorkbenchContentData.ts` 继续收口到约 74 行；content-data hook 当前主要保留 connectors / diagram / runtime-sync / assets 的轻量组合 wiring
- 已新增 `src/features/knowledgePage/useKnowledgeWorkbenchRuleSql.ts` 与 `useKnowledgeWorkbenchRuleSql.test.tsx`，将 rule/sql manager + actions 的编排从 route entry 下沉到独立 hook
- 已继续把 `src/hooks/useKnowledgeRuleSqlManager.ts` 从约 560 行收口到约 423 行，并拆出 `src/hooks/knowledgeRuleSqlManagerUtils.ts` 承接规则/SQL 模板表单值、payload builder、缓存判定与匹配 helper；主 hook 当前聚焦 form + 列表状态与 CRUD orchestration，同时继续 re-export `parseInstructionDraft` / `shouldUseRuleSqlListCache` / 表单类型以保持知识库工作台既有调用契约
- 已新增 `src/features/knowledgePage/useKnowledgeWorkbenchNavigationState.ts` 与 `useKnowledgeWorkbenchNavigationState.test.tsx`，将 sidebar data / section routing / asset-detail callback 组合从 route entry 下沉到独立 hook
- 已新增 `src/features/knowledgePage/useKnowledgeWorkbenchPresentationState.ts`、`knowledgeWorkbenchPresentationStateTypes.ts` 与 `useKnowledgeWorkbenchPresentationState.test.tsx`，将 asset workbench + navigation 这一组纯展示态与共享参数类型从 `useKnowledgeWorkbenchViewState.ts` 继续拆出
- 已新增 `src/features/knowledgePage/buildKnowledgeWorkbenchPageStage.ts` 与 `buildKnowledgeWorkbenchPageStage.test.ts`，将 sidebar/main-stage/overlay 三组 props 组装从 route entry 下沉到独立 builder
- 已新增 `src/features/knowledgePage/KnowledgeWorkbenchPageFrame.tsx` 与 `KnowledgeWorkbenchPageFrame.test.tsx`，将 knowledge 壳层 + workbench stage 组合从 route entry 下沉到独立页面壳组件
- 已新增 `src/features/knowledgePage/useKnowledgeWorkbenchPageController.ts`，将 knowledge route entry 的剩余 hook 组合与 page-level assembly 下沉到独立 controller hook
- 已新增 `src/features/knowledgePage/useKnowledgeWorkbenchPageInteractionState.ts` 与 `useKnowledgeWorkbenchPageInteractionState.test.tsx`，将 page-level local/runtime/controller-data wiring 从 `useKnowledgeWorkbenchPageController.ts` 继续拆出
- 已新增 `src/features/knowledgePage/buildKnowledgeWorkbenchPageInteractionInputs.ts` 与 `buildKnowledgeWorkbenchPageInteractionInputs.test.ts`，将 page-interaction hook 内的大段 input mapping 收敛为纯 builder
- 已新增 `src/features/knowledgePage/knowledgeWorkbenchPageInteractionInputTypes.ts`、`buildKnowledgeWorkbenchPageInteractionLocalInputs.ts`、`buildKnowledgeWorkbenchPageInteractionKnowledgeInputs.ts`、`buildKnowledgeWorkbenchPageInteractionContentInputs.ts` 与 `buildKnowledgeWorkbenchPageInteractionInputLanes.test.ts`，并将 page-interaction 入口共享参数类型一并收口到 types 文件，整体按 types/local/knowledge/content 四条 lane 继续拆细
- 已新增 `src/features/knowledgePage/useKnowledgeWorkbenchViewState.ts`、`knowledgeWorkbenchViewStateTypes.ts` 与 `useKnowledgeWorkbenchViewState.test.tsx`，将 sync effects 与页面视图态组合继续下沉；其中纯展示态与共享参数类型已进一步拆到 `useKnowledgeWorkbenchPresentationState.ts` / types 文件
- 已新增 `src/features/knowledgePage/useKnowledgeWorkbenchModelingState.ts` 与 `useKnowledgeWorkbenchModelingState.test.tsx`，将 modeling summary + committed workspace key 这一组 controller 派生状态继续下沉
- 已新增 `src/features/knowledgePage/useKnowledgeWorkbenchControllerInteractionState.ts` 与 `useKnowledgeWorkbenchControllerInteractionState.test.tsx`，将 actions + rule/sql manager + view-state 这一组 action/form wiring 从 controller hook 继续下沉
- 已新增 `knowledgeWorkbenchControllerInteractionTypes.ts`、`buildKnowledgeWorkbenchControllerInteractionOperationInputs.ts`、`buildKnowledgeWorkbenchControllerInteractionViewInputs.ts` 与 `buildKnowledgeWorkbenchControllerInteractionInputs.test.ts`，将 controller-interaction hook 内的 operations/view 输入映射继续拆为 types + 两条 builder lane
- 已继续移除仅做 barrel re-export 的 `buildKnowledgeWorkbenchControllerInteractionInputs.ts`，并让 `useKnowledgeWorkbenchControllerInteractionState.ts` / 对应测试直接依赖 operations/view 两条真实 builder lane，进一步降低 controller-interaction 的中转层
- 已继续移除仅做 barrel re-export 的 `buildKnowledgeWorkbenchPageInteractionInputLanes.ts`，并让 `buildKnowledgeWorkbenchPageInteractionInputs.ts` / `buildKnowledgeWorkbenchPageInteractionInputLanes.test.ts` 直接依赖 local/knowledge/content 三条真实 builder lane，进一步降低 page-interaction 的中转层
- 已新增 `src/features/knowledgePage/useKnowledgeWorkbenchControllerOperations.ts` 与 `useKnowledgeWorkbenchControllerOperations.test.tsx`，将 controller-interaction 内的 actions + rule/sql manager 组合 wiring 继续下沉
- 已新增 `knowledgeWorkbenchControllerOperationsTypes.ts`、`buildKnowledgeWorkbenchControllerActionsInputs.ts`、`buildKnowledgeWorkbenchControllerRuleSqlInputs.ts` 与 `buildKnowledgeWorkbenchControllerOperationsInputs.test.ts`，将 controller-operations hook 内的 actions/ruleSql 输入映射继续拆为 types + 两条 builder lane
- 已继续移除仅做 barrel re-export 的 `buildKnowledgeWorkbenchControllerOperationsInputs.ts`，并让 `useKnowledgeWorkbenchControllerOperations.ts` / 对应测试直接依赖 actions/ruleSql 两条真实 builder lane，进一步降低 controller-operations 的中转层
- 已新增 `src/features/knowledgePage/useKnowledgeWorkbenchControllerViewState.ts` 与 `useKnowledgeWorkbenchControllerViewState.test.tsx`，将 controller-interaction 内的 view-state wiring 继续下沉
- 已新增 `src/features/knowledgePage/buildKnowledgeWorkbenchControllerViewInputs.ts`、`knowledgeWorkbenchControllerViewTypes.ts` 与 `buildKnowledgeWorkbenchControllerViewInputs.test.ts`，将 controller-view-state hook 内的大段 input mapping 与共享参数类型继续分层
- 已新增 `src/features/knowledgePage/useKnowledgeWorkbenchControllerDataState.ts` 与 `useKnowledgeWorkbenchControllerDataState.test.tsx`，将 page controller 内的 knowledge/content/modeling data-state wiring 继续下沉
- 已新增 `src/features/knowledgePage/buildKnowledgeWorkbenchControllerStage.ts` 与 `buildKnowledgeWorkbenchControllerStage.test.ts`，将 controller 末尾的 stage input assembly（sidebar/main-stage/overlay 三段 props wiring）继续下沉到独立 builder
- 已新增 `src/features/knowledgePage/buildKnowledgeWorkbenchControllerStageInputs.test.ts`，为 controller-stage builder 内的 sidebar/main-stage/overlay 三个映射 lane 补齐 lane 回归
- 已新增 `src/features/knowledgePage/buildKnowledgeWorkbenchControllerSidebarInput.ts`、`buildKnowledgeWorkbenchControllerMainStageInput.ts`、`buildKnowledgeWorkbenchControllerOverlaysInput.ts`，将 controller-stage 的三条映射 lane 继续拆成独立纯函数
- 已新增 `src/features/knowledgePage/knowledgeWorkbenchControllerStageTypes.ts`，将 controller-stage builder 共享输入类型继续抽离，降低 builder/inputs 间的内联类型噪音
- `pages/knowledge/index.tsx` 当前维持在 ~37 行，route entry 已基本收口；后续热点已转移到 controller hook 本身，下一步应继续拆 controller 内剩余 composition 层
- `useKnowledgeWorkbenchPageController.ts` 当前约 115 行；controller 已把 page-level local/runtime/controller-data wiring 继续下沉到 `useKnowledgeWorkbenchPageInteractionState.ts`，当前主要保留 local state、controller-data、page-interaction 与最终 stage builder 的轻量组合
- 已继续新增 `src/features/knowledgePage/useKnowledgeWorkbenchPageControllerData.ts` / `useKnowledgeWorkbenchPageControllerInteraction.ts`，将 page controller 内剩余的 controller-data builder 调用与 page-interaction builder 调用继续下沉到独立组合 hook；`useKnowledgeWorkbenchPageController.ts` 已继续从约 91 行收口到约 65 行
- `useKnowledgeWorkbenchPageInteractionState.ts` 当前约 17 行；当前只负责委派给 controller-interaction hook，不再承担大段映射逻辑
- `buildKnowledgeWorkbenchPageInteractionInputs.ts` 当前约 63 行；当前只负责 page-interaction input builder 的轻量组合
- `knowledgeWorkbenchPageInteractionInputTypes.ts` 当前约 92 行，`buildKnowledgeWorkbenchPageInteractionLocalInputs.ts` / `buildKnowledgeWorkbenchPageInteractionKnowledgeInputs.ts` / `buildKnowledgeWorkbenchPageInteractionContentInputs.ts` 当前约 67 / 79 / 64 行；page-level local/runtime/controller-data → controller-interaction 的映射与入口共享参数类型已继续拆成 types + 三条 lane
- `useKnowledgeWorkbenchControllerInteractionState.ts` 当前约 38 行，`knowledgeWorkbenchControllerInteractionTypes.ts` / `buildKnowledgeWorkbenchControllerInteractionOperationInputs.ts` / `buildKnowledgeWorkbenchControllerInteractionViewInputs.ts` 当前约 16 / 69 / 27 行，`useKnowledgeWorkbenchControllerOperations.ts` 当前约 27 行，`knowledgeWorkbenchControllerOperationsTypes.ts` / `buildKnowledgeWorkbenchControllerActionsInputs.ts` / `buildKnowledgeWorkbenchControllerRuleSqlInputs.ts` 当前约 61 / 61 / 23 行，`useKnowledgeWorkbenchControllerViewState.ts` 当前约 16 行，`buildKnowledgeWorkbenchControllerViewInputs.ts` / `knowledgeWorkbenchControllerViewTypes.ts` 当前约 36 / 91 行；controller-interaction / controller-operations / controller-view-state 已继续拆成 builder + types + lanes 分层，其中 controller-operations / controller-interaction 的纯 barrel 已删除
- `buildKnowledgeWorkbenchControllerStage.ts` 当前约 19 行，`buildKnowledgeWorkbenchControllerSidebarInput.ts` / `buildKnowledgeWorkbenchControllerMainStageInput.ts` / `buildKnowledgeWorkbenchControllerOverlaysInput.ts` 当前约 29 / 29 / 57 行；controller-stage 的三条映射 lane 已继续拆成独立纯函数，原本仅做 barrel re-export 的 `buildKnowledgeWorkbenchControllerStageInputs.ts` 已删除
- 已继续新增 `buildKnowledgeWorkbenchMainStageOverviewInput.ts` / `buildKnowledgeWorkbenchMainStageEditorInput.ts`（约 77 / 63 行），将 main-stage lane 内的 overview/detail props 与 rule-sql/modeling props 继续拆成两条纯 builder lane；`buildKnowledgeWorkbenchControllerMainStageInput.ts` 已继续从约 72 行收口到约 29 行

### W3-4. 拆 `src/features/knowledgePage/index.styles.ts`

建议拆为：

- shared tokens / primitives
- overview styles
- assets styles
- editor styles
- modal / drawer styles

当前进展（2026-04-18）：

- `src/features/knowledgePage/index.styles.ts` 当前已直接 re-export 到 leaf style files，不再经过 workbench shell/summary/editor 多层 barrel
- 已拆出：
  - `src/features/knowledgePage/styles/knowledgePageBaseStyles.ts`
  - `src/features/knowledgePage/styles/knowledgePageModalStyles.ts`
  - `src/features/knowledgePage/styles/knowledgePageOverviewStyles.ts`
  - `src/features/knowledgePage/styles/knowledgePageWorkbenchLayoutStyles.ts`
  - `src/features/knowledgePage/styles/knowledgePageWorkbenchSummaryCardChromeStyles.ts`
  - `src/features/knowledgePage/styles/knowledgePageWorkbenchSummaryActionStyles.ts`
  - `src/features/knowledgePage/styles/knowledgePageWorkbenchSectionTabStyles.ts`
  - `src/features/knowledgePage/styles/knowledgePageWorkbenchSectionStyles.ts`
  - `src/features/knowledgePage/styles/knowledgePageWorkbenchCompactStyles.ts`
  - `src/features/knowledgePage/styles/knowledgePageWorkbenchEditorLayoutStyles.ts`
  - `src/features/knowledgePage/styles/knowledgePageWorkbenchCreateCardStyles.ts`
  - `src/features/knowledgePage/styles/knowledgePageWorkbenchEditorCardChromeStyles.ts`
  - `src/features/knowledgePage/styles/knowledgePageWorkbenchEditorItemMetaStyles.ts`
  - `src/features/knowledgePage/styles/knowledgePageWorkbenchEditorFormStyles.ts`
  - `src/features/knowledgePage/styles/knowledgePageWorkbenchEditorHelperStyles.ts`
  - `src/features/knowledgePage/styles/knowledgePageWizardStyles.ts`
  - `src/features/knowledgePage/styles/knowledgePageDetailStyles.ts`
- 已继续移除仅做 barrel re-export 的 `knowledgePageWorkbenchStyles.ts` / `knowledgePageWorkbenchShellStyles.ts` / `knowledgePageWorkbenchSummaryStyles.ts` / `knowledgePageWorkbenchSummaryCardStyles.ts` / `knowledgePageWorkbenchEditorStyles.ts` / `knowledgePageWorkbenchEditorCardStyles.ts` / `knowledgePageWorkbenchEditorItemStyles.ts`，并让 `index.styles.ts` 直接依赖 leaf style files，进一步降低 knowledgePage styles 的中转层
- 当前主样式热点已转移到 feature 级别布局一致性，而不是单一 giant stylesheet

### W3-5. 拆 `src/pages/home/[id].tsx`

建议先按风险最低的层次切：

- thread state / recovery helper
- thread page styles
- reference preview component

当前进展（2026-04-18）：

- 已拆出 `src/features/home/thread/threadPageState.ts`
- 已拆出 `src/features/home/thread/threadPageStyles.tsx`
- 已拆出 `src/features/home/thread/components/ReferenceConversationPreview.tsx`
- 已新增 `src/features/home/thread/components/ThreadConversationStage.tsx`，将 thread 页的 conversation shell / composer dock / knowledge chips / readonly hint 分支从 route entry 下沉到 thread feature 组件
- 已新增 `src/features/home/thread/components/ThreadPageOverlays.tsx`，将 save-as-view / sql-pair / reasoning / sql adjust 四个 modal overlays 的组装从 route entry 下沉到 thread feature 组件
- 已新增 `src/features/home/thread/components/ThreadPageShell.tsx`，将 thread 页 loading shell / navItems / activeHistory wiring 从 route entry 下沉到 thread feature 组件
- 已新增 `src/features/home/thread/useThreadRecoveryOrchestration.ts`，将未完成 asking/response 恢复、response/recommend 轮询超时、线程切换清理与 thread question 存储从 route entry 下沉到独立 hook
- 已继续拆出 `src/features/home/thread/threadRecoveryOrchestrationTypes.ts` 与 recovery helper lanes（`threadRecoveryPlanHelpers.ts` / `threadRecoveryCleanupHelpers.ts` / `threadRecoveryQuestionStoreHelpers.ts` / `threadRecoveryPollingHelpers.ts`），将 recovery hook 的共享类型与 cleanup / recovery-plan / question-store / polling 逻辑继续按 types/helpers 分层
- 已新增 `src/features/home/thread/useThreadPollingTimeouts.ts`，将 thread response/recommend 两类 timeout controller 与 stop/schedule 逻辑从 recovery hook 再次下沉
- `threadPageState.ts` 已补充 `resolveThreadRecoveryPlan`，把“继续 prompt 流 / 恢复 asking task / 恢复 response 轮询 / 清空恢复态”的判定收敛到纯 helper，并由 `thread.test.tsx` 补齐回归
- `home/[id].tsx` 已从 ~1405 行降到 route-entry re-export；实际 thread 页组合已下沉到
  `src/features/home/thread/routes/HomeThreadPage.tsx`
- `useThreadRecoveryOrchestration.ts` 已继续收口到 ~195 行，并新增 `threadRecoveryOrchestrationTypes.ts` 与 recovery helper lanes 承接共享类型与 cleanup / recovery-plan / question-store helper
- 已补 `src/features/home/thread/threadRecoveryOrchestrationHelpers.test.ts`，为 recovery cleanup / recovery-plan / question-store / polling helper 补齐纯函数回归覆盖
- 已继续把 response/recommend 轮询的 dedupe / settle 逻辑下沉到 `threadRecoveryPollingHelpers.ts`（`startThreadResponsePollingIfNeeded` / `settleFinishedThreadResponsePolling` / `syncThreadRecommendationPollingState`），并补齐对应 helper 回归测试
- 已一度拆出 `src/features/home/thread/buildThreadRecoveryOrchestrationResult.ts` 并将 recovery hook 内的 polling/recovery/cleanup/result 输入组装继续下沉到 pure builders；随后继续删除仅做 identity passthrough 的 `buildThreadRecoveryOrchestrationResult.ts`、`buildThreadResponsePollingStartInputs.ts` / `buildThreadRecoveryPlanRunnerInputs.ts` / `buildThreadRecoveryCleanupInputs.ts` / `buildThreadResponsePollingSettleInputs.ts` / `buildThreadRecommendationPollingStateInputs.ts`，让 orchestration hook、effects 与 callbacks 直接调用真实 lane helper，删除无意义的 `buildThreadRecoveryOrchestrationInputs.test.ts`
- `useThreadRecoveryOrchestration.ts` 已继续从 ~189 行收口到 ~175 行；当前主要保留 timeout + effect orchestration wiring
- 已新增 `src/features/home/thread/useThreadRecoveryCleanupEffect.ts` / `useThreadRecoverySyncEffects.ts`，将 thread recovery hook 内的 cleanup lifecycle 与 response/recommend/question-store sync effects 继续下沉；`useThreadRecoveryOrchestration.ts` 已继续从约 175 行收口到约 133 行
- 已继续新增 `src/features/home/thread/threadRecoveryPlanHelpers.ts` / `threadRecoveryCleanupHelpers.ts` / `threadRecoveryQuestionStoreHelpers.ts` / `threadRecoveryPollingHelpers.ts`，将 recovery helper 再按 plan / cleanup / question-store / polling 四条 lane 分层
- 已继续移除仅做 barrel re-export 的 `src/features/home/thread/threadRecoveryOrchestrationHelpers.ts`，并让 polling / cleanup / plan / question-store 的 builders、effects、tests 直接依赖各自 lane helper，进一步降低 thread recovery 的中转层
- 已继续新增 `src/features/home/thread/useThreadResponsePollingStarter.ts` / `useThreadRecoveryPlanHandler.ts`，将 recovery orchestration entry hook 内剩余的 polling-start 与 recovery-plan callback 再下沉到独立 hook；`useThreadRecoveryOrchestration.ts` 已继续从约 133 行收口到约 97 行
- 已一度新增 `src/features/home/thread/useThreadRecoveryRefs.ts` / `useThreadRecoveryEffects.ts` / `useThreadRecoveryExecutionControls.ts`，将 refs 初始化、cleanup+sync effects 调度，以及 polling-controls + recovery-plan-handler 组合拆成独立 hook lane；随后继续删除这三层仅做薄组合的 hook，让 `useThreadRecoveryOrchestration.ts` 直接使用 `useRef`、`useThreadRecoveryPollingControls.ts`、`useThreadRecoveryPlanHandler.ts`、`useThreadRecoveryCleanupEffect.ts` 与 `useThreadRecoverySyncEffects.ts`
- 已继续新增 `src/features/home/thread/useThreadRecoveryResponseSyncEffect.ts` / `useThreadResponsePollingSettleEffect.ts` / `useThreadRecommendationPollingEffect.ts`，将 `useThreadRecoverySyncEffects.ts` 内的 response-sync、response-settle 与 recommendation-polling 三个 effect lane 继续拆到独立 hook；`useThreadRecoverySyncEffects.ts` 已继续从约 103 行收口到约 63 行
- 已继续新增 `src/features/home/thread/useThreadCreateResponseAction.ts` 与 `useThreadCreateResponseAction.test.tsx`，将 thread response actions 中的 create-response / polling-handoff / optimistic hydration 编排从 `useThreadResponseActions.ts` 继续下沉到独立 hook，并补齐 hook 级回归；`useThreadResponseActions.ts` 已继续从约 289 行收口到约 240 行
- 已继续新增 `src/features/home/thread/useThreadRecommendedQuestionsAction.ts` 与 `useThreadRecommendedQuestionsAction.test.tsx`，将 thread response actions 中的 recommendation-trigger / result-fetch / polling-stop 编排从 `useThreadResponseActions.ts` 继续下沉到独立 hook，并补齐 hook 级回归；`useThreadResponseActions.ts` 已继续从约 240 行收口到约 214 行
- 已继续新增 `src/features/home/thread/useThreadResponseArtifactActions.ts` 与 `useThreadResponseArtifactActions.test.tsx`，将 thread response actions 中的 view-create / sql-pair-create loading 与成功/失败反馈编排从 `useThreadResponseActions.ts` 继续下沉到独立 hook，并补齐 hook 级回归；`useThreadResponseActions.ts` 已继续从约 214 行收口到约 183 行
- 已继续新增 `src/features/home/thread/useThreadResponseMutationActions.ts` 与 `useThreadResponseMutationActions.test.tsx`，将 thread response actions 中的 answer/chart generation、chart adjust、SQL fix + regenerate 编排从 `useThreadResponseActions.ts` 继续下沉到独立 hook，并补齐 hook 级回归；`useThreadResponseActions.ts` 已继续从约 183 行收口到约 105 行
- 随后继续删除只剩 page-level hook composition 的 `src/features/home/thread/useThreadResponseActions.ts`，让 `src/pages/home/[id].tsx` 直接组合 `useThreadCreateResponseAction.ts` / `useThreadRecommendedQuestionsAction.ts` / `useThreadResponseArtifactActions.ts` / `useThreadResponseMutationActions.ts` 四条真实 lane；thread 页这一层又少掉一层无意义中转
- 已继续把 `src/components/pages/home/promptThread/ChartAnswer.tsx` 从 ~618 行收口到约 500 行，并拆出：
  - `src/components/pages/home/promptThread/chartAnswerUtils.ts`
  - `src/components/pages/home/promptThread/ChartAnswerPinModal.tsx`
  - `src/components/pages/home/promptThread/chartAnswerStyles.tsx`
  当前 ChartAnswer 已聚焦 preview 数据对齐、图表编辑态与 pin-to-dashboard 编排，同时继续通过 re-export `getIsChartFinished` 保持 thread state / 测试的既有契约
- 已继续把 `src/hooks/useAskPrompt.tsx` 从约 586 行收口到约 459 行，并拆出 `src/hooks/askPromptUtils.ts` 承接 ask prompt 的状态判定、推荐问题历史、线程缓存回写与 runtime selector 解析 helper；主 hook 当前聚焦轮询控制、提交/重试编排与流式任务接线，同时继续 re-export 现有 helper/type 以保持首页与线程页调用契约
- 已继续把 `src/utils/referenceDemoKnowledge.ts` 从约 567 行收口到约 165 行，并拆出 `src/utils/referenceDemoKnowledgeData.ts` / `src/utils/referenceDemoKnowledgeTypes.ts` 承接样例知识库元数据、资产别名与共享类型；主文件当前聚焦名称解析、展示文案与样例资产计数 helper，同时维持对既有常量与类型导出的兼容面
- 已继续把 `src/features/knowledgePage/lists.tsx` 从约 605 行收口到约 459 行，并拆出 `src/features/knowledgePage/virtualizedManageEntryList.tsx` 承接 SQL 模板 / 分析规则管理列表的虚拟滚动容器；主文件当前聚焦知识库侧栏项与 rule/sql card 渲染
- 当前已完成纯状态 / 恢复判定 helper、页面样式、reference preview、conversation shell、page shell、overlay 组装与 polling/recovery orchestration 迁移

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

- `useApiHistoryList`
- `useSkillsControlPlaneData`
- `useHomeSidebar` 的读取主链路（保留 warm-cache / intent 例外语义）
- `useKnowledge*` 中重复的 fetch 状态机
- `useAuthSession` 维持 shared session cache exception，并通过专门文档约束

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

当前进展（2026-04-19）：

- 已为 `useSkillsControlPlaneData` 提取 `buildSkillsControlPlaneRequestKey`，
  将 control-plane request key 收敛到纯 helper，并把依赖从 selector object
  缩到 canonical runtime scope fields
- 已为 `useApiHistoryList` 提取 `buildApiHistoryListRequestKey`，将请求 URL / key
  的生成继续收敛到纯 helper，并把依赖从 pagination/filter/selector object
  缩到实际字段，减少 object churn 触发的无谓重算
- 已为 `useSkillConnectors` 提取 `buildSkillConnectorsRequestKey`，将 skills
  连接器读取主链路的 request key 收敛到纯 helper，并补齐独立测试，和
  `useSkillsControlPlaneData` / `useSkillsPageData` 形成同一收口模式
- 已继续将 `buildSkillConnectorsUrl` / `buildSkillConnectorsRequestKey` 收口到
  `src/features/settings/skills/skillsPageUtils.ts`，让 skills connectors 的 URL
  与 request-key 生成复用同一纯 helper 模式，避免 hook 内继续混杂请求标识与
  URL 组装逻辑
- 已为 `usePermissionsRoleCatalog` 提取 request-key / URL / payload normalize
  helper，并补齐独立测试，让 permissions 域的角色目录读取也遵循同一纯 helper
  + 定向回归测试模式
- 已为 `useModelList` 提取 `buildModelListRequestKey`，并补齐 hook 级独立测试，
  让 modeling 域的模型列表读取也纳入同一 request-key/helper 收口模式
- 已为 `useDeployStatusRest` 提取 `buildDeployStatusRequestKey`，并补齐 hook 级
  回归测试，锁定 deploy-status 读取在 executable / non-executable scope 下的
  request-key 与 fallback 行为
- 已为 `useWorkspaceGovernanceOverview` 提取 request-key helper，并补齐 hook
  级测试；配合 users / audit / identity / automation 页面测试，锁定设置治理概览
  读取链路的 request-key 与错误上报行为
- 已为 `useCheckOnboarding` 与 `useRuntimeSelectorState` 提取 request-key helper，
  并补齐 helper 级回归测试，继续减少关键 runtime / onboarding 读取链路中
  内联 request-key 构造的散落
- 已为 `useHomeSidebar` 提取 threads request-key helper，并在现有 helper 测试
  中补齐覆盖；同时将 connectors 页列表读取的 request-key / payload normalize
  helper 下沉到 connectors utils，并通过页面测试 + `useManageConnectorsPage`
  hook 测试锁定语义
- 已继续新增 `src/hooks/homeSidebarHelpers.ts`，把 `useHomeSidebar` 内的 cache TTL、
  storage 读写、selector / URL / query gate helper 统一迁出；`useHomeSidebar.tsx`
  当前已收口到约 404 行，主 hook 仅保留 effect / request / mutation orchestration
- 已新增：
  - `src/hooks/useSkillsControlPlaneData.test.ts`
  - `src/hooks/useApiHistoryList.test.ts`（补 request-key case）
  继续为请求 key / URL 构造补充回归覆盖

## 验收标准

- 新增请求逻辑优先使用统一原语
- direct fetch hook 数量显著下降
- cache key / ttl 命名规则统一
- intentional exceptions 已有书面约束，不再隐式扩散

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

当前进展（2026-04-18）：

- 已新增 `src/features/settings/connectors/connectorsPageUtils.ts`
- `settings/connectors.tsx` 中的连接器类型、payload builder、secret re-encrypt helper、数据库 provider 表单映射已迁出 page entry
- 已新增：
  - `src/features/settings/connectors/ConnectorsCatalogSection.tsx`
  - `src/features/settings/connectors/ConnectorSecretRotationModal.tsx`
  - `src/features/settings/connectors/ConnectorEditorModal.tsx`
- `settings/connectors.tsx` 已从 ~1754 行降到 ~634 行
- 剩余 `settings/connectors.tsx` 以 route state / request orchestration 为主
- 已一度新增 `src/features/settings/connectors/useManageConnectorsPage.ts`，将连接器页的权限判定、请求编排与 modal orchestration 从 route entry 继续下沉
- 已继续拆出 `src/features/settings/connectors/useManageConnectorsRuntimeState.ts`、`buildManageConnectorsControlState.ts` 与 `buildConnectorManagementCapabilityInput.ts`，将工作区 selector / capability 推导 / modal disable 逻辑继续按 runtime/control/helper 分层
- `settings/connectors.tsx` 已进一步从 ~634 行降到 ~152 行，当前主要保留 shell 组装与 section/modal 组合
- 连接器列表读取主链路已接入 `useRestRequest`，不再保留页内 ad-hoc fetch 状态机
- 已继续拆出 `src/features/settings/connectors/connectorManagementCapabilities.ts`、`src/features/settings/connectors/useConnectorEditorFields.ts`、`src/features/settings/connectors/useConnectorEditorModalState.ts` 与 `src/features/settings/connectors/useConnectorSecretOperations.ts`，将权限推导、editor watcher/default、editor modal 编排与 secret-rotation modal 编排从 `useManageConnectorsPage.ts` 下沉
- 已新增 `src/features/settings/connectors/useConnectorMutationOperations.ts`，将连接器的 save/delete/test 编排从 `useManageConnectorsPage.ts` 下沉
- 已继续拆出 `src/features/settings/connectors/connectorMutationOperationTypes.ts`、`useConnectorSubmitOperation.ts` 与 `useConnectorDeleteOperation.ts`，将 save/delete orchestration 继续按 types/submit/delete 三层分 lane
- 已继续拆出 `src/features/settings/connectors/useConnectorTestingOperations.ts`，将 modal/saved-connector 的连接测试链路从 `useConnectorMutationOperations.ts` 下沉，并补齐 `useConnectorTestingOperations.test.tsx` / `useConnectorMutationOperations.test.tsx` 的回归覆盖
- 已新增 `src/features/settings/connectors/useConnectorCatalog.ts`，将连接器列表读取、request-key 绑定、payload normalize 与 secret count 推导从 `useManageConnectorsPage.ts` 下沉，并补齐 `useConnectorCatalog.test.tsx` / `useManageConnectorsPage.test.tsx` / `tests/pages/settings/connectors.test.tsx` 的回归覆盖
- `useManageConnectorsPage.ts` 已从 ~571 行进一步降到 ~145 行；runtime selector + capability 推导 + modal disable 逻辑已继续下沉到独立 helper/hook
- 已新增 `src/features/settings/connectors/useManageConnectorsEditorState.ts` 与 `useManageConnectorsEditorState.test.tsx`，将 editor form、connector field watchers 与 editor modal 编排从 `useManageConnectorsPage.ts` 进一步下沉
- `useManageConnectorsPage.ts` 已继续从 ~145 行收口到 ~136 行；当前更多聚焦 runtime state、catalog、secret ops 与 mutation orchestration 的组合
- 已一度拆出 `src/features/settings/connectors/buildManageConnectorsRuntimeStateInputs.ts` / `buildManageConnectorsEditorStateInputs.ts` / `buildManageConnectorsCatalogInputs.ts` / `buildManageConnectorsSecretOperationsInputs.ts` / `buildManageConnectorsMutationOperationsInputs.ts` / `buildManageConnectorsControlStateInputs.ts` / `buildManageConnectorsPageResult.ts`，将 `useManageConnectorsPage.ts` 内的 runtime/editor/catalog/secret/mutation/control/page-result 组装继续下沉到 pure builders；随后继续删除这批仅做 identity passthrough 的 builder 与 `buildManageConnectorsPageInputs.test.ts`，让 page hook / operations hook 直接调用真实 runtime/editor/catalog/secret/mutation/control lane
- `useManageConnectorsPage.ts` 已继续从 ~136 行收口到 ~67 行；当前主要保留 connectors page-level hook composition wiring
- 已一度新增 `src/features/settings/connectors/useManageConnectorsRuntimeContext.ts` 与 `useManageConnectorsPageOperations.ts`，将 runtime-context 与 catalog / secret / mutation / control 四条组合 lane 从 `useManageConnectorsPage.ts` 下沉；随后继续删除这两层仅做薄组合的 hook，让 `useManageConnectorsPage.ts` 直接调用 runtime/context 与真实 lane hooks，减少多余中转层
- 随后继续删除仅做 page-level 组合的
  `src/features/settings/connectors/useManageConnectorsPage.ts`，并新增
  `src/features/settings/connectors/ManageConnectorsPage.tsx` 承担真实页面组合；
  `settings/connectors.tsx` 当前已收口为 route-entry re-export，连接器页这一层又少掉一层无意义中转
- 已继续把 `src/features/settings/connectors/connectorsPageUtils.ts`
  从 ~628 行收口到 ~219 行，并新增
  `src/features/settings/connectors/connectorsPayloadUtils.ts`（~424 行）承接：
  - 数据库 connector config / secret builder
  - submit / test payload builder
  - secret re-encrypt payload builder
  - form value hydrate / JSON stringify helper
  当前 connectorsPageUtils 已聚焦 URL、常量、selector 与类型导出
- `useConnectorMutationOperations.ts` 已从 ~234 行进一步降到 ~58 行，并新增 `connectorMutationOperationTypes.ts` / `useConnectorSubmitOperation.ts` / `useConnectorDeleteOperation.ts`（约 18 / 95 / 47 行）；save/delete orchestration 已继续拆到独立 lane，连接测试链路仍由 `useConnectorTestingOperations.ts` 承接
- 已补 `src/features/settings/connectors/buildManageConnectorsControlState.test.ts`、`buildConnectorManagementCapabilityInput.test.ts`、`useConnectorSubmitOperation.test.tsx` 与 `useConnectorDeleteOperation.test.tsx`，为连接器页 control-state / capability-input / submit / delete lane 补齐回归覆盖
- 已新增 `src/features/settings/settingsPageCapabilities.ts`，将设置页与连接器页共享的
  platform-management 可见性判定从多页内联逻辑收敛到同一 helper
- 已新增 `src/features/settings/useWorkspaceGovernanceOverview.ts`，将
  `/api/v1/workspace/current` 的重复读取逻辑从多个治理页中收敛到共享 hook
  - `settings/users`
  - `settings/permissions`
  - `settings/audit`
  - `settings/identity`
  - `settings/automation`
- 已新增 `src/features/settings/settingsShell.ts`，将 settings 页重复的
  nav/back/layout shell props 收敛到共享 helper，避免每个页面重复拼装
- 已新增：
  - `src/features/settings/users/usersPageUtils.tsx`
  - `src/features/settings/users/UsersMembersSection.tsx`
  将 users 页的角色来源摘要 / source detail 渲染 / 成员列表 section
  从 route entry 下沉到 settings/users feature 目录
- 已继续把 `src/features/settings/users/UsersMembersSection.tsx` 从 ~602 行
  收口到 ~280 行，并拆出：
  - `UsersMembersToolbar.tsx`
  - `UsersMemberInviteModal.tsx`
  - `UsersMemberEditModal.tsx`
  - `UsersMemberRoleModal.tsx`
  - `usersMembersSectionTypes.ts`
  当前 users 成员管理主 section 已聚焦筛选、表格与 modal 编排
- 已新增 `src/features/settings/users/usersPageUtils.test.tsx`，为
  users feature 的角色来源 / 状态颜色 / source detail helper 补充回归测试
- `settings/users.tsx` 已从 ~497 行继续收口到 route-entry re-export；
  实际 shell 与成员管理页面组合当前已下沉到
  `src/features/settings/users/ManageUsersPage.tsx`
- `settings/audit.tsx`、`settings/diagnostics.tsx`、`settings/identity.tsx`、
  `settings/automation.tsx`、`settings/system-tasks.tsx`、`settings/platform.tsx`
  也已收口为 route-entry re-export；对应实现分别下沉到：
  - `src/features/settings/audit/ManageAuditPage.tsx`
  - `src/features/settings/diagnostics/ManageDiagnosticsPage.tsx`
  - `src/features/settings/identity/ManageIdentityPage.tsx`
  - `src/features/settings/automation/ManageAutomationPage.tsx`
  - `src/features/settings/systemTasks/ManageSystemTasksPage.tsx`
  - `src/features/settings/platform/ManagePlatformPage.tsx`
- 已继续把以下 settings giant page 收口到 500 行内，并拆出 summary / section leaf：
  - `src/features/settings/identity/ManageIdentityPage.tsx` → ~346 行
    - `IdentitySummarySection.tsx`
    - `IdentityProvidersSection.tsx`
    - `DirectoryGroupsSection.tsx`
  - `src/features/settings/automation/ManageAutomationPage.tsx` → ~316 行
    - `AutomationSummarySection.tsx`
    - `AutomationServiceAccountsSection.tsx`
    - `AutomationApiTokensSection.tsx`
  - `src/features/settings/systemTasks/ManageSystemTasksPage.tsx` → ~310 行
    - `SystemTasksSummarySection.tsx`
    - `SystemTasksJobsSection.tsx`
    - `SystemTasksRunsSection.tsx`
    - `systemTasksPageUtils.ts`
- 已新增 `src/features/settings/workspaceGovernanceSharedUi.tsx`，把 users / identity /
  automation 三处重复的 source-detail tag 渲染收口到共享 UI helper
- settings 子域当前已基本形成“pages 仅 route entry，feature 承担页面实现”的结构，
  后续重点转向继续清理共享请求原语、legacy compatibility 与剩余 giant-file 热点
- 已新增：
  - `src/features/settings/permissions/permissionsPageUtils.ts`
  - `src/features/settings/permissions/PermissionsRoleCatalogSection.tsx`
  - `src/features/settings/permissions/PermissionsRoleBindingsSection.tsx`
  将 permissions 页的角色目录 / 角色绑定两个主 section 与角色标签 helper
  从 route entry 下沉到 settings/permissions feature 目录
- 已继续新增：
  - `src/features/settings/permissions/PermissionsAuthorizationExplainSection.tsx`
  - `src/features/settings/permissions/PermissionsGovernanceControlsSection.tsx`
  - `src/features/settings/permissions/permissionsGovernanceControlTypes.ts`
  - `src/features/settings/permissions/ManagePermissionsPage.tsx`
  - `src/features/settings/permissions/usePermissionsRoleManagement.ts`
  - `src/features/settings/permissions/usePermissionsRoleCatalog.ts`
  - `src/features/settings/permissions/usePermissionsCustomRoles.ts`
  - `src/features/settings/permissions/usePermissionsAccessGovernance.ts`
  - `src/features/settings/permissions/usePermissionsImpersonationExplain.ts`
  - `countActiveBreakGlassGrants`
  - `getAccessReviewStatusColor`
  - `getAccessReviewDecisionColor`
- `src/features/settings/permissions/PermissionsGovernanceControlsSection.tsx` 已继续从约 504 行收口到约 473 行，并把 access review / break-glass / member / decision 类型下沉到 `permissionsGovernanceControlTypes.ts`；当前 section 已低于 500 行阈值
  将 permissions 页的授权解释 / access review / break-glass / impersonation
  主 section、治理态颜色 / 计数 helper，以及 page 级 mutation/request
  orchestration 继续下沉到 settings/permissions feature 目录；其中
  role catalog + custom role / role binding request orchestration 已继续拆到
  `usePermissionsRoleManagement.ts`，access review / break-glass /
  impersonation / explain orchestration 已继续拆到
  `usePermissionsAccessGovernance.ts`（access review + break-glass）与
  `usePermissionsImpersonationExplain.ts`（impersonation + authorization explain）
- 已新增 `src/features/settings/permissions/permissionsPageUtils.test.ts`，
  为 permissions feature 的角色标签、治理计数与状态颜色 helper
  补充回归测试
- `settings/permissions.tsx` 已从 ~1371 行继续收口到 route-entry re-export；
  实际 settings shell 与 feature section 组合当前已下沉到
  `src/features/settings/permissions/ManagePermissionsPage.tsx`
- permissions feature 一度通过
  `src/features/settings/permissions/useManagePermissionsPage.ts`
  承接 workspace overview / capability / option composition；随后继续删除
  这层仅做 page-level 组合的 hook，并让 `ManagePermissionsPage.tsx`
  直接依赖 auth/runtime/workspace-overview/role-management 四条真实 lane
- permissions feature 的治理与角色编排已继续拆细：
  - `usePermissionsAccessGovernance.ts` 负责 access review / break-glass
  - `usePermissionsImpersonationExplain.ts` 负责 impersonation / explain
  - `usePermissionsRoleManagement.ts` 继续下沉到
    `usePermissionsRoleCatalog.ts` + `usePermissionsCustomRoles.ts`
- 已新增 `src/features/settings/profile/ManageProfilePage.tsx`，将
  `settings.tsx` 的个人资料 / 密码修改 / impersonation 提示页面实现下沉到
  settings/profile feature 目录；`settings.tsx` 当前也已收口为 route-entry re-export
- 已继续移除仅做治理组合的 `src/features/settings/permissions/usePermissionsGovernanceActions.ts`；随后又把当前 UI 未渲染的 governance / impersonation explain lane 从 permissions 页入口移出，避免页面继续实例化未使用的控制流，并顺手修正了这条旧组合链路里 `explainPrincipalType` 的错误引用
- 已新增 `src/features/settings/identity/identityHealth.ts`，将 identity 页的证书健康、metadata 来源与 SCIM 状态 helper 从 `src/components/pages/settings/access/*` 迁入 settings/identity feature 目录，并补齐 `identityHealth.test.ts` 回归测试
- 已补齐 settings shell 迁移后的渲染回归测试：
  - `src/tests/pages/settings/platform.test.tsx`
  - `src/tests/pages/settings/skills.test.tsx`
  - `src/tests/pages/settings/diagnostics.test.tsx`
  - `src/tests/pages/settings/system-tasks.test.tsx`
  结合已有的 `users / permissions / audit / identity / automation / connectors`
  页面测试，settings 子域的共享 shell/layout 收口已有回归保护
- 已新增 `src/features/settings/skills/skillsPageUtils.ts`，将
  skills 页的 connector option / submit payload / capability 解析等纯工具
  从 route entry 中抽离
- 已新增 `src/features/settings/skills/useSkillConnectors.ts`，将
  skills 页连接器读取主链路切到 feature hook + `useRestRequest`
- 已一度新增 `src/features/settings/skills/useManageSkillsPage.ts`，将
  skills 页的 form/modal 状态、marketplace install / toggle / delete /
  save orchestration 与 shell/runtime wiring 从 route entry 中继续下沉
- 已新增 `src/features/settings/skills/useSkillDefinitionModal.ts`，将
  技能定义 create/edit modal 的 form 状态、默认值填充与 save orchestration
  从 `useManageSkillsPage.ts` 继续拆到独立 feature hook
- 已新增 `src/features/settings/skills/useSkillDefinitionOperations.ts`，将
  技能 marketplace install / enable-toggle / delete 的 mutation orchestration
  与 loading 状态从 `useManageSkillsPage.ts` 继续拆到独立 feature hook
- 已新增 `src/features/settings/skills/useSkillsPageData.ts`，将
  control-plane 读取、connector 读取、runtime selector 收窄、已安装 catalog
  集合与 enabled skill 统计等数据派生从 `useManageSkillsPage.ts` 继续拆到
  独立 feature hook
- 已新增 `src/features/settings/skills/useSkillsPageData.test.tsx`，为
  skills data hook 的 connector option、installed catalog ids、enabled
  skill count、refresh 代理与 loader 入参补充回归测试
- 已新增：
  - `src/features/settings/skills/SkillsMetricsGrid.tsx`
  - `src/features/settings/skills/SkillsMarketplaceSection.tsx`
  - `src/features/settings/skills/SkillDefinitionsSection.tsx`
  - `src/features/settings/skills/SkillDefinitionModal.tsx`
  将 skills 页的指标区、市场列表、我的技能列表与编辑 modal
  从 route entry 中拆到 settings/skills feature 目录
- 已新增 `src/features/settings/skills/skillsPageUtils.test.ts`，为
  skills feature 的 submit payload / capability / connector normalize helper
  补充回归覆盖
- `settings/skills.tsx` 已从 ~957 行继续收口到 route-entry re-export，仅保留
  页面入口；实际页面壳与 section/modal 组合已继续下沉到
  `src/features/settings/skills/ManageSkillsPage.tsx`
- 已新增 `src/features/settings/profile/ManageProfilePage.tsx`，将
  `settings.tsx` 的个人资料 / 代理登录提示 / 密码修改页面组合迁入
  settings/profile feature 目录，并复用 `settingsShell` 共享导航壳；
  `settings.tsx` 当前也已收口为 route-entry re-export
- 已新增 `src/features/auth/AuthPage.tsx`，将 `auth.tsx` 的统一登录页
  与 redirect helper 迁入 auth feature 目录；`auth.tsx` 当前收口为
  route-entry re-export，继续对测试与 legacy `/register` alias 保持原导出契约
- 已继续把 `src/features/auth/AuthPage.tsx` 从 ~661 行收口到 ~345 行，并新增
  `src/features/auth/authPageStyles.tsx` 承接登录页的视觉样式与版式定义；
  当前 AuthPage 已聚焦 redirect 解析、session gating 与 submit orchestration
- 已新增 `src/features/home/dashboard/ManageDashboardPage.tsx`，将
  `home/dashboard.tsx` 的 dashboard workbench 页面组合迁入 home/dashboard
  feature 目录；`home/dashboard.tsx` 当前也已收口为 route-entry re-export
- 已新增 `src/features/home/ManageHomeIndexPage.tsx`，将 `pages/index.tsx` 的
  onboarding + loading route 入口迁入 home feature；`pages/index.tsx` 当前也已收口为
  route-entry re-export
- 已新增 `src/features/home/routes/HomeLandingPage.tsx`，将 `pages/home/index.tsx` 的
  landing page route 组合与 helper re-export 迁入 home/routes；`pages/home/index.tsx`
  当前也已收口为 route-entry re-export
- 已新增 `src/features/knowledgePage/routes/KnowledgeHomePage.tsx`，将
  `pages/knowledge/index.tsx` 的 workbench route 组合与测试需要的 helper re-export
  一并迁入 knowledgePage/routes；`pages/knowledge/index.tsx` 当前也已收口为
  route-entry re-export
- 随后继续删除仅做 page-level 组合的
  `src/features/settings/skills/useManageSkillsPage.ts`，让
  `ManageSkillsPage.tsx` 直接依赖 `useSkillsPageData.ts` /
  `useSkillDefinitionModal.ts` / `useSkillDefinitionOperations.ts` 与
  capability/shell helpers；skills 页这一层又少掉一层无意义中转

### W5-4. modeling 域 feature 化

- diagram
- metadata
- relationships
- deploy/status

当前进展（2026-04-19）：

- 已新增 `src/features/modeling/modelingWorkspaceLayout.tsx`，将
  `ModelingWorkspace.tsx` 内联 styled layout 提取到 modeling feature 目录
- 已新增 `src/features/modeling/modelingWorkspaceUtils.ts`，将
  diagram normalize / deep-link query 解析等纯工具从页面组件中迁出
- 已新增 `src/features/modeling/ModelingWorkspaceContent.tsx`，将
  diagram stage、sidebar、drawer / modal overlays 从
  `ModelingWorkspace.tsx` 继续拆到 modeling feature 目录
- 已新增 `src/features/modeling/useModelingWorkspaceState.ts`，将
  runtime selector / readonly 解析、diagram request/refetch/refresh、初始
  load effect 与 page-level loading 组合从 `ModelingWorkspace.tsx` 继续拆到
  modeling feature 目录
- 已新增 `src/features/modeling/useModelingWorkspaceInteractions.ts`，将
  modeling 页的交互组合层从 page component 中抽离；当前已进一步拆成：
  - `src/features/modeling/useModelingWorkspaceNavigationEffects.ts`
  - `src/features/modeling/useModelingWorkspaceDiagramActions.ts`
  - `src/features/modeling/useModelingWorkspaceMoreActions.ts`
  分别承接 deep-link / metadata sync / GO_TO_FIRST_MODEL 事件、
  diagram node interaction / add / relationship mutation input 组合，以及
  more-menu 的 delete/edit/update-columns action orchestration
- 已新增 `src/features/modeling/useModelingWorkspaceMutationHandlers.ts`，将
  metadata / model / calculated-field / relationship submit handler 与 loading
  state orchestration 从 `ModelingWorkspace.tsx` 继续拆到 modeling feature
  目录
- modeling mutation orchestration 已继续拆细：
  - `src/features/modeling/modelingWorkspaceMutationTypes.ts`
  - `src/features/modeling/useModelingMetadataMutationHandler.ts`
  - `src/features/modeling/useModelingEntityMutationHandlers.ts`
  - `src/features/modeling/useModelingRelationshipMutationHandler.ts`
  将 metadata、实体 create/update、relationship submit 三组 mutation
  从 `useModelingWorkspaceMutationHandlers.ts` 继续拆到独立 feature hooks
- 已新增：
  - `src/features/modeling/buildModelingRelationshipMutationInput.ts`
  - `src/features/modeling/buildModelingRelationshipMutationInput.test.ts`
  将 relationship form -> mutation payload 的纯转换逻辑从
  `useModelingWorkspaceDiagramActions.ts` 继续拆成纯函数，并补充回归测试
- 已新增 `src/features/modeling/useModelingWorkspaceDeleteActions.ts`，将
  model / calculated field / relation / view 四类 delete orchestration 从
  `useModelingWorkspaceMoreActions.ts` 继续拆到独立 feature hook
- 已新增 `src/features/modeling/useModelingWorkspaceDeleteActions.test.tsx`，为
  delete actions 的 model/view 删除链路与无效 payload no-op 行为补充回归测试
- 已新增 `src/features/modeling/modelingWorkspaceUtils.test.ts`，为
  modeling feature 提取后的纯工具补充回归测试
- `src/components/pages/modeling/ModelingWorkspace.tsx` 继续收敛，当前更聚焦于
  shell 组合与少量 hook wiring；已从 ~729 行进一步收口到 ~161 行
- `useModelingWorkspaceMutationHandlers.ts` 已进一步从 ~165 行收口到 ~48 行，
  当前主要保留 mutation hook 组合；具体实体/关系/metadata 提交逻辑已下沉
  到更细的 modeling feature hooks
- `useModelingWorkspaceDiagramActions.ts` 已继续从 ~278 行收口到 ~102 行，
  当前主要保留 readonly 提示、node click 与 add action；relationship
  mutation input 已下沉到 `buildModelingRelationshipMutationInput.ts`，
  more-menu action orchestration 已下沉到 `useModelingWorkspaceMoreActions.ts`
- `useModelingWorkspaceMoreActions.ts` 已进一步从 ~197 行收口到 ~109 行，
  当前主要保留 more-menu 的 update/edit/delete 路由与错误兜底；delete
  细节已下沉到 `useModelingWorkspaceDeleteActions.ts`

### W5-5. workspace 域 feature 化

建议目标：

- `features/workspace/sections`
- `features/workspace/styles`
- `features/workspace/state`

当前进展（2026-04-19）：

- 已拆出 `src/features/workspace/workspacePageStyles.tsx`
- 已拆出 `src/features/workspace/workspacePageTypes.ts`
- 已拆出 `src/features/workspace/workspacePageUtils.ts`
- 已拆出 `src/features/workspace/useWorkspacePageState.ts`，将
  workspace 页的 overview 读取、tab/search 状态、过滤结果、治理摘要与
  join/apply/default-workspace action orchestration 下沉到 feature hook
- 已新增 `src/features/workspace/workspacePageDerivedState.ts`，将
  workspace 页基于 overview payload 的权限能力、检索过滤、治理侧统计与
  SAML 证书告警汇总从 state hook 中继续拆成纯派生层
- 已新增 `src/features/workspace/workspacePageDerivedState.test.ts`，为
  workspace 派生层的过滤、治理可见性与证书告警汇总补充回归覆盖
- 已拆出：
  - `src/features/workspace/components/WorkspacePrimaryPanel.tsx`
  - `src/features/workspace/components/WorkspaceGovernanceAside.tsx`
- `pages/workspace.tsx` 已从 ~1177 行降到 route-entry re-export；页面实现已继续下沉到
  `src/features/workspace/ManageWorkspacePage.tsx`
- 当前已完成页面样式、类型/工具、主区/侧区 section、feature page 与 page state /
  request orchestration 迁移
- `useWorkspacePageState.ts` 已继续从 ~374 行收口到 ~183 行，当前主要保留
  runtime request / local UI state / action handler；基于 payload 的 view-model
  派生已下沉到 `workspacePageDerivedState.ts`

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

当前进展（2026-04-18）：

- 已补充 `docs/frontend-legacy-route-inventory-2026-04-18.md`
  - `/settings/access -> /settings/users`
  - `/settings/security -> /settings`
- 已同步 `docs/frontend-route-inventory-2026-04-18.md` 的兼容入口清单
- 内部导航已优先切到 canonical route：
  - 工作空间入口统一走 `/workspace`
  - API 历史入口统一走 `/settings/diagnostics`
- 已将 `/modeling` 与 `knowledge?section=modeling` 的“建模 surface”判定收敛到
  `src/utils/knowledgeWorkbench.ts`
  - `HeaderBar`
  - `Sidebar`
  - `LearningSection`
  - `useRuntimeScopeNavigation`
    均复用同一 predicate，避免兼容路径判定再次散落

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

当前进展（2026-04-18）：

- 已新增 `wren-ui/src/utils/compatibilityRoutes.tsx` 作为兼容 alias / redirect 的共享 helper
- `register`、`settings/access`、`settings/workspace`、`workspace/schedules`、`api-management/history` 已改为统一 alias helper
- `settings/access`、`workspace/schedules`、`api-management/history` 已继续改为
  直接指向各自的 feature page 实现，不再通过 canonical route entry 二次中转，
  让兼容 route 保持“薄 alias -> feature page”结构
- `settings/security` 已改为统一 redirect helper
- `/modeling` 已改为同一 compatibility helper 提供的 runtime-aware redirect page，
  不再在 route entry 内部手写 `useRouter + useRuntimeScopeNavigation.replace`
- 已新增 `src/features/modeling/ModelingCompatibilityRedirectPage.tsx`，将
  `/modeling` 的 styled fallback 与 runtime-aware redirect helper 组合下沉到
  modeling feature 目录；`pages/modeling.tsx` 当前收口为薄 route-entry re-export
- 已新增 `src/utils/compatibilityRoutes.test.tsx`，覆盖 alias / server redirect /
  runtime-aware redirect 三类共享兼容 helper 的行为
- 已补 `src/tests/pages/settings/workspace.test.tsx` 与
  `src/tests/pages/settings/security.test.ts`，锁定
  `/settings/workspace -> /workspace` alias 与
  `/settings/security -> /settings` redirect 的兼容行为
- 已新增 `wren-ui/src/server/api/compatibilityApi.ts`，将 legacy API 的
  `Deprecation` / `Link` / `Warning` header 收敛为共享 helper
  - `/api/ask_task/streaming`
  - `/api/ask_task/streaming_answer`
  - `/api/v1/generate_vega_chart`
    已接入同一兼容流程，避免页面/API 兼容策略继续各写一套

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
- 已新增 `docs/frontend-dependency-audit-2026-04-18.md`，记录 Next / eslint-config-next / bundle-analyzer 对齐状态与 `cron-parser` 去重结论
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
