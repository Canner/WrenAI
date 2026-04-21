# Frontend Architecture Next Batch — 2026-04-19

对应：

- `docs/frontend-architecture-backlog-2026-04-18.md`
- `docs/frontend-architecture-progress-summary-2026-04-19.md`

## 目的

把当前 backlog 的剩余高收益项，转换成一份可直接执行的下一批清单。

本批次不追求再次大范围结构重写，重点是：

1. 收掉 **Wave 4** 的请求原语长尾
2. 明确 **Wave 6** 兼容入口的保留/删除决策
3. 把 **Wave 7** 从“一次性审计”推进到“可执行治理”

## Fresh verification basis

本清单基于 2026-04-20 的一次独立复核：

- `wren-ui/src` 非测试代码 `>500` 行文件数：**0**
- near-threshold Top 2：
  - `src/pages/api/v1/workspace/current.ts`（500）
  - `src/components/pages/home/promptThread/ChartAnswer.tsx`（500）
- `pages-route-allowlist.json` 当前锁定 route 数：**168**
- 非测试代码内 `useRestRequest` 实际调用数：**18**

Wave 4 启发式热点（按当前代码快照）：

| File | Lines | Heuristic score | 备注 |
| --- | ---: | ---: | --- |
| `src/hooks/useThreadDetail.ts` | 297 | 14 | 已完成主读取链路迁移；残余主要是 `requestUrl` helper / retry 包装 |
| `src/features/home/dashboard/useManageDashboardData.ts` | 199 | 14 | 已完成 list/detail 主读取链路迁移 |
| `src/hooks/useHomeSidebar.tsx` | 377 | 已部分收口 | 主 GET / rename / delete request 已迁到 `homeSidebarRequests.ts` |
| `src/hooks/useRuntimeSelectorState.tsx` | 135 | 10 | request helper 已下沉到 `runtimeSelectorStateRequest.ts`，hook 主体已变薄 |
| `src/hooks/useKnowledgeDiagramData.ts` | 179 | 11 | 已完成主读取链路迁移；残余主要是 request-key / cache helper |
| `src/hooks/useAuthSession.ts` | 266 | 已收口 | 已完成：主读取链路迁入 `useRestRequest`，保留 TTL cache + in-flight dedupe |
| `src/hooks/useAutoComplete.tsx` | 153 | 已收口 | 已完成：主读取链路迁入 `useRestRequest`，保留 diagram cache 复用 |
| `src/features/settings/systemTasks/ManageSystemTasksPage.tsx` | 310 | 15 | 已完成 overview 主读取链路迁移；残余主要是 request key helper 与 action mutation fetch |
| `src/hooks/usePollingRequestLoop.ts` | 96 | 已收口 | 新增共享 polling coordinator，thread response / recommended questions 已复用 |
| `src/hooks/useRecommendedQuestionsInstruction.tsx` | 259 | 已部分收口 | 已接入 `usePollingRequestLoop`，剩余主要是 timeout 与按钮态编排 |
| `src/hooks/useDeployStatusRest.ts` | 125 | 已部分收口 | 已接入 `PollingRequestCoordinator`，剩余主要是 silent catch 与 return shape |

## 执行原则

- 遵循当前标准：**非测试代码 500 行以内即可，不为拆分而拆分**
- 优先消灭“重复状态机”，而不是追求命名层面的统一
- 同一批内，先动 hook / rest helper，再动 feature page
- 每个子项都要带验证，不做“只改不证”

---

## Batch A — Wave 4 请求原语收尾（最高优先级）

### A1. 收 `useThreadDetail.ts`

目标：

- 把 thread detail 读取链路统一到 `useRestRequest`
- 清掉重复的 `requestUrl + setLoading + catch(() => null)` 组合

建议动作：

- 提取 thread detail 的 request builder / response normalize helper
- 保留现有对外返回面，先只替换内部请求状态机
- 如果存在 polling / recovery 依赖，避免在这一轮顺手改动

验收：

- 不再手写主读取链路的 loading / fetch orchestration
- 行为不变
- thread 页面历史恢复与详情加载测试继续通过

### A2. 收 `useManageDashboardData.ts`

目标：

- 统一 dashboard 列表 / 详情读取状态
- 降低 `ManageDashboardPage` 对内部自管请求状态机的依赖

建议动作：

- 先识别哪些请求适合 `useRestRequest`，哪些仍需要 mutation helper
- 列表读取、选中 dashboard 详情读取优先统一
- create / update / delete 这类 mutation 暂不强行塞进 `useRestRequest`

验收：

- 列表/详情读取链路统一
- 仍能支撑当前 dashboard 页面交互
- 页面级 `setLoading` 数量明显下降

### A3. 收 `useHomeSidebar.tsx`

目标：

