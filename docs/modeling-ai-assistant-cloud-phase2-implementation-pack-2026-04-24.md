# Modeling AI Assistant Cloud Phase 2 Implementation Pack（2026-04-24）

> 对应规划文档：
> - `docs/modeling-ai-assistant-cloud-phase2-parity-and-quality-plan-2026-04-24.md`
>
> 前置基线：
> - `docs/modeling-ai-assistant-cloud-final-alignment-summary-2026-04-23.md`
> - `docs/modeling-ai-assistant-cloud-implementation-pack-2026-04-23.md`
> - `docs/modeling-ai-assistant-cloud-alignment-patch-2026-04-22.md`
>
> 用途：
> - 这份文档不是再讲“为什么要做 Phase 2”，而是把 **Phase 2 真正要实现的内容** 收敛成可执行 implementation pack。
> - 它默认 Phase 1 已完成，并以当前代码为起点继续推进。

---

## 1. Source of Truth

如果后续 Phase 2 执行中出现文档冲突，按这个优先级处理：

1. **本文件**
   - Phase 2 的实现包与执行顺序
2. `docs/modeling-ai-assistant-cloud-phase2-parity-and-quality-plan-2026-04-24.md`
   - Phase 2 的路线图与边界说明
3. `docs/modeling-ai-assistant-cloud-final-alignment-summary-2026-04-23.md`
   - Phase 1 已完成的 Cloud-current 总口径
4. `docs/modeling-ai-assistant-cloud-alignment-patch-2026-04-22.md`
   - Cloud Playwright 实测证据主档

一句话：

> **Phase 2 默认建立在“Phase 1 已完成”的前提上，目标不是补基础交互，而是收敛体验/质量/入口编排差距。**

---

## 2. Phase 2 的总体目标

Phase 2 解决的不是“本地有没有 Modeling AI Assistant”，而是：

> **本地实现是否已经足够接近 Cloud 的真实体验与真实效果。**

Phase 2 需要并行考虑 3 类问题：

1. **Visual parity**：长得像不像 Cloud
2. **AI quality evaluation**：真实输出质量接近不接近 Cloud
3. **Future hooks**：未来 handoff / deep-link / launcher 状态钩子要不要补，以及按什么顺序补

因此 Phase 2 implementation pack 分成 3 条 lane：

- **Lane A / Visual parity**
- **Lane B / AI quality evaluation**
- **Lane C / Future hooks**

注意：

- Lane C **应该包含进 Phase 2 规划**
- 但 Lane C **不应阻塞** Lane A / Lane B 的验收完成

---

## 3. 完成定义（Definition of Done）

### Phase 2 整体完成，不要求一次做完全部 lane

推荐把 Phase 2 当成三段式完成：

- **Phase 2A 完成**：视觉/UI 对齐验收通过
- **Phase 2B 完成**：AI 输出质量评估文档与结论产出
- **Phase 2C 完成**：future hooks 中至少 1 个高优先级钩子真正落地

### 最低“Phase 2 已启动并有价值”标准

只要满足：

1. launcher / assistant route 的视觉差距被系统梳理
2. 本地真实 ai-service 输出有可复现评估样本
3. `openAssistant=...` / handoff / launcher task-state 这些 future hooks 被明确排序

就说明 Phase 2 已经脱离抽象讨论，进入有效执行。

---

## 4. Lane A — Visual parity

## 4.1 目标

把当前“功能对了，但视觉仍偏工程版”的部分对齐到 Cloud：

- launcher 外观
- launcher 状态表达
- relationships route 的信息密度与视觉层级
- semantics wizard 的视觉层级
- empty / result / completed / error 态视觉统一

## 4.2 当前已知差距

当前本地还没有完整对齐的点包括：

1. **launcher 状态表达**
   - Cloud 有更明显的 `Todo / Done`
   - 本地还没有完整照搬

2. **launcher 内容块结构**
   - Cloud 的 launcher 更像 status-driven guidance block
   - 本地现在更像工程化快捷入口卡片

3. **assistant route 页面编排**
   - relationships result table 的 spacing / density / action affordance 仍偏本地风格
   - semantics step 区块、generated review、example prompt 的信息层级仍与 Cloud 有差距

4. **状态态样式**
   - empty-state
   - generating
   - save-enabled completed state
   - error/retry state
   仍没有 Cloud 的统一语言

## 4.3 要实现的内容

### A1. Launcher parity

