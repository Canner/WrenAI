# Chart Follow-up 商业版参考方案与本仓库改造方案（2026-04-21）

## 1. 背景

当前本仓库的问答与图表能力存在以下体验问题：

1. 图表生成失败时，前端通常只能看到统一的 `NO_CHART / Chart not available`，失败原因不够可解释。
2. 图表能力与主回答链路耦合较深，用户会感知为“回答成功了，但图表随机失败”。
3. 图表生成的意图识别、图表类型选择、schema 校验等阶段没有在产品层被清晰表达。
4. 某些问题本质上更适合先给出表格/回答，再由用户显式追问“生成图表”。
5. 本项目明确约束：**不采用前端 fallback 图**；AI 没生成图，就应该报错或给出更清晰的失败原因。

本文档基于：
- 对商业版最新截图的观察；
- 当前开源仓库代码与实际链路测试；
- 已定位的问答 / 图表 / polling / runtime scope 问题；

产出两部分内容：
1. 商业版方案抽象；
2. 本仓库应落地的改造方案。

配套细化文档：
- `docs/chart-followup-page-interaction-checklist-2026-04-21.md`
- `docs/ask-chart-thinking-steps-contract-draft-2026-04-21.md`
- `docs/home-unified-intent-routing-architecture-2026-04-21.md`

> 说明：商业版内部实现细节无法直接访问，本文对商业版的流程拆分属于**基于截图与交互行为的推断**，不是对其私有代码的逐字复述。


## 1.1 与当前实现同步（2026-04-21 晚）

本轮代码已经把这份方案中的 **Phase 0 / Phase 1 / Phase 2 主路径**推进到可用状态，但并未完成最终商业版 1:1 对齐。

### 已落地

- `stop-chart` 路由已改为真正调用 `chart_service.stop_chart`；
- chart custom instruction 已从 `wren-ui` 透传到 `wren-ai-service`；
- `wren-ui` server 已增加 deterministic `chartability` precheck；
- chart error code 已从单一 `NO_CHART` 细分为 `AI_NO_CHART / CHART_SCHEMA_INVALID / EMPTY_RESULT_SET / ...`；
- `thread_response` 已新增 `response_kind / source_response_id`，chart follow-up 已是独立 response；
- Home 页已具备左侧 timeline + 右侧 workbench 的 dual-surface 主骨架；
- 自然语言 `“生成一张图表给我”` 已可直接路由到 chart follow-up；
- chart follow-up 的 polling race 已修复，避免旧 response 的 finished payload 提前 settle 新 response。

### 已验证

- `yarn check-types`
- `yarn lint`
- `yarn test --runInBand src/features/home/thread/threadRecoveryOrchestrationHelpers.test.ts src/features/home/thread/useThreadResponseMutationActions.test.tsx src/tests/pages/home/thread.test.tsx`
- `PW_UI_SERVER_MODE=standalone E2E_UI_PORT=3003 E2E_AI_PORT=5557 playwright test e2e/specs/homeUnifiedIntentChartFollowup.spec.ts --project chromium`

### 仍待补齐

- full canonical `ResolvedHomeIntent` 持久化与 server-side contract；
- chart follow-up / ask 的商业版 thinking steps 1:1 标签与阶段字段；
- preview/sql workbench header actions（导出 / spreadsheet 等）收口；
- 新增用户可见文本进入 i18n，而不是继续硬编码；
- 更严格的 artifact lineage contract（当前仍是 `sourceResponseId` + copied SQL 的首版折中实现）。

---

## 2. 商业版方案（基于截图观察的抽象）

### 2.1 总体思路

商业版不是把“图表生成”当成主回答链路的自动副产物，而是更接近：

- **第一步：先稳定生成 SQL / Data Preview / Text Answer**
- **第二步：用户显式追问或触发“生成图表”**
- **第三步：系统走一条独立的 chart follow-up pipeline**

这意味着：

1. 回答链路优先保证“有结果可看”；
2. 图表链路是基于已有结果的增强动作；
3. 图表失败不会让用户觉得“整次问答失败了”；
4. 图表步骤本身是可解释、可分阶段的。

### 2.2 从截图可见的两条 pipeline

#### A. 普通问答 pipeline
截图中第一条问答的 thinking steps 大致是：

- User intent recognized
- Found candidate models
- Thought
- SQL statement generated
- Fetched data rows
- No related summarizing instructions found

这说明主链路主要负责：

1. 识别问题意图；
2. 选择候选模型；
3. 生成 SQL；
4. 拉取数据预览；
5. 汇总为回答。

#### B. 图表 follow-up pipeline
截图中第二条“生成一张图表给我”的 thinking steps 大致是：

- Fetched data rows
- User intent recognized
- No related charts instructions found
- Chart intent detected
- Chart type selected
- Chart generated
- Chart validated

这说明图表 follow-up 不是重新走完整 text-to-sql，而是：

1. 复用已有问题 / SQL / 数据；
2. 识别当前 follow-up 是否为图表意图；
3. 选择图表类型；
4. 生成图表 schema；
5. 校验图表是否合法。

