# Home 统一意图路由架构方案（2026-04-21）

> 关联文档：
> - `docs/chart-followup-commercial-reference-and-implementation-plan-2026-04-21.md`
> - `docs/chart-followup-page-interaction-checklist-2026-04-21.md`
> - `docs/ask-chart-thinking-steps-contract-draft-2026-04-21.md`
> - `docs/cloud-home-interaction-alignment-patch-2026-04-22.md`


## 0. 与当前实现同步（2026-04-21 晚）

当前分支已经完成这份方案的**第一轮主路径落地**，但还不是最终版的 full canonical `ResolvedHomeIntent`。

| 项目 | 当前状态 | 代码落点 |
|---|---|---|
| 自然语言 chart-only follow-up 路由 | 已落地 | `wren-ui/src/features/home/thread/homeIntentRouting.ts` |
| 显式 chart action → 独立 chart follow-up response | 已落地 | `wren-ui/src/features/home/thread/useThreadResponseMutationActions.ts`、`wren-ui/src/server/services/askingServiceThreadActions.ts` |
| `responseKind/sourceResponseId` 数据模型 | 已落地 | `wren-ui/migrations/20260421163000_add_chart_followup_fields_to_thread_response.js`、repository / serializer |
| dual-surface 右侧 workbench + artifact state | 已落地 | `HomeThreadPage.tsx`、`ThreadWorkbench.tsx`、`threadWorkbenchState.ts` |
| chart-only follow-up 轮询竞态修复 | 已落地 | `threadRecoveryPollingHelpers.ts`、`useThreadResponsePollingSettleEffect.ts` |
| server 持久化的 full `ResolvedHomeIntent` | 未落地 | 当前仍是页面层 + serializer 层的 canonical hydrate，尚未整库持久化 |
| `GENERAL_HELP / RECOMMEND_QUESTIONS` 的统一 intent contract | 部分落地 | `GENERAL_HELP` 已由 ask runtime 映射；`RECOMMEND_QUESTIONS` 已在 thread-sidecar 输出中补齐 canonical intent envelope |
| replay workbench restore 持久化 | 已落地 | `threadWorkbenchReplayState.ts` + `HomeThreadPage.tsx` 已支持按 thread 恢复 `selectedResponse/artifact/openState` |

因此，本文后文的 canonical model 仍然是**目标态设计**；当前代码已经先把 chart follow-up 这条高价值主路径交付出来。

## 0.1 Cloud 新线程实测补丁（2026-04-22）

2026-04-22 已使用 Playwright 在 Cloud 登录态下，用**全新线程**复跑了 ask → follow-up → multi-follow-up → chart follow-up 主链路，补充确认了 5 个对齐约束：

- ask / follow-up 的 **latest response** 在结果 ready 后会主动驱动右侧 workbench；
- ask response 左侧默认只有 `Data preview` teaser，chart / recommend 入口优先以**底部 contextual chips**出现；
- `生成一张图表给我`、`推荐几个问题给我` 这类 chips 默认是 **`draft-to-composer`**，不是 one-click execute；
- chart follow-up 是独立 response，且其底部 chips 会切换为 chart-specific follow-ups；
- `Spreadsheet` 更像 **workbench header action**，而不是第四个 artifact tab。

后文若与以上 5 条冲突，以这次新线程实测 patch 与 `docs/cloud-home-interaction-alignment-patch-2026-04-22.md` 为准。

## 1. 结论先行

基于当前代码、你补充的商业版实时会话截图，以及已有 chart follow-up 方案，结论更新为三条：

1. **Home 页仍然需要统一的产品意图层。**
2. **这份路由方案应该与页面交互 checklist 分开，但实现必须联动。**
3. **最佳抽象不是“只有对话流”或“只有右侧工作台”，而是：`intent-first + artifact-driven + dual-surface presentation`。**

这里的 dual-surface 指：

- **左侧对话区**：承载问题、thinking steps、文本回答、artifact teaser card；
- **右侧工作台**：承载当前激活 artifact 的完整查看与操作；
- 二者联动，但不是同一概念。

换句话说：

- **intent** 决定“用户当前想做什么”；
- **artifact** 决定“这次动作产出了什么结果”；
- **presentation** 决定“结果如何同时在左侧摘要呈现、在右侧完整查看”。

---

## 2. 当前代码事实

## 2.1 Ask 主链路目前只有 4 类 NLP intent

代码事实：

- `wren-ai-service/src/pipelines/generation/intent_classification.py`
- `wren-ai-service/src/core/fixed_order_ask_runtime.py`

当前 ask runtime 的 NLP 分类只有：

- `TEXT_TO_SQL`
- `GENERAL`
- `MISLEADING_QUERY`
- `USER_GUIDE`

