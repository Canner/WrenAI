# Cloud Home 交互对齐版设计文档 Patch（2026-04-22）

> 关联文档：
> - `docs/home-unified-intent-routing-architecture-2026-04-21.md`
> - `docs/chart-followup-page-interaction-checklist-2026-04-21.md`
> - `docs/chart-followup-commercial-reference-and-implementation-plan-2026-04-21.md`
> - `docs/ask-chart-thinking-steps-contract-draft-2026-04-21.md`
>
> 关联代码：
> - `wren-ui/src/features/home/thread/homeIntentContract.ts`
> - `wren-ui/src/features/home/thread/homeIntentRouting.ts`
> - `wren-ui/src/features/home/thread/routes/HomeThreadPage.tsx`
> - `wren-ui/src/features/home/thread/components/ThreadWorkbench.tsx`
> - `wren-ui/src/features/home/thread/components/ThreadWorkbenchHeaderActions.tsx`
> - `wren-ui/src/components/pages/home/promptThread/AnswerResult.tsx`
> - `wren-ui/src/features/home/thread/useThreadRecommendedQuestionsAction.ts`
> - `wren-ui/src/server/services/askingServiceRecommendationActions.ts`
> - `wren-ui/src/server/api/threadPayloadSerializers.ts`
>
> 证据来源：
> - 2026-04-22 使用 Playwright 登录态实测 Cloud：`https://cloud.getwren.ai/projects/15008/home/26899`
> - 同轮实测截图：`new-thread-ask-finished.png`、`cloud-after-view-chart.png`、`cloud-thread-full.png`

---

## 0. 这份 patch 要解决什么

2026-04-22 的 Playwright 新线程实测表明：当前仓库在 **dual-surface 主干** 上已经接近 Cloud，但在 **对话辅助层（contextual follow-ups / recommendation trigger / workbench header affordance）** 上还没有 1:1 对齐。

这份 patch 的目标不是推翻现有 `ResolvedHomeIntent + dual-surface + CHART_FOLLOWUP response`，而是把下列差异补成新的目标态：

1. **Ask / follow-up 结果后的底部推荐，不应先自动展开完整推荐问题列表，而应先展示 contextual trigger chips。**
2. **Ask response 不应默认在正文中展示 chart teaser card；chart 入口应主要通过底部 chips 暴露。**
3. **Chip 的默认交互应统一为 `draft-to-composer`，而不是直接执行。**
4. **Workbench 需要补 `Spreadsheet` 这一类 header action，但不应误建模成第四个 artifact tab。**
5. **conversation aid 需要从 thread-level 单层模型升级为 response-scoped contextual aid + thread-level aid 双层模型。**

一句话概括：

> 现阶段最该对齐的不是双栏骨架，而是 **preview-first + latest-response-driven + response-scoped chips + draft-to-composer** 这一整层交互语义。

---

## 1. Cloud 新线程实测结论（2026-04-22）

## 1.1 已验证行为

以下行为已通过新线程 `26899` 实测确认：

### A. 首问（ask / new）

问题：
- `Which are the top 3 cities with the highest number of orders?`

Cloud 行为：
- 左侧生成一条 ask response；
- ask response 展示：
  - user question
  - thinking steps
  - text answer
  - `Data preview` teaser + `View data`
- **右侧 workbench 会在结果 ready 后自动打开**；
- 默认右侧聚焦 `Data Preview`；
- 右侧 header 有 `Spreadsheet` 按钮；
- 底部 contextual chips 为：
  - `生成一张图表给我`
  - `推荐几个问题给我`

### B. 一次追问 / 多次追问（ask / follow-up）

问题：
- `What is the total order count for the top 5 cities?`
- `Can you also show the share of each city within this top 5 total?`

Cloud 行为：
- 每次 follow-up 都是 **新的 ask response**；
- 不是覆盖上一条 response；
- 右侧 workbench 会跟随切到 **最新 response**；
- 默认仍然是 preview-first；
- 底部 contextual chips 仍为：
  - `生成一张图表给我`
  - `推荐几个问题给我`

### C. 生成图表（chart follow-up）

操作：
- 点击底部 chip `生成一张图表给我`
- 观察到该文案先被写入 composer
- 再点击 send 发送

