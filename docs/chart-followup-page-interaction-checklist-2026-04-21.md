# Chart Follow-up 页面交互 Checklist（2026-04-21）

> 关联主文档：
> `docs/chart-followup-commercial-reference-and-implementation-plan-2026-04-21.md`
>
> 路由语义配套：
> `docs/home-unified-intent-routing-architecture-2026-04-21.md`
>
> Cloud 新线程对齐 patch：
> `docs/cloud-home-interaction-alignment-patch-2026-04-22.md`

## 1. 目标

把当前 thread 页从“单列回答 + answer 内部 chart tab”逐步升级为更接近商业版的 **dual-surface** 形态：

- 左侧保留对话流、thinking steps、文本回答、artifact teaser card；
- 右侧提供当前激活 artifact 的完整工作台（Data Preview / SQL Query / Chart）；
- chart follow-up 可独立存在；
- 右侧工作台按场景按需出现，不做无意义的常驻空壳。



## 1.1 与当前实现同步（2026-04-21 晚）

当前分支已经**越过原文的 Phase 1，直接落到 Phase 2 主路径**：

- 已有真正的 `HomeThreadPage` 左右双区骨架；
- 已有 `ThreadWorkbench` / `threadWorkbenchState` / `activeWorkbenchArtifact`；
- 已有独立 `CHART_FOLLOWUP` response 与 `sourceResponseId`；
- 已支持自然语言 `“生成一张图表给我”` 直达 chart follow-up；
- 已通过 Playwright 实测 ask → chart follow-up → workbench 渲染链路。

因此，下文 Phase 1 checklist 更多作为**历史过渡说明**保留；本次同步重点是把 Phase 2 / 验收项更新到最新实现状态。

这里要特别强调：

- 商业版在**实时对话过程中**，当表格或图表 artifact 出现时，右侧工作台会显示；
- 但在**回放/重进页面**场景，不一定默认立即展开同样的工作台状态；
- 因此页面交互需要区分 `live conversation` 与 `replay conversation`。

## 1.2 Cloud 新线程实测补丁（2026-04-22）

2026-04-22 在 Cloud 新线程下重新实测后，需要补 5 条页面级约束：

- ask / follow-up 结果 ready 后，**latest response** 会主动驱动右侧 workbench；
- ask response 左侧默认只有 `Data preview` teaser，chart / recommend 入口优先以**底部 contextual chips**出现；
- `生成一张图表给我`、`推荐几个问题给我` 这类 chips 默认先**写入 composer**，而不是直接执行；
- chart response 底部 chips 会切换为 chart-specific follow-ups；
- `Spreadsheet` 存在于 workbench header，而不是 tab strip。

因此，下文若与以上 5 条冲突，以这次新线程实测 patch 为准。

---

## 2. 当前代码现状

当前相关代码：

- `wren-ui/src/components/pages/home/promptThread/AnswerResult.tsx`
- `wren-ui/src/components/pages/home/promptThread/ChartAnswer.tsx`
- `wren-ui/src/components/pages/home/preparation/index.tsx`
- `wren-ui/src/components/pages/home/preparation/PreparationSteps.tsx`
- `wren-ui/src/features/home/thread/routes/HomeThreadPage.tsx`

当前交互特征（已同步到最新代码）：

1. `HomeThreadPage` 已维护：
   - `selectedResponseId`
   - `activeWorkbenchArtifact`
   - `isWorkbenchOpen`
2. `AnswerResult` 已从“内部 tabs”转成：
   - 左侧问题卡片
   - preparation / thinking steps
   - 文本回答
   - 轻量 artifact teaser card（当前代码仍含 `Data Preview / Chart` teaser，但 Cloud 新线程目标态应收敛为 ask=preview teaser、chart=chart teaser）
3. `ThreadWorkbench` 已提供统一右侧结果工作台：
   - `Data Preview / SQL Query / Chart` 按当前 selected response 条件渲染
   - 但 `Spreadsheet` 这类 Cloud header affordance 仍未进入统一模型