并且在 `fixed_order_ask_runtime.py` 中实际路由为：

- `TEXT_TO_SQL` → text-to-sql 主链路
- `GENERAL` → `data_assistance`
- `USER_GUIDE` → `user_guide_assistance`
- `MISLEADING_QUERY` → `misleading_assistance`

也就是说，**今天系统里的“问数 / 数据补充 / 使用帮助 / 无效问题”只在 ask runtime 内有统一分类**。

## 2.2 Follow-up 目前不是独立 intent，而是 thread context

代码事实：

- `wren-ui/src/server/controllers/askingControllerThreadActions.ts`
- `wren-ui/src/features/home/thread/useThreadCreateResponseAction.ts`

当前 follow-up 通过：

- `createThreadResponse(threadId, { question | taskId | sql })`

来创建新的 thread response。

它的“follow-up 语义”主要来自：

- 当前 thread 历史；
- ask runtime 里的 `histories`；
- rephrased question；
- 不是一个显式的 `FOLLOW_UP` / `ASK_FOLLOWUP` 分类值。

## 2.3 图表生成已经有首版统一路由，但仍未形成 full intent contract

代码事实：

- `wren-ui/src/features/home/thread/useThreadResponseMutationActions.ts`
- `wren-ui/src/features/home/thread/homeIntentRouting.ts`
- `wren-ui/src/server/services/askingServiceResponseActions.ts`

当前图表生成已经有两条入口，并且都能汇入 chart follow-up 主路径：

- 显式动作：`onGenerateThreadResponseChart(responseId)`
- 自然语言输入：`resolveComposerIntent(...)` 把 `“生成一张图表给我”` 识别成 chart-only follow-up

两条入口最终都会落到：

- 独立 `CHART_FOLLOWUP` response
- `sourceResponseId`
- `generateThreadResponseChartAction(...)`

也就是说，**chart follow-up 这条高价值主路径已经统一了入口结果**；但它仍然是页面层 / action 层的薄契约，还不是完整的 server-persisted unified intent model。

## 2.4 推荐追问目前也是显式 thread-level action

代码事实：

- `wren-ui/src/features/home/thread/useThreadRecommendedQuestionsAction.ts`
- `wren-ui/src/server/services/askingServiceRecommendationActions.ts`

当前推荐追问由：

- `triggerThreadRecommendationQuestions(threadId)`

触发。

结果落在 thread 级别：

- `thread.questionsStatus`
- `thread.questions`

不是 response 级独立回答，也不走 ask intent 分类。

## 2.5 当前结果呈现已经进入 dual-surface，但语义 contract 仍是轻量版

代码事实：

- `wren-ui/src/components/pages/home/promptThread/AnswerResult.tsx`
- `wren-ui/src/features/home/thread/routes/HomeThreadPage.tsx`
- `wren-ui/src/features/home/thread/components/ThreadWorkbench.tsx`
- `wren-ui/src/features/home/thread/threadWorkbenchState.ts`

当前页面已经具备：

- 左侧 response timeline；
- `AnswerResult` 内的 `Data Preview / Chart` teaser card；
- 右侧 `ThreadWorkbench`；
- `selectedResponseId + activeWorkbenchArtifact + isWorkbenchOpen` 页面状态；
- 针对 ask response / chart response 的条件 workbench tabs。

也就是说，**artifact / workbench 的页面级分层已经落地**。

当前真正仍然缺的，是更高一层的统一语义 contract：

- **server-persisted resolved intent**
- **更明确的 artifact plan / lineage contract**
- **ask / chart / recommendation 共用的产品语义层**

---

## 3. 为什么现在需要统一意图

如果不补统一意图层，后面会持续出现 5 类问题：

### 3.1 同一句自然语言在不同入口下行为不一致

例如：

- 用户在输入框里说“生成一张图表给我”
- 用户点击按钮“生成图表”

这两个入口本质应该落到同一类 chart 语义，但今天：

- 前者更接近 ask follow-up；
- 后者是专门 chart action；
- 二者 thinking steps、结果挂载位置、失败语义都可能不同。

### 3.2 页面交互无法稳定绑定到“意图”

右侧 workbench 是否展开、默认 tab 是什么、是否创建独立 response，不该直接由“某个 API 名称”决定，而应该由：

- 当前动作对应的产品意图；
- 当前动作产出的 artifacts；
- 当前 active artifact 是什么；
- 当前是不是 live conversation / replay conversation。

### 3.3 thinking steps 无法做到 ask / chart / follow-up 一致收口

如果没有统一 intent：

- ask steps 是一套；
- chart steps 是另一套；
- recommendation 又是 thread 侧状态；
- follow-up 只是“再提一个问题”。

最终前端只能围绕接口拼页面，不能围绕“用户正在做什么”来组织过程展示。