Cloud 行为：
- 创建 **独立 chart response**；
- 该 chart response 的问题显示为用户刚提交的 follow-up；
- 右侧 workbench 自动切到这条 chart response；
- 默认聚焦 `Chart`；
- tabs 为：
  - `Data Preview`
  - `SQL Query`
  - `Chart`
- header 仍有 `Spreadsheet`；
- Chart 激活时有 `Pin to dashboard`；
- chart response 底部 contextual chips 会切换为 **chart-type-aware refine suggestions**；
- 本次 BAR chart 场景下的示例 chips 为：
  - `为柱状图添加标签`
  - `仅显示前 ... 个柱子`
  - `将标题重命名为 ...`
  - `推荐几个问题给我`

### D. 推荐问题 trigger 行为

额外验证：
- 点击 `推荐几个问题给我`
- Cloud 会先把该文案写入 composer
- **不会自动提交**

这说明 Cloud 至少在本轮实测里，推荐问题 chip 属于：
- `draft-to-composer`
- 而不是 `one-click execute`

## 1.2 已验证 / 未验证边界

### 已验证

- ask 结果后 workbench 自动打开；
- latest response 驱动右侧 workbench；
- chart follow-up 是独立 response；
- chart response 继承 `Data Preview / SQL Query / Chart` 三类右侧结果面板；
- `生成一张图表给我` / `推荐几个问题给我` 这类 chips 至少支持 `draft-to-composer`；
- `Spreadsheet` 存在于 workbench header，而不是 tab strip 内。

### 未完全验证（仍需后续一次专项验证）

- chart-specific chips（如 `为柱状图添加标签`）提交后，是创建新 response，还是 mutate 当前 chart response；
- `Spreadsheet` 点击后是打开全页表格视图、下载、还是外跳到另一种 grid/workbench 模式；
- recommendation trigger 提交后，Cloud 是展示推荐问题 sidecar，还是创建推荐类 response。

因此，本 patch 中涉及这三点的地方，会明确区分：
- **已验证结论**
- **目标态建议**
- **待补充验证项**

---

## 2. 对现有文档的 patch 结论

## 2.1 对 `home-unified-intent-routing-architecture` 的 patch

原方案方向正确：
- `intent-first + artifact-driven + dual-surface presentation` 仍成立；
- `CHART` 是独立 response 仍成立；
- `View data / View chart` 属于 artifact navigation 仍成立；
- `selectedResponse + activeWorkbenchArtifact + openState` 仍是页面层核心状态。

但需要补 4 个关键 patch：

### Patch A：conversation aid 不能只建模为 thread-level suggested questions

当前文档更接近：
- `conversationAidPlan.threadAids = ['suggested_questions']`

需要升级为：
- **response-scoped contextual aids**
- **thread-level aids**

因为 Cloud 实测中，底部 chips 明显绑定的是“当前 response 的下一步动作”，而不是 thread 全局静态推荐。

### Patch B：Ask response 的 chart 入口应优先建模为 contextual trigger，而不是 teaser artifact

当前文档和代码都把 ask 结果里的 chart 入口部分建模成 `chart_teaser`。Cloud 实测更像：
- ask body 内只有 `Data preview` teaser
- chart 入口在底部 chips：`生成一张图表给我`

因此：
- `chart_teaser` 应主要属于 `CHART` response
- ask response 默认不展示 chart teaser

### Patch C：需要显式引入 chip interaction policy

现有文档只描述了“推荐追问 / 生成图表”这些能力，但没有定义：
- 点击 chip 后是立即执行
- 还是先填 composer

Cloud 新线程实测给出的更强约束是：
- 默认先 `draft-to-composer`
- 真正执行以用户 send 为准

### Patch D：`Spreadsheet` 应是 header action，不是第四个 artifact tab

当前 canonical artifact 只有：
- `preview`
- `sql`
- `chart`

Cloud 实测并不要求把 `Spreadsheet` 扩成第四个 tab；更合理的抽象是：
- `Spreadsheet` 是 **workbench header action**
- 与 `Pin to dashboard` 一样属于当前 selected response / active artifact 的结果操作层

---

## 2.2 对 `chart-followup-page-interaction-checklist` 的 patch

这份 checklist 在骨架上基本正确，但需要补 3 个修正：

### Patch A：Ask body 的 artifact teaser policy 要改

建议从：
- ask response 可有 `Data preview` teaser
- ask response 可有 chart 相关入口

收敛为：
- ask response 默认只有 `Data preview` teaser
- chart 入口主要通过底部 contextual chips 提供
- chart teaser 默认只属于 chart response