### 2.3 商业版交互特征

从截图可总结出以下交互特征：

1. **图表是一次独立回答**
   - 用户追问“生成一张图表给我”；
   - 左侧 timeline 出现新的 Chart 回答单元；
   - 不是直接覆盖原回答。

2. **结果面板右侧是结果工作台**
   - 页面是典型的 **dual-surface**：左侧是语义时间线，右侧是结果工作台；
   - tabs 不是固定永远三栏，而是**基于当前选中 response 的可用 artifacts 条件渲染**；
   - Chart 是在结果工作台里展示，而非单独漂浮的组件；
   - 右侧结果工作台不是页面初始就常驻出现，而是**在当前选中回答存在可渲染结果（Data Preview / SQL / Chart）时才出现**；
   - 若当前只是 pending / thinking，尚无可渲染 artifact，则不会为了占位先弹一个空工作台。

3. **图表之前已有稳定的数据基础**
   - Data Preview 是一等公民；
   - 即使图表失败，用户仍应能使用表格和 SQL。

4. **工作台标题和动作绑定当前 selected response**
   - 用户点开哪条回答，右侧标题就跟随哪条回答；
   - chart follow-up response 被选中时，标题与操作上下文都应绑定 chart response 本身，而不是 source response；
   - 但 chart response 仍可复用 source response 的 Data Preview / SQL。

5. **图表流程是“先 planning，再 generation”**
   - 从 thinking steps 可见 `Chart type selected` 与 `Chart validated` 是独立阶段；
   - 说明商业版并不是简单让 LLM 直接返回最终图。

6. **对话辅助信息留在左侧，不进入工作台主承载位**
   - thinking steps 属于左侧 response/timeline；
   - 推荐追问属于 thread-level conversational aid；
   - 它们都不应该占据右侧工作台的主区域。

---

## 3. 当前开源仓库现状

### 3.1 已确认可工作的部分

通过真实链路验证：

1. **样例空间 HR 知识库**：
   - 问题：`各岗位的平均薪资分别是多少？`
   - 问答成功；图表成功。

2. **PostgreSQL HR 知识库**：
   - 问题：`各岗位的平均薪资分别是多少？`
   - 问答成功；图表成功。

3. **TiDB 业务知识库中的合理业务问题**：
   - 问题：`统计 990001 平台下各渠道的折扣比例，并生成柱状图`
   - 问答成功；图表成功。

这说明：

- 当前图表生成链路**不是整体坏掉**；
- 不是简单的“所有图表都生成失败”；
- 现有代码在部分数据集 / 问题上是正常工作的。

### 3.2 已确认的问题类型

#### A. 图表失败但主链路正常
示例：
- `按 status 统计 report_demo_dwd_order_deposit 的平均 amount，并生成柱状图`

现象：
- `answer_detail.status = FINISHED`
- `chart_detail.status = FAILED`
- `chart_detail.error.code = EMPTY_RESULT_SET`
- `diagnostics.previewRowCount = 0`

结论：
- SQL/回答链路是成功的；
- 图表输入结果集为空；
- chart generation 无法产图。

#### B. 上游数据源问题导致问答失败
示例：
- `按 type 统计 METRICS_SCHEMA.tikv_channel_full 的平均 value，并生成柱状图`

现象：
- `answer_detail.status = FAILED`
- 错误：`(1105, 'query metric error: pd unavailable')`

结论：
- 这不是图表重构导致；
- 是数据源 / TiDB metrics schema / PD 上游能力问题。

#### C. 问答链路曾出现“卡在整理结果”
根因已定位并修复：
- `GENERAL / MISLEADING_QUERY` ask 结果未稳定落库；
- server 热更新 / 单例重建后未完成 asking task 无法 rehydrate；
- 前端就会一直轮询旧状态，看起来像“整理结果卡住”。

---

## 4. 商业版方案与本仓库的差异

### 4.1 流程拆分差异

商业版更像：
- 主问答 pipeline
- chart follow-up pipeline

本仓库当前已经追上了其中一半：
- chart follow-up 已是独立 response；
- 自然语言 chart-only follow-up 与显式 chart action 已能汇入同一主路径；
- 但 chart planning / type selection / validation 仍没有像商业版那样完整产品化表达。

### 4.2 错误表达差异

商业版倾向于：
- 先有 Data Preview / SQL；
- 图表是显式增强动作；
- 图表失败不会吞掉主结果。

本仓库当前已经把错误表达往这个方向推进了一大步：
- 已有 `chartability` precheck；
- 已有 `AI_NO_CHART / CHART_SCHEMA_INVALID / EMPTY_RESULT_SET / ...` 细分错误码；
- 图表失败时，主回答与 preview/sql 仍可继续使用；
- 但还没有把这些失败原因进一步映射成商业版那种分阶段 thinking steps 文案。

### 4.3 交互建模差异

