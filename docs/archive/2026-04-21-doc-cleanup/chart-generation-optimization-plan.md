# 图表生成优化方案

> 历史说明（2026-04-16）：本文保留的是 Apollo/GraphQL 时代的设计、排障或执行记录。当前 `wren-ui` 运行时前端已经切到 REST，代码目录也已收口到 `src/server/*` 与 `src/pages/api/v1/*`；文中的旧 GraphQL 入口、resolver 与 Apollo 上下文描述仅作历史背景，不再代表当前主链路。

更新时间：2026-04-15

> 本文档面向当前 WrenAI V1 的问答页 / Dashboard 图表生成链路，目标是把现有“可用但偏前端补救式”的实现，收敛为一套**服务端产出可渲染 canonical spec、前端负责展示与轻量交互、后台任务可恢复、编辑模型分层清晰**的稳定方案。
>
> 本文档覆盖：图表生成、图表调整、图表持久化、后台轮询任务、预览数据复用、渲染策略与测试补强。
>
> 本文档不覆盖：完整 BI grammar 重构、替换 Vega/Vega-Lite、Dashboard 领域模型重做。

---

## 1. 当前实现现状

### 1.1 当前主链路

当前图表生成主路径如下：

```text
用户在问答结果页打开 Chart tab
  -> 前端触发 generate chart
  -> 后端创建/更新 thread response.chartDetail.status = FETCHING
  -> ChartBackgroundTracker 轮询 AI service 获取 chart 结果
  -> 后端把 AI 返回的 chartSchema 写回 chartDetail
  -> 前端轮询 response 状态
  -> 前端本地对 chartSchema 做规范化/修补
  -> 前端 compile Vega-Lite spec
  -> 前端通过 vega-embed 渲染
```

### 1.2 当前链路里的关键事实

1. **图表是惰性生成**，不是首屏就生成；只有切到 Chart tab 才触发
2. **图表生成是异步任务**，后端通过 tracker 轮询 AI service，再把状态和结果写回 `thread_response.chartDetail`
3. **服务端主路径已开始保存 canonical 结果与 hints**，但前端仍保留少量 legacy fallback / render patch 逻辑等待继续收口
4. **图表编辑分两类混在一起**：
   - 轻量显示控制与 deterministic 结构编辑已可在本地 / 服务端纯函数链路完成（如 `hideLegend`、`hideTitle`、`Show top 25`、切换图型、改 X/Y/color/theta 等）
   - 语义性调整仍保留 AI 路径，职责边界还需继续收口
5. **旧的服务端 `/api/v1/generate_vega_chart` 路径仍保留**，但已切到 `canonicalizeChartSchema + shapeChartPreviewData + authz`；当前仓内未见主链路调用，定位上应视为 deprecated compatibility endpoint，剩余问题主要是接口与主链路仍分叉

### 1.3 当前实现对应文件

- 图表 tab 惰性触发：
  - `wren-ui/src/components/pages/home/promptThread/AnswerResult.tsx`
- 前端发起 chart 任务 / 轮询结果：
  - `wren-ui/src/pages/home/[id].tsx`
  - `wren-ui/src/server/services/askingService.ts`
- 后台 chart tracker：
  - `wren-ui/src/server/backgrounds/chart.ts`
- 前后端图表规范化 / compile / render：
  - `wren-ui/src/utils/chartSpecRuntime.ts`
  - `wren-ui/src/components/chart/index.tsx`
  - `wren-ui/src/components/chart/render.ts`
  - `wren-ui/src/components/chart/meta.ts`
  - `wren-ui/src/components/chart/config.ts`
- 旧服务端增强链路：
  - `wren-ui/src/pages/api/v1/generate_vega_chart.ts`
- 图表编辑 UI：
  - `wren-ui/src/components/pages/home/promptThread/ChartAnswer.tsx`
- preview data 使用点：
  - `wren-ui/src/components/pages/home/promptThread/ChartAnswer.tsx`
  - `wren-ui/src/components/pages/home/promptThread/TextBasedAnswer.tsx`
  - `wren-ui/src/components/pages/home/promptThread/ViewSQLTabContent.tsx`
- dashboard 图表渲染：
  - `wren-ui/src/components/pages/home/dashboardGrid/index.tsx`

---

## 2. 核心问题盘点

### 2.1 服务端没有 canonical renderable spec