### 3.4 artifact 无法稳定驱动左/右联动

商业版更接近：

- 左侧有 `Data preview / Chart` 的 teaser 卡片；
- 右侧有 `Data Preview / SQL Query / Chart` 的完整 viewer。

如果没有统一 intent + artifact 层：

- 左侧卡片不知道该出现什么；
- 右侧 workbench 不知道该默认打开什么；
- replay 场景也无法稳定恢复或延迟打开。

### 3.5 后续扩展能力会继续分叉

后面如果加：

- 追问拆解
- 自动补充数据上下文
- 推荐下一步分析
- explain chart / refine chart

如果没有统一 intent 层，新增一个动作就会再长出一条专用分支。

---

## 4. 设计原则

## 4.1 统一的是“产品意图”，不是“单一分类器”

我们要统一的是：

- 前端与服务端共享的意图语义；
- response / artifact / workbench / thinking steps / telemetry 的统一语言；
- entrypoint 到 runtime 的路由规则。

**不是要求所有入口都必须先经过同一个 LLM intent classifier。**

因此建议采用：

- **自然语言入口** → NLP intent classification
- **显式 UI action** → deterministic intent mapping

## 4.2 路由优先级：显式动作优先于 NLP 推断

建议统一采用：

1. **Explicit action**（按钮/菜单/快捷入口）
2. **Bound source context**（绑定了 source response / source thread）
3. **Thread context**（当前是否在 follow-up 场景）
4. **NLP classification**（自然语言分类）
5. **Fallback guardrail**（兜底为 ask/general/misleading）

例如：

- 点了“生成图表”按钮，就不该再让 classifier 去猜是不是画图。
- 只有用户直接在输入框里输入“生成一张图表给我”，才需要 NLP + context 一起判定。

## 4.3 intent 不等于 layout，但必须驱动 artifact 与 workbench

这次需要明确修正：

- intent 不应该等于某种固定页面布局；
- 但 intent 必须能够驱动：
  - 会产生哪些 **workbench artifacts**；
  - 哪个是 **primary workbench artifact**；
  - 是否在结果 ready 后自动打开右侧 workbench；
  - 左侧应该出现哪种 teaser card。

换句话说：

- **intent** 决定任务；
- **artifact** 决定结果；
- **presentation** 决定左侧摘要 + 右侧完整查看如何联动。

## 4.4 左右双区是 presentation 层，不是 intent 本身

目标态下，页面可以是：

- 左侧对话流 + 右侧工作台
- 单列回放页 + 可延迟打开的工作台
- 移动端抽屉式工作台

这些都属于 presentation 层。

因此 unified intent 文档不应把“右侧工作台常驻/不常驻”当成 intent 的一部分，但应定义：

- active artifact
- workbench open/close policy
- live / replay 的默认行为

## 4.5 服务端是最终 resolved intent 的 source of truth

这是第一版文档必须补上的点。

建议模型是：

- 前端传 `intentHint`
- 服务端做最终 `resolveHomeIntent(...)`
- 服务端把 resolved intent / artifact plan / source binding 信息持久化到 response 或 thread sidecar

原因：

- 刷新后不能丢语义；
- recovery / polling 需要读取统一 intent；
- telemetry 不能只靠前端推断；
- replay 场景需要知道这条 response 的 `primaryWorkbenchArtifact` 是什么。
- 但 **workbench 当前是否打开、当前打开哪个 tab** 仍属于页面状态，不应直接持久化进 resolved intent 本体。

---

## 5. 建议的统一模型

## 5.1 不建议只保留一个平面 `HomeIntent` enum

如果只定义：

- `ASK_DATA`
- `ASK_FOLLOWUP`
- `GENERATE_CHART`
- `GENERATE_MORE_QUESTIONS`
- `DATA_ASSISTANCE`
- `USER_GUIDE`
- `MISLEADING_QUERY`

会把三种维度混在一起：

1. **任务类型**
2. **触发模式**
3. **结果载体**

因此更好的 canonical 方案应该至少是多轴模型。

## 5.2 建议的 canonical 模型

