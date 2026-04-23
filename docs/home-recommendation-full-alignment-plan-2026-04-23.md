# Home 推荐问题全量对齐方案（2026-04-23）

> 关联文档：
> - `docs/home-unified-intent-routing-architecture-2026-04-21.md`
> - `docs/chart-followup-page-interaction-checklist-2026-04-21.md`
> - `docs/cloud-home-interaction-alignment-patch-2026-04-22.md`
>
> 关联代码：
> - `wren-ui/src/features/home/thread/homeIntentContract.ts`
> - `wren-ui/src/features/home/thread/homeIntentRouting.ts`
> - `wren-ui/src/features/home/thread/routes/HomeThreadPage.tsx`
> - `wren-ui/src/features/home/thread/useThreadRecommendedQuestionsAction.ts`
> - `wren-ui/src/components/pages/home/promptThread/AnswerResult.tsx`
> - `wren-ui/src/components/pages/home/RecommendedQuestions.tsx`
> - `wren-ui/src/server/services/askingServiceRecommendationActions.ts`
> - `wren-ui/src/server/api/threadPayloadSerializers.ts`
> - `wren-ui/src/pages/api/v1/thread-recommendation-questions/[id].ts`

---

## 0. 目标

这份文档只回答一个问题：

> **推荐问题（`推荐几个问题给我`）这一条链路，如果要和 Cloud / 商业版体验进一步对齐，最佳目标态应该是什么，以及应该怎么改。**

这里的“全量对齐”不是指把所有逻辑都塞进一个临时 sidecar，而是把推荐问题正式纳入 Home 的统一意图与对话语义层，让它在以下 4 个维度都和 ask / chart follow-up 一致：

1. **触发方式一致**：底部 chip 默认 `draft-to-composer`
2. **执行语义一致**：send 后进入明确的 intent runtime
3. **结果归属一致**：结果归属于触发它的 response，而不是漂移到 thread 全局
4. **回放与恢复一致**：刷新、重放、切换 response 后，推荐结果仍稳定挂在正确 owner 上

---

## 1. 当前实现现状

## 1.1 已实现的部分

当前仓库已经完成了推荐问题链路的第一轮 Cloud 对齐基础：

### A. 第一层 trigger 已经是 response-scoped chip

当前 ask / chart response 底部都会生成：
- `推荐几个问题给我`

对应代码：
- `wren-ui/src/features/home/thread/homeIntentContract.ts`
  - `buildAskConversationAids`
  - `buildChartConversationAids`

并且这个 chip 当前默认行为已经是：
- **先写入 composer**
- 不直接执行

这点已经和 Cloud 的新线程实测一致。

### B. composer submit 时已经有 `RECOMMEND_QUESTIONS` intent 入口

`HomeThreadPage.tsx` 中，submit 时会先走：
- `resolveComposerIntent(...)`

当识别为 `RECOMMEND_QUESTIONS` 后，会转入：
- `handleGenerateThreadRecommendedQuestions(...)`

说明推荐问题已经进入统一意图入口，而不是纯粹的散落按钮逻辑。

### C. 当前 recommendation runtime 仍然是 thread-scoped

当前真正执行推荐生成时，调用的是：
- `POST /api/v1/thread-recommendation-questions/:threadId`
- `GET /api/v1/thread-recommendation-questions/:threadId`

对应代码：
- `wren-ui/src/features/home/thread/useThreadRecommendedQuestionsAction.ts`
- `wren-ui/src/pages/api/v1/thread-recommendation-questions/[id].ts`
- `wren-ui/src/server/services/askingServiceRecommendationActions.ts`

当前服务端生成输入也仍然主要是：
- 读取 thread 最近 5 条 response
- 提取最近问题列表 `previousQuestions`
- 让 AI 生成推荐问题

### D. 当前展示是“thread-level 结果 + response-scoped owner”混合态

当前页面层已经额外补了 owner 概念：
- `recommendedQuestionsOwnerThreadId`
- `recommendedQuestionsOwnerResponseId`
- `showRecommendedQuestions`

这样做的结果是：
- **推荐结果虽然仍是 thread 级 sidecar 数据**
- 但视觉上尽量挂在某条 response 下展示

这是一种过渡态，不是最终态。

---

## 1.2 当前实现的核心问题

虽然主路径已经能工作，但距离“全量对齐”还差 5 个关键点。