当前主链路里，服务端保存的是 AI 返回的原始 `chartSchema`，而不是一份经过统一规范化和校验的“可渲染最终 spec”。

直接后果：

1. 同一张图是否能渲染，要到浏览器里才知道
2. 前端承担了过多“修 spec / 补字段 / 降级兜底”的职责
3. 服务端无法统一保证图表质量，也无法稳定做缓存、测试和回放
4. 同时存在旧服务端增强逻辑与新前端补救逻辑，两套规则源长期会漂移

### 2.2 Tracker 不 durable，失败恢复能力不足

当前 `ChartBackgroundTracker` / `ChartAdjustmentBackgroundTracker` 的主要问题：

1. 基于进程内 `setInterval`
2. `runningJobs` 没有 `try/finally` 级别的可靠清理
3. 一旦轮询或写库异常，job 可能卡死在“正在跑”状态
4. 进程重启后，内存任务会丢失
5. tracker 中保存的是旧 `threadResponse` 快照，状态推进后内存对象不一定同步刷新

这类问题本质上是**后台状态机不稳定**，优先级高于体验问题。

### 2.3 Deterministic edit 仍然过度依赖 AI

当前图表编辑存在边界不清：

- 适合本地立即处理的结构化编辑：
  - chartType
  - xAxis / yAxis
  - color
  - xOffset
  - theta
- 仍会走 AI 调整任务

这会带来：

1. 延迟高
2. 成本高
3. 调整结果不稳定
4. 用户对“只是换个图型为什么要重新等 AI”感知不好

正确边界应当是：

- **deterministic edit 本地即时完成**
- **semantic edit 才走 AI**

### 2.4 Preview data 存在重复请求与重复整形

当前至少有 3 处在按 `responseId` 拉取 preview data：

- `ChartAnswer`
- `TextBasedAnswer`
- `ViewSQLTabContent`

这会带来：

1. 同一 response 重复发请求
2. 同一批字段映射 / alias 对齐逻辑重复出现
3. 图表与表格看到的数据上下文容易发生轻微漂移

### 2.5 Top-N / sampling / auto-filter 主要在前端渲染阶段处理

目前类别过多、图表过密等问题，主要通过前端渲染阶段做补救：

- 类别过多时直接返回 `null`
- 用户再点 `Show top 25`
- dashboard 模式再加一层自动过滤

这比完全不处理要好，但问题在于：

1. 数据 shaping 太晚才发生
2. 服务端不知道最终给用户看的到底是哪份数据
3. dashboard / answer / edit 之间难以保持一致

### 2.6 渲染层偏重，Dashboard 多图场景扩展性一般

当前前端渲染链路默认：

- 客户端 compile
- `vega-embed`
- 固定 `renderer: 'svg'`

在单图场景问题不大，但 Dashboard 多图并发时：

1. SVG DOM 成本更高
2. 每张图都重新 compile
3. 没有 compiled spec cache

### 2.7 测试保护不足

已有：

- `ChartAnswer.test.tsx`
- `chartSpecRuntime.test.ts`
- `render.test.ts`
- `meta.test.ts`

缺失：

- tracker 状态机专项测试
- canonicalization 契约测试
- deterministic edit 测试
- dashboard renderer 策略测试

---

## 3. 优化目标

本次优化后，图表链路应达到以下目标：

1. **服务端产出 canonical renderable spec**，前端不再承担主要规范化职责
2. **后台任务可恢复、可重试、可观测**，进程重启后不丢任务
3. **图表编辑分层清晰**：本地 deterministic edit + AI semantic edit
4. **同一 response 的 preview data 只拉一次并共享**
5. **top-N / downsample / other bucket 尽量前移到服务端 data shaping**
6. **dashboard 多图场景具备 renderer 自适应与缓存能力**
7. **图表主链路有稳定的测试保护**

---

## 4. 目标架构

### 4.1 目标主链路

```text
用户打开 Chart tab
  -> 后端创建/恢复 chart generation job
  -> AI service 返回 rawChartSchema
  -> 服务端执行 canonicalize + validate + renderHint inference
  -> 服务端持久化 chartSchema(=canonical spec) / rawChartSchema / metadata
  -> 前端拉取 response
  -> 前端直接 render chartSchema
  -> 用户做快速编辑时本地即时变换 canonical spec
  -> 用户做语义编辑时才提交 AI 调整任务
```