### Patch B：左下区域不只是“推荐追问”，而是“contextual follow-ups”

Cloud 底部 chips 不只是推荐问题，还包含：
- chart trigger
- chart refine trigger
- recommend trigger

因此 checklist 里的左下区应改名为更宽的：
- `contextual follow-ups`
- 或 `conversation aids`

### Patch C：workbench header affordance 需要显式纳入页面交互规则

需要把以下内容加入 checklist：
- `Spreadsheet` 为 header action
- `Pin to dashboard` 为 chart-active 时的 header action
- 这些 action 不属于 tab，也不属于 teaser card

---

## 3. 对现有实现的差异判断

## 3.1 已经接近 Cloud 的部分（应保留）

以下实现不应推倒重来：

1. **latest response 驱动右侧 workbench**
   - `wren-ui/src/features/home/thread/routes/HomeThreadPage.tsx`
2. **chart-only composer question 可解析为 chart follow-up**
   - `wren-ui/src/features/home/thread/homeIntentRouting.ts`
3. **chart follow-up 是独立 response，并绑定 `sourceResponseId`**
   - `wren-ui/src/features/home/thread/useThreadResponseMutationActions.ts`
4. **chart response 可继承 source response 的 preview/sql lineage**
   - `wren-ui/src/features/home/thread/homeIntentContract.ts`
5. **右侧 tabs 依据当前 selected response 条件渲染**
   - `wren-ui/src/features/home/thread/components/ThreadWorkbench.tsx`

结论：

> 主干架构不需要重做；对齐重点应放在 `teaser policy + conversation aid + header actions`。

## 3.2 当前实现中最偏离 Cloud 的部分（应优先修正）

### A. Ask response 当前会出现 chart teaser

当前实现里：
- `ASK` 默认 artifact plan 包含 `chart_teaser`
- ask result body 也会渲染 chart teaser card

这会让 ask response 比 Cloud 多出一个“卡片化 chart 入口”，与 Cloud 的 chips-first 方案不一致。

### B. 推荐问题当前会自动触发

当前实现会在 answer 准备后自动触发推荐问题生成。Cloud 新线程实测中，第一层看到的是：
- `推荐几个问题给我`

也就是先 trigger，不是先自动展开结果。

### C. 当前缺 `Spreadsheet` header action 模型

现有 workbench 只建模了：
- tab 内容
- preview/sql/chart 的 header 按钮

但没有把 `Spreadsheet` 这类 Cloud header affordance 纳入统一模型。

---

## 4. 新的目标态交互模型

## 4.1 Ask / follow-up / multi-follow-up

### Ask NEW

- 创建 ask response；
- 左侧展示：thinking、text answer、`Data preview` teaser；
- 若 preview/sql ready，则右侧自动打开；
- 默认聚焦 `Data Preview`；
- 底部 contextual chips：
  - `生成一张图表给我`
  - `推荐几个问题给我`

### Ask FOLLOW_UP

- 创建新的 ask response；
- 不覆盖历史 response；
- 最新 response 成为当前 selected response；
- 右侧切到最新 response 的 primary artifact；
- 底部 contextual chips 重新绑定到最新 response。

### Ask MULTI_FOLLOW_UP

- 与单次 follow-up 相同；
- 规则核心不是“第几次追问”，而是：
  - **最新 response 拥有当前 workbench 与当前 contextual chips**。

## 4.2 Chart follow-up

- chart follow-up 始终是独立 response；
- source 绑定当前 selected response，或最近一个可绑定 `preview/sql` 的 response；
- chart response 自己拥有 `chart` artifact；
- chart response 通过 lineage 继承 `preview/sql`；
- chart response ready 后，右侧默认聚焦 `Chart`；
- chart response 底部 contextual chips 切换为 chart-specific follow-ups。

## 4.3 Recommendation trigger

- recommendation 在第一层不再自动展开；
- 先通过 chip `推荐几个问题给我` 触发；
- chip 默认只把 prompt 写入 composer；
- 用户 send 后，再进入 recommendation 流程。

---

## 5. Canonical contract patch（建议更新）

## 5.1 artifact contract patch

当前保持：

```ts
export type WorkbenchArtifactKind = 'preview' | 'sql' | 'chart';
```

不建议在本 patch 的第一步把 `Spreadsheet` 直接加入 `WorkbenchArtifactKind`。