商业版：
- 图表 follow-up 是独立回答；
- thinking steps 明确显示 chart stages；
- 左侧语义流 / 右侧工作台是分层建模；
- 右侧工作台承接图表结果，且 tabs 条件渲染；
- chart response 与 source response 存在明确 lineage。

本仓库当前：
- 已有独立 chart follow-up response；
- 已有左侧 timeline / 右侧 workbench 的 dual-surface 主骨架；
- 已有 `selectedResponseId + activeWorkbenchArtifact` 的页面级状态；
- 但仍缺少 chart planner 语义层；
- 仍缺少统一的 `resolved intent + artifact plan + activeWorkbenchArtifact` 持久化契约；
- `sourceResponseId` 已存在，但 artifact lineage 仍是首版轻量实现，还没有完全从产品 contract 层说清楚。

---

## 5. 本仓库建议的目标状态

### 5.1 产品原则

本仓库后续应遵循以下原则：

1. **结果优先**
   - 先保证 SQL / Data Preview / Text Answer 稳定可达；
   - 图表是增强能力，不应破坏主链路。

2. **图表是显式 follow-up**
   - 用户可通过自然语言或按钮触发图表生成；
   - 图表应是独立 response / 独立任务，而不是纯附属渲染。

3. **无前端 fallback 图**
   - 不在前端偷偷补图；
   - AI / planner 没给出合法图表就应明确失败。

4. **失败可解释**
   - 不再只给 `NO_CHART`；
   - 要区分是：空结果、字段结构不适合、上游错误、chart schema 无效等。

5. **调试信息不直接暴露在 UI**
   - 详细 diagnostics 留在接口和日志中；
   - 前端只呈现适当的用户级原因与下一步。

6. **意图与展示分层**
   - Home 入口先统一到 `resolved intent`；
   - 页面再基于 `artifactPlan + activeWorkbenchArtifact` 决定左侧 teaser / 右侧 workbench 如何联动；
   - “查看图表 / 查看数据”应是 artifact navigation，而不是误建新任务。

7. **工作台只承载结果，不承载空占位**
   - 只有在当前 selected response 已有可渲染 artifact 时才展开右侧；
   - 任务刚创建但还在 pending/thinking 时，不为了骨架感强行打开空工作台。

### 5.2 目标交互

#### 主回答阶段
用户输入问题后：
- 初始先保持对话主视图，不预先占出右侧结果区；
- 当当前回答已有可渲染结果时，再出现右侧结果工作台；
- 右侧结果工作台承接：
  - 回答对应的 Data Preview
  - SQL 查询
  - 后续 chart follow-up 的 Chart
- 左侧 response body 继续承载：问题、thinking steps、文本回答、轻量 teaser card；
- 右侧工作台只承载当前 `selectedResponse` 的 full viewer。

#### 图表阶段
用户点击“生成图表”或追问“生成一张图表给我”后：
- **Phase 1** 仍可沿用当前 tab 形态，但要先把失败原因与阶段信息做清楚；
- **Phase 2** 再把图表升级为独立 chart follow-up response；
- 右侧结果工作台只在当前回答 / chart response 有结果可展示时出现，默认不做常驻空容器；
- 对 chart response，右侧结果工作台展示 `Chart`，并可通过 `sourceResponseId` 继承 source response 的 `Data Preview / SQL Query`；
- workbench tabs 应按当前 selected response 实际可用 artifacts 条件渲染，而不是固定永远三栏；
- workbench 标题和更多操作绑定当前 selected response；chart-specific actions 仅在当前激活 artifact 为 `chart` 时出现；
- replay / revisit 默认不强制展开右侧工作台，用户点击左侧 teaser / `View chart` / `View data` 后再展开更合理；
- 左侧 timeline 显示新的 Chart 回答单元。

---

## 6. 本仓库修改方案

## 6.1 服务端：先引入 Chartability 层，Chart Planner 后置到 Phase 3

### 目标
在真正调用 chart generation 之前，先做一层**确定性的 chartability 判定**。

这里要明确拆开两个概念：

- **Chartability**：当前结果是否适合成图，属于 Phase 1，优先用确定性规则完成；
- **Chart Planner**：如果适合成图，再去推荐图表类型 / 维度 / 指标，属于 Phase 3。

### Phase 1 的落地位置
结合当前代码，Phase 1 的 deterministic chartability precheck 建议**先落在 `wren-ui` server 侧**，原因是：

- 当前 chart 请求发出前，`wren-ui` 已经会先执行一次 preview，并拿到 `previewRowCount / previewColumnCount / previewColumns`；
- 这些信息已经足够支撑空结果、无数值列、结果结构不适合等首批 deterministic 判断；
- 这样可以更早 fail fast，避免无意义地继续调用 ai-service chart generation；
- `wren-ai-service` 后续可以保留 defensive check，但 Phase 1 不建议前后端各维护一套并行且可能漂移的规则。
- 当前 `thread_response.chart_detail` 本身就是可扩展 JSON 负载，Phase 1 新增 `chartability` / 更细的错误码语义，优先按**契约增量**落地；真正需要 response 拆分与关系字段的 migration，放到 Phase 2 再做。
- 如果 deterministic precheck 已确认“不可成图”，建议直接在 `wren-ui` server 把 `thread_response.chart_detail` 写为 terminal failed 状态（可不生成 `queryId`），并跳过 background tracker；这与当前前端按 `status` 判断完成态的逻辑兼容。