- 把 home sidebar 里的 threads 主读取链路与预取/辅助读取进一步分层
- 降低 sidebar 切换时的重复 fetch / silent catch

建议动作：

- 把主列表读取继续收敛到 `useRestRequest`
- 将仍需保留的辅助 fetch（如预热、补充数据、边缘刷新）显式标注为 side-effect lane
- 清理无提示的 `catch(() => null)`，至少保留一致的错误归类

验收：

- 主线程列表读取不再与其他副作用混杂
- 失败策略更清晰
- 左侧历史记录交互不回归

当前状态（2026-04-20）：

- `useHomeSidebar.tsx`：**继续推进完成**
  - 新增 `src/hooks/homeSidebarRequests.ts`
  - sidebar threads 的主 GET / rename / delete request 已统一下沉
  - hook 本体已不再直接包含 `fetch + response.json().catch(() => null)`
  - 新增 `src/hooks/homeSidebarRequests.test.ts`

### A4. 收 `useRuntimeSelectorState.tsx` / `useKnowledgeDiagramData.ts`

目标：

- 收掉 runtime selector / knowledge diagram 两条“半统一”链路
- 把 `requestUrl` 拼装逻辑继续下沉

建议动作：

- 把 URL 组装迁到纯 helper
- 让 hook 本体只保留 selector 输入、`useRestRequest` 调用与返回面
- 避免把 selector 变化重新带回 page 级抖动

验收：

- hook 主体更薄
- selector 切换行为不回归
- knowledge diagram 读取不再保留 ad-hoc request 拼装

当前状态（2026-04-20）：

- `useRuntimeSelectorState.tsx`：**已部分完成**
  - URL / request-key / GET request / initial-loading 判断已下沉到
    `src/hooks/runtimeSelectorStateRequest.ts`
  - `useRuntimeSelectorState.tsx` 主体已明显变薄
- `useKnowledgeDiagramData.ts`：**已完成主读取链路迁移**
  - 当前剩余主要是 request-key / cache helper，不再是本地请求状态机

### A5. 收共享 polling 状态机

目标：

- 把 thread response / recommended questions 两条轮询链路里的
  timer/session/loading 状态机收成一套共享原语

已完成（2026-04-20）：

- 新增 `src/hooks/usePollingRequestLoop.ts`
- `src/hooks/useThreadResponsePolling.ts` 与
  `src/hooks/useThreadRecommendedQuestionsPolling.ts`
  已改为复用同一 polling coordinator
- 新增 `src/hooks/usePollingRequestLoop.test.ts`，锁定 coordinator 的
  current-session / clear-timer / error-normalize 契约

### A6. 收 `useRecommendedQuestionsInstruction.tsx`

目标：

- 把推荐问题入口里的重复 polling loop 收到共享原语
- 把 prefetched initial task / empty-task / settlement 逻辑拆成可测试 helper

已完成（2026-04-20）：

- `useRecommendedQuestionsInstruction.tsx` 已改为复用 `usePollingRequestLoop.ts`
- 新增 `recommendedQuestionsInstructionHelpers.ts`
  - `buildEmptyRecommendedQuestionsTask`
  - `getGroupedQuestions`
  - `createRecommendationPollingLoader`
  - `resolveRecommendedQuestionsSettlement`
- 新增 `recommendedQuestionsInstructionHelpers.test.ts`

### A7. 次优先长尾

这一批可以与 A1~A4 并行，但收益略低：

- `src/hooks/useAuthSession.ts`（已完成：主读取链路已迁入 `useRestRequest`，保留 TTL cache + in-flight dedupe）
- `src/hooks/useAutoComplete.tsx`（已完成：主读取链路已迁入 `useRestRequest`，保留 diagram cache 复用）
- `src/features/settings/systemTasks/ManageSystemTasksPage.tsx`（已完成：overview 主读取链路已迁入 `useRestRequest`，保留 silent refresh 语义）

### A8. 收 `useDeployStatusRest.ts`

目标：

- 把 deploy status 的 polling timer 控制切到共享 coordinator
- 将 unsynchronized fallback / polling-interval 判断拆成纯 helper

已完成（2026-04-20）：

- 新增 `src/hooks/deployStatusRestHelpers.ts`
- `useDeployStatusRest.ts` 已改为复用 `PollingRequestCoordinator`
- `useDeployStatusRest.test.ts` 已补 helper contract 覆盖

---

## Batch B — Wave 6 兼容入口长尾治理

当前残余入口：

- `src/pages/settings/security.tsx`
- `src/pages/workspace/schedules.tsx`
- `src/pages/settings/workspace.tsx`
- `src/pages/settings/access.tsx`
- `src/pages/register.tsx`
- `src/pages/api-management/history.tsx`

### B1. 建立决策表

把上述入口分成三类：

1. **必须保留**：已有外链 / 老书签 / 导航约定仍依赖
2. **可继续保留但需标注弃用**
3. **可删除**：内部已无引用，只剩历史兼容意义