```ts
export type HomeIntentKind =
  | 'ASK'
  | 'CHART'
  | 'RECOMMEND_QUESTIONS'
  | 'GENERAL_HELP'
  | 'USER_GUIDE'
  | 'MISLEADING_QUERY';

export type HomeIntentMode =
  | 'NEW'
  | 'FOLLOW_UP'
  | 'EXPLICIT_ACTION';

export type HomeResultTarget =
  | 'THREAD_RESPONSE'
  | 'THREAD_SIDECAR'
  | 'EXISTING_RESPONSE';

export type InlineArtifactKind =
  | 'preview_teaser'
  | 'chart_teaser';

export type WorkbenchArtifactKind =
  | 'preview'
  | 'sql'
  | 'chart';

export type WorkbenchHeaderActionKind =
  | 'open_spreadsheet'
  | 'pin_dashboard'
  | 'copy_sql'
  | 'adjust_sql'
  | 'close';

export type ThreadConversationAidKind =
  | 'suggested_questions';

export type ConversationAidInteractionMode =
  | 'draft_to_composer'
  | 'execute_intent';

export type ResponseConversationAidKind =
  | 'TRIGGER_CHART_FOLLOWUP'
  | 'TRIGGER_RECOMMEND_QUESTIONS'
  | 'TRIGGER_CHART_REFINE';

export type ConversationAidItem = {
  kind: ResponseConversationAidKind;
  label: string;
  prompt: string;
  interactionMode: ConversationAidInteractionMode;
  sourceResponseId?: number | null;
  suggestedIntent?: HomeIntentKind | null;
};

export type ConversationAidPlan = {
  responseAids?: ConversationAidItem[] | null;
  threadAids?: ThreadConversationAidKind[] | null;
};

export type ResolvedHomeIntent = {
  kind: HomeIntentKind;
  mode: HomeIntentMode;
  target: HomeResultTarget;
  source: 'explicit' | 'classifier' | 'derived';
  sourceThreadId?: number | null;
  sourceResponseId?: number | null;
  confidence?: number | null;
  artifactPlan?: {
    teaserArtifacts: InlineArtifactKind[];
    workbenchArtifacts: WorkbenchArtifactKind[];
    primaryTeaser?: InlineArtifactKind | null;
    primaryWorkbenchArtifact?: WorkbenchArtifactKind | null;
  } | null;
  conversationAidPlan?: ConversationAidPlan | null;
};
```

## 5.3 为什么这是更优模型

因为它把 6 件事情拆开了：

1. `kind`：这次到底是 ask、chart、还是 recommend
2. `mode`：这是新问、follow-up、还是按钮显式触发
3. `target`：结果落到 response、thread sidecar、还是已有 response 上
4. `artifactPlan`：这次有哪些 teaser / workbench 结果，以及哪个是默认主结果
5. `conversationAidPlan`：这次有哪些 response-scoped contextual aids，以及是否还会产出 thread-level aids
6. `WorkbenchHeaderActionKind`：哪些能力属于结果工作台 header affordance，而不是 artifact tab（例如 `Spreadsheet`）

这比平面 enum 更适合当前仓库和商业版目标态，也更贴近 2026-04-22 Cloud 新线程实测。

## 5.4 UI 层仍可派生简单标签

如果 UI 或 telemetry 需要更易读的标签，可以从 canonical model 派生：

- `ASK + NEW` → `ASK_DATA`
- `ASK + FOLLOW_UP` → `ASK_FOLLOWUP`
- `CHART + EXPLICIT_ACTION` → `GENERATE_CHART`

但这些应是 **derived label**，不应是最底层唯一模型。

---

## 6. 当前代码到新模型的映射

## 6.1 Ask runtime 的映射

| 当前来源 | 当前值 | 新模型映射 |
|---|---|---|
| ask runtime | `TEXT_TO_SQL` + 无 follow-up 依赖 | `kind=ASK, mode=NEW, target=THREAD_RESPONSE` |
| ask runtime | `TEXT_TO_SQL` + 有 histories/source response | `kind=ASK, mode=FOLLOW_UP, target=THREAD_RESPONSE` |
| ask runtime | `GENERAL` | `kind=GENERAL_HELP, target=THREAD_RESPONSE` |
| ask runtime | `USER_GUIDE` | `kind=USER_GUIDE, target=THREAD_RESPONSE` |
| ask runtime | `MISLEADING_QUERY` | `kind=MISLEADING_QUERY, target=THREAD_RESPONSE` |

> 命名上建议优先使用 `GENERAL_HELP`，比 `DATA_ASSISTANCE` 更贴近当前 `GENERAL` 的实际覆盖范围。

## 6.2 显式动作的映射

| 当前来源 | 当前值 | 新模型映射 |
|---|---|---|
| explicit UI action | generate chart | `kind=CHART, mode=EXPLICIT_ACTION, target=THREAD_RESPONSE(Phase 2)` |
| explicit UI action | recommend questions | `kind=RECOMMEND_QUESTIONS, mode=EXPLICIT_ACTION, target=THREAD_SIDECAR` |

> `RECOMMEND_QUESTIONS` 比 `GENERATE_MORE_QUESTIONS` 更准确，因为当前实现它不是 response 本身，而是 thread sidecar 结果。

## 6.3 artifact plan 的推荐默认值