要对齐：
- header icon / title / description 排版
- collapse / expand 的视觉反馈
- item card 的 spacing / border / shadow
- `Todo / Done` 状态表达
- count / badge 表达（如果 Cloud 当前有）

### A2. Relationships page parity

要对齐：
- header 区块
- intro 文案区块层次
- table header / row spacing
- edit / delete 图标行为区可视化
- empty-state / result-state / save action 区块布局

### A3. Semantics page parity

要对齐：
- step 1 选择区块
- step 2 prompt 区
- example prompt 区块
- generated review 区块
- `Generate / Regenerate / Save / Back` 按钮层级与布局

### A4. Error-state parity

要对齐：
- relationships create task error
- semantics generate error
- semantics save error
- readonly snapshot warning state

## 4.4 文件级起点

### Launcher
- `wren-ui/src/features/modeling/components/ModelingAssistantLauncher.tsx`
- `wren-ui/src/features/modeling/ModelingWorkspaceContent.tsx`

### Shared route shell
- `wren-ui/src/features/modeling/assistant/ModelingAssistantRouteLayout.tsx`
- `wren-ui/src/features/modeling/assistant/useModelingAssistantLeaveGuard.ts`

### Relationships page
- `wren-ui/src/features/modeling/assistant/recommendRelationships/RecommendRelationshipsPage.tsx`

### Semantics page
- `wren-ui/src/features/modeling/assistant/recommendSemantics/RecommendSemanticsPage.tsx`
- `wren-ui/src/features/modeling/assistant/recommendSemantics/GeneratedSemanticsReview.tsx`

## 4.5 验收

最低验收：

1. launcher 视觉上能表达 `Todo / Done`
2. relationships result-state 的编辑区不再像默认工程表格
3. semantics completed state 视觉层级清晰且接近 Cloud
4. readonly / error / retry 态有一致表达
5. 使用 screenshot review / visual verdict 做至少一轮对比记录

---

## 5. Lane B — AI quality evaluation

## 5.1 目标

验证：

> **本地 ai-service 的 relationships / semantics 真实输出质量，是否接近 Cloud。**

注意：这条 lane 不是为了“让 e2e 通过”，而是为了回答：

- 本地关系推荐质量够不够
- 本地语义描述质量够不够
- 如果不够，是 manifest 问题、prompt 问题还是 pipeline 问题

## 5.2 当前状态

当前已有：
- mocked Playwright e2e
- 证明本地 route/UI/save contract 正确

当前没有：
- 非 mocked 的本地 assistant 全链路质量结论
- dataset-by-dataset 的输出对照报告

## 5.3 要实现的内容

### B1. 建评估样本集

至少选 3 套：
- HR
- ecommerce
- 复杂结构样例（例如 NBA / Chinook / Music）

### B2. relationships 输出评估

每套数据都要记录：
- 有没有推荐
- 推荐数量
- from / to / type 是否合理
- description 是否有业务解释性
- save 后是否形成合理关系

### B3. semantics 输出评估

每套数据都要记录：
- model description 是否可读
- column description 是否有业务意义
- 是否出现空话/套话
- multi-model 输出是否稳定
- save 后 metadata 是否正确

### B4. 失败态评估

要记录：
- 超时
- 5xx / 502
- malformed payload
- save 失败
- regeneration 失败

### B5. 输出评估文档

建议新增：
- `docs/modeling-ai-assistant-cloud-ai-quality-evaluation-YYYY-MM-DD.md`

文档最少应包含：
- dataset
- input context
- Cloud 观察结果（若有）
- local 输出结果
- 质量判断
- 差异原因推测
- 后续行动建议

## 5.4 文件级起点

### API / routes
- `wren-ui/src/pages/api/v1/relationship-recommendations/**`
- `wren-ui/src/pages/api/v1/semantics-descriptions/**`

### adaptor
- `wren-ui/src/server/adaptors/wrenAIAdaptor.ts`
- `wren-ui/src/server/adaptors/wrenAIAdaptorTypes.ts`
- `wren-ui/src/server/models/adaptor.ts`

### AI-service 侧（若需要调优）
- `wren-ai-service/src/web/v1/routers/relationship_recommendation.py`
- `wren-ai-service/src/web/v1/routers/semantics_description.py`
- `wren-ai-service/src/web/v1/services/relationship_recommendation.py`
- `wren-ai-service/src/web/v1/services/semantics_description.py`
- `wren-ai-service/src/pipelines/generation/relationship_recommendation.py`
- `wren-ai-service/src/pipelines/generation/semantics_description.py`

## 5.5 验收