### 4.2 核心原则

#### 原则 A：服务端负责“规范化后的真相”

最终持久化到 `thread_response.chartDetail` 的不应只是原始 AI 输出，而应包含：

- 原始输出（便于诊断）
- 规范化后的 canonical spec（用于真正渲染）
- 渲染 hint（用于 renderer/交互策略）
- 校验结果 / 降级信息

#### 原则 B：前端负责展示与轻量交互，不负责主规范化

前端仍可以做：

- theme 注入
- 尺寸响应式适配
- hideLegend / hideTitle 等轻量展示切换
- deterministic field remap

但前端不应再承担：

- AI 输出兜底修复的主职责
- 是否“能渲染”这件事的最终判定

#### 原则 C：deterministic edit 与 semantic edit 分层

- **Deterministic edit**：本地规则变换，立即预览，不走 AI
- **Semantic edit**：需要理解语义意图或重新推断图表结构时才走 AI

#### 原则 D：后台 job 的真相必须 durable

无论是否后续引入真正队列系统，本期至少要做到：

- job 状态以数据库持久化状态为真相
- 重启后可恢复 `FETCHING / GENERATING`
- 每次轮询都能幂等推进状态

---

## 5. 详细改造方案

### 5.1 服务端 canonicalization / validation 收口

#### 5.1.1 要解决的问题

把当前分散在以下位置的规则收口成一套：

- `wren-ui/src/utils/chartSpecRuntime.ts`
- `wren-ui/src/components/chart/render.ts`
- `wren-ui/src/components/chart/meta.ts`
- `wren-ui/src/pages/api/v1/generate_vega_chart.ts`

目标是形成**唯一的 chart normalization rule source**。

#### 5.1.2 建议产物

当前已落地的统一职责面（以现有实现为准）：

- `wren-ui/src/utils/chartSpecRuntime.ts`
  - 服务端 canonicalization
  - validation / render hint inference
  - preview data shaping
- `wren-ui/src/components/chart/render.ts`
  - 前端轻量 render patch
  - top categories fallback 展示策略
  - renderer 选择
- `wren-ui/src/components/chart/meta.ts`
  - chart type / field title / option value 纯函数提取

职责分别是：

1. **Normalizer**
   - 把 raw chart schema 规范化成可渲染 canonical spec
   - 处理 mark / encoding / axis / legend / aggregate / fallback
   - 处理已知兼容问题与最小修复
2. **Validator**
   - 对 canonical spec 做结构校验
   - 返回错误、警告与降级信息
3. **RenderHints**
   - 推断建议 renderer（svg/canvas）
   - 推断 large category / dense series / scroll / pagination 等 UI hint

#### 5.1.3 持久化模型建议

在 `thread_response.chartDetail` 中新增或收敛以下字段：

```ts
chartDetail: {
  status: 'FETCHING' | 'GENERATING' | 'FINISHED' | 'FAILED'
  rawChartSchema: Json | null
  chartSchema: Json | null // 当前承载 canonical renderable spec
  canonicalizationVersion: string | null
  renderHints: {
    preferredRenderer?: 'svg' | 'canvas'
    categoryCount?: number
    isLargeCategory?: boolean
    isDenseSeries?: boolean
    suggestedTopN?: number | null
  } | null
  validation: {
    warnings?: string[]
    errors?: string[]
    degraded?: boolean
  } | null
  adjustmentMode?: 'local' | 'ai' | null
  lastError?: string | null
  updatedAt?: string
}
```

说明：

- `rawChartSchema` 用于诊断与回放
- `chartSchema` 当前即前端渲染主输入（语义上等价于 canonicalChartSpec）
- `canonicalizationVersion` 用于未来规则升级与回刷

#### 5.1.4 兼容策略

在迁移期内：

1. 若 `chartSchema` 已是服务端 canonical spec，前端直接渲染
2. 旧 `/generate_vega_chart` 仅保留为 deprecated compatibility endpoint
3. 前端只保留轻量 render patch，不再回退到 class-based handler 逻辑

这样可以避免一次性切换导致旧数据无法显示。

---

### 5.2 Chart job 稳定性改造

#### 5.2.1 最小可行目标

在不强制引入外部队列的前提下，本期至少完成：

1. `try/finally` 清理 `runningJobs`
2. 失败重试与指数退避
3. 进程启动时恢复未完成 job
4. 轮询推进幂等化
5. 统一 terminal state