### 推荐流程

#### Step 1: Chart intent detection
输入：
- 当前 follow-up question
- source response question
- source SQL
- preview data

输出：
- 是否属于 chart follow-up
- 用户是否显式要求图表

#### Step 2: Chartability check
判断当前结果是否适合生成图表。**Phase 1 不做 LLM planner，只做 deterministic precheck**，建议 reasonCode 先收敛为：
- `EMPTY_RESULT_SET`
- `INSUFFICIENT_NUMERIC_FIELDS`
- `INSUFFICIENT_DATA_VARIATION`
- `UNSUPPORTED_RESULT_SHAPE`

说明：
- 不建议把 `SINGLE_ROW_RESULT` 作为硬编码 reasonCode，因为“单行”不等于一定不可视化；更准确的是判定是否存在足够的数据变化或可重组的指标结构；
- `UNSUPPORTED_WIDE_TABLE` 暂不放在 Phase 1，因为当前方案没有给出明确阈值，且它更适合在 Phase 3 的 planner 中处理；
- `SYSTEM_METRICS_SOURCE` 暂不放在 Phase 1，因为以当前代码和数据结构，并没有可靠的系统级标签或元数据可供 deterministic 判定。

#### Step 3: Chart planning
如果可图表化，再输出：
- `recommendedChartType`
- `dimensions`
- `measures`
- `optionalMeasures`
- `reason`

> 注意：这一步属于 **Phase 3**，不是 Phase 1。

#### Step 4: Chart schema generation
调用 AI chart generation 或后端 chart generator。

#### Step 5: Chart validation
校验返回 schema：
- mark 合法
- encoding 完整
- 至少有一个维度 + 一个指标
- 能通过当前渲染器

### 推荐接口输出结构
建议扩展 `chartDetail` / 新的 chart response 元数据，但要按 phase 渐进引入，而不是一次性把所有字段都上齐：

- **Phase 1**：`chartability`、细分后的 `error.code`、现有 `diagnostics`
- **Phase 2**：`currentStage`、`chartStages[]`
- **Phase 3**：`chartPlan`

这样可以避免在 Phase 1 就暴露大量长期为 `null` 的字段，也避免前端过早依赖尚未真正产出的 planner / stage 数据。

```ts
{
  status: 'FETCHING' | 'GENERATING' | 'FINISHED' | 'FAILED' | 'STOPPED',
  // Phase 1
  chartability?: {
    checked: boolean,
    chartable: boolean,
    reasonCode?:
      | 'OK'
      | 'EMPTY_RESULT_SET'
      | 'INSUFFICIENT_NUMERIC_FIELDS'
      | 'INSUFFICIENT_DATA_VARIATION'
      | 'UNSUPPORTED_RESULT_SHAPE',
  },
  // Phase 2
  currentStage?: 'intent' | 'chartability' | 'planning' | 'generation' | 'validation',
  chartStages?: Array<{
    key: 'intent' | 'chartability' | 'planning' | 'generation' | 'validation',
    status: 'pending' | 'running' | 'finished' | 'failed',
    detail?: string,
    startedAt?: string,
    finishedAt?: string,
  }>,
  // Phase 3
  chartPlan?: {
    recommendedChartType?: 'BAR' | 'LINE' | 'GROUPED_BAR' | 'PIE',
    dimensions?: string[],
    measures?: string[],
    optionalMeasures?: string[],
    reason?: string,
  },
  error?: {
    code:
      | 'UPSTREAM_DATA_ERROR'
      | 'AI_NO_CHART'
      | 'CHART_SCHEMA_INVALID'
      | 'OTHERS',
    message: string,
    shortMessage: string,
  },
  diagnostics?: {
    previewColumnCount: number,
    previewRowCount: number,
    previewColumns: Array<{ name: string; type?: string | null }>,
    submittedAt?: string,
    finalizedAt?: string,
  }
}
```

> 注意：`diagnostics` 继续保留在接口与日志，不直接原样暴露为面向普通用户的 UI 调试面板。
>
> 另外，`currentStage / chartStages` 只能作为 `status` 的**补充维度**，不能替代现有 `status`。当前 background tracker、thread recovery、前端完成态判断都直接依赖 `status` 做 finalized 判定，Phase 2 之前不能改写这条主语义。
>
> `chartability.reasonCode` 与 `chartStages.key` 应作为**稳定键**；面向用户的显示文案应由前端文案字典 / locale 层映射，不建议让后端直接返回已翻译好的 `summary` / `label` 作为主展示源。

---

## 6.2 服务端：统一图表失败原因的职责边界

当前统一 `NO_CHART` 不够好。建议拆成两层：

### A. `chartability.reasonCode`
用于**生成前**的确定性判定：