### B2. 标准化收口规则

保留入口的统一规则：

- 一律只允许 `createCompatibilityAliasPage(...)`
- 不再写各自的业务逻辑
- 若需 redirect，必须统一走共享 helper

### B3. 删除窗口

如果产品上允许清理：

- 先在 inventory 文档中标注“拟删除”
- 再统一删一批，而不是零散删除

验收：

- `pages/` 里的 compatibility 页不再继续生长
- 保留项都有清晰理由

---

## Batch C — Wave 7 依赖治理闭环

### C1. 产出完整重复依赖清单

目标：

- 从 `package.json` + lockfile 出发，列出：
  - 直接重复声明
  - 可疑但未使用依赖
  - 仅历史兼容保留的依赖

### C2. 评估升级窗口

建议至少形成一页结论：

- Next / React / TypeScript 当前版本与升级风险
- 哪些升级是“可随下批做”
- 哪些升级要等业务冻结窗口

当前更明确的结论（2026-04-20）：

- `antd` 若从 `4.20.4` 升到最新稳定版，不应理解为“单次升级”，而应理解为：
  1. **先做 Antd prep wave**
  2. **再做 v4 → v5**
  3. **最后评估 v5 → v6**
- 现有 blast radius 已确认：
  - 非测试代码约 **278** 个文件直接 import `antd`
  - Antd prep Batch 0A 落地前约 **21** 个非测试文件直接 import `antd/lib/*` / `antd/es/*`
  - 当前已先清掉其中 **14** 个纯 low-risk internal import 文件，剩余 **7** 个 internal-import 文件
  - `src/import/antd.ts` 仍维护 **47** 个 Antd 4 alias export
  - 约 **45** 处 `visible=`
  - 约 **4** 处 `onVisibleChange` / `onDropdownVisibleChange`
  - 约 **12** 处 `Tabs.TabPane`
  - 约 **19** 处旧 style/class props
  - 约 **18** 处 `moment`
  - `src/styles/**/*.less` 约 **23** 个文件
  - `.ant-*` 覆盖命中约 **403** 处

#### C2a. Antd prep wave（建议先于真正升级执行）

目标：

- 不直接升级 `antd`
- 先把 Antd 4 时代桥接层与高风险旧接口压到可控范围

建议动作：

1. **先清 internal import / facade**
   - 初始共有 **21** 个非测试 internal import 入口；当前已先收掉 **14** 个 pure low-risk 文件，剩余 **7** 个文件
   - 停止继续扩张 `src/import/antd.ts`
   - 若可行，开始把 facade alias export 回收为直接 `from 'antd'` import
   - 需要特别注意：`src/import/antd.ts` 不是“只有少数文件手动 import 的工具文件”
     - `next.config.js` 当前通过 `antd$ -> src/import/antd.ts` 的 exact-match alias，把应用中的 `from 'antd'` 统一重写到这层 facade
     - 当前虽然没有源码文件直接写 `@/import/antd`，但非测试代码里约 **278** 个 `from 'antd'` 文件都属于这层 facade 的**隐式消费者**
     - 因此 `src/import/antd.ts` 的回收不应被当成单文件 cleanup，而应被视为一批全局 import 边界调整
   - 当前这 **21** 个入口按**文件风险**更适合拆成三类：
     - **纯低风险 public surface 文件（14）**：文件内只依赖 `table` / `table/interface` / `tree` / `select` / `transfer` / `list`
       - 主要集中在 `components/table`、`components/sidebar`、`components/pages`、`features/settings`、`features/workspace`
       - 这批最适合作为 Antd prep wave 的第一刀
       - 建议第一波文件顺序：
         1. `components/table/ModelRelationSelectionTable.tsx`
         2. `components/pages/setup/SelectModels.tsx`
         3. `components/pages/setup/DefineRelations.tsx`
         4. `features/settings/platform-users/ManagePlatformUsersPage.tsx`
         5. `features/settings/platform-workspaces/ManagePlatformWorkspacesPage.tsx`
         6. `features/workspace/components/WorkspacePrimaryPanel.tsx`
         7. `components/sidebar/utils.tsx`
         8. `components/sidebar/home/ThreadTree.tsx`
         9. `components/sidebar/modeling/ModelTree.tsx`
         10. `components/sidebar/modeling/ViewTree.tsx`
         11. `components/selectors/DescriptiveSelector.tsx`
         12. `components/pages/modeling/form/ModelForm.tsx`
         13. `components/table/TableTransfer.tsx`
         14. `features/knowledgePage/modals/AssetWizardModal.tsx`
     - **混合风险文件（1）**：
       - `components/table/MultiSelectBox.tsx`
       - 同时依赖 `table` 与 `form/context`，不适合放进纯 low-risk 第一波
       - 更适合等 `form/context` 替代方案明确后再一起处理
     - **高风险 private surface import 位点（6）**：
       - `form/context`：5 个文件 + 1 个 mixed 文件中的附带依赖
         - `components/table/SelectionTable.tsx`
         - `components/table/MultiSelectBox.tsx`
         - `components/editor/MarkdownEditor.tsx`
         - `components/editor/SQLEditor.tsx`
         - `components/selectors/lineageSelector/index.tsx`
       - `menu/hooks/useItems`：1 个文件
         - `components/diagram/CustomDropdown.tsx`
       - 这批不建议与 public type import 混做，应单独评估可替代 API 或重写方式
   - 若按**import 语句**统计，则仍可理解为：
     - low-risk public surface import **15**
     - low-risk `list` 默认导入 **1**
     - private `form/context` **5**
     - private `menu/hooks/useItems` **1**