建议新增：

```ts
export type WorkbenchHeaderActionKind =
  | 'open_spreadsheet'
  | 'pin_dashboard'
  | 'copy_sql'
  | 'adjust_sql'
  | 'close';
```

原因：
- Cloud 实测中 `Spreadsheet` 更像 header affordance，不像 tab；
- 现阶段没有证据证明它应被视作独立 artifact；
- 先把它放在 header actions 层，更符合 Cloud 交互事实，也更可逆。

## 5.2 conversation aid contract patch

建议把原本只有 threadAids 的模型，升级为：

```ts
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
```

并将 `ResolvedHomeIntent` 中的：

```ts
conversationAidPlan?: {
  threadAids: ThreadConversationAidKind[];
} | null;
```

升级为：

```ts
conversationAidPlan?: ConversationAidPlan | null;
```

## 5.3 Ask / Chart 默认 plan patch

### ASK

建议默认：

```ts
artifactPlan: {
  teaserArtifacts: ['preview_teaser'],
  workbenchArtifacts: ['preview', 'sql'],
  primaryTeaser: 'preview_teaser',
  primaryWorkbenchArtifact: 'preview',
}
conversationAidPlan: {
  responseAids: [
    {
      kind: 'TRIGGER_CHART_FOLLOWUP',
      label: '生成一张图表给我',
      prompt: '生成一张图表给我',
      interactionMode: 'draft_to_composer',
      suggestedIntent: 'CHART',
    },
    {
      kind: 'TRIGGER_RECOMMEND_QUESTIONS',
      label: '推荐几个问题给我',
      prompt: '推荐几个问题给我',
      interactionMode: 'draft_to_composer',
      suggestedIntent: 'RECOMMEND_QUESTIONS',
    },
  ],
}
```

### CHART

建议默认：

```ts
artifactPlan: {
  teaserArtifacts: ['chart_teaser'],
  workbenchArtifacts: ['chart', 'preview', 'sql'],
  primaryTeaser: 'chart_teaser',
  primaryWorkbenchArtifact: 'chart',
}
conversationAidPlan: {
  responseAids: [
    {
      kind: 'TRIGGER_CHART_REFINE',
      label: '<dynamic chart refine suggestion>',
      prompt: '<dynamic chart refine suggestion>',
      interactionMode: 'draft_to_composer',
      suggestedIntent: 'CHART',
    },
    {
      kind: 'TRIGGER_RECOMMEND_QUESTIONS',
      label: '推荐几个问题给我',
      prompt: '推荐几个问题给我',
      interactionMode: 'draft_to_composer',
      suggestedIntent: 'RECOMMEND_QUESTIONS',
    },
  ],
}
```

注意：
- chart-specific chips 不应被写死成固定文案清单，更合理的抽象是 **chart-type-aware dynamic aids** 或 templated / AI-generated refine aids；
- 本轮 BAR chart 实测中的 `为柱状图添加标签 / 仅显示前 ... 个柱子 / 将标题重命名为 ...` 应视为 **示例**，不是 canonical default；
- chart-specific chips 是否最终创建新 response，还是 mutate 当前 chart response，当前仍需额外验证；
- 因此这里建议只把它们统一建模为 **draft-to-composer 的 follow-up trigger**，不要先把执行落点写死。

---

## 5.4 Composer Draft Intent Contract

`draft-to-composer` 要成立，不能只把 chip 文案写进输入框；还必须同时写一份 **draft metadata**，否则当前 `resolveComposerIntent(...)` 只会把内容稳定路由成：

- 普通 `ASK`
- 或 regex 命中的 `CHART`

而像 `推荐几个问题给我`、`为柱状图添加标签`、`仅显示前 ... 个柱子` 这类 chip，在只传文本时，大概率都会被误判成普通 ask。

建议新增一个页面级 draft contract：

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

也可以命名为 `DraftedAidEnvelope`，但关键点不在名称，而在下面 4 条规则：

1. **点击 chip 时，写入的是 `prompt + draft metadata`，而不是只有文本。**
2. 提交时，如果用户仍在发送这份 draft，且只做了轻微编辑：
   - 优先走 `intentHint`
   - 带上 `sourceResponseId`
   - 不再退回普通 regex / parser。
3. 如果用户把文本改得很不一样，或清空重写：
   - 退回普通 `resolveComposerIntent(...)` 重新判定。