4. chart 已是独立 `CHART_FOLLOWUP` response，并带 `sourceResponseId`。
5. 自然语言 `“生成一张图表给我”` 已可直达 chart follow-up，不再只依赖按钮动作。
6. 当前 recommendation 仍偏自动触发；Cloud 新线程目标态更接近“先展示 contextual chips，再由用户 send 执行”。

也就是说，当前实现已经把：

- artifact
- workbench
- live / replay 的基本开关策略

拆出来了；剩余要补的是更完整的 intent contract、lineage 语义和商业版级 thinking steps 收口。

---

## 3. 交互总原则

### 3.1 左侧是语义流，右侧是结果工作台

最佳抽象应为：

- **左侧对话区**
  - 问题卡片
  - thinking steps
  - 文本回答
  - artifact teaser card（ask 默认 `Data preview`，chart response 默认 `Chart`）
  - contextual follow-ups / recommendation triggers
- **右侧工作台**
  - 当前激活 artifact 的完整 viewer
  - `Data Preview / SQL Query / Chart` tabs
  - 与当前 `selectedResponse + artifact owner` 解析一致的 header actions（如 `Spreadsheet`、`Pin to dashboard`）

因此：

- 左侧不是右侧的替代品；
- 右侧也不是单独的“调试面板”；
- 二者是同一条回答的两种呈现层。

### 3.2 左侧 teaser card 与右侧 full viewer 必须联动

补充 Cloud 新线程 patch：

- ask response 默认应只有 `Data preview` teaser；
- chart 入口优先通过底部 contextual chips 提供，而不是在 ask body 再塞一张 chart teaser；
- `Chart` teaser 默认属于 chart response 本身。


例如：

- 左侧 `Data preview` 卡片 + `View data`
- 左侧 `Chart` 卡片 + `View chart`

点击后应：

- 选中对应 response；
- 设置 `activeWorkbenchArtifact`；
- 打开或聚焦右侧工作台；
- 将右侧 tab 切到对应 artifact。

如果右侧工作台已经打开：

- 不应先关闭再重开；
- 应保持打开，仅切换 `selectedResponseId + activeWorkbenchArtifact`。

### 3.2A 底部 contextual follow-up chips 与 composer 的关系

Cloud 新线程实测补充了一条更强的交互约束：

- 左下区域的 `生成一张图表给我`、`推荐几个问题给我`、chart refine chips，第一版都应优先视为 **response-scoped contextual aids**；
- 点击后默认行为应是：
  - 写入 composer
  - 不直接执行
- 真正执行以用户 send 为准。

因此这里的 chips 不等价于：

- teaser CTA
- one-click mutation
- 右侧 workbench action

它们是 conversation aid，不是 artifact navigation。

另外要补一条 contract 约束：

- chart refine chips 不应写成固定文案清单；
- 更合理的抽象是 **chart-type-aware dynamic aids** 或 templated / AI-generated refine aids；
- 2026-04-22 Cloud BAR chart 实测里的 `为柱状图添加标签 / 仅显示前 ... 个柱子 / 将标题重命名为 ...` 只应作为 **示例**，不是 canonical default。

### 3.2B `draft-to-composer` 不能只写文本，必须带 draft metadata

如果 chip 只是把文本写进 composer，当前 `homeIntentRouting.ts` 的 `resolveComposerIntent(...)` 在发送时仍会优先把很多 drafted prompts 当成普通 ask。

因此页面侧需要一个轻量 draft envelope，例如：

```ts
type ComposerDraftIntent = {
  draftKey: string;
  intentHint: HomeIntentKind;
  sourceResponseId?: number | null;
  sourceAidKind?: ResponseConversationAidKind | null;
  draftedPrompt: string;
};
```

页面交互至少要满足：

- chip 点击时写入 **prompt + draft metadata**；
- 用户基本沿用这份 draft 发送时，优先消费 `intentHint`；
- 用户大改文本后，再退回普通 parser / regex 判定；
- 这份 draft state 是页面态，不需要一开始就落库。

### 3.3 右侧结果工作台按需出现，但 live / replay 行为不同

这是关键约束：

#### live conversation