- `EMPTY_RESULT_SET`
- `INSUFFICIENT_NUMERIC_FIELDS`
- `INSUFFICIENT_DATA_VARIATION`
- `UNSUPPORTED_RESULT_SHAPE`

### B. `error.code`
用于**生成中 / 生成后**的运行时或产物失败：

- `UPSTREAM_DATA_ERROR`
- `AI_NO_CHART`
- `CHART_SCHEMA_INVALID`
- `OTHERS`

### 行为规范
- **空结果集 / 结构不适合**：优先落到 `chartability.reasonCode`，而不是一律映射为 `NO_CHART`
- **上游数据源失败**：保留原始后端 message，并映射为 `UPSTREAM_DATA_ERROR`
- **AI 未产出 schema**：才归类为 `AI_NO_CHART`
- **schema 校验失败 / JSON 解析失败**：归类为 `CHART_SCHEMA_INVALID`，不能再被吞并为统一 `NO_CHART`

### 落地约束
新增 chart 错误码时，不能只改单侧服务定义；需要同步收口以下层：

- `wren-ai-service` 的 chart / chart_adjustment 返回码；
- `wren-ui` 的 `GeneralErrorCodes`、`errorMessages`、`shortMessages`；
- `transformStatusAndError` 等 adaptor 兼容映射；
- 前端用户级提示与日志字段。

否则会出现“后端已细分错误码，但前端仍按旧 `NO_CHART` / `OTHERS` 处理”的半升级状态。

这样可以避免用户把所有失败都理解成“图表能力坏了”。

---

## 6.3 前端：交互层修改

### A. 把“生成图表”做成显式 follow-up 动作
在回答卡片 / SQL / Data Preview 附近提供明确入口：
- 生成图表
- 查看结果
- SQL 查询

并且要补一层统一入口契约：
- “生成图表”是 **new intent / follow-up action**；
- “查看图表 / 查看数据 / 查看 SQL”是 **artifact navigation**；
- 前者需要 `intentHint + sourceResponseId`；
- 后者只切换 `selectedResponse + activeWorkbenchArtifact`，不应重复发任务。

分阶段处理：
- **Phase 1**：允许先保留当前 response 内部 chart tab 的大形态，重点先补可解释失败与接口契约；
- **Phase 2**：再把点击动作升级为独立 chart follow-up 请求，并新增 chart response。

### B. Chart response 独立存在
左侧 timeline / response list 中，Chart 作为独立回答单元存在。

但这一步在当前代码里不是轻量改动，必须先完成**数据模型 / API 模型设计**。当前 thread 页面仍是单列对话流，chart 也仍然附着在原 response 的 `chartDetail` 上；同时 chart adjustment、dashboard pinning、thread recovery / polling 都默认 chart 属于原 response。

因此 Phase 2 先拆成两步：

1. **先定模型**
   - 最小落地路径：新增一条 `thread_response` 记录承载 chart follow-up，尽量复用现有表结构；
   - 推荐长期路径：为 `thread_response` 增加显式 `response_kind` / `parent_response_id`（或等价字段），让 chart follow-up 成为一等公民。
   - 最小 API / data contract 建议同步明确：
     - `responseKind: 'answer' | 'chart_followup'`
     - `parentResponseId?: number | null`
     - `sourceResponseId?: number | null`
     - `sourceAction?: 'generate_chart' | 'adjust_chart' | null`
     - `chartDetail` 仅挂在 chart follow-up response 上，不再混挂在主回答 response 上
     - `artifactPlan` / `conversationAidPlan` 作为增量契约补齐，供页面决定 teaser / workbench 行为
     - timeline 查询默认返回混合 response，并保留父子关系信息，供 pinning / recovery / workbench 使用
     - chart response 可通过 lineage 继承 source response 的 `preview/sql`，而不是复制一份结果
2. **再做页面与交互**
   - timeline 独立展示；
   - 右侧工作台承接 chart；
   - dashboard pinning / chart adjustment / polling / recovery 同步切到新的 chart response 语义。

这样带来的好处：
- 主回答仍然完整；
- 图表失败不会污染主回答；
- 图表有自己的状态机与历史。

### C. 结果工作台按需出现，而不是初始常驻
交互上要明确：

- 在只有问题输入、还没有任何结果时，**不出现右侧结果工作台**；
- 当当前选中的 response 已经有可渲染结果（如 SQL、Data Preview、Chart）时，才切出左右布局；
- 当 response 仍在 pending / thinking，但尚无可渲染结果时，**不因为任务已创建就打开空工作台**；
- 如果当前选中的是没有可渲染结果的 response（例如纯过程态、失败态且没有结果载荷），右侧结果区应自动收起；
- chart follow-up response 被选中时，右侧默认聚焦 `Chart`，但仍允许切回 `Data Preview / SQL Query`；
- ask response 与 chart response 的 tabs 要按可用 artifacts 条件渲染，不能固定写死永远三栏；
- replay / revisit 默认可以收起，live conversation 则可在 `primaryWorkbenchArtifact` ready 后自动展开。