### 问题 1：结果 carrier 仍然不是 first-class response

当前推荐结果没有成为 timeline 中的一种正式 response 类型，而是：
- thread 级别数据
- 页面层绑定 owner response

这会带来几个长期问题：
- replay / refresh 恢复逻辑复杂
- 多次 recommendation 容易相互覆盖
- 历史回放时很难知道“这组推荐是对哪条回答生成的”
- 无法天然进入统一 thinking / telemetry / lineage 体系

### 问题 2：推荐生成仍然偏“thread aware”，不够“response aware”

当前服务端主要输入是：
- 最近 5 个问题

但 Cloud 更合理的目标态应优先基于：
1. 触发源 response 的 question
2. 触发源 response 的 answer summary
3. 触发源 response 的 SQL / preview schema / chart metadata
4. thread history 仅作为补充上下文

也就是说，今天更像：
- “基于最近对话生成几个相关问题”

目标态应该更像：
- “基于这条具体结果，建议你接下来最值得问/看的问题”

### 问题 3：第二层推荐 item 当前是直接执行，不是 draft-first

当前推荐结果项点击后直接执行：
- `onSelectRecommendedQuestion -> onCreateResponse`

这和第一层 chip 的 `draft-to-composer` 语义不完全一致，也不够稳妥。

更好的目标态是：
- 推荐结果项默认也先写入 composer
- 再由用户 send
- 只有显式设定为 `execute_intent` 的极少数项才允许直接执行

### 问题 4：当前 recommendation result 与 workbench / timeline 的语义层是割裂的

目前：
- ask / chart follow-up 已经在向“response + artifact + right workbench”靠拢
- recommendation 还停留在“thread sidecar”模型

这会让 Home 页有两套不一致的心智模型：
- 一套是正式 response
- 一套是临时侧挂结果

### 问题 5：推荐项本身还不够智能

当前推荐问题更偏：
- 通用相关问题生成

但真正贴近 Cloud 的目标态应该进一步具备：
- response-aware
- chart-aware
- current-artifact-aware
- 可区分“继续问数”与“建议转图表/图表 refine”

---

## 2. 目标态结论

## 2.1 推荐问题也应进入统一 Home intent 体系

推荐问题不应继续作为 thread 特例存在，而应被正式定义成 Home 的一个一等意图：

- `RECOMMEND_QUESTIONS`

但要注意：
- **它是一个独立意图**
- **不一定必须产出右侧 workbench artifact**
- **它的结果载体更适合是 timeline 中的一类 follow-up response**

换句话说：
- 推荐问题应该和 chart follow-up 一样有“独立 response 载体”
- 但它不一定像 chart 一样占用右侧结果区

---

## 2.2 最佳结果载体：`RECOMMENDATION_FOLLOWUP` response

推荐新增一种 response kind：

```ts
ThreadResponseKind.RECOMMENDATION_FOLLOWUP
```

这类 response 的职责不是保存 SQL / chart，而是保存：
- 这轮 recommendation 是从哪条 response 触发的
- 当前生成状态
- 最终推荐问题列表
- 每个推荐项的交互模式 / 建议 intent

建议新增数据结构：

```ts
type RecommendationItem = {
  label: string;
  prompt: string;
  category?: string | null;
  interactionMode: 'draft_to_composer' | 'execute_intent';
  suggestedIntent?: 'ASK' | 'CHART' | 'RECOMMEND_QUESTIONS' | null;
};

type ThreadResponseRecommendationDetail = {
  status: 'NOT_STARTED' | 'GENERATING' | 'FINISHED' | 'FAILED';
  queryId?: string | null;
  items: RecommendationItem[];
  error?: {
    code?: string | null;
    message?: string | null;
    shortMessage?: string | null;
  } | null;
  sourceResponseId?: number | null;
};
```

这样做的好处：
- response ownership 自然成立
- replay / refresh 不再依赖页面层额外绑定
- timeline 历史更完整
- telemetry / i18n / thinking step 都能统一进入 response contract

---

## 2.3 推荐问题的最佳 UX 语义

目标 UX 语义建议如下：

### 第一层：trigger chip

在 ask response / chart response 底部展示：
- `推荐几个问题给我`

点击后：
- **只写入 composer**
- 附带 draft metadata：
  - `intentHint = RECOMMEND_QUESTIONS`
  - `sourceResponseId = 当前 response id`