2. **先清 v4 → v5 必改接口**
   - modal / drawer / popover / dropdown 相关的 `visible`
   - `onVisibleChange` / `onDropdownVisibleChange`
   - `moment` 相关日期链路
3. **单独评估主题与 SSR**
   - `next.config.js`
   - `src/pages/_app.tsx`
   - `src/pages/_document.tsx`
   - `src/styles/index.less`
   - `src/styles/antd-variables.less`
   - 这 5 个文件共同决定是否还能继续依赖 Antd 4 Less 主题桥接链
4. **把 v6 清理面列成第二波**
   - `Tabs.TabPane`
   - `destroyOnClose`
   - `bodyStyle` / `maskStyle` / `overlayStyle` / `dropdownClassName` 等旧 prop
5. **把 `.ant-*` 覆盖回归留成独立波次**
   - 不与包升级混在一个 commit
   - 先按 `styles/themes`、`styles/components`、`knowledgePage/styles`、`reference/sidebar/home prompt thread` 分层回归

### C3. 固定化依赖审计流程

目标不是再写一份文档，而是给出固定动作：

- 何时跑依赖审计
- 产物写到哪里
- 什么情况必须更新 allowlist / audit 文档

验收：

- Wave 7 不再只是“一份审计结论”
- 有可重复执行的治理流程

建议补到固定流程里的 Antd / UI 栈审计动作：

- `npm view antd dist-tags --json`
- `npm view @ant-design/icons dist-tags --json`
- `npm view antd@6 peerDependencies --json`
- `rg` 统计：
  - `antd/lib/*` / `antd/es/*`
  - `visible=`
  - `onVisibleChange` / `onDropdownVisibleChange`
  - `Tabs.TabPane`
  - `bodyStyle` / `maskStyle` / `overlayStyle` / `dropdownClassName`
  - `moment`
  - `.ant-*`

---

## 推荐执行顺序

### 第一批（直接开工）

1. `useRuntimeSelectorState.tsx` 剩余 request-key/plumbing 薄化
2. `useKnowledgeDiagramData.ts` / 其他 request-key 长尾
3. `useRecommendedQuestionsInstruction.tsx` 的 timeout/error 策略细化

### 第二批（补齐半统一链路）

4. Wave 6 compatibility 决策表
5. Wave 7 dependency closure
6. Antd prep wave：先清 internal import / facade / `visible` / `moment`

### 第三批（治理性工作）

7. `useDeployStatusRest.ts` / 其他 polling 长尾
8. 依赖治理流程固化
9. Antd 主题链 / SSR 迁移评估（`next.config.js` / `_app.tsx` / `_document.tsx` / Less bridge）

---

## 每批建议验证

### Wave 4

- 定向 `next lint --file ...`
- 对应 hook / feature 的 jest tests
- `yarn --cwd wren-ui check-types`
- 必要时补一轮页面级 smoke（home / dashboard / knowledge）

### Wave 6

- `node wren-ui/scripts/check_pages_routes.mjs`
- route allowlist 复核
- grep 确认旧入口是否仍被引用

### Wave 7

- dependency audit 文档更新
- `yarn --cwd wren-ui install --mode=skip-build` 或等价依赖解析校验
- 变更前后 lockfile / bundle 风险说明
- 若评估 Antd 升级，还应补：
  - `npm view antd dist-tags --json`
  - `npm view @ant-design/icons dist-tags --json`
  - `npm view antd@6 peerDependencies --json`
  - `rg` 统计 blast radius 是否变化

---

## 完成定义

这份 next batch 可以视为完成，当以下条件满足：

1. Wave 4 mixed-mode / request-key 热点继续收掉至少 2 个（优先 `useRuntimeSelectorState.tsx` 与 `useKnowledgeDiagramData.ts`）
2. Wave 6 残余 compatibility 页有明确保留/删除决策
3. Wave 7 从“已有 audit”推进到“有执行闭环”
4. 进度摘要文档同步刷新一次