这点很重要：右侧区域是**结果承载区**，不是页面骨架的一部分，不能一开始就占位成一个常驻空白面板。

### D. 右侧工作台保持结果导向
右侧建议统一为：
- Data Preview
- SQL Query
- Chart

Data Preview 应保持第一等公民地位。

同时要补齐 3 条页面语义：

1. **标题与动作绑定当前 selected response**
   - chart response 被选中时，标题显示 chart follow-up 的问题；
   - 不应显示 source response 的标题。
2. **chart-specific actions 仅在 chart 激活时显示**
   - 如 `Pin to dashboard` 只在 `activeWorkbenchArtifact = chart` 时显示；
   - preview / sql 场景显示自己的导出或查看动作。
3. **thinking steps / suggested follow-ups 不进入右侧工作台**
   - 它们属于左侧 response/timeline / conversational aid；
   - 右侧只承载 full viewer。

> 实施说明：这不是简单换一个 tab 文案。当前 thread 页没有现成的左右 workbench 结构，因此这一步应视为 **Phase 2 的页面布局重构**，而不是 Phase 1 的小修。

### E. 用户级失败文案优化
不暴露 diagnostics，但要给用户更清楚的失败文案：

- 当前查询结果为空，无法生成图表
- 当前结果更适合表格查看
- 当前数据源暂不可用，图表未生成
- AI 未生成可渲染图表，请尝试改写问题或明确图表目标
- 图表结果未通过校验，请稍后重试

> 实施说明：以上文案仅为产品语义示例。真正落地时，新增的用户可见文本（失败文案、按钮文案、状态标签）应统一进入**文案字典 / locale 层 / 多语言机制**，不能在组件里直接硬编码。

---

## 6.4 前端：thinking steps 结构改造

建议让 thinking steps 与商业版保持同类结构：

### 普通问答
如果希望把普通问答也做得接近参考图，建议按**更完整的 8 个可见步骤**设计，而不是当前 UI 的 3 个粗粒度步骤：

1. `Found X related Question-SQL pairs` / `No related Question-SQL pairs found`
2. `Found X related SQL queries instructions` / `No related SQL queries instructions found`
3. `User intent recognized`
4. `Found X candidate models`
5. `Thought for Xs`
6. `SQL statement generated for Xs`
7. `Fetched up to N data rows for Xs`
8. `Found X related summarizing instructions` / `No related summarizing instructions found`

基于最新代码，当前普通问答链路的现状是：

- **已经在用** `sql_pairs_retrieval`，不是没用；
- **已经在用** `instructions_retrieval(scope=\"sql\")`，不是没用；
- **已经有** intent classification、candidate models（`retrievedTables`）、sql generation reasoning、SQL generation 这些能力；
- **但当前 UI 没把这些 retrieval / instruction / fetch 阶段显式展示出来**，仍只展示 3 个粗步骤；
- **answer / summarizing instructions** 目前没有独立的 `scope=\"answer\"` retrieval 链路，因此第 8 步还不是现成能力，需要新增。

也就是说：图 1 里的步骤并不是凭空多出来的，其中前半部分（Question-SQL pairs / SQL instructions）我们当前后端其实已经在做，只是前端没有结构化地展示。

### 图表 follow-up
如果要按你的要求与参考图 **1:1 对齐**，建议图表 follow-up 明确按以下 **9 个步骤**展示：

1. `Found X related Question-SQL pairs` / `No related Question-SQL pairs found`
2. `Found X related SQL queries instructions` / `No related SQL queries instructions found`
3. `Fetched up to 500 data rows for Xs`
4. `User intent recognized`
5. `Found X related charts instructions` / `No related charts instructions found`
6. `Chart intent detected`
7. `Chart type selected`
8. `Chart generated`
9. `Chart validated`

其中基于最新代码，需要特别说明：

- 第 1、2 步可以复用普通问答主链路已经存在的 sql pair / sql instruction retrieval 结果；
- 第 3 步当前 chart generation 前已经会 preview 一次数据样本，天然适合映射成独立 step；
- 第 5 步 **当前还没有** `scope=\"chart\"` 的 instruction retrieval 接入，这是要新增的；
- 第 6~9 步当前也还没有稳定的数据契约，只能从最终 `status + error + diagnostics` 倒推，因此需要真正补契约。

并且这些 thinking steps 仍应显示在左侧 chart response 卡片中，而不是挪进右侧 workbench。

### 配套的数据契约
这部分不能只停留在 UI 愿景层。要支撑 thinking steps，后端 / 持久化层至少需要提供：

- `resolvedIntent.kind / mode / target`
- `artifactPlan`
- `sourceResponseId`
- `messageKey` / `messageParams`（用于前端按 locale 映射成 “Found X…”、“No related … found” 这类文本）
- `count`（如 sql pairs 数量、instructions 数量、candidate models 数量）
- `durationMs`
- `currentStage`
- `chartStages[]`
- 每个 stage 的 `status / detail / startedAt / finishedAt`