- 当当前选中 response 的 **primaryWorkbenchArtifact** ready 时，可自动展开右侧工作台；
- 例如 ask response 的 preview ready、chart response 的 chart ready。
- 若只是 task 已创建、仍在 pending/thinking、但尚无可渲染 artifact，则不应为了占位而提前弹出空工作台。

#### replay / revisit conversation

- 若没有明确恢复态，不必强制默认展开右侧工作台；
- 用户点击左侧 teaser card / `View data` / `View chart` 后再展开更合理。

### 3.4 thinking steps 不是右侧结果

thinking steps 属于：

- 当前 response 的过程信息；
- 应留在左侧 response / timeline 区域；
- 不应占据右侧工作台主承载位。

### 3.4A thinking steps 的 UI 行为也要单独定义

除了步骤顺序，还要明确页面行为：

- 默认 **折叠优先**，避免每条 response 默认展开全部 steps；
- live / streaming 时允许 step 状态逐步更新，但不要求每次都自动展开；
- replay / revisit 时优先恢复 step 数据本身，不强制恢复历史展开态；
- ask follow-up 与 chart follow-up 尽量共用同一套 steps UI 样式，只在标签 / 状态上体现差异。

### 3.4B Workbench header actions 是独立于 tabs 的一层

除了 `Data Preview / SQL Query / Chart` 这些 artifact tabs，还需要单独建模一层 header affordance：

- `Spreadsheet`：优先视为结果工作台 header action，而不是第四个 tab；
- `Pin to dashboard`：仅在 chart-active 时显示；
- 这些 action 优先按 **artifact owner** 解析，而不是一律绑定 `selectedResponse`；
- 它们都不进入 `activeWorkbenchArtifact`。

### 3.5 Chart follow-up 最终是独立回答

Chart follow-up 最终目标：

- 左侧出现独立 chart response；
- 左侧 response 内展示 chart teaser card；
- 右侧展示该 chart response 的结果工作台；
- 不覆盖原回答。

并且需要明确：

- workbench 的标题与更多操作栏绑定当前 `selectedResponse`；
- chart response 被选中时，标题显示 chart follow-up 的问题；
- 但其 `Data Preview / SQL Query` 可通过 `sourceResponseId` 继承 source response 的 artifacts。

---

## 4. 关键状态矩阵

## 4.1 页面级可见性

| 场景 | 左侧对话区 | 右侧结果工作台 |
|---|---|---|
| 刚进入页面，无已选可渲染结果 | 显示对话流 | 不显示 |
| live：当前选中普通回答，preview/sql ready | 显示对话流 | 显示，默认聚焦 preview 或 sql |
| replay：当前选中普通回答，已有 preview/sql，但未恢复 `activeWorkbenchArtifact` | 显示对话流 | 可先不显示，等用户点击 teaser/card |
| 当前选中普通回答，只有 thinking steps、无结果 | 显示对话流 | 不显示 |
| live：当前选中 chart response，chart 生成成功 | 显示对话流 | 显示，默认聚焦 Chart |
| replay：当前选中 chart response，但无恢复 workbench 状态 | 显示对话流 | 可先不显示，点击 `View chart` 后显示 |
| live：当前选中 chart response，但 chart 仍 pending，且尚无 preview/sql/chart 可渲染 | 显示对话流 | 不应为了 pending 态单独打开空工作台 |
| 当前选中 chart response，chart 失败但有 SQL/Data Preview | 显示对话流 | 显示，可切回 SQL/Data Preview |
| 当前选中 chart response，既无 chart 也无其他结果载荷 | 显示对话流 | 不显示 |

## 4.2 默认聚焦规则

| response 类型 | primary workbench artifact | 默认右侧 tab |
|---|---|---|
| ask / follow-up response | `preview`（若存在）否则 `sql` | `Data Preview` 或 `SQL Query` |
| chart follow-up response | `chart` | `Chart` |

## 4.3 contextual aids 的渲染 / owner 规则

页面上必须把“谁显示 chips”和“chips 属于谁”写清楚：