| kind | teaserArtifacts | workbenchArtifacts | primaryWorkbenchArtifact |
|---|---|---|---|
| `ASK` | `preview_teaser` | `preview`, `sql` | `preview`（若存在）否则 `sql` |
| `CHART` | `chart_teaser` | `chart`, `preview`, `sql` | `chart` |
| `RECOMMEND_QUESTIONS` | - | - | - |
| `GENERAL_HELP` | - | - | - |
| `USER_GUIDE` | - | - | - |
| `MISLEADING_QUERY` | - | - | - |

## 6.3A conversation aid / header action 的推荐默认值（2026-04-22 patch）

基于 Cloud 新线程实测，建议再补两条默认策略：

### ASK

- `conversationAidPlan.responseAids` 默认包含：
  - `生成一张图表给我`
  - `推荐几个问题给我`
- 两者默认交互都应是 **`draft-to-composer`**；
- 也就是说 ask 结果的 chart / recommend 入口优先是 contextual chips，而不是 ask body 内再额外挂一张 chart teaser card。

### CHART

- `conversationAidPlan.responseAids` 默认包含 **chart-type-aware dynamic refine aids** + `推荐几个问题给我`；
- BAR chart 在 2026-04-22 Cloud 实测里的示例 chips 包括：
  - `为柱状图添加标签`
  - `仅显示前 ... 个柱子`
  - `将标题重命名为 ...`
- 这些示例应视为 **example copy**，不是固定 canonical default；
- 这些 chip 的第一版 contract 也建议统一走 **`draft-to-composer`**，不要在证据不足时先写死成 one-click mutate。

### Workbench header

- `Spreadsheet` 应作为 `WorkbenchHeaderActionKind` 暴露；
- `Pin to dashboard` 属于 chart-active 时的 header action；
- 这两者都不应被误收编进 `WorkbenchArtifactKind`。

补充说明：

- **文本回答本身不是 workbench artifact**，它属于左侧 response body；
- **ask response 默认只有 `preview_teaser`**，chart 入口优先通过底部 contextual chips 提供；
- **suggested/contextual follow-ups 都不是 workbench artifact**，它们属于 conversation aid；
- `Spreadsheet` 应优先建模为 **workbench header action**，而不是第四个 workbench artifact；
- 因此 `answer`、`suggested_questions`、`Spreadsheet` 都不应进入 `activeWorkbenchArtifact`。

## 6.3B `ComposerDraftIntent` / `DraftedAidEnvelope`

Cloud 的 `draft-to-composer` 不是“把一句文案塞进输入框”这么简单；为了让 intent 不在提交时丢失，页面还需要同时保存一份 draft metadata。

建议页面级新增：

```ts
type ComposerDraftIntent = {
  draftKey: string;
  intentHint: HomeIntentKind;
  sourceResponseId?: number | null;
  sourceAidKind?: ResponseConversationAidKind | null;
  draftedPrompt: string;
  draftedAt: string;
};
```

第一版至少明确 4 条规则：

1. chip 点击时，写入的是 **`prompt + draft metadata`**，而不是只有文本；
2. composer 提交时，如果用户仍在发送这份 draft，且只做了轻微编辑：
   - 优先走 `intentHint`
   - 带上 `sourceResponseId`
   - 不退回普通 regex / parser；
3. 如果用户把内容改得很不一样，或清空重写：
   - 再回退到 `resolveComposerIntent(...)` 重新判定；
4. 这份 draft state 应保留在 **页面态 / composer 态**，不需要写回 thread response 持久化字段。

这是必要补丁，因为当前 `homeIntentRouting.ts` 的 `resolveComposerIntent(...)` 仍主要稳定覆盖：

- 普通 `ASK`
- regex 命中的 `CHART`

如果没有 `ComposerDraftIntent`，`推荐几个问题给我`、chart refine chips 等 drafted prompts 很容易退化成普通 ask。

## 6.3C `responseAids` / header actions 第一版建议 read-time derive

虽然 `conversationAidPlan` / `WorkbenchHeaderActionKind` 已进入 canonical model，但第一版落地更建议：

- 先扩 `types/homeIntent.ts`
- 在 `homeIntentContract.ts` 统一推导 `responseAids` / `headerActions`
- 在 `threadPayloadSerializers.ts` 返回 payload 时补齐
- 前端先消费这一层 derived contract

先不要急着：

- 改 repository schema
- 改历史数据
- 做 migration

原因是这批 aid / header action 在第一版主要仍是 **展示性、可派生信息**；先做 read-time derive 更轻、更可逆。

---

## 7. 入口与路由矩阵

## 7.1 入口分类

建议把 Home 页入口先分成 3 类：

### A. 自然语言输入框提交

例如：

- “各部门平均薪资是多少？”
- “按部门拆开再看一下”
- “生成一张图表给我”
- “这个数据集适合分析什么？”

