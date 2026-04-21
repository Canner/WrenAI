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

> 说明：商业版内部实现细节无法直接访问，本文对商业版的流程拆分属于**基于截图与交互行为的推断**，不是对其私有代码的逐字复述。

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
   - tabs 包含：Data Preview / SQL Query / Chart；
   - Chart 是在结果工作台里展示，而非单独漂浮的组件。

3. **图表之前已有稳定的数据基础**
   - Data Preview 是一等公民；
   - 即使图表失败，用户仍应能使用表格和 SQL。

4. **图表流程是“先 planning，再 generation”**
   - 从 thinking steps 可见 `Chart type selected` 与 `Chart validated` 是独立阶段；
   - 说明商业版并不是简单让 LLM 直接返回最终图。

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
- `chart_detail.error.code = NO_CHART`
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

本仓库当前更像：
- 主问答完成后，在原 response 上附着 chart tab；
- 用户感知上图表像主回答的附属结果；
- chart planning / type selection / validation 阶段没有单独产品化表达。

### 4.2 错误表达差异

商业版倾向于：
- 先有 Data Preview / SQL；
- 图表是显式增强动作；
- 图表失败不会吞掉主结果。

本仓库当前：
- 图表失败往往只表现为 `NO_CHART`；
- 缺少对“为什么不能画”的明确用户语义；
- 主回答与图表行为边界不够清楚。

### 4.3 交互建模差异

商业版：
- 图表 follow-up 是独立回答；
- thinking steps 明确显示 chart stages；
- 右侧工作台承接图表结果。

本仓库：
- 图表是回答页中的一个 tab；
- 图表生成更像回答的附加动作；
- 缺少 chart planner 语义层。

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

### 5.2 目标交互

#### 主回答阶段
用户输入问题后，系统生成：
- 回答
- SQL 查询
- Data Preview

#### 图表阶段
用户点击“生成图表”或追问“生成一张图表给我”后：
- 新建一个 chart follow-up response；
- 右侧结果工作台展示 Data Preview / SQL Query / Chart；
- 左侧 timeline 显示新的 Chart 回答单元。

---

## 6. 本仓库修改方案

## 6.1 服务端：引入 Chart Planner / Chartability 层

### 目标
在真正调用 chart generation 之前，先做一层“是否适合成图 + 适合什么图”的判定。

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
判断当前结果是否适合生成图表，例如：
- `EMPTY_RESULT_SET`
- `SINGLE_ROW_RESULT`
- `INSUFFICIENT_NUMERIC_FIELDS`
- `UNSUPPORTED_WIDE_TABLE`
- `SYSTEM_METRICS_SOURCE`
- `UPSTREAM_QUERY_ERROR`

#### Step 3: Chart planning
如果可图表化，再输出：
- `recommendedChartType`
- `dimensions`
- `measures`
- `optionalMeasures`
- `reason`

#### Step 4: Chart schema generation
调用 AI chart generation 或后端 chart generator。

#### Step 5: Chart validation
校验返回 schema：
- mark 合法
- encoding 完整
- 至少有一个维度 + 一个指标
- 能通过当前渲染器

### 推荐接口输出结构
建议扩展 `chartDetail` / 新的 chart response 元数据：