1. 默认只在 **latest completed response** 上显示 contextual aids；
2. 当用户主动点选历史 response 时，切换显示该 response 自己的 aids；
3. 不要让每条历史消息都永久展开 chips；
4. 同一时刻只高亮一组 aids；
5. recommendation runtime 可以 thread-scoped，但 recommendation result 的 presentation owner 仍必须 response-scoped。

---

## 5. Phase 1 Checklist（不改大布局，先稳住 artifact 语义）

目标：保留当前 answer 内部 tab 结构，但先把未来 dual-surface 逻辑所需的语义补齐。

### 5.1 当前 answer 内部 tab 的行为收口

- [ ] 保留现有 chart tab 触发逻辑，但补齐失败态语义
- [ ] chart tab 内不再使用模糊 fallback 文案
- [ ] chart 失败时允许继续查看 SQL / Data Preview
- [ ] 图表失败不应让整个 answer 卡片看起来像“本次问答失败”

### 5.2 先抽出 artifact helper，而不是直接写死在 tabs 里

建议新增统一判断逻辑，例如：

- [ ] `hasRenderableResult(response)`
- [ ] `resolveResponseArtifacts(response)`
- [ ] `resolvePrimaryArtifact(response)`
- [ ] `resolveDefaultWorkbenchTab(response)`

判断条件建议至少覆盖：

- [ ] `response.sql`
- [ ] preview 数据可用
- [ ] `response.chartDetail?.chartSchema`

### 5.3 左侧 teaser card 先作为语义 contract 确立

即使 Phase 1 暂不做完整右侧 workbench，也建议先明确左侧 artifact teaser card contract：

- [ ] ask response 可有 `Data preview` teaser
- [ ] chart response 可有 `Chart` teaser
- [ ] SQL 默认不单独做 teaser
- [ ] teaser 上的 CTA 使用统一命名，如 `View data / View chart`

### 5.4 不做的事

- [ ] 不在 Phase 1 就引入完整左右分栏
- [ ] 不在 Phase 1 就把 chart 拆成独立 response
- [ ] 不在 Phase 1 就强行做 replay 状态持久化

---

## 6. Phase 2 Checklist（真正落地 dual-surface：左侧 timeline + 右侧 workbench）

## 6.1 页面骨架

- [x] `HomeThreadPage` 升级为“左侧 response timeline + 右侧 workbench”布局
- [x] 右侧 workbench 依据 `activeWorkbenchArtifact + selectedResponse + openPolicy` 控制显隐
- [x] 没有可渲染结果时，页面回到单列主视图或收起工作台

## 6.2 左侧 response 区

- [x] 主回答 response 可选中
- [x] chart follow-up response 可选中
- [x] thinking steps 显示在对应 response 卡片下
- [x] 当前选中 response 有明确选中态
- [ ] ask response 默认仅显示 `Data preview` teaser，不默认显示 chart teaser
- [ ] chart response 默认显示 `Chart` teaser
- [ ] response 底部显示 response-scoped contextual follow-up chips，而不是只依赖自动 recommendation list
- [ ] 默认只在 latest completed response 显示 aids；选中历史 response 时再切换到该 response 的 aids
- [ ] 同一时刻只展开一组 aids，不让整条历史 timeline 永久堆满 chips

## 6.3 右侧 workbench

- [x] 使用统一的 workbench 容器，但 tabs 按当前 selected response 的可用 artifacts **条件渲染**
- [x] ask / follow-up response 默认显示 `Data Preview / SQL Query`
- [x] chart follow-up response 默认显示 `Data Preview / SQL Query / Chart`
- [x] 主回答 response 默认打开 `Data Preview`
- [x] chart follow-up response 默认打开 `Chart`
- [x] chart response 失败时，如果仍有 SQL / Data Preview，允许切回
- [x] workbench 不再重复展示 thinking steps

## 6.3A 标题与操作栏规则 / owner resolution