### B. 显式操作按钮

例如：

- 生成图表
- 生成推荐追问
- 重新生成回答
- 查看图表 / 查看数据

### C. 结果增强 / 结果修改动作

例如：

- 调整 SQL
- 调整 chart
- pin 到 dashboard

这些更像 mutation / workspace action，**不建议纳入第一版 unified intent**。

## 7.2 路由决策表

| 入口 | 条件 | ResolvedHomeIntent |
|---|---|---|
| 输入框提问 | 新线程或无上文依赖 | `ASK + NEW` |
| 输入框提问 | 有 thread 上下文，问题引用上文 | `ASK + FOLLOW_UP` |
| 输入框提问 | 语义是“生成图表给我”且绑定 source response | `CHART + FOLLOW_UP` |
| 输入框提问 | 语义偏分析建议/补充说明 | `GENERAL_HELP` |
| 输入框提问 | 产品使用帮助 | `USER_GUIDE` |
| 输入框提问 | 明显无关/无效 | `MISLEADING_QUERY` |
| 点击生成图表 | 有 source response | `CHART + EXPLICIT_ACTION` |
| 点击生成推荐追问 | 当前 thread 存在 | `RECOMMEND_QUESTIONS + EXPLICIT_ACTION` |
| 点击查看图表 / 查看数据 | 已有对应 artifact | **不是新 intent，而是 artifact navigation** |

## 7.3 建议新增的入口元数据

```ts
type HomeIntentEnvelope = {
  entrypoint:
    | 'composer'
    | 'response_action'
    | 'thread_action'
    | 'workbench_action';
  intentHint?: HomeIntentKind | null;
  sourceThreadId?: number | null;
  sourceResponseId?: number | null;
  sourceWorkbenchArtifacts?: WorkbenchArtifactKind[] | null;
  preferredWorkbenchArtifact?: WorkbenchArtifactKind | null;
};
```

用途：

- `intentHint`：显式动作直接给 hint
- `sourceResponseId`：chart follow-up / explain result 时绑定哪条回答
- `sourceWorkbenchArtifacts`：说明当前 follow-up 复用的是 preview、sql 还是 chart
- `preferredWorkbenchArtifact`：为 workbench 默认打开哪个 artifact 提供建议

## 7.4 source binding 规则（必须补）

这是第一版文档最需要补全的边界规则。

建议如下：

1. **显式 chart 动作**
   - 必须有 `sourceResponseId`
   - 没有 source response 时，不允许进入 chart runtime

2. **自然语言 chart follow-up**
   - 优先绑定当前 selected response
   - 若无 selected response，则取最近一个具备 `preview/sql` 的 response
   - 若仍无可绑定 source，则降级为 `GENERAL_HELP` 或 clarification，而不是盲目进 chart runtime

3. **查看图表 / 查看数据**
   - 如果对应 artifact 已存在，只做 navigation，不创建新任务

4. **运行中任务去重**
   - 已存在运行中的同类 chart task 时，优先复用 / 聚焦，而不是重复新建
   - recommendation 同理

5. **workbench 已打开时的切换**
   - 若右侧 workbench 已打开，点击另一条 response 的 teaser，不应先关闭再重开
   - 应保持 workbench 打开，仅切换 `selectedResponseId + activeWorkbenchArtifact`

---

## 8. Response、artifact 与 workbench 语义

## 8.1 哪些 intent 应创建独立 response

| kind | 是否创建 response | 说明 |
|---|---|---|
| `ASK` | 是 | 标准主回答或 follow-up 回答 |
| `CHART` | 当前分支已是 | 当前已经创建独立 `CHART_FOLLOWUP` response，并通过 `sourceResponseId` 保留来源关系 |
| `RECOMMEND_QUESTIONS` | 否 | thread 级 sidecar，不是正式回答 |
| `GENERAL_HELP` | 是 | 一般帮助型回答 |
| `USER_GUIDE` | 是 | 产品帮助型回答 |
| `MISLEADING_QUERY` | 是 | 无效/离题提示回答 |

## 8.2 artifact teaser 与 full viewer 应分开建模

商业版更接近：

- 左侧 response 内有轻量 artifact teaser card
- 右侧 workbench 展示当前激活 artifact 的完整 viewer

因此建议对每条 response 补充：

```ts
type ResponseArtifactState = {
  teaserArtifacts: InlineArtifactKind[];
  workbenchArtifacts: WorkbenchArtifactKind[];
  primaryTeaser?: InlineArtifactKind | null;
  primaryWorkbenchArtifact?: WorkbenchArtifactKind | null;
};
```

左侧负责：

- 告诉用户“这条回答产出了什么”
- 提供 `View data / View chart` 等入口

右侧负责：