否则前端仍然只能根据单一 `status` 和最终 `error` 倒推出流程状态，无法稳定展示“卡在哪一步”。

> 实施边界：这组字段建议**从 Phase 2 开始引入**。Phase 1 仍以现有 `status + error + diagnostics` 为主，避免为了 thinking steps 过早扩大改造面。

这样：
- 用户知道系统卡在哪一步；
- 产品和研发定位问题也更清晰。

---

## 6.5 对系统 schema / metrics 模型的策略

### 原则
**不建议把“过滤模型”作为主解法。**

原因：
- 这只能掩盖一部分问题；
- 无法解释其他空结果 / wide table / schema invalid 的情况；
- 会把“能不能画图”的问题错误转化为“能不能检索到模型”的问题。

### 当前阶段的正确做法
- 对明显不稳定的数据源，先通过已有的执行错误链路返回 `UPSTREAM_DATA_ERROR`；
- 不把 `SYSTEM_METRICS_SOURCE` 作为 Phase 1 的 reasonCode；
- 如果后续确实要做“系统 metrics / 内部 schema”的智能处理，应先补**显式模型元数据 / 标签能力**，再考虑 retrieval 降权或策略路由。

### 何时做硬过滤
仅在以下场景考虑：
- 明确已知该数据源永远不稳定；
- 确认面向业务问答完全不适合作为候选；
- 且业务上不希望用户触达这些模型。

在当前阶段，不建议先走硬过滤。

---

## 7. 分阶段实施计划

## Phase 0：稳定当前链路（立即做，当前状态：已落地）

### 已修复并验证
- 修复 `@指定知识库` 资产数全为 0
- 修复 thread response / 推荐追问 / 推荐问题 polling 瞬时失败即停
- 修复 asking task `GENERAL / MISLEADING_QUERY` 未落库与未恢复问题
- 修复 runtime scope 相关接口初始化时序与瞬时失败重试

### 已确认待完成
- 修复 `PATCH /charts/{query_id}` 错误调用 `ask_service.stop_ask` 的 stop-chart 路由 bug
- 补齐 chart `custom_instruction` 从 `wren-ui -> adaptor -> wren-ai-service` 的透传链路
- 明确 chart instructions 的最终注入方案：仅走请求透传，还是后续接入 `scope="chart"` 的 retrieval

### 验收标准
- 问数链路不再因单次 polling 或 server 热更新而假死
- 样例空间与 PG 空间图表链路可成功
- “停止图表生成”具备真实效果，而不是 no-op
- [x] chart 指令链路不再处于半成品状态

## Phase 1：Chartability + ReasonCode（当前状态：主链路已落地）

### 目标
先补：
- 只做 `chartability`，不提前引入 `chartPlan`
- 为空结果 / 字段结构不适合 / 上游错误 / AI 无图 / schema 无效 建立明确边界
- [x] 不改变 UI 大形态，只做接口与状态语义增强（本轮实际已先推进到 Phase 2 主骨架）
- 清理现有 `ChartAnswer` 中基于“是否包含中文字符”的描述 fallback 逻辑，改为优先展示服务端返回文案；缺省文案走统一文案层，而不是硬编码中文替换
- 推荐默认**不在 Phase 1 扩 scope 到 `chart_adjustment`**，先把 chart generation 主链路做稳；若实现过程中触达共享错误映射导致无法完全隔离，则必须在同一批次同步补齐 `chart_adjustment`，不能让两条链路出现半升级语义漂移

### 验收标准
- 失败不再统一为 `NO_CHART`
- 接口层可区分：空结果、结构不适合、上游问题、AI 无图、schema 校验失败
- Phase 1 不暴露大量长期为 `null` 的 planner 字段
- Phase 1 新增的用户可见文本（错误提示、空态提示、状态标签）进入统一文案字典 / locale 层，不在组件中散落硬编码
- 不再根据“描述文本是否为中文”决定是否替换为固定中文 fallback
- chart generation 与 `chart_adjustment` 的范围边界清晰；若 Phase 1 不改 adjustment，代码和文档都要明确 guard，避免共享映射带来的语义漂移

## Phase 2：Chart follow-up 独立回答（当前状态：主骨架已落地，商业版细节仍待补齐）

### 目标
- 先落地 `resolved intent + artifactPlan + sourceResponseId` 这组最小 contract，作为页面交互与右侧 workbench 的上游语义基础
- [x] 先完成 chart follow-up 的数据模型 / API 模型设计
- 再把生成图表升级为独立 response 语义
- 左侧 timeline 出现单独 Chart 回答
- 右侧结果工作台承接图表
- 配套收口 dashboard pinning / chart adjustment / recovery / polling