### 第二层：用户 send 后创建 recommendation follow-up response

用户 send `推荐几个问题给我` 后：
- 创建一条新的 timeline response
- `responseKind = RECOMMENDATION_FOLLOWUP`
- `sourceResponseId = 触发它的那条 response`
- response 自己带 `recommendationDetail.status = GENERATING`

### 第三层：推荐结果完成后挂在这条 response 上

完成后：
- 该 response 展示推荐问题列表
- 推荐结果属于这条 response 本身
- 不再依赖 thread-level owner state

### 第四层：推荐结果 item 默认也走 draft-to-composer

点击某个推荐问题项时：
- 默认仍然只写入 composer
- 不立即执行

这么做的原因：
- 与第一层 chip 语义一致
- 降低误触发成本
- 保持 Cloud 风格的“用户确认 send 才进入下一轮”

---

## 2.4 与 workbench 的关系

推荐 follow-up response 不建议抢占右侧 workbench。

建议规则：
- ask response / chart response：仍可驱动右侧 workbench
- `RECOMMENDATION_FOLLOWUP` response：默认只在左侧 timeline 呈现
- 右侧 workbench 保持显示当前 source response 的 artifact，除非用户显式切换

理由：
- 推荐问题本身不是主要结果 artifact
- 它更像“下一步动作建议”
- 不应该把右侧工作台从数据/SQL/图表强行切走

因此推荐 follow-up response 的最佳角色是：
- **timeline 中的对话辅助类 response**
- 不是新的 artifact response

---

## 3. 推荐问题生成的目标输入模型

## 3.1 当前输入不足

当前服务端核心输入是：

```ts
previousQuestions = 最近 5 条 thread response.question
```

这对于“线程级泛推荐”够用，但对于 Cloud 风格的“基于当前结果继续深挖”不够精确。

---

## 3.2 建议的 response-aware planner 输入

建议把 recommendation generation 的输入升级为以下优先级：

### 一级输入：source response 主信息

1. `sourceResponse.question`
2. `sourceResponse.rephrasedQuestion`
3. `sourceResponse.answerDetail.content`（可截断摘要）
4. `sourceResponse.sql`

### 二级输入：source response 结果特征

5. preview columns
6. preview row count
7. 指标列 / 维度列推断
8. 若 source response 是 chart：
   - chart type
   - chart title
   - x/y encoding summary

### 三级输入：thread 上下文

9. 最近 3~5 条用户问题
10. 最近 1~2 条 response 的 intent lineage

### 四级输入：runtime / manifest 语义

11. 当前 runtime scope
12. knowledge base / manifest 信息
13. schema/mdl 语义提示

目标生成结果不只是“随便推荐几个相关问题”，而是分类地产出：
- 深挖当前指标
- 换维度切片
- 时间趋势
- Top-N / 排序
- 对比 / 占比
- 若当前已有表格，建议生成图表
- 若当前已有图表，建议进一步 refine 或换图

---

## 3.3 推荐问题项建议增加结构化字段

建议每个推荐项至少包含：

```ts
type RecommendationItem = {
  label: string;
  prompt: string;
  category:
    | 'drill_down'
    | 'compare'
    | 'trend'
    | 'distribution'
    | 'ranking'
    | 'chart_followup'
    | 'chart_refine'
    | 'related_question'
    | null;
  interactionMode: 'draft_to_composer' | 'execute_intent';
  suggestedIntent: 'ASK' | 'CHART' | 'RECOMMEND_QUESTIONS' | null;
};
```

这样前端才能做更好的：
- 文案展示
- icon / 分组
- telemetry
- 后续个性化排序

---

## 4. 与 Cloud 对齐时的关键取舍

## 4.1 第一层 chip：已确认，应该保留

这部分已经基本对齐，不建议回退成自动展开 recommendation list。

即：
- ask/chart response 底部先出现 `推荐几个问题给我`
- 由用户决定是否 send

---

## 4.2 第二层结果 carrier：建议升级为 response，而不是继续 thread sidecar

这点是下一版最重要的结构升级。

短期继续 sidecar 当然也能跑，但缺点会越来越明显：
- ownership 修补逻辑越来越重
- replay 恢复越来越脆
- 与 chart follow-up 模型长期分叉

因此，如果目标是“全部对齐 + 后续可持续演进”，最佳路线是：
- **把 recommendation result 正式 response 化**

---