#### 5.2.2 状态机建议

```text
IDLE
  -> FETCHING        # 已创建任务，等待 AI service 完成
  -> GENERATING      # 正在服务端规范化 / 校验 / 写回
  -> FINISHED        # 成功
  -> FAILED          # 失败
```

补充字段建议：

- `retryCount`
- `nextRetryAt`
- `lastPolledAt`
- `jobStartedAt`
- `jobFinishedAt`

这些字段可以先挂在 `chartDetail` 内，不一定首期拆独立表。

#### 5.2.3 启动恢复策略

应用启动时扫描：

- `chartDetail.status in ('FETCHING', 'GENERATING')`

恢复逻辑：

1. 若 AI service 结果已完成，则直接拉取并继续后续规范化
2. 若尚未完成，则重新登记轮询
3. 若超出最大时限，标为 `FAILED`

#### 5.2.4 幂等要求

同一个 `responseId` 的 job 恢复、重试、重复触发都必须满足：

- 不重复创建结果
- 不重复进入无限轮询
- 成功写回后不会被旧轮询覆盖

---

### 5.3 图表编辑模型分层

#### 5.3.1 Local deterministic edits

以下编辑应完全本地化，不再走 AI：

- 切换图型（bar / line / area / pie / scatter 等既有可支持图型）
- 切换 X / Y / color / theta / xOffset 等字段映射
- 隐藏 / 显示 legend
- 隐藏 / 显示 title
- top-N 展示
- 基于 renderHints 的简单 dense fallback

实现方式：

- 基于 `chartSchema`（当前 canonical spec）做纯函数变换
- UI 即时预览
- 仅在用户确认后把本地 patch 写回 `chartDetail` 或作为会话态缓存

#### 5.3.2 AI semantic edits

以下才走 AI：

- “换一种更适合表达趋势的图”
- “突出异常点”
- “把同比和环比一起表达清楚”
- “保留分类但改成更适合高基数场景的视图”

即：只有当编辑请求本质上需要重新做语义推断时，才进入 AI 调整任务。

#### 5.3.3 前端交互建议

图表编辑 UI 拆成两块：

1. **快速编辑**
   - 图型
   - 轴字段
   - 颜色字段
   - legend/title
   - top-N
2. **AI 调整**
   - 自然语言输入
   - 异步生成

这样可以让用户明确知道：

- 哪些操作是立即生效的
- 哪些操作需要等待 AI

---

### 5.4 Preview data 共享层

#### 5.4.1 目标

同一个 `responseId` 的 preview data 只请求一次，供：

- `TextBasedAnswer`
- `ChartAnswer`
- `ViewSQLTabContent`

共享。

#### 5.4.2 建议实现

新增统一 hook / 数据层（命名可微调）：

- `wren-ui/src/hooks/useResponsePreviewData.ts`

能力：

1. 按 `responseId` 缓存 preview data
2. 统一字段 alias / label / type metadata 整形
3. 提供 loading / error / refresh
4. 支持图表与表格共用同一份 preview data

#### 5.4.3 收益

- 避免重复请求
- 避免重复字段清洗逻辑
- 保证图表和文本/SQL tab 看到的数据一致

---

### 5.5 Chart-oriented data shaping 前移到服务端

#### 5.5.1 服务端应接管的 shaping

建议把以下逻辑从“前端渲染补救”前移到“服务端图表准备阶段”：

- top-N
- other bucket
- 时间粒度降采样
- dense line downsample
- 必要时的数值 binning

#### 5.5.2 设计原则

- UI 看到的图表数据，应尽量对应服务端明确产出的结果
- shaping 结果要可解释、可记录
- 不能只在浏览器里偷偷裁剪数据

#### 5.5.3 持久化建议

`chartDetail` 可增加：

```ts
chartDataProfile: {
  appliedShaping?: Array<
    | { type: 'top_n'; value: number }
    | { type: 'other_bucket' }
    | { type: 'time_downsample'; granularity: string }
    | { type: 'series_downsample'; value: number }
  >
}
```

这样诊断时能明确回答：“这张图为什么只展示 top 25”。

---

### 5.6 渲染层优化

#### 5.6.1 Renderer 自适应

建议策略：

- 单图 / 导出优先 `svg`
- dashboard 多图 / 稠密图优先 `canvas`