- 展示完整数据表
- 展示 SQL
- 展示完整图表与交互

并且应明确：

- ask response 默认只出现 `Data preview` teaser；
- chart response 默认只出现 `Chart` teaser；
- SQL 默认不做 teaser，只在右侧 workbench 里作为 tab 出现。

## 8.3 chart response 需要 artifact lineage

从商业版目标态看，chart follow-up response 在右侧往往能同时查看：

- chart response 自己的 `Chart`
- 以及 source response 派生或继承来的 `Data Preview / SQL Query`

因此建议显式引入 lineage，而不是只靠页面临时猜：

```ts
type ResponseArtifactLineage = {
  sourceResponseId?: number | null;
  inheritedWorkbenchArtifacts?: Array<'preview' | 'sql'>;
};
```

推荐规则：

- chart response 自己拥有 `chart`
- chart response 可通过 lineage 继承 source response 的 `preview/sql`
- workbench 在 selected response 为 chart response 时，标题与操作上下文仍绑定 **chart response 本身**，而不是 source response

## 8.4 activeWorkbenchArtifact / workbench state 需要单独状态模型

建议页面级再补：

```ts
type ThreadWorkbenchState = {
  selectedResponseId?: number | null;
  activeWorkbenchArtifact?: WorkbenchArtifactKind | null;
  open: boolean;
  source: 'auto' | 'user' | 'restored';
};
```

原因：

- response 被选中，不等于 right pane 一定要打开；
- `chart`、`preview`、`sql` 需要独立激活；
- replay 进入页面时，可能不应该强制恢复到 live conversation 的自动展开态。

## 8.4A Header action owner resolution 不能一律绑定 `selectedResponse`

Cloud patch 之后，`Spreadsheet` 虽然归类成 header action，但它操作的对象仍需要按 **artifact owner** 解析，而不是简单绑定当前 `selectedResponse`。

更合理的规则是：

- `pin_dashboard` → 当前 **selected chart response**
- `open_spreadsheet` → 当前 **preview artifact owner response**
- `copy_sql` / `adjust_sql` → 当前 **sql artifact owner response**
- `close` → workbench 容器自身

并补两条约束：

1. 如果当前 active artifact 没有对应 owner，就隐藏或 disable 该 action；
2. header action 的可见性与行为，应优先消费 lineage / owner 解析结果，而不是一律消费 `selectedResponseId`。

## 8.5 suggested/contextual follow-ups 属于 conversation aid，不参与 activeWorkbenchArtifact

根据商业版截图、2026-04-22 Cloud 新线程实测与当前代码，更合理的抽象是：

- suggested/contextual follow-ups 显示在左下区域；
- **第一层优先是 response-scoped contextual aids**，例如 `生成一张图表给我`、`推荐几个问题给我`、chart refine chips；
- thread-level aids 仍可存在，但更适合作为第二层结果（例如 recommendation result list）；
- 它们都不进入 workbench；
- 都不参与 `activeWorkbenchArtifact` 计算；
- 它们的默认交互建议统一为 **`draft-to-composer`**，而不是直接执行。

## 8.5A recommendation 应允许 thread-scoped runtime，但 presentation owner 必须 response-scoped

`RECOMMEND_QUESTIONS` 的 runtime 第一版仍可以保留 thread 级轮询 / sidecar 输出，但展示 owner 需要继续绑定触发它的那条 response。

建议明确：

- runtime 可以 thread-scoped；
- presentation owner 必须 response-scoped；
- trigger 发起时必须记录 `sourceResponseId`；
- 新一轮 ask / chart 不应把旧 recommendation result 迁移到新的 response；
- replay / refresh 后，如果结果仍存在，应恢复回原 owner response。

这样才能和当前 `recommendedQuestionsOwnerThreadId / recommendedQuestionsOwnerResponseId` 这一组现有代码语义保持一致。

---

## 9. 与 thinking steps / 页面交互的关系

## 9.1 与 `ask-chart-thinking-steps-contract` 的关系

统一 intent 是 thinking steps 的上游：

- `ASK` → ask steps
- `CHART` → chart follow-up 9 steps
- `RECOMMEND_QUESTIONS` → recommendation steps（后续可补）

因此 thinking steps 不应自己猜当前是哪类动作，而应消费 resolved intent。

## 9.1A thinking steps 的数据契约与 UI 行为应拆开

除了 step sequence，本方案还需要把 UI 行为约束写清楚：

- 默认 **折叠优先**，不要让每条 response 默认展开全部 steps；
- live / streaming 场景下可以逐步更新 step 状态，但不要求每次都自动展开；
- replay / revisit 时优先恢复 steps 数据本身，不强制恢复当时的展开态；
- ask follow-up 与 chart follow-up 的 steps 样式应尽量一致，只在标签 / 状态上体现 intent 差异。

