# Ask / Chart Thinking Steps 字段契约草案（2026-04-21）

> 关联主文档：
> `docs/chart-followup-commercial-reference-and-implementation-plan-2026-04-21.md`
>
> 路由语义配套：
> `docs/home-unified-intent-routing-architecture-2026-04-21.md`

## 1. 目标

把当前“后端已经做了很多阶段，但前端只显示粗步骤”的状态，升级为：

- 普通问答 steps 接近参考图 1；
- chart follow-up steps 与参考图 2 1:1 对齐；
- 用户可见文案通过 `messageKey + params` 本地化，不靠后端直接返回翻译后的整句；
- ask / chart 的步骤都能带计数、耗时、状态。

---

## 2. 当前代码事实

## 2.1 Ask 链路已存在的能力

代码参考：

- `wren-ai-service/src/core/fixed_order_ask_runtime.py`
- `wren-ai-service/src/web/v1/services/ask.py`
- `wren-ui/src/components/pages/home/preparation/PreparationSteps.tsx`

当前 ask 链路里**已存在**：

- `sql_pairs_retrieval`
- `instructions_retrieval(scope="sql")`
- `intent_classification`
- `schema retrieval`
- `sql generation reasoning`
- `sql generation`
- `sql correction`

但当前前端只展示 3 个粗步骤：

- retrieving
- organizing
- generating

## 2.2 Chart 链路已存在的能力

代码参考：

- `wren-ui/src/server/services/askingServiceResponseActions.ts`
- `wren-ai-service/src/web/v1/services/chart.py`
- `wren-ui/src/server/backgrounds/chart.ts`

当前 chart 链路里**已存在**：

- chart generation 前 preview 一次数据样本（最多 500 行）
- chart task 状态：`FETCHING / GENERATING / FINISHED / FAILED / STOPPED`
- chart schema canonicalization / validation

但当前还**不存在**：

- `scope="chart"` instruction retrieval
- chart 专属 `thinkingSteps` 契约
- `Chart intent detected / Chart type selected / Chart validated` 这些独立阶段字段

## 2.3 当前 answer instruction 缺口

当前没有独立的：

- `instructions_retrieval(scope="answer")`

因此图 1 里的：

- `Found X related summarizing instructions`

还不是现成能力，需要新增。

---

## 3. 契约设计原则

### 3.1 稳定键与展示文案分离

后端返回：

- 稳定步骤键
- 参数
- 状态
- 计数
- 耗时

前端负责：

- 用 `messageKey + messageParams` 映射本地化文案

### 3.2 steps 是 additive metadata

Phase 1/2 新增的 thinking steps 字段只能是**附加元数据**，不能替代：

- `askingTask.status`
- `chartDetail.status`

原因：

- 当前 polling / finalized 判断 / recovery 都还直接依赖原有 `status`

### 3.3 允许“找到”与“未找到”是同一个 step

例如：

- `ask.sql_pairs_retrieved`
- count = 0

前端可以映射成：

- `No related Question-SQL pairs found`

而不是要求后端返回两套不同文案。

---

## 4. 通用字段契约

建议新增一个通用结构：

```ts
type ThinkingStepStatus = 'pending' | 'running' | 'finished' | 'failed' | 'skipped';

type ThinkingStep = {
  key: string;
  status: ThinkingStepStatus;
  messageKey: string;
  messageParams?: Record<string, string | number | boolean | null>;
  count?: number | null;
  durationMs?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  detail?: string | null;
  errorCode?: string | null;
};
```

补充说明：

- `messageKey`：前端本地化键
- `messageParams`：如 `{ count: 4 }`、`{ rows: 500, seconds: 1.7 }`
- `count`：方便前端做 badge / 统计
- `durationMs`：统一原始耗时
- `detail`：仅作补充说明，不作为主文案依赖

---

## 5. Ask 链路契约草案

建议在 `askingTask` 上新增：

```ts
type AskingTaskThinking = {
  steps: ThinkingStep[];
  currentStepKey?: string | null;
};
```

```ts
type AskingTask = {
  ...
  thinking?: AskingTaskThinking | null;
};
```

## 5.1 目标步骤顺序

普通问答建议按以下 8 步输出：

1. `ask.sql_pairs_retrieved`
2. `ask.sql_instructions_retrieved`
3. `ask.intent_recognized`
4. `ask.candidate_models_selected`
5. `ask.sql_reasoned`
6. `ask.sql_generated`
7. `ask.data_fetched`
8. `ask.answer_instructions_retrieved`

## 5.2 前后端文案映射示例

| key | count / params | 前端可映射文案 |
|---|---|---|
| `ask.sql_pairs_retrieved` | `count=1` | `Found 1 related Question-SQL pairs` |
| `ask.sql_pairs_retrieved` | `count=0` | `No related Question-SQL pairs found` |
| `ask.sql_instructions_retrieved` | `count=4` | `Found 4 related SQL queries instructions` |
| `ask.intent_recognized` | - | `User intent recognized` |
| `ask.candidate_models_selected` | `count=10` | `Found 10 candidate models` |
| `ask.sql_reasoned` | `durationMs=4310` | `Thought for 4.31s` |
| `ask.sql_generated` | `durationMs=3480` | `SQL statement generated for 3.48s` |
| `ask.data_fetched` | `rows=500,durationMs=1850` | `Fetched up to 500 data rows for 1.85s` |
| `ask.answer_instructions_retrieved` | `count=0` | `No related summarizing instructions found` |