4. 这份 draft state 应该是 **页面态 / composer 态**，不是 thread response 持久化字段。

建议的第一版接线方式：

- `AnswerResult` / contextual chips 点击时写入 `ComposerDraftIntent`
- `HomeThreadPage` 提交时把 `draftIntent` 一并传给 `resolveComposerIntent(...)`
- `resolveComposerIntent(...)` 先消费 draft，再回退到现有 parser / regex

这样才能保证：

- `推荐几个问题给我` → `RECOMMEND_QUESTIONS`
- `为柱状图添加标签` → chart refine follow-up
- `仅显示前 ... 个柱子` → chart refine follow-up

而不是因为用了 draft-to-composer，就全部退化成普通 ask。

## 5.5 `responseAids` 第一版建议 derive at read-time，而不是立即持久化

虽然 `conversationAidPlan` 在 canonical model 中是合理的，但结合当前代码与这批信息的性质，第一版更建议：

- 先扩 `types/homeIntent.ts`
- 在 `homeIntentContract.ts` 推导 `responseAids` / `headerActions`
- 在 `threadPayloadSerializers.ts` 返回 payload 时补齐
- 前端先消费这一层 contract

先不要急着：

- 改 repository schema
- 改历史数据
- 做 migration

原因：

- 这批 aid 本质上是 **展示性、可派生信息**；
- 先 read-time derive 更轻、更可逆；
- 等 chips / owner / replay 规则稳定后，再决定是否需要持久化。

## 6. 页面交互规则 patch

## 6.1 teaser policy

### Ask response

- 默认仅渲染 `preview_teaser`
- 不默认渲染 `chart_teaser`

### Chart response

- 默认渲染 `chart_teaser`
- 失败态仍可保留 teaser card，但 CTA / 文案要切换为 regenerate 或 failed explanation

## 6.2 bottom aids policy

每条 selected response 的底部区域，应优先展示：
- `conversationAidPlan.responseAids`

而不是仅展示：
- `RecommendedQuestions` 结果卡

换句话说：
- **Cloud 的第一层是 trigger chips**
- **不是自动铺开的 recommendation result list**

## 6.3 chip interaction policy

建议新增统一规则：

- 默认 `responseAids` 点击后：
  - 写入 composer
  - 不直接执行
- 只有用户 send 后：
  - 才进入 ask / chart / recommendation runtime

这条规则适用于：
- ask 后的 chart trigger
- ask 后的 recommend trigger
- chart 后的 refine trigger

## 6.4 workbench header policy

建议把 header actions 分为两层：

### 通用 actions
- `close`

### artifact-specific actions
- preview：`open_spreadsheet`（待确认具体跳转目标）
- sql：`copy_sql`、`adjust_sql`
- chart：`open_spreadsheet`、`pin_dashboard`

其中：
- `Spreadsheet` 的信息架构优先归类为 header action
- 不进入 tab strip
- 不进入 teaser card

---

## 6.5 Response Aid Render Policy

response-scoped aids 要落地，必须先定义 **哪些 response 显示 chips**，否则实现时会在“每条历史消息都展开”与“只显示当前一条”之间摇摆。

建议第一版规则：

1. 默认只在 **latest completed response** 上显示 contextual aids。
2. 当用户主动点选历史 response 时，可以切换显示该 response 自己的 aids。
3. 不要让每条历史消息都永久展开 chips，避免页面过密。
4. pending / streaming response 在未形成稳定 artifact 前，不默认展示完整 aids。
5. 同一时刻只高亮一组 aids：
   - latest completed response
   - 或当前 selected historical response

一句话：

> presentation 可以 latest-first，但 owner 仍然必须 response-scoped。

## 6.6 Recommendation Ownership / Replay Policy

当前文档里 recommendation 已被收敛成“trigger-first, result-second”，但还需要进一步明确：

> **runtime 可以 thread-scoped，但 presentation owner 必须 response-scoped。**

也就是说：

- recommendation task 可以继续沿用 thread 级 runtime / polling；
- 但 recommendation result 的展示 owner 必须带 `sourceResponseId`；
- 这与当前代码中的：
  - `recommendedQuestionsOwnerThreadId`
  - `recommendedQuestionsOwnerResponseId`
  是一致的。

建议明确 5 条规则：