## 4.3 推荐结果 item 点击语义：建议统一为 draft-first

当前第一层是 draft-first，第二层直接 execute，这种混搭不优。

更建议统一策略：
- 默认都 draft-first
- send 才执行

只有将来非常明确的“系统动作型快捷项”才保留 `execute_intent`。

---

## 4.4 Cloud 未完全验证的两点，需要先保留验证位

截至当前证据，以下两点仍建议保留“验证位”，不要在文档里装作已证实：

1. **Cloud 在 send `推荐几个问题给我` 后，到底是生成 sidecar 还是独立 response？**
2. **Cloud 点击第二层推荐项后，到底是 draft 还是直接执行？**

因此本方案给的是：
- **推荐的最佳目标态**
- 不是“已由 Cloud 100% 实锤的所有细节”

但从整体架构与现有代码演进方向看，这一目标态是更优也更稳的。

---

## 5. 页面交互目标态

## 5.1 Ask / Chart response 底部

保留 response-scoped contextual chips：
- `生成一张图表给我`
- `推荐几个问题给我`
- chart response 场景下再加 chart refine chips

规则：
- 点击 chip -> draft into composer
- 不自动执行

---

## 5.2 Recommendation follow-up response 样式

建议以轻量 response card 形式出现在左侧 timeline：

状态：
- `GENERATING`：显示 skeleton / loading 文案
- `FAILED`：显示失败状态与重试 action
- `FINISHED`：显示推荐问题列表

推荐项展示：
- 不要太像按钮瀑布
- 更接近一组可点击的 suggestion rows / chips
- 每项 hover 明确
- 点击默认写入 composer

可以附加：
- `基于刚刚这条结果，你接下来还可以问：`

但所有新用户可见文案都应进入 i18n，不允许新增硬编码。

---

## 5.3 Replay / refresh 行为

目标行为：

1. 刷新页面后，recommendation follow-up response 仍在原位置
2. 回放历史 thread 时，recommendation 仍跟随原 source response lineage
3. 切换 selected response 时，不应把 recommendation 结果漂到另一条 response 下
4. 多次生成 recommendation 时，每次都是独立 response，不互相覆盖

---

## 6. 建议的数据与 API 改造

## 6.1 数据模型

建议新增：

### ThreadResponse 新字段 / 枚举

- `responseKind = RECOMMENDATION_FOLLOWUP`
- `recommendationDetail: ThreadResponseRecommendationDetail | null`

并继续复用：
- `sourceResponseId`
- `resolvedIntent`

---

## 6.2 API 建议

当前 thread-level API：
- `POST /api/v1/thread-recommendation-questions/:threadId`
- `GET /api/v1/thread-recommendation-questions/:threadId`

建议升级为 response-scoped API：

### 创建 recommendation follow-up

```http
POST /api/v1/thread-responses/:id/generate-recommendations
```

输入：
- source response id
- runtime scope identity
- 可选 prompt / intent metadata

效果：
- 创建一条 `RECOMMENDATION_FOLLOWUP` response
- 初始状态 `GENERATING`
- 返回新的 response id

### 获取 recommendation follow-up 结果

直接复用 thread response 查询：

```http
GET /api/v1/thread-responses/:id
```

当后台任务完成后：
- 更新该 response 的 `recommendationDetail`

这样前端只需要沿用现有 response polling / hydration 模型。

---

## 6.3 服务端生成逻辑

建议新增或重构成：

- `generateThreadResponseRecommendationsAction(sourceResponseId)`
- `getThreadResponseRecommendationResult(responseId)`

职责：
1. 读取 source response
2. 构造 response-aware planner input
3. 发起 recommendation generation task
4. 把 queryId / status 写回新 response
5. 后台 tracker 轮询后更新 `recommendationDetail`

这样可与现有：
- answer background tracker
- chart background tracker

保持统一风格。

---

## 7. 前端状态收口建议

当前建议删除这些页面层 owner state：
- `showRecommendedQuestions`
- `recommendedQuestionsOwnerThreadId`
- `recommendedQuestionsOwnerResponseId`

原因：
- 这些都是 thread-sidecar 过渡方案的补丁状态
- response 化后，它们应当消失

目标态应改为：
- recommendation 直接作为 `displayThread.responses` 的一部分渲染
- 每条 response 自带自己的 `recommendationDetail`