## 5.3 数据来源建议

| step | 建议来源 |
|---|---|
| sql pairs | `state.sql_samples.length` |
| sql instructions | `state.instructions.length`（`scope="sql"`） |
| intent recognized | intent classification 完成 |
| candidate models | `state.table_names.length` |
| thought | `reason_sql_generation` 起止时间 |
| SQL generated | `generate_sql` 起止时间 |
| data fetched | answer 生成前执行 query/preview 的统计 |
| answer instructions | 新增 `instructions_retrieval(scope="answer")` |

## 5.4 最小落地建议

### Wave A

- 先把已存在能力映射成 steps：
  - sql pairs
  - sql instructions
  - intent
  - candidate models
  - thought
  - sql generated

### Wave B

- 补 `data fetched`
- 补 `scope="answer"` instruction retrieval

---

## 6. Chart 链路契约草案

建议在 `chartDetail` 上新增：

```ts
type ChartThinking = {
  steps: ThinkingStep[];
  currentStepKey?: string | null;
};
```

```ts
type ThreadResponseChartDetail = {
  ...
  thinking?: ChartThinking | null;
};
```

## 6.1 目标步骤顺序（与参考图 2 对齐）

Chart follow-up 按以下 9 步输出：

1. `chart.sql_pairs_retrieved`
2. `chart.sql_instructions_retrieved`
3. `chart.preview_data_fetched`
4. `chart.intent_recognized`
5. `chart.chart_instructions_retrieved`
6. `chart.chart_intent_detected`
7. `chart.chart_type_selected`
8. `chart.chart_generated`
9. `chart.chart_validated`

## 6.2 前端可映射文案示例

| key | count / params | 前端可映射文案 |
|---|---|---|
| `chart.sql_pairs_retrieved` | `count=0` | `No related Question-SQL pairs found` |
| `chart.sql_instructions_retrieved` | `count=4` | `Found 4 related SQL queries instructions` |
| `chart.preview_data_fetched` | `rows=500,durationMs=1700` | `Fetched up to 500 data rows for 1.7s` |
| `chart.intent_recognized` | - | `User intent recognized` |
| `chart.chart_instructions_retrieved` | `count=0` | `No related charts instructions found` |
| `chart.chart_intent_detected` | - | `Chart intent detected` |
| `chart.chart_type_selected` | `chartType='BAR'` | `Chart type selected` |
| `chart.chart_generated` | - | `Chart generated` |
| `chart.chart_validated` | - | `Chart validated` |

## 6.3 数据来源建议

| step | 建议来源 |
|---|---|
| sql pairs | 复用 source answer 的 ask retrieval 结果，或在 chart follow-up 重新取一次 |
| sql instructions | 复用 source answer 的 `scope="sql"` retrieval 结果，或重新取一次 |
| preview data fetched | `askingServiceResponseActions.generateThreadResponseChartAction` 的 preview 数据样本 |
| intent recognized | 新增 chart follow-up intent 分类 |
| chart instructions | 新增 `instructions_retrieval(scope="chart")` |
| chart intent detected | chart follow-up intent 分类结果 |
| chart type selected | chart planner / chart generator 前置输出 |
| chart generated | chart schema 产出成功 |
| chart validated | canonicalize + validation 完成 |

## 6.4 与当前代码的差距

当前还缺：

- [ ] `scope="chart"` instruction retrieval
- [ ] chart intent detection 结果字段
- [ ] chart type selected 独立阶段字段
- [ ] chart validated 独立阶段字段
- [ ] chart thinking steps 的持久化 / 轮询更新

---

## 7. 推荐落地顺序

## Phase A：Ask thinking steps 先细化

优先原因：

- ask 主链路现有能力最多；
- 很多步骤后端已在做，只是没展示；
- 这是图 1 最快可落地的一部分。

## Phase B：Chart thinking steps 契约补齐

优先补：

- `preview_data_fetched`
- `scope="chart"` instructions
- `chart_intent_detected`
- `chart_type_selected`
- `chart_validated`

## Phase C：前端按 locale 做文案映射

要求：

- 不把整句英文/中文硬编码在后端返回里；
- 前端根据 `messageKey + params` 统一渲染。

---

## 8. 验收标准

### Ask

- [ ] 普通问答 steps 不再只有 3 个粗步骤
- [ ] sql pair / sql instruction / candidate models / thought / sql generated 至少可见
- [ ] answer summarizing instructions 若未接入，也要在方案和代码中明确缺口边界

### Chart

- [ ] chart follow-up steps 与参考图 2 的顺序一致
- [ ] chart instructions 为独立步骤
- [ ] chart generated 与 chart validated 为独立步骤
- [ ] 失败时可定位失败发生在哪一步