也就是说，thinking steps 的 **data contract** 与 **panel open state** 应分离。

## 9.2 与 `chart-followup-page-interaction-checklist` 的关系

页面交互文档应消费以下信息：

- `ResolvedHomeIntent`
- `artifactPlan`
- `conversationAidPlan`
- `selectedResponseId`
- `activeWorkbenchArtifact`
- `workbench open policy`

而不应直接耦合某个旧 REST/GraphQL 接口名字。

## 9.3 对商业版目标态的抽象

基于商业版实时会话截图，更好的抽象是：

- **左侧**：问题、thinking、文本回答、artifact teaser card
- **右侧**：当前 artifact 的 full viewer
- **live conversation**：当 `primaryWorkbenchArtifact` ready 时，可自动展开 workbench
- **replay conversation**：若无恢复态，可默认收起 workbench，直到用户点击 artifact teaser
- **conditional tabs**：workbench 只渲染当前 selected response 实际可用的 artifacts，而不是永远固定三栏

这个规则不属于 intent 本身，但属于 intent 驱动下的 presentation policy。

---

## 10. 实施建议

## Phase A：补统一 contract，不重写 runtime（当前状态：部分落地，artifact/workbench contract 已先落在前端）

建议事项：

- [x] 新增 `HomeIntentKind / HomeIntentMode / HomeResultTarget / InlineArtifactKind / WorkbenchArtifactKind / ThreadConversationAidKind`
- [x] 新增 `ResolvedHomeIntent` 与 `HomeIntentEnvelope`
- [x] 服务端实现统一 `resolveHomeIntent(...)`
- [x] response / thread sidecar 记录 resolved intent 与 artifact plan

此阶段不要求：

- 重写 AI ask classifier
- 重写 chart runtime
- 改动推荐追问存储模型

## Phase B：把自然语言 follow-up / 生成图表纳入统一路由（当前状态：chart follow-up 主路径已落地，draft metadata 仍待补）

建议事项：

- [ ] composer 提交时支持 `draftPrompt + intentHint + sourceResponseId`
- [x] 自然语言 chart follow-up 可绑定 source response
- [x] ask runtime 输出通过 adapter 映射到 `ASK + NEW/FOLLOW_UP`
- [x] recommendation runtime 输出映射到 `RECOMMEND_QUESTIONS`
- [x] “查看图表 / 查看数据” 统一收敛为 artifact navigation，而不是误建新 intent

## Phase C：驱动 artifact 与 workbench 收口（当前状态：dual-surface 主体已落地，恢复态/i18n 仍待补）

建议事项：

- [x] response 产出 artifact teaser state
- [x] 页面维护 `activeWorkbenchArtifact / workbenchState`
- [x] chart response 独立化
- [x] ask/chart thinking steps 读取 resolved intent
- [x] 新增 artifact teaser / workbench 标题与动作文案纳入 i18n，而不是在页面层硬编码
- [ ] `responseAids / headerActions` 第一版继续以 read-time derive 为主，而不是立即持久化迁移
- [ ] header actions 基于 artifact owner 解析，而不是一律绑定 `selectedResponse`

---

## 11. 非目标

这份方案当前**不包含**：

1. 把所有 mutation 都塞进 unified intent
   - 例如 pin dashboard、rename dashboard、cache schedule
2. 强制 ask / chart / recommendation 共用一个 LLM classifier
3. 一次性重写 `thread_response` 全模型
4. 在第一版就定义所有未来系统动作

第一版先把 Home 分析主路径统一即可。

---

## 12. 推荐的落地顺序

建议顺序：

1. **先补统一 intent + artifact contract**（本文）
2. **再推进 ask/chart thinking steps 契约**
3. **再推进 chart follow-up 页面交互与独立 response**

原因：

- 先有 resolved intent，steps 才知道自己属于哪条链路；
- 先有 artifact plan，页面 workbench 才知道默认该看什么；
- 这样可以避免“先做 UI，再回头硬补语义层”。

---

## 13. 当前方案是否合理、是否最优

基于当前代码与商业版目标态，结论是：

- **需要统一 intent：成立。**
- **应该与页面交互文档分开：成立。**
- **但 canonical 方案不应只是平面 enum，而应升级为 `kind + mode + target + artifactPlan`：成立。**
- **最佳抽象不是 thread-first 或 workbench-first 二选一，而是 dual-surface artifact-driven：成立。**
- **resolved intent 只负责语义路由与 artifact contract，不负责持久化“当前 workbench 是否展开”这类纯页面态：成立。**
- **chart follow-up 最优做法不是复制一份 preview/sql，而是通过 `sourceResponseId + lineage` 复用 source response 的 workbench artifacts：成立。**