这样前端会简单很多：
- 无需额外 owner 漂移保护
- 无需单独 sidecar 恢复逻辑
- 无需 thread-level recommend polling UI 特判

---

## 8. i18n 与 telemetry 要求

## 8.1 i18n

新增以下用户可见文本时，必须进入现有 i18n 体系：
- recommendation follow-up response 标题/说明文案
- generating / failed / retry 文案
- 推荐项分类标签（若展示）
- 任何新的 tooltip / CTA

不得新增硬编码中英文混杂文本。

## 8.2 telemetry

建议新增事件：
- `home_recommendation_trigger_drafted`
- `home_recommendation_trigger_sent`
- `home_recommendation_response_created`
- `home_recommendation_generated`
- `home_recommendation_item_drafted`
- `home_recommendation_item_executed`

以便后续衡量：
- 第一层 trigger 转化率
- 第二层 item 点击率
- recommendation -> ask/chart follow-up 转化率

---

## 9. 分阶段落地方案

## Phase 0：补齐事实验证与契约冻结

目标：先把尚未完全确认的 Cloud 行为边界补齐，再冻结 contract。

需要确认：
1. Cloud 在 send `推荐几个问题给我` 后，是 sidecar 还是独立 response
2. Cloud 点击第二层推荐项，是 draft 还是直接执行

即使 Cloud 最终仍是 sidecar，本仓库也仍然可以选择 response carrier 作为更优演进路线；但要在文档中明确“这是架构升级，不是逐像素照搬”。

交付：
- 更新本文与关联文档的 verified / inferred 边界
- 冻结推荐问题的 canonical contract

---

## Phase 1：response carrier 化

目标：让 recommendation 从 thread sidecar 升级为 first-class response。

工作项：
1. `ThreadResponseKind` 新增 `RECOMMENDATION_FOLLOWUP`
2. `thread_response` 表新增 `recommendationDetail`（或等价 JSON 列）
3. serializer / repository / API contract 补齐
4. 新增 response-scoped create recommendation API
5. 后台 tracker 能写回 recommendation result

验收：
- send `推荐几个问题给我` 后，timeline 出现独立 response
- recommendation result 存在 response 上，而不是 thread sidecar

---

## Phase 2：前端渲染与状态收口

目标：删掉 thread-sidecar 过渡逻辑，改为 response 自带 recommendation。

工作项：
1. 删除页面层 owner state
2. `AnswerResult` / timeline 支持 `RECOMMENDATION_FOLLOWUP`
3. recommendation loading / failed / finished 状态渲染
4. replay / refresh 恢复逻辑改为纯 response hydrate
5. workbench 保持 source artifact，不被 recommendation 抢占
6. 所有新增 UI 文案进入 i18n

验收：
- 刷新/回放后 recommendation 位置稳定
- 多轮 recommendation 不互相覆盖
- 切换 response 不再引发 ownership 漂移

---

## Phase 3：点击语义统一为 draft-first

目标：第一层 chip 与第二层 recommendation item 语义统一。

工作项：
1. 推荐结果项点击默认写入 composer
2. 为 draft 注入 `intentHint / sourceResponseId / suggestedIntent`
3. 只有明确标记 `execute_intent` 的项才直接执行

验收：
- 第一层 / 第二层都默认 draft-first
- composer send 后才真正创建下一轮 ask/chart follow-up

---

## Phase 4：response-aware recommendation intelligence

目标：让推荐问题真正基于“当前结果”而不是“最近对话”。

工作项：
1. 服务端 planner 输入改为 source-response-first
2. 引入 preview/schema/chart metadata
3. 推荐项结构化分类
4. chart-aware / artifact-aware suggestion generation
5. 减少纯静态模板式推荐

验收：
- 当前表格结果能生成更具体的 drill-down / compare / trend 建议
- 当前图表结果能生成更贴近图表 refine / related ask 的建议

---

## 10. 最终结论

如果只是短期修补，继续维持：
- response-scoped trigger chip
- thread-level recommendation sidecar

也能工作。

但如果目标是：
- **和 Cloud 更完整对齐**
- **与现有 ask / chart follow-up 架构统一**
- **后续让 recommendation 更智能、更稳、更可回放**

那么最佳方案是：

> **把推荐问题从“thread 级 sidecar 特例”升级为“response-scoped、response-carried、response-aware 的 recommendation follow-up”。**

这是当前代码演进方向上最一致、最可维护，也最适合作为下一版实施的方案。