- [x] workbench 标题绑定当前 `selectedResponse`
- [x] chart response 被选中时，标题显示 chart follow-up 的问题，而不是 source response 的问题
- [ ] `Spreadsheet` 作为 header action 进入统一规则，而不是作为 tab 建模
- [x] chart-specific actions（如 `Pin to dashboard`）仅在 `activeWorkbenchArtifact = chart` 时显示
- [x] preview / sql 状态下显示对应的刷新 / 复制 / 调整动作，不复用 chart 专属操作
- [ ] `open_spreadsheet` 按 preview artifact owner 解析，`copy_sql / adjust_sql` 按 sql artifact owner 解析，`pin_dashboard` 按当前 chart response 解析
- [ ] 若当前 active artifact 没有对应 owner，header action 应隐藏或 disable，而不是误绑到 `selectedResponse`

## 6.4 live conversation 行为

- [x] 新 ask response 的 preview ready 后，若其为当前 latest / selected response，可自动展开右侧 workbench
- [x] 新 chart follow-up response 的 chart ready 后，自动聚焦 `Chart`
- [x] chart task 刚创建但尚无可渲染 artifact 时，不因为 pending 占位而提前打开空 workbench
- [ ] contextual follow-up chips 点击后默认先写入 composer，而不是直接执行
- [ ] recommendation 不再在 answer 完成后默认自动生成；Cloud 对齐目标是 trigger-first
- [x] recommendation 完成时不默认打开右侧 workbench

## 6.5 replay / revisit 行为

- [x] 页面重进时，如果无恢复态，右侧 workbench 可保持收起
- [x] 用户点击左侧 `View data / View chart` 后再展开
- [x] 若未来补持久化，可恢复上次 `selectedResponse + activeWorkbenchArtifact + openState`

## 6.6 “生成图表”动作

- [ ] 主回答所在 turn 提供明确“生成图表”入口，且 Cloud 对齐优先形态为底部 contextual chip，而不是 ask body 内 chart teaser card
- [x] 触发后新增 chart follow-up response
- [x] 新增 response 后自动选中该 chart response
- [x] 若 chart response 已有可渲染结果，则右侧 workbench 自动展开并聚焦 `Chart`

## 6.6A “推荐问题 / contextual follow-ups”动作

- [ ] ask / chart response 底部统一展示 contextual follow-up chips
- [ ] `推荐几个问题给我` 优先作为 trigger chip，而不是自动展开完整推荐结果
- [ ] trigger chip 默认先写入 composer，且同时写入 draft metadata；用户 send 后再进入对应 runtime
- [ ] chart response 的 chips 应切换为 chart-type-aware follow-ups，而不是继续复用 ask response 那组通用 chips
- [ ] send recommendation trigger 后，结果必须绑定正确 `sourceResponseId`，而不是跟随最新 response 漂移

## 6.6B recommendation ownership / replay

- [ ] recommendation runtime 可以继续 thread-scoped，但 result presentation owner 必须 response-scoped
- [ ] 新一轮 ask / chart 产生后，旧 recommendation result 仍挂在原 owner response
- [ ] replay / refresh 后，如果 recommendation result 已存在，应恢复回原 owner response

## 6.7 “查看图表 / 查看结果”动作

- [x] 若已有 chart response，则“查看图表”行为应切到该 response
- [x] 若已有 preview artifact，则“查看数据”行为应激活 preview，而不是重新请求
- [x] 若右侧 workbench 已打开，则保持打开并切换上下文，而不是关闭再打开
- [x] 这些行为是 artifact navigation，不是新任务 intent

## 6.8 chart response 的 lineage

- [x] chart response 自己拥有 `chart`
- [x] chart response 的 `Data Preview / SQL Query` 首版可通过 `sourceResponseId` + 复制 SQL 继续查看 source response 结果
- [x] lineage 规则由统一 contract + workbench helper 明确：chart response 保持标题/图表归自己，preview/sql 通过 `artifactLineage.inheritedWorkbenchArtifacts` 解析到 source response

---

## 7. 组件拆分建议

建议在 Phase 2 引入以下职责拆分：

### 7.1 左侧

- `ThreadResponseTimeline`
- `ThreadResponseCard`
- `ThreadResponseThinkingSteps`
- `ThreadResponseArtifactTeasers`

### 7.2 右侧

