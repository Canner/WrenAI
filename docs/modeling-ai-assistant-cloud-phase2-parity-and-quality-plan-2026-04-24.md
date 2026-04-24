# Modeling AI Assistant Phase 2 候选路线（2026-04-24）

> 相关文档：
> - `docs/modeling-ai-assistant-cloud-final-alignment-summary-2026-04-23.md`
> - `docs/modeling-ai-assistant-cloud-implementation-pack-2026-04-23.md`
> - `docs/modeling-ai-assistant-cloud-alignment-patch-2026-04-22.md`
>
> 目的：
> - 在 Phase 1 已完成的前提下，明确接下来真正值得做的 Phase 2 工作
> - 回答“视觉/UI 是否继续对齐”“AI 输出质量是否要单独评估”以及“未来钩子是否要纳入”

---

## 1. 当前前提

截至当前代码状态：

- Phase 1 / Cloud-current contract 已完成
- 已对齐：launcher / sibling routes / leave guard / relationships review flow / semantics wizard / save boundaries / readonly guard
- 已验证：
  - lint
  - typecheck
  - targeted Jest
  - build
  - local Playwright e2e（mocked assistant task results）

但当前仍未完全覆盖的部分有 4 类：

1. **视觉/UI 细节**
2. **AI 真实输出质量**
3. **Cloud 中的未来钩子 / handoff contract**
4. **非 mocked 的真实 assistant task 端到端验证**

因此如果继续推进，应该进入 **Phase 2**，而不是继续把这些内容混在 Phase 1 里。

---

## 2. Phase 2 的目标定义

Phase 2 不再解决“有没有这条交互链路”，而是解决：

> **本地实现与 Cloud 商业版在体验层和真实效果层是否足够接近。**

建议把它拆成 3 个工作流：

- **Phase 2A — Visual parity**
- **Phase 2B — AI quality evaluation**
- **Phase 2C — Future hooks / product handoff hooks**

这 3 个流的优先级不一样，不能混为一谈。

---

## 3. Phase 2A — Visual parity

## 3.1 目标

把当前“功能对齐但视觉不完全一致”的部分拉近到 Cloud：

- launcher 视觉层级
- `Todo / Done` 状态表达
- assistant route 页面的 header / spacing / content rhythm
- empty/result/completed/error 态的视觉一致性

## 3.2 建议纳入范围

### launcher
- `Modeling AI Assistant` 顶部卡片的层级、图标、按钮密度
- 折叠/展开视觉状态
- `Recommend relationships` / `Recommend semantics` 的状态 tag
- `Todo / Done`、数量 badge 的表达方式

### relationships route
- result table 排版
- row-level action icon 的位置和密度
- empty-state 的版式
- save/cancel 区的布局

### semantics route
- step 1 / step 2 的视觉层级
- example prompt 的样式
- generated review 区块的 card/list 样式
- save / regenerate / back 的位置和样式

## 3.3 不纳入范围

- 交互语义重写
- API contract 变化
- AI prompt / pipeline 策略变化

## 3.4 验收方式

- 以 Cloud 页面截图为视觉参考
- 做页面级 screenshot diff / structured visual review
- 至少覆盖：
  - modeling launcher
  - relationships empty state
  - relationships result state
  - semantics step 1
  - semantics step 2
  - semantics completed state

---

## 4. Phase 2B — AI quality evaluation

## 4.1 目标

当前本地 Playwright e2e 证明的是：

- 交互 contract
- save/apply/persist contract
- route contract

但没有证明：

- 本地 ai-service 的 relationships 推荐质量接近 Cloud
- 本地 ai-service 的 semantics 生成质量接近 Cloud

因此需要单独开一个 **真实输出质量评估** 流。

## 4.2 为什么必须单独做

因为这不是 UI 问题，而是：

- manifest 质量
- ai-service pipeline 行为
- prompt / model / config
- runtime dataset 差异

所以必须把它和视觉对齐拆开。

## 4.3 评估维度

### relationships
- 是否能产出推荐
- 推荐数量是否合理
- from/to/type 是否合理
- description 是否有业务解释性
- save 后是否形成有效关系