1. recommendation trigger 由某条 response 发起时，必须记录 `sourceResponseId`。
2. result list 即使 runtime thread-scoped，展示时仍挂回对应 owner response。
3. 用户切到别的 response，不应把旧 recommendation result 迁移到新 response。
4. 新一轮 ask 产生后，旧 recommendation result 仍属于原 owner response，除非新的 trigger 明确覆盖。
5. replay / refresh 后，如果 recommendation result 已存在，仍应恢复到原 owner response。

这样才能避免后面出现：

- 切到别的 response，推荐列表要不要跟着跑？
- 新问一轮后，旧推荐列表显示在哪？
- replay 时推荐结果是不是丢失？

## 6.7 Header Action Owner Resolution

`Spreadsheet` 被定义成 header action 之后，还必须继续定义：

> 它操作的是当前 `selectedResponse`，还是当前 `artifact owner response`？

对于 chart follow-up，这个差异非常关键，因为当前代码已经有 artifact lineage / owner 解析：

- chart response 自己拥有 `chart`
- preview / sql 可能继承自 source response

因此 header actions 的 owner 解析建议明确为：

- `pin_dashboard` → 当前 **selected chart response**
- `open_spreadsheet` → 当前 **preview artifact owner response**
- `copy_sql` / `adjust_sql` → 当前 **sql artifact owner response**
- `close` → workbench 容器自身，不依赖 owner

同时建议补两条 UI 规则：

1. 如果当前 active artifact 没有对应 owner，就隐藏或 disable 该 action。
2. header actions 的可见性与行为，应优先基于 **artifact owner** 解析，而不是一律绑定 `selectedResponse`。

## 7. Recommendation 流程 patch

## 7.1 不再默认自动触发推荐问题生成

建议撤销当前“answer 完成后自动触发 recommendation polling”的默认策略。

原因：
- 这会让本地实现先展开结果，再给 trigger；
- 与 Cloud 先 trigger、后执行的交互顺序不一致。

## 7.2 Recommendation 改成两段式

### 第一段：trigger
- ask/chart response 底部出现 `推荐几个问题给我`
- 点击后写入 composer

### 第二段：runtime
- 用户 send 后，进入 `RECOMMEND_QUESTIONS`
- 再决定展示：
  - thread-level result list
  - 或 response-bound recommendation panel

### 当前建议
在 Cloud 还未进一步专项验证前，先保留：
- `RECOMMEND_QUESTIONS` 仍落在 thread sidecar

但展示顺序改为：
- **trigger first**
- **result list second**

---

## 8. Thinking steps patch

## 8.1 Ask thinking steps

当前 docs 中对 ask thinking steps 的目标顺序可以保留，但需要新增一条说明：

- 对于 follow-up ask，Cloud 实测中有时会在 intent 之前出现一次 data fetch 相关步骤；
- 因此 ask thinking steps 更适合作为 **phase-constrained sequence**，而不是唯一刚性顺序。

也就是说：
- 可以约束 ask steps 的组成与阶段含义；
- 但不应假设所有 NEW / FOLLOW_UP / replay 变体都严格一模一样。

## 8.2 Chart thinking steps

chart thinking steps 当前目标态基本仍成立：
- preview data fetched
- chart intent detected
- chart type selected
- chart generated
- chart validated

这部分无需因为本次 patch 推翻。

## 8.3 Thinking steps 的 UI 行为也需要同步写清楚

既然这份文档是 interaction alignment patch，就不应只写 step sequence，还应补齐 UI 行为约束：

- 默认应保持 **折叠优先**，避免每条 response 默认展开全部 steps；
- live / streaming 场景下，steps 可以逐步更新，但不要求每次都把整个面板自动展开；
- replay / revisit 时，优先恢复 steps 数据本身，不强制恢复用户当时的展开态；
- ask follow-up 与 chart follow-up 的 steps 样式应尽量一致，只在标签/状态上体现 intent 差异。

也就是说：

> thinking steps 的数据契约与 UI 展开态应分离；前者可稳定返回，后者优先保持页面级轻状态。

## 8.4 i18n / message catalog 约束

本 patch 新增的大量用户可见文案，都不应直接硬编码在页面里。至少以下内容必须进入现有 i18n / message catalog：

- contextual chips
- `Spreadsheet`
- recommendation trigger 文案
- chart refine trigger 文案
- 相关失败态 / disabled 态说明

结合当前代码，第一版可继续沿用类似 `threadWorkbenchMessages.ts` 的 message surface；无论最终落在哪个 catalog，规则应明确为：