- `ThreadWorkbench`
- `ThreadWorkbenchTabs`
- `ThreadWorkbenchChartPanel`
- `ThreadWorkbenchSqlPanel`
- `ThreadWorkbenchPreviewPanel`
- `ThreadWorkbenchHeaderActions`

### 7.3 状态 helper

- `hasRenderableResult(response)`
- `resolveResponseArtifacts(response)`
- `resolvePrimaryWorkbenchArtifact(response)`
- `resolveDefaultWorkbenchTab(response)`
- `resolveSelectedResponseId(...)`
- `resolveShouldOpenWorkbench(...)`
- `resolveWorkbenchTabs(response)`

---

## 8. 验收标准

### 8.1 主体验

- [x] 页面初始不出现无意义的右侧空白结果区
- [x] live conversation 中，当当前选中 response 有 `primaryWorkbenchArtifact` ready 时，右侧工作台可自动出现
- [x] chart follow-up 成为独立回答，不覆盖原回答
- [x] chart response 默认聚焦 Chart
- [ ] ask response 左侧默认仅有 `Data preview` teaser；chart teaser 默认属于 chart response
- [ ] 左下区域优先展示 contextual follow-up chips，而不是先自动展开 recommendation result list
- [ ] `生成一张图表给我` / `推荐几个问题给我` 这类 chip 点击后先写入 composer，不直接执行
- [ ] `Spreadsheet` 以 header action 形式出现，而不是被当成第四个 tab
- [x] ask response 与 chart response 的 workbench tabs 按可用 artifacts 条件渲染，而不是固定三栏
- [x] 新增的 teaser / workbench 标题 / 动作文案进入现有 i18n 体系，而不是直接硬编码
- [ ] contextual chips / Spreadsheet / trigger 失败态 / disabled 态说明也进入现有 message catalog，而不是补硬编码文案

### 8.2 replay 体验

- [x] replay / revisit 不强制复现 live conversation 的自动展开行为
- [x] 无恢复态时，点击左侧 artifact teaser 后再展开右侧工作台
- [x] 没有结果载荷时右侧区域自动收起，而不是保留空壳

### 8.3 降级体验

- [x] chart 失败后，原回答仍可正常查看
- [x] chart response 若失败但仍有 SQL/Data Preview，用户可继续切换查看
- [x] “查看图表 / 查看数据”在 artifact 已存在时不重复发起无意义任务
- [x] suggested follow-ups 继续留在左侧 conversational aid 区，不进入右侧 workbench

### 8.4 与当前代码兼容

- [x] 当前分支已经以 Phase 2 形态重构 `AnswerResult.tsx` / `HomeThreadPage.tsx` 主链路
- [x] Phase 2 才引入 response 语义拆分与页面骨架重构
- [x] Phase 2 的交互实现消费 `ResolvedHomeIntent + artifactPlan + activeWorkbenchArtifact`（`useThreadPageDisplayState` 已统一 hydrate response contract，composer 路由输出 canonical `resolvedIntent + envelope`，页面侧不再只依赖薄契约）

### 8.5 Playwright + Telemetry 基线

#### Playwright 最小验收

- [ ] ask 完成后只出现 trigger chips，不自动展开 recommendation list
- [ ] 点击 `生成一张图表给我` 只写入 composer，不自动发送
- [ ] 点击 `推荐几个问题给我` 只写入 composer，不自动发送
- [ ] send recommendation trigger 后，结果绑定正确 `sourceResponseId`
- [ ] 选中历史 response 时，chips source 能切换正确
- [ ] chart 激活时显示 `Pin to dashboard`
- [ ] `Spreadsheet` 只在有 preview owner 时显示或可点击

#### Telemetry 最小基线

- [ ] `home_chip_exposed`
- [ ] `home_chip_clicked`
- [ ] `home_chip_draft_sent`
- [ ] `home_spreadsheet_clicked`
- [ ] `home_recommendation_generated`

每条 event 至少应带：

- [ ] `threadId`
- [ ] `sourceResponseId`
- [ ] `aidKind` / `artifactKind`
- [ ] `selectedResponseId`
- [ ] `resolvedIntentKind`