### semantics
- model description 是否可读
- column description 是否不是空话
- 多模型结果是否稳定
- save 后 metadata 写入是否正确
- 失败态是否可恢复

## 4.4 建议评估数据集

至少挑 3 组：

- HR
- ecommerce
- 一个结构更复杂的样例（如 NBA / Chinook / Music）

## 4.5 建议输出物

单独出一份评估文档，例如：

- `docs/modeling-ai-assistant-cloud-ai-quality-evaluation-YYYY-MM-DD.md`

里面至少包含：
- dataset
- Cloud 观察结果
- local 输出结果
- 差异类型
- 是否需要 prompt/pipeline 调整

---

## 5. Phase 2C — Future hooks / product handoff hooks

## 5.1 现在最明确的 future hook 是什么

当前最明确的 future hook 只有一个：

- `openAssistant=relationships|semantics`

在 Cloud 侧它目前更像：

- URL 级预留 contract
- 但当前仍是 noop / inactive hook

所以它不是 Phase 1 必做项。

---

## 5.2 未来钩子是否应该纳入 Phase 2

**应该纳入 Phase 2 规划，但不应该和 2A / 2B 混成一个验收包。**

更准确地说：

- **应该纳入路线图**
- **不应该阻塞视觉/UI 对齐**
- **不应该阻塞 AI 质量评估**

因为它属于：

> **产品 handoff / deep-link / orchestration hook**

而不是基础体验对齐本身。

---

## 5.3 建议纳入的 future hooks 列表

### Hook 1 — `openAssistant=...`
目标：
- 支持从 `/modeling?openAssistant=relationships`
- 或 `/modeling?openAssistant=semantics`
- 直接进入目标 flow

适用场景：
- 外部入口直接唤起 assistant
- URL 分享 / 引导链路

### Hook 2 — onboarding / knowledge handoff
目标：
- 当用户完成某些 setup / knowledge 流程后
- 能精确 handoff 到：
  - relationships
  - semantics

适用场景：
- 多表导入后建议去关系推荐
- 建模未完成时建议补 semantics

### Hook 3 — launcher task state reflection
目标：
- launcher 上显示更贴近 Cloud 的：
  - `Todo`
  - `Done`
  - 数量 / 状态 badge

适用场景：
- modeling 页面返回后有状态记忆与引导

---

## 5.4 哪些 future hooks 不建议现在就做

不建议在下一轮立即做：

- relationships full authoring workbench 深链
- assistant 多任务恢复 / replay / resume 中台
- 通用 AI task orchestration framework

这些会明显扩大范围。

---

## 6. 推荐优先级

建议优先级如下：

### P1
- **Phase 2A — Visual parity**
- **Phase 2B — AI quality evaluation**

原因：
- 这是“用户现在立刻能感受到”的差距
- 也是判断本地实现是否真正接近 Cloud 的关键

### P2
- **Hook 3 — launcher task state reflection**

原因：
- 视觉和状态表达高度相关
- 它和 Visual parity 是相邻主题

### P3
- **Hook 1 — `openAssistant=...`**
- **Hook 2 — onboarding / knowledge handoff**

原因：
- 这是流程编排增强，不是当前功能闭环的阻塞项

---

## 7. 建议落地顺序

### Step 1
先做 **Visual parity**：
- 把 launcher 和两条 assistant route 做到接近 Cloud 的视觉表达

### Step 2
再做 **AI quality evaluation**：
- 跑真实本地 ai-service
- 形成评估文档

### Step 3
最后再决定 future hooks：
- 如果产品当前确实需要外部入口/自动 handoff
- 再做 `openAssistant=...` 和 onboarding/knowledge handoff

---

## 8. 最终建议

### 结论一
**未来钩子应该被纳入 Phase 2 路线图。**

### 结论二
但它们不应该与“视觉/UI 对齐”和“AI 输出质量评估”绑成一个完成条件。

### 结论三
因此最合理的拆法是：

- **Phase 2A：Visual parity**
- **Phase 2B：AI quality evaluation**
- **Phase 2C：Future hooks / handoff hooks**

一句话总结：

> **future hooks 应该包含进 Phase 2 规划，但应作为后置的 orchestration/handoff lane，而不是当前 parity 的阻塞项。**