### 验收标准
- 主回答与图表回答解耦
- 图表失败不破坏主回答
- chart response 的 source relation 清晰可追踪
- thread response / API 至少具备 `responseKind + parentResponseId`（或等价字段）这类可稳定表达父子关系的最小 contract
- thread response / API 具备 `sourceResponseId + artifactPlan + activeWorkbenchArtifact` 所需的最小语义，避免页面临时猜测
- dashboard / adjustment / recovery 都绑定到新的 chart response 语义
- `currentStage / chartStages` 为附加状态维度，`status` 仍保留为 finalized 判定主语义
- ask response 与 chart response 的 workbench tabs 为条件渲染；pending 且无 artifact 时不展示空工作台
- workbench 标题与动作绑定当前 selected response；chart response 通过 lineage 复用 source response 的 preview/sql
- 新增的用户可见文本（chart response 卡片标题、失败文案、thinking step 标签）需纳入统一文案字典 / locale 层 / 多语言机制，不硬编码

## Phase 3：Chart Planner（当前状态：尚未开始）

### 目标
- 服务端实现 chart planning
- 支持基础规则 + AI 规划混合
- 处理宽表、多指标、时间序列等更复杂结果形态
- 在这一阶段再引入 `chartPlan.recommendedChartType / dimensions / measures`

### 验收标准
- 宽表、多指标、时间序列等场景成功率显著提升
- 图表失败可定位到具体 stage

---

## 8. 验收标准

### 功能验收
1. 样例空间 HR 问题可稳定生成图表；
2. PostgreSQL HR 空间同类问题可稳定生成图表；
3. 空结果场景返回明确 reasonCode，而非统一 `NO_CHART`；
4. 图表 follow-up 可独立存在于回答流中；
5. 图表失败不再被用户理解成“整次问答失败”；
6. 右侧工作台只在有可渲染 artifact 时出现，pending 且无结果时不展示空工作台；
7. ask response / chart response 的 workbench tabs 为条件渲染，而不是固定永远三栏。

### 技术验收
1. asking task / thread response / chart task 在 server 重启后可恢复；
2. polling 对瞬时失败具备恢复能力；
3. runtime scope 相关请求在初始化时序上更稳；
4. chart diagnostics 保留在接口与日志中，便于排障；
5. 不引入前端 fallback 图。
6. stop-chart、chart adjustment、dashboard pinning 在新旧图表链路下都语义清晰。

---

## 9. 非目标

本方案当前明确**不做**：

1. 前端自动补图（fallback chart）
2. 在 UI 直接展示原始 diagnostics 调试信息
3. 通过大面积硬过滤模型来规避图表失败
4. 一步到位重写整个问答架构

---

## 10. 当前建议

基于当前现状，建议优先顺序如下：

1. **先完成 Phase 0：把现有半成品链路补齐**
   - 先修 stop-chart 路由 bug；
   - 先补 chart instruction 透传缺口；
   - 让当前链路先完整、可控。

2. **再完成 Phase 1：Chartability + ReasonCode**
   - 这是最小、最有效的产品改造；
   - 可以马上让图表失败变得可解释；
   - 同时避免继续把不同错误都压成 `NO_CHART`。

3. **在推进 Phase 2 前，先补 Home 统一 intent / artifact contract**
   - chart follow-up 页面不是孤立问题；
   - 如果没有 `resolved intent + artifactPlan + sourceResponseId + activeWorkbenchArtifact`，页面层只能继续靠局部猜测拼交互；
   - 这一步不一定要比 Phase 2 单独拆成更大的项目，但至少要作为 Phase 2 的前置契约一起落地。

4. **然后推进 Phase 2：Chart follow-up 独立回答**
   - 这一步最接近商业版体验；
   - 但应先定数据模型，再做页面重构。

5. **最后做 Phase 3：Chart Planner**
   - 解决“图表到底该选什么类型”的智能化问题；
   - 是长期正确方向。

---

## 11. 附：当前已验证事实（2026-04-21）

### 问数链路
- 普通业务问题在 TiDB 业务知识库中可成功完成；
- 之前“生成 SQL / 整理回答后卡住”的主问题已修复。

### 图表链路
- 样例空间 HR：成功；
- PostgreSQL HR：成功；
- TiDB 业务知识库中的合理业务问题：成功；
- 某些失败案例不是链路坏，而是：
  - 空结果集；
  - 或上游数据源错误（如 `pd unavailable`）。

### 说明
因此当前最值得做的，不是简单“过滤模型”，而是把：
- **图表意图识别**
- **图表可行性判断**
- **图表类型选择**
- **图表生成与校验**

这几个阶段真正结构化。

### 基于最新代码补充确认
- `PATCH /charts/{query_id}` 当前仍错误调用 `ask_service.stop_ask`，stop-chart bug 已被代码证实；
- `chart.custom_instruction` 在 `wren-ai-service` 端已具备字段与 prompt 支持，但 `wren-ui` adaptor 仍未透传；
- 当前 chart 仍附着在原 `thread_response.chart_detail` 上，dashboard pinning、chart adjustment、thread recovery 都默认这一语义，因此 Phase 2 不能只改 UI，而要先定 response/data model。
- chart follow-up 若要真正贴近商业版，不能只做“把 chart tab 挪到右边”；还必须同步补齐 `sourceResponseId`、artifact lineage、conditional tabs、按需打开的 workbench 语义。