最低验收：
1. 有真实本地 assistant task 跑通记录
2. 至少 3 套数据集的输出质量对照
3. 有一份评估文档
4. 能明确回答“当前本地 AI 质量是否足够接近 Cloud”

---

## 6. Lane C — Future hooks

## 6.1 目标

把当前“已经在 Cloud 或产品形态里看得到影子，但 Phase 1 不该做”的钩子正式纳入路线图。

## 6.2 结论

**future hooks 应纳入 Phase 2。**

但：
- 它们不是 parity 的阻塞项
- 也不是 AI 质量评估的阻塞项
- 它们应作为独立 lane 推进

## 6.3 应纳入的 hooks

### C1. `openAssistant=...`

当前 Cloud 中最明确的 future hook：
- `openAssistant=relationships`
- `openAssistant=semantics`

当前状态：
- 在 Cloud 仍更像 noop / inactive hook

Phase 2 是否纳入：
- **纳入规划：是**
- **立即实现：不一定**

建议：
- 先在本地补 route/query contract 设计
- 再决定是否真正激活

### C2. onboarding / knowledge handoff hooks

目标：
- 从 onboarding / knowledge workbench 直接 handoff 到 assistant route
- 按上下文决定落 relationships 还是 semantics

建议纳入原因：
- 这是产品链路上的自然下一步
- 但不是本地 Phase 1 的交互闭环阻塞项

### C3. launcher task state reflection

目标：
- launcher 显示更贴近 Cloud 的：
  - `Todo`
  - `Done`
  - badge / count / 状态摘要

说明：
- 它既属于视觉，也属于 product hook
- 建议作为 Phase 2A / 2C 的交叉子项推进

## 6.4 当前不建议纳入的 hooks

这些不建议现在列为 Phase 2 必做：
- relationships full authoring workbench deep-link
- assistant 多任务 resume/replay 中台
- 通用 AI task orchestration framework

原因：
- 这些会明显扩大范围
- 会把 Phase 2 从 parity/evaluation/handoff 扩成平台重构

## 6.5 文件级起点

### `openAssistant=...`
- `wren-ui/src/utils/knowledgeWorkbench.ts`
- `wren-ui/src/hooks/useRuntimeScopeNavigation.tsx`
- `wren-ui/src/features/modeling/modelingWorkspaceUtils.ts`
- `wren-ui/src/features/modeling/useModelingWorkspaceState.ts`

### handoff hooks
- `wren-ui/src/features/knowledgePage/useKnowledgeAssetWorkbench.ts`
- `wren-ui/src/features/knowledgePage/**`

### launcher state reflection
- `wren-ui/src/features/modeling/components/ModelingAssistantLauncher.tsx`

## 6.6 验收

未来钩子 lane 的最低完成标准：

1. 至少选定一个 hook 进入真正开发
2. `openAssistant=...` 是否激活有明确结论
3. onboarding / knowledge handoff 是否要进下一阶段有明确结论
4. launcher 的 task state 展示是否升到 Cloud 级有明确结论

---

## 7. 推荐执行顺序

## Step 1
先做 **Lane A / Visual parity**

原因：
- 最直观
- 反馈快
- 也能顺手处理 launcher state reflection 的一部分

## Step 2
再做 **Lane B / AI quality evaluation**

原因：
- 现在 mocked e2e 已经证明 contract 正确
- 接下来最重要的是回答“真实效果是否够好”

## Step 3
最后做 **Lane C / Future hooks**

原因：
- 这是更偏 orchestration / handoff 的增强
- 不应阻塞 parity 和 quality 的结论产出

---

## 8. 最低实施清单

### Phase 2A 必做
- [ ] launcher 视觉状态对齐
- [ ] relationships result-state 视觉对齐
- [ ] semantics completed state 视觉对齐
- [ ] error/readonly 态视觉统一

### Phase 2B 必做
- [ ] 选 3 套数据集
- [ ] relationships 真实输出评估
- [ ] semantics 真实输出评估
- [ ] 形成质量评估文档

### Phase 2C 必做
- [ ] 明确 `openAssistant=...` 是否激活
- [ ] 明确 onboarding / knowledge handoff 是否进入下一轮
- [ ] 明确 launcher `Todo / Done` / badge 是否升级到 Cloud 级别

---

## 9. 一句话总结

> **Phase 2 应该拆成：Visual parity、AI quality evaluation、Future hooks 三条 lane；future hooks 应该纳入，但不应成为 parity/quality 的阻塞项。**