由服务端 `renderHints.preferredRenderer` 提示，前端再结合实际容器与交互需求做最终决策。

#### 5.6.2 Compiled spec cache

当前每次渲染都 compile，建议引入以 `responseId + canonicalizationVersion + localEditHash` 为 key 的 compiled spec cache。

收益：

- 减少重复 compile
- 提升 dashboard 多图场景渲染速度

#### 5.6.3 轻量前端职责

前端图表层收敛为：

1. 读取 `chartSchema`（canonical spec）
2. 应用本地快速编辑 patch
3. 选择 renderer
4. 渲染

而不是再承担主规范化逻辑。

---

### 5.7 观测与诊断

图表链路需要最少具备以下诊断能力：

1. job 状态推进日志
2. chart canonicalization 失败日志
3. validation warning / degraded 信息
4. preview data 拉取命中率 / cache 命中率
5. dashboard renderer 分布（svg vs canvas）
6. AI 调整与本地快速编辑的占比

建议在 BFF 中补统一日志字段：

- `workspaceId`
- `threadId`
- `responseId`
- `chartJobStatus`
- `chartAdjustmentMode`
- `canonicalizationVersion`
- `retryCount`

---

### 5.8 测试方案

#### 5.8.1 必补测试

#### A. Tracker 状态机测试

覆盖：

- 正常完成
- AI 结果拉取失败后重试
- 写库异常后的 finally 清理
- 启动恢复未完成任务
- 超时失败

#### B. Canonicalization 规则测试

覆盖：

- 常见 chart schema 正常规范化
- 缺字段 / 异常 schema 降级
- mark/encoding fallback
- renderHints 推断

#### C. Deterministic edit 测试

覆盖：

- chartType 切换
- x/y/color remap
- hideLegend / hideTitle
- top-N patch

#### D. Preview data 共享测试

覆盖：

- 同一 `responseId` 只发一次请求
- 多组件共享缓存
- refresh 行为

#### E. Dashboard renderer 策略测试

覆盖：

- 单图默认 svg
- dense / multi-card 默认 canvas
- cache key 变更时正确重编译

---

## 6. 分阶段实施计划

### 6.1 P0：稳定性止血

优先级最高，先把后台任务从“可能卡死 / 重启丢任务”修到“可恢复”。

#### 范围

1. `backgrounds/chart.ts` 增加 `try/finally`
2. 引入 retry/backoff
3. 启动恢复 `FETCHING / GENERATING`
4. 统一 terminal state
5. 修复旧快照导致的重复推进问题

#### 验收

- tracker 任一轮询异常后不会永久卡住 `runningJobs`
- 进程重启后能恢复未完成 chart 任务
- 同一 response 不会出现双 tracker 无限竞争

---

### 6.2 P1：服务端收口与前端降负

#### 范围

1. 服务端 canonicalization/validation 模块落地
2. `chartDetail` 扩充为 raw + canonical + hints
3. 前端优先渲染 canonical `chartSchema`
4. deterministic edit 本地化
5. preview data 共享 hook 落地
6. 旧前端主规范化职责完全移除

#### 验收

- 服务端保存的 canonical spec 可直接渲染
- chartType/x/y/color 等快速编辑不再走 AI round-trip
- `ChartAnswer` / `TextBasedAnswer` / `ViewSQLTabContent` 共用 preview data
- `Chart` 组件主路径不再依赖 legacy `ChartSpecHandler`
- legacy `ChartSpecHandler` / `vegaSpecUtils` 已删除

---

### 6.3 P2：性能与可维护性增强

#### 范围

1. server-side chart data shaping
2. renderHints 完整化
3. dashboard adaptive renderer
4. compiled spec cache
5. 旧 `/generate_vega_chart` 路径和双规则源收口

#### 验收

- top-N / downsample / other bucket 由服务端明确产出
- dashboard 多图场景可按 hint 自动选择 renderer
- 规范化规则源收敛为一套

---

## 7. 数据结构与 API 调整建议

### 7.1 `thread_response.chartDetail` 当前落地形态（与代码保持一致）