```ts
{
  status: 'PLANNING' | 'GENERATING' | 'VALIDATING' | 'FINISHED' | 'FAILED',
  planner: {
    chartable: boolean,
    reasonCode?:
      | 'OK'
      | 'EMPTY_RESULT_SET'
      | 'SINGLE_ROW_RESULT'
      | 'INSUFFICIENT_NUMERIC_FIELDS'
      | 'UNSUPPORTED_WIDE_TABLE'
      | 'SYSTEM_METRICS_SOURCE'
      | 'UPSTREAM_QUERY_ERROR',
    recommendedChartType?: 'BAR' | 'LINE' | 'GROUPED_BAR' | 'PIE',
    dimensions?: string[],
    measures?: string[],
  },
  error?: {
    code: string,
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

---

## 6.2 服务端：图表失败原因细化

当前统一 `NO_CHART` 不够好。建议拆分为：

- `EMPTY_RESULT_SET`
- `UNSUPPORTED_RESULT_SHAPE`
- `AI_NO_CHART`
- `CHART_SCHEMA_INVALID`
- `UPSTREAM_DATA_ERROR`

### 行为规范
- **空结果集**：不应再落成统一 `NO_CHART`
- **上游数据源失败**：保留原始后端 message，并映射更明确 code
- **AI 未产出 schema**：才归类为 `AI_NO_CHART`

这样可以避免用户把所有失败都理解成“图表能力坏了”。

---

## 6.3 前端：交互层修改

### A. 把“生成图表”做成显式 follow-up 动作
在回答卡片 / SQL / Data Preview 附近提供明确入口：
- 生成图表
- 查看结果
- SQL 查询

用户点击后，不再只是切到原 response 内部 tab，而是：
- 触发一次独立 chart follow-up 请求；
- 新增一个 chart response。

### B. Chart response 独立存在
左侧 timeline / response list 中，Chart 作为独立回答单元存在。

这样带来的好处：
- 主回答仍然完整；
- 图表失败不会污染主回答；
- 图表有自己的状态机与历史。

### C. 右侧工作台保持结果导向
右侧建议统一为：
- Data Preview
- SQL Query
- Chart

Data Preview 应保持第一等公民地位。

### D. 用户级失败文案优化
不暴露 diagnostics，但要给用户更清楚的失败文案：

- 当前查询结果为空，无法生成图表
- 当前结果更适合表格查看
- 当前查询命中了系统监控指标源，暂不支持该图表生成方式
- 图表生成失败，请尝试改写问题或换一种展示目标

---

## 6.4 前端：thinking steps 结构改造

建议让 thinking steps 与商业版保持同类结构：

### 普通问答
- User intent recognized
- Candidate models found
- SQL generated
- Data fetched
- Answer summarized

### 图表 follow-up
- Chart intent detected
- Chartability checked
- Chart type selected
- Chart generated
- Chart validated

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

### 正确做法
把系统 schema / metrics 表处理为：
- **retrieval 降权**，而非绝对过滤；
- 在 chartability check 中增加标签：
  - `SYSTEM_METRICS_SOURCE`
  - `UPSTREAM_DATA_ERROR`

### 何时做硬过滤
仅在以下场景考虑：
- 明确已知该数据源永远不稳定；
- 确认面向业务问答完全不适合作为候选；
- 且业务上不希望用户触达这些模型。

在当前阶段，不建议先走硬过滤。

---

## 7. 分阶段实施计划

## Phase 0：稳定当前链路（立即做）

### 已完成 / 进行中
- 修复 `@指定知识库` 资产数全为 0
- 修复 thread response / 推荐追问 / 推荐问题 polling 瞬时失败即停
- 修复 asking task `GENERAL / MISLEADING_QUERY` 未落库与未恢复问题
- 修复 runtime scope 相关接口初始化时序与瞬时失败重试

### 验收标准
- 问数链路不再因单次 polling 或 server 热更新而假死
- 样例空间与 PG 空间图表链路可成功

## Phase 1：Chartability + ReasonCode

### 目标
先补：
- 空结果 / 单行 / 无数值列 / 上游错误 的明确 reasonCode
- 不改变 UI 大形态

### 验收标准
- 失败不再统一为 `NO_CHART`
- 接口层可区分：空结果、结构不适合、上游问题、AI 无图

## Phase 2：Chart follow-up 独立回答

### 目标
- 生成图表改为独立 response 类型
- 左侧 timeline 出现单独 Chart 回答
- 右侧结果工作台承接图表

### 验收标准
- 主回答与图表回答解耦
- 图表失败不破坏主回答

## Phase 3：Chart Planner

### 目标
- 服务端实现 chart planning
- 支持基础规则 + AI 规划混合

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
5. 图表失败不再被用户理解成“整次问答失败”。

### 技术验收
1. asking task / thread response / chart task 在 server 重启后可恢复；
2. polling 对瞬时失败具备恢复能力；
3. runtime scope 相关请求在初始化时序上更稳；
4. chart diagnostics 保留在接口与日志中，便于排障；
5. 不引入前端 fallback 图。

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

1. **先完成 Phase 1：Chartability + ReasonCode**
   - 这是最小、最有效的下一步；
   - 可以马上让图表失败变得可解释。

2. **再完成 Phase 2：Chart follow-up 独立回答**
   - 这一步最接近商业版体验；
   - 能显著提升用户对图表能力的理解。

3. **最后做 Phase 3：Chart Planner**
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