> 本 patch 新增的任何用户可见 chips / header action / 失败态文案，都必须进入 i18n。

---

## 9. 推荐落地顺序（对齐 Cloud 的最小改动路径）

## Phase 1：先对齐交互，不改主干架构

目标：最低成本贴近 Cloud 新线程体验。

建议事项：
- ask response 去掉默认 `chart_teaser`
- selected response 底部新增 `contextual follow-up chips`
- chips 默认统一为 `draft-to-composer`
- 补 `ComposerDraftIntent`，确保 draft-to-composer 不会把 recommendation / chart refine 误路由成普通 ask
- 停止 answer 完成后自动生成推荐问题
- workbench header 补 `Spreadsheet` action

## Phase 2：补 canonical contract

建议事项：
- 为 `ResolvedHomeIntent` 补 `responseAids`
- 为 workbench 补 `WorkbenchHeaderActionKind`
- ask / chart 的默认 `conversationAidPlan` 输出改成 response-scoped

## Phase 3：补 chart refine 专项路由

建议事项：
- 定义 chart refine follow-up 的 resolved intent / runtime entry
- 再决定 refine 是：
  - 新 response
  - 还是 mutate 当前 chart response

这个阶段应以追加一次 Cloud 实测为前提，不建议在证据不足时先写死。

---

## 10. Patch 后的验收标准

### A. Ask / follow-up
- [ ] ask / follow-up 结果 ready 后，右侧 workbench 自动跟随 latest response 打开
- [ ] ask response 左侧默认仅有 `Data preview` teaser
- [ ] ask response 底部出现 `生成一张图表给我`、`推荐几个问题给我`
- [ ] 上述 chips 点击后先写入 composer，不直接执行

### B. Chart follow-up
- [ ] `生成一张图表给我` 发送后创建独立 chart response
- [ ] chart response 默认聚焦 `Chart`
- [ ] chart response 可继承 source response 的 `preview/sql`
- [ ] chart response 底部出现 chart-specific chips

### C. Recommendation
- [ ] 推荐问题默认不再自动生成
- [ ] recommendation 先通过 chip trigger 进入 composer
- [ ] 用户 send 后才进入 recommendation runtime

### D. Workbench
- [ ] `Spreadsheet` 出现在 header actions，而不是 tabs 中
- [ ] `Pin to dashboard` 仅在 chart-active 时显示
- [ ] header actions 按 artifact owner 解析，不一律绑定 `selectedResponse`
- [ ] tabs 仍然只围绕 `preview/sql/chart` 条件渲染

## 10.1 Playwright 验收补充

最少应补 7 条交互验收：

1. ask 完成后只出现 trigger chips，不自动展开 recommendation list；
2. 点击 `生成一张图表给我` → 写入 composer，不自动发送；
3. 点击 `推荐几个问题给我` → 写入 composer，不自动发送；
4. send recommendation trigger 后，结果绑定到正确 `sourceResponseId`；
5. 选中历史 response 时，chips source 能切换正确；
6. chart 激活时显示 `Pin to dashboard`；
7. `Spreadsheet` 只在有 preview owner 时显示或可点击。

## 10.2 Telemetry 基线

至少建议新增以下埋点：

- `home_chip_exposed`
- `home_chip_clicked`
- `home_chip_draft_sent`
- `home_spreadsheet_clicked`
- `home_recommendation_generated`

每条 event 至少应带：

- `threadId`
- `sourceResponseId`
- `aidKind` / `artifactKind`
- `selectedResponseId`
- `resolvedIntentKind`

---

## 11. 最终结论

本轮 Cloud 新线程实测后的最重要结论是：

> **当前仓库与 Cloud 的主要差异，不在双栏骨架，而在 response-scoped contextual follow-ups 的产品层。**

因此，下一步的设计与实现不应再把重点放在：
- 重写 dual-surface
- 重写 chart response 独立化
- 重写 selectedResponse/workbench 主状态

而应放在：
- ask teaser policy 改成 preview-only
- chips-first 的 conversation aid 设计
- recommendation 从 auto-run 改成 trigger-first
- `Spreadsheet` 进入 header action taxonomy

这样可以在 **不推翻当前主干实现** 的前提下，把问数 / 追问 / 多次追问 / 生图 / 推荐问题这一整套 Home 交互，更快对齐到 Cloud 的真实体验。