```ts
interface ThreadResponseChartDetail {
  status: 'FETCHING' | 'GENERATING' | 'FINISHED' | 'FAILED';
  rawChartSchema?: Record<string, unknown> | null;
  chartSchema?: Record<string, unknown> | null; // 当前承载 canonical renderable spec
  canonicalizationVersion?: string | null;
  renderHints?: {
    preferredRenderer?: 'svg' | 'canvas';
    categoryCount?: number;
    isLargeCategory?: boolean;
    isDenseSeries?: boolean;
    suggestedTopN?: number | null;
  } | null;
  validationErrors?: string[] | null;
  chartDataProfile?: {
    sourceRowCount?: number;
    resultRowCount?: number;
    appliedShaping?: Array<Record<string, unknown>>;
  } | null;
  retryCount?: number;
  nextRetryAt?: string | null;
  lastPolledAt?: string | null;
  lastError?: string | null;
  updatedAt?: string;
}
```

### 7.2 API 兼容要求

迁移期间：

1. 旧前端仍可读取旧 `chartSchema`
2. 当前实现直接以 `chartSchema` 作为 canonical renderable spec
3. 旧 `/generate_vega_chart` 仅作为 deprecated compatibility endpoint 保留
4. `adjustChart` API 需要区分：
   - `mode=local`：本地 patch 提交/保存
   - `mode=ai`：语义调整任务

### 7.3 Deprecated `/generate_vega_chart` 移除门槛

当前该接口仅作兼容保留；仓内未见 ask/chart 主链路调用。

建议移除门槛：

1. `api_history` 中 `GENERATE_VEGA_CHART` 连续一个发布观察窗口无调用
2. 外部调用方已迁移到统一 ask/chart workflow
3. 删除时一并收口以下残留：
   - `wren-ui/src/pages/api/v1/generate_vega_chart.ts`
   - `wren-ui/openapi.yaml` 中 `/generate_vega_chart`
   - `ApiType.GENERATE_VEGA_CHART` 及其旧 GraphQL / schema 暴露
   - API history 中针对 `vegaSpec.data.values` 的兼容脱敏分支
   - 相关兼容测试

---

## 8. 影响范围

本方案预计会影响以下模块：

### 后端 / BFF

- `wren-ui/src/server/services/askingService.ts`
- `wren-ui/src/server/backgrounds/chart.ts`
- `wren-ui/src/pages/api/v1/generate_vega_chart.ts`
- `wren-ui/src/utils/chartSpecRuntime.ts`

### 前端

- `wren-ui/src/components/chart/index.tsx`
- `wren-ui/src/components/chart/render.ts`
- `wren-ui/src/components/chart/meta.ts`
- `wren-ui/src/components/chart/config.ts`
- `wren-ui/src/components/pages/home/promptThread/ChartAnswer.tsx`
- `wren-ui/src/components/pages/home/promptThread/TextBasedAnswer.tsx`
- `wren-ui/src/components/pages/home/promptThread/ViewSQLTabContent.tsx`
- `wren-ui/src/components/pages/home/dashboardGrid/index.tsx`
- 新增 `useResponsePreviewData.ts`

### 测试

- `backgrounds/chart` 新增专项测试
- chart normalizer / validator 新增专项测试
- deterministic edit 新增专项测试
- preview data hook 新增专项测试

---

## 9. 收口标准

满足以下条件，才算本方案完成：

1. 服务端能稳定产出并持久化 canonical renderable `chartSchema`
2. 前端不再承担主规范化职责，只保留轻量 patch / render
3. tracker 具备 finally 清理、重试、启动恢复能力
4. deterministic edit 不再触发 AI round-trip
5. 同一 response 的 preview data 只拉一次并可共享
6. dashboard 多图场景支持 renderer 自适应或至少有明确 hint 驱动
7. 旧双规则源完成收口，不再长期并存
8. 核心链路具备自动化测试保护

---

## 10. 非目标

以下事项不在本期范围：

1. 替换 Vega / Vega-Lite 技术栈
2. 引入全新 BI chart grammar
3. 重做 Dashboard 领域模型
4. 完整引入外部任务队列系统作为前提条件
5. 让所有图表编辑都变成 AI 驱动

---

## 11. 一句话结论

当前图表链路的主要问题，不是“能不能生成图”，而是**图表正确性与稳定性被过度压在前端和内存 tracker 上**。本方案的核心就是把“可渲染 canonical spec、可恢复后台状态机、可解释的数据 shaping、清晰的本地/AI 编辑边界”收回到服务端主链路，前端则降到“共享数据 + 快速编辑 + 高性能渲染”的职责边界上。
