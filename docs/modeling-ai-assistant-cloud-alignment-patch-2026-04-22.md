# Modeling AI Assistant Cloud 对齐 Patch（2026-04-22）

> 相关文档：
> - `docs/modeling-ai-assistant-cloud-final-alignment-summary-2026-04-23.md`
> - `docs/modeling-ai-assistant-cloud-implementation-pack-2026-04-23.md`
>

> Cloud 实测入口：
> - `https://cloud.getwren.ai/projects/15008/modeling`
> - `https://cloud.getwren.ai/projects/15008/recommend-relationships`
> - `https://cloud.getwren.ai/projects/15008/recommend-semantics`
>
> 实测证据：
> - `modeling-page-initial.png`
> - `modeling-recommend-relationships.png`
> - `modeling-recommend-relationships-back-confirm.png`
> - `modeling-relationships-top-back-confirm-modal.png`
> - `modeling-recommend-semantics.png`
> - `modeling-recommend-semantics-validation.png`
> - `modeling-generate-semantics-step.png`
> - `modeling-generate-semantics-full.png`
> - `modeling-semantics-top-back-modal.png`
> - `modeling-semantics-step1-top-back-modal.png`
> - `modeling-semantics-step1-selection-preserved-after-cancel.png`
> - `modeling-semantics-prompt-preserved-after-cancel.png`
> - `modeling-semantics-go-back-to-modeling.png`
> - `modeling-semantics-fresh-step1-after-route-exit.png`
> - `modeling-openAssistant-relationships.png`
> - `tmp/modeling-fresh-modeling-page.png`
> - `tmp/modeling-fresh-assistant-dropdown.png`
> - `tmp/modeling-fresh-recommend-relationships.png`
> - `tmp/modeling-fresh-relationships-back-modal.png`
> - `tmp/modeling-fresh-semantics-full.png`
> - `tmp/modeling-fresh-semantics-validation.png`
> - `tmp/modeling-fresh-generate-semantics.png`
> - `tmp/modeling-fresh-semantics-prompt-retained.png`
> - `tmp/modeling-fresh-openAssistant-relationships-noop.png`
> - `tmp/modeling-fresh-semantics-step-back-clears-selection.png`
> - `tmp/modeling-fresh-semantics-step1-back-modal.png`
> - `tmp/modeling-fresh-semantics-reenter-reset.png`
> - `tmp/modeling-semantics-step2-prompt-2026-04-22.png`
> - `tmp/modeling-semantics-step1-reentry-reset-2026-04-22.png`
> - `tmp/playwright-modeling-page-2026-04-22.png`
> - `tmp/playwright-modeling-initial-load-network-2026-04-22.txt`
> - `tmp/playwright-modeling-openAssistant-relationships-noop-2026-04-22.png`
> - `tmp/playwright-modeling-openAssistant-semantics-noop-2026-04-22.png`
> - `tmp/playwright-modeling-fresh-verification-notes-2026-04-22.md`
> - `tmp/playwright-modeling-relationships-network-2026-04-22.txt`
> - `tmp/playwright-modeling-relationships-empty-state-preserved-after-cancel-2026-04-22.png`
> - `tmp/playwright-modeling-semantics-initial-load-network-2026-04-22.txt`
> - `tmp/playwright-modeling-semantics-next-without-selection-network-2026-04-22.txt`
> - `tmp/playwright-modeling-semantics-step2-pre-generate-network-2026-04-22.txt`
> - `tmp/playwright-modeling-semantics-step-transition-network-2026-04-22.txt`
> - `tmp/playwright-modeling-semantics-step2-prompt-preserved-2026-04-22.png`
> - `tmp/playwright-modeling-semantics-reentry-fresh-after-go-back-2026-04-22.png`
> - `tmp/playwright-modeling-semantics-step1-selection-preserved-after-cancel-2026-04-22.png`
> - `tmp/playwright-modeling-semantics-step1-go-back-reentry-reset-2026-04-22.png`
> - `tmp/playwright-modeling-cloud-fresh-network-2026-04-22.txt`
> - `tmp/playwright-modeling-cloud-fresh-snapshot-2026-04-22.md`
> - `tmp/playwright-modeling-openAssistant-relationships-fresh-network-2026-04-22.txt`
> - `tmp/playwright-modeling-openAssistant-relationships-fresh-snapshot-2026-04-22.md`
> - `tmp/playwright-modeling-openAssistant-semantics-fresh-network-2026-04-22.txt`
> - `tmp/playwright-modeling-openAssistant-semantics-fresh-snapshot-2026-04-22.md`
> - `tmp/playwright-modeling-semantics-fresh-route-entry-network-2026-04-22.txt`
> - `tmp/playwright-modeling-semantics-fresh-route-entry-snapshot-2026-04-22.md`
> - `tmp/playwright-modeling-semantics-fresh-next-no-selection-network-2026-04-22.txt`
> - `tmp/playwright-modeling-semantics-fresh-next-no-selection-snapshot-2026-04-22.md`
> - `tmp/playwright-modeling-semantics-fresh-step1-before-select-snapshot-2026-04-22.md`
> - `tmp/playwright-modeling-semantics-fresh-step1-search-and-select-network-2026-04-22.txt`
> - `tmp/playwright-modeling-semantics-fresh-step1-search-and-select-snapshot-2026-04-22.md`
> - `tmp/playwright-modeling-semantics-fresh-step2-before-example-snapshot-2026-04-22.md`
> - `tmp/playwright-modeling-semantics-fresh-step2-example-and-typed-network-2026-04-22.txt`
> - `tmp/playwright-modeling-semantics-fresh-step2-example-and-typed-snapshot-2026-04-22.md`
> - `tmp/playwright-modeling-semantics-fresh-step2-back-cleared-selection-snapshot-2026-04-22.md`
> - `tmp/playwright-modeling-semantics-fresh-generate-success-network-2026-04-22.txt`
> - `tmp/playwright-modeling-semantics-fresh-generate-success-snapshot-2026-04-22.md`
> - `tmp/playwright-modeling-semantics-fresh-unsaved-go-back-diagram-check-2026-04-22.md`
> - `tmp/playwright-modeling-semantics-fresh-reentry-after-unsaved-generate-network-2026-04-22.txt`
> - `tmp/playwright-modeling-semantics-fresh-reentry-after-unsaved-generate-step1-snapshot-2026-04-22.md`
> - `tmp/playwright-modeling-semantics-fresh-completed-state-top-back-cancel-network-2026-04-22.txt`
> - `tmp/playwright-modeling-semantics-fresh-completed-state-top-back-cancel-snapshot-2026-04-22.md`
> - `tmp/playwright-modeling-semantics-fresh-completed-state-back-result-snapshot-2026-04-22.md`
> - `tmp/playwright-modeling-semantics-fresh-completed-state-back-no-save-network-2026-04-22.txt`
> - `tmp/playwright-modeling-relationships-fresh-route-entry-network-2026-04-22.txt`
> - `tmp/playwright-modeling-relationships-fresh-route-entry-snapshot-2026-04-22.md`
> - `tmp/playwright-modeling-semantics-step1-fresh-top-back-modal-2026-04-22.md`
> - `tmp/playwright-modeling-relationships-fresh-top-back-modal-2026-04-22.md`
> - `tmp/wren-ui-modeling-assistant-baseline-tests-2026-04-22.txt`
> - `tmp/wren-ui-modeling-route-primitives-tests-2026-04-22.txt`
> - `tmp/wren-ui-modeling-assistant-prechange-baseline-2026-04-22.txt`
> - `tmp/wren-ui-recommendation-helper-primitives-2026-04-22.txt`
> - `tmp/wren-ui-modeling-assistant-unified-prechange-baseline-2026-04-22.txt`
> - `tmp/wren-ui-shell-primitives-2026-04-22.txt`
> - `tmp/wren-ui-shell-back-history-primitives-2026-04-22.txt`

---

## 0. 这份 patch 要解决什么

旧的 2026-04-21 relationships 方案文档的大方向仍然合理：

- Modeling 作为 AI Assistant 承接层；
- relationships / semantics 属于建模语境，而不是继续塞回 onboarding；
- 用统一入口承接多个 AI 建模能力。

但 2026-04-22 的 Playwright 实测表明，这份文档对 **Cloud 当前真实 IA / route / wizard / leave-guard 语义** 的描述已经明显落后。

这份 patch 的目标不是推翻原方案，而是把它更新成更接近 Cloud 当前现状的一份 **alignment overlay**。

---

## 1. Cloud 当前真实行为（实测）

## 1.1 Modeling 页已经有统一 Assistant 入口

Cloud 当前的 `modeling` 页顶部已经存在：

- `Modeling AI Assistant`

并且下拉菜单里至少有两个能力：

- `Recommend relationships`
- `Recommend semantics`

这说明：

- Assistant 不是待建设概念；
- semantics 也不是远期占位能力，而是当前可访问的 sibling flow。

补充：2026-04-22 晚间 fresh rerun 还直接从 modeling 页 DOM 触发了 launcher 项点击，确认：

- `Recommend relationships` 选项确实存在且可见；
- 从 modeling 页点击后会真正跳到 `/projects/15008/recommend-relationships`；
- `Recommend semantics` 也会真正跳到 `/projects/15008/recommend-semantics`；
- 不是“文案存在但未接线”的假入口。

同一轮 fresh rerun 还补强了一个实现层细节：

- 这个入口不是单纯的静态文案，而是由带 `data-guideid="modeling-copilot"` 的 `ModelingCopilot` surface 渲染；
- 这进一步说明 Cloud 当前 contract 确实是“modeling 内嵌 launcher + route 跳转”，而不是未来态占位文本。

同轮 fresh network 还确认：

- modeling 画布页自身初始加载不会触发 assistant create-task 操作；
- 没有看到 `CreateModelRelationshipsTask` 或 `CreateModelDescriptionTask` 在 modeling route render 时自动发出；
- 这说明 Cloud 当前 launcher 是被动入口，而不是页面加载即后台预热任务。

## 1.2 Assistant 不是 panel/overlay，而是 sibling route

当前点击两个能力后，会进入独立 route：

- relationships：
  - `/projects/15008/recommend-relationships`
- semantics：
  - `/projects/15008/recommend-semantics`

而不是：

- 在 modeling 画布内展开 overlay；
- 或在右侧 diagram 区域打开内嵌 panel。

因此，Cloud 当前更接近：

> `modeling canvas + assistant dropdown + sibling route flows`

而不是原文中更偏好的：

> `modeling canvas + assistant panel / overlay`

## 1.3 `Recommend relationships` 当前是独立 recommendation task 页

本次项目 `15008` 下，relationships 页当前实测为：

- 标题：`Generate relationships`
- 说明文案：AI assistant 会发现模型间潜在关系
- 首次进入时会先出现 loading / generating 状态：
  - `Generating... This may take up to a minute to generate the results.`
- 空态：
  - `No additional recommended relationships`
  - `No relationships are recommended.`
- 可见主要动作：
  - 顶部 `Back to modeling`
  - 底部 `Cancel and Go Back`
  - `Save`（disabled）

本轮实测没有看到明显的：

- `Add relationship`
- `New relationship`
- inline manual edit/add affordance

因此至少在当前项目的实测下，Cloud 的 relationships flow 更像：

- recommendation task 页 / 结果确认页
- 先 loading，再进入 empty-state 或 recommendation result
- **终态与当前数据源有关，不是固定 empty-state**

而不是原文里更强的那种：

- 推荐 + 编辑 + 删除 + 新增 + 保存的一体式建模工作台。

## 1.4 `Recommend semantics` 当前是两步式 wizard

### Step 1：`Pick models`

特点：

- 选择要生成 semantics 的 models；
- `Next` 按钮可点击；
- 若 0 选择直接提交，会出现 inline 校验：
  - `Please select at least one model.`

补充：2026-04-22 晚间 fresh rerun 还单独抓了一次 route 初始加载网络，确认：

- 进入 `/projects/15008/recommend-semantics` 本身不会触发 `CreateModelDescriptionTask`；
- 初始加载只看到 bootstrap queries（如 `Me` / `GetSettings` / `OnboardingStatus` / `Diagram` / `Subscription` / `Credits` / `DeployStatus`）。
- 在 **0 选择** 的 step 1 上点击 `Next` 后，同样只出现 inline validation，也没有触发 `CreateModelDescriptionTask`。
- 最新一轮 fresh rerun 也再次复现了这条边界，且 step 1 snapshot 里还可直接看到 docs link：`Modeling AI Assistant / Generate semantics`。

注意：

- 这不是“未选中前禁用 Next”的 gating；
- 而是“允许点击，再提交校验”。

### Step 2：`Generate semantics`

特点：

- 有 dataset prompt 输入区；
- 有 `Generate` 按钮；
- 有 example prompts：
  - `College`
  - `E-commerce`
  - `Human Resources`
- 底部动作：
  - `Back`
  - `Save`

当前实测动作状态：

- `Generate`：enabled
- `Back`：enabled
- `Save`：disabled

补充实测：

- 点击 example prompt 后，主输入框 **不会自动回填**；
- 点击 example prompt 或手动输入 prompt，本身也**不会自动触发** `CreateModelDescriptionTask`；
- 它们当前更像“参考文案展示”，不是 click-to-fill 模板。

### 1.4.1 2026-04-22 晚间 fresh rerun 补强证据

这一轮额外 Playwright 复核又确认了四件很容易在实现时走偏的细节：

1. 在 step 1 勾选 model 后点击 `Next`，页面会进入 step 2，但 fresh network 里仍只看到 bootstrap queries（`Me` / `GetSettings` / `OnboardingStatus` / `Diagram` / `Subscription` / `Credits` / `DeployStatus`），**没有** `CreateModelDescriptionTask`；
2. 在 step 2 点击 `College` example prompt 后，主输入框仍为空，说明它当前不是 click-to-fill；
3. 在 step 2 手动输入 prompt 后点击顶部 `Back to modeling`，再在 confirm 中点 `Cancel`，typed prompt 会原地保留；
4. 从 step 2 点底部 `Back` 回到 step 1 后，之前选中的 model 会被清空。

2026-04-22 夜间另一轮 fresh rerun 又把第 2 和第 4 条各复核了一次：

- 在 step 1 搜索框输入 `emp` 并勾选一个 model 后，列表会本地收敛到 `1/5 model(s)` 结果视图，但 fresh network 里仍然没有 `CreateModelDescriptionTask`；
- 点击 `College` 后，再手动输入 `Need hiring funnel semantics for recruiting analytics.`，fresh network 里仍然没有 `CreateModelDescriptionTask`；
- 随后点击 step-2 底部 `Back` 回到 step 1，浏览器内读取到的 6 个 checkbox 状态全部为 `false`，说明 wizard internal back 仍然会清空 selection。

这组 fresh 证据对应文件：

- `tmp/playwright-modeling-semantics-step-transition-network-2026-04-22.txt`
- `tmp/playwright-modeling-semantics-step2-prompt-preserved-2026-04-22.png`

## 1.5 顶部 `Back to modeling` 是统一的 route-level leave guard

Cloud 当前两个 assistant 子路由都存在统一顶部动作：

- `Back to modeling`

它的行为是：

1. 点击后先弹确认框：
   - `Go back to the modeling page?`
   - `Please be aware that leaving the page will not save your progress, and this action cannot be undone.`
2. `Cancel`
   - 留在当前 route
   - 保留当前 route 内状态
3. `Go back`
   - 退出 assistant route
   - 返回 `/modeling`

并且这套 guard **不是 dirty-only 才触发**：

- 在 semantics step 1、未选任何 model、未产生任何输入时，顶部 back 也会弹框；
- 这更像 route-level guarded leave，而不是严格的 dirty-check guard。

2026-04-22 夜间 fresh rerun 又把这条统一 modal copy 在两个子路由上各复核了一次：

- semantics step 1 untouched 状态点击顶部 `Back to modeling`，会出现同一套 confirm 文案；
- relationships empty-state 状态点击顶部 `Back to modeling`，也会出现同一套 confirm 文案；
- 两边点 `Cancel` 后都会原地留在当前 route，并关闭 modal。

## 1.6 `Cancel` 与 `Go back` 的状态语义

### 顶部 back 的 confirm = `Cancel`

Cloud 当前可确认的保留行为：

- semantics step 1：
  - 已选 models 保留
- semantics step 2：
  - typed prompt 保留
- semantics generated review state：
  - `Generated semantics` / `Regenerate` / enabled `Save` 保留
- relationships 空态页：
  - 页面状态保持不变

2026-04-22 晚间 fresh rerun 又补了两条明确证据：

- 在 semantics step 1 勾选 `employees` 后，顶部 `Back to modeling` -> `Cancel`，勾选状态仍保留；
- 在 relationships 空态页点击顶部 `Back to modeling` 后再点 `Cancel`，页面仍停留在 `/projects/15008/recommend-relationships`，empty state 也保持不变。

2026-04-22 深夜 fresh rerun 又补了一条更靠近 completed state 的证据：

- 在单模型成功生成语义后（页面已进入 `Generated semantics` review state，且出现 `Regenerate` 与 enabled `Save`）；
- 点击顶部 `Back to modeling` 打开 confirm，再点 `Cancel`；
- 页面会继续停留在 `/projects/15008/recommend-semantics`；
- 且 completed review state 仍完整保留，没有退回 step 1 / step 2 初始态。
- 同轮 fresh network 里也没有出现 `SaveModelDescriptions`，说明 `Cancel` 不会顺手触发持久化。

### 顶部 back 的 confirm = `Go back`

Cloud 当前可确认的退出行为：

- semantics step 2 点 `Go back` 后回 modeling；
- relationships 页点 `Go back` 后也回 modeling。

2026-04-22 晚间 fresh rerun 又补充确认：

- semantics step 1 untouched 状态点击顶部 `Back to modeling`，在 confirm 里选 `Go back` 后，也会真实退出到 `/projects/15008/modeling`；
- relationships 空态页点击顶部 `Back to modeling`；
- 在 confirm 里选择 `Go back`；
- 会真实退出到 `/projects/15008/modeling`。

### 重新进入后的 reset 行为

从 semantics 真正退出回 modeling 后，再重新进入：

- 回到 fresh step 1 `Pick models`
- 不保留之前的 model 选择
- 不保留之前 step 2 的 prompt

2026-04-22 晚间 fresh rerun 又补了一次闭环验证：

1. step 1 选择 `employees`
2. 进入 step 2 并输入 prompt
3. 顶部 `Back to modeling` -> confirm `Go back`
4. 返回 `/projects/15008/modeling`
5. 再重新进入 `/projects/15008/recommend-semantics`

结果仍然是：

- fresh step 1
- 所有 model checkbox 未选中
- 页面上也看不到 step 2 prompt input

此外，同晚又补了一条 step-1-only 分支验证：

1. step 1 选择 `employees`
2. 顶部 `Back to modeling` -> confirm `Go back`
3. 返回 `/projects/15008/modeling`
4. 再重新进入 `/projects/15008/recommend-semantics`

结果同样是：

- fresh step 1
- 所有 model checkbox 未选中
- 页面上没有 step 2 prompt input

也就是说：

> `Cancel` 保留当前 route 临时状态；`Go back` 真正退出后，重进 flow 会 reset。

## 1.7 Cloud 当前已经有三类不同“返回/离开”语义

至少可以区分出：

### A. Top back

- `Back to modeling`
- route-level leave
- guarded

### B. Step back

- semantics step 2 的 `Back`
- 只在 wizard 内回上一步
- 不离开 route
- 当前实测会清空 step 1 的选择

### C. Explicit cancel/go back

- relationships 页底部 `Cancel and Go Back`
- 直接退出 flow
- 不弹 confirm

2026-04-22 晚间 fresh rerun 再次确认：

- 在 relationships 空态页点击底部 `Cancel and Go Back` 后，会直接回到 `/projects/15008/modeling`；
- 中间不会再出现二次 confirm modal。
- 夜间另一轮 fresh rerun 也再次确认：返回 modeling 后页面直接恢复 `Modeling AI Assistant` launcher 视图，而不是残留 assistant confirm/modal 状态。

这三类动作在原文中尚未被清楚拆开。

## 1.8 `openAssistant=...` 当前不是 Cloud 现状

实测：

- `modeling?openAssistant=relationships`
- `modeling?openAssistant=semantics`

都不会自动进入对应 flow，也不会自动打开特定 assistant panel。

2026-04-22 晚间 fresh rerun 再次确认：

- 访问 `https://cloud.getwren.ai/projects/15008/modeling?openAssistant=relationships`
- 最终仍停留在 modeling 画布页；
- 页面上仍是 `Modeling AI Assistant` launcher，而不是 `Generate relationships` route 内容。
- fresh network 里也没有 `CreateModelRelationshipsTask` / `ModelRelationshipsTask`。
- 访问 `https://cloud.getwren.ai/projects/15008/modeling?openAssistant=semantics`
- 最终也仍停留在 modeling 画布页；
- 页面上不会自动出现 `Pick models` / `Generate semantics` route 内容。
- fresh network 里同样没有 `CreateModelDescriptionTask`。

因此：

- 这组 query 参数可以继续作为未来实现设想；
- 但当前不应被当成 Cloud 现状来描述。

## 1.9 Cloud 当前的网络 contract 是 GraphQL task flow

除页面 IA 与返回语义外，Cloud 当前 assistant flow 的数据交互也有一个很重要的现状：

### Relationships

进入 `recommend-relationships` 后，Cloud 会触发 GraphQL 异步任务：

- `CreateModelRelationshipsTask`
- `ModelRelationshipsTask(taskId)`

当前轮询结果里已能看到：

- `response.fromConstraint`
- `response.fromLLM`

这说明 Cloud 当前 relationships flow 并不是“单次同步拿 constraint 列表”这么简单，而已经是：

> `trigger task -> polling -> result payload`

### Semantics

在 `recommend-semantics` 中点击 `Generate` 后，Cloud 会触发：

- `CreateModelDescriptionTask(modelIds, prompt)`
- `ModelsDescriptionTask(taskId)`

返回结果包含：

- `status`
- `error`
- `descriptions[]`

也就是说，Cloud 当前 semantics 也已经是 GraphQL task-based async flow，而不是前端本地拼装的同步提交页。

### 这对本地实现意味着什么

这里需要明确区分两层：

1. **Cloud 当前事实**：GraphQL task mutation + polling query；
2. **本地对齐策略**：不一定要照搬 GraphQL surface，但必须保留同等的异步任务语义。

因此本地第一阶段可以继续通过 `wren-ui` BFF 暴露：

- `POST trigger`
- `GET status/result`

但文档里必须写清楚：

> 我们是在 **交互 contract** 上对齐 Cloud，而不是假装 Cloud 当前仍是同步 constraint fetch。

## 1.10 Semantics generate 完成后的页面状态已具备稳定 contract

本次继续用单模型 fresh run 复核 `recommend-semantics` 的生成完成态，结果如下：

- step 2 输入 prompt 并点击 `Generate` 后；
- 页面会轮询 `ModelsDescriptionTask(taskId)`；
- 任务完成后，页面状态变为：
  - `Generate` 按钮变成 `Regenerate`
  - `Save` 从 disabled 变成 enabled
  - `Generated semantics` 区块出现
  - `Example prompt` 区块收起
  - 生成结果挂在当前已选 model 下面展示

本次 fresh 证据：

- `tmp/modeling-fresh-semantics-after-generate-single-model.png`
- `tmp/playwright-modeling-semantics-fresh-generate-success-network-2026-04-22.txt`
- `tmp/playwright-modeling-semantics-fresh-generate-success-snapshot-2026-04-22.md`
- Playwright network:
  - `CreateModelDescriptionTask(modelIds, prompt)`
  - `ModelsDescriptionTask(taskId)`

2026-04-22 深夜 fresh rerun 又补到一组更具体的请求体证据：

- 单模型 `employees` 场景下，`Generate` 会发送：
  - `CreateModelDescriptionTask`
  - `variables.modelIds = [134798]`
  - `variables.prompt = "This dataset tracks HR analytics for employees, departments, salaries, and managers."`
- 之后轮询：
  - `ModelsDescriptionTask(taskId)`
- completed state snapshot 中可直接看到：
  - `Regenerate`
  - `Generated semantics`
  - `Save` enabled
  - 针对 `employees` 的 model / column descriptions 已经落到 review 区块里

这说明：

> `recommend-semantics` 当前不是“点 Generate 仅触发后台任务”的半成品；  
> 它已经有比较明确的 `generate -> polling -> generated review -> save enabled` 页面完成态。

---

## 2. 对原文的 patch 判断

## 2.1 仍然成立的部分

以下判断仍成立：

1. 不应该再把 relationships 当成 onboarding 强制步骤；
2. Modeling 应作为 AI Assistant 的统一承接层；
3. relationships / semantics 放在同一入口下是合理的。

## 2.2 需要纠正的部分

### Patch A：不要再把 semantics 当成 V3

Cloud 当前已经有：

- `Recommend semantics`
- `Pick models -> Generate semantics` 两步 flow

因此原文中：

- `V1: Generate relationships`
- `V3: Recommend semantics`

这一阶段顺序已经不符合 Cloud 现状。

### Patch B：承接方式应从 panel/overlay 改成 sibling routes

原文更偏：

- diagram 内 assistant overlay / panel

Cloud 现状更接近：

- modeling canvas 顶部 dropdown
- 点击能力后进入 route page

因此第一版对齐 Cloud 时，应优先采用：

- route-first assistant flow

而不是 panel-first。

### Patch C：relationships 页当前不应被写成“完整编辑工作台”

至少在当前空态下，Cloud 现状更像：

- 推荐结果页 / 空态页
- 无推荐时没有明显 manual add 主入口

因此原文里“支持编辑/删除/新增/保存”的描述，应标注为：

- 目标态 / 本地规划
- 而不是当前 Cloud 已验证现状。

### Patch D：需要补 route-level leave guard contract

原文当前没有完整描述：

- 顶部 back 的 confirm
- cancel-preserve-state
- confirm-exit-and-reset

但这已经是 Cloud 当前非常稳定的一层交互 contract。

### Patch E：需要补 return semantics 分层

应明确区分：

- top back（guarded leave）
- step back（wizard 内回退）
- explicit cancel/go back（直接退出）

不然很容易在本地实现时把这三种动作混成一个“返回”按钮。

### Patch F：`openAssistant=...` 应降级为 future hook

当前这组 query 参数不应被当成现状 contract。

更合理的写法是：

- 当前 Cloud 现状：route navigation
- 未来若要优化 onboarding -> modeling handoff，再补 deep-link / auto-open 方案

---

## 3. 建议补到文档里的新 contract

## 3.1 IA contract

建议明确写成：

```md
Modeling AI Assistant 当前以顶部 dropdown 形式存在；
具体能力通过独立 route page 承接，而不是先以内嵌 panel 为主。
```

## 3.2 Route contract

建议当前对齐 Cloud 时，优先承认以下两个 route：

- `/recommend-relationships`
- `/recommend-semantics`

并把它们视为：

- assistant-owned sibling routes

## 3.3 Leave guard contract

建议明确：

```md
assistant 子路由的顶部 Back to modeling 统一走 guarded leave；
Cancel 保留当前 route 内临时状态；
Go back 退出到 modeling；
重新进入 flow 时，从 fresh route state 开始。
```

## 3.4 Wizard contract（semantics）

建议明确：

- step 1 `Next` 为 submit-then-validate，而不是 disabled gating；
- step 2 `Generate` enabled、`Save` disabled；
- example prompts 当前只做展示，不自动回填；
- step 2 `Back` 会回到 step 1，且当前会清空 model selection。

## 3.5 Relationships empty-state contract

建议明确：

- 无推荐关系时，Cloud 当前先展示空态；
- 当前项目实测未见显式 manual add affordance；
- 若本地要实现“空态仍可手动新增关系”，应视为 **planned enhancement**，不是 Cloud 现状复刻。

---

## 4. 当前仓库实现与 Cloud patch 的直接差距（代码快照）

结合本地代码，当前仓库和 Cloud 现状之间至少还有 4 个直接断层：

### 4.1 Modeling 主视图里还没有 Assistant 容器

`wren-ui/src/features/modeling/ModelingWorkspaceContent.tsx` 当前只有：

- sidebar
- diagram
- metadata/model/relation modal & drawer

没有看到：

- `Modeling AI Assistant` dropdown
- assistant-owned route entry
- relationships / semantics 承接壳子

### 4.2 Modeling query 只支持 metadata/model/relation deep link

`wren-ui/src/features/modeling/modelingWorkspaceUtils.ts` 当前 `readModelingWorkspaceQueryParams()` 只解析：

- `modelId`
- `viewId`
- `openMetadata`
- `openModelDrawer`
- `relationId`
- `openRelationModal`

没有：

- `openAssistant`
- `assistantFlow`
- `recommendRelationships`
- `recommendSemantics`

### 4.3 Knowledge -> Modeling 导航目前只会跳到 `section=modeling`

`wren-ui/src/features/knowledgePage/useKnowledgeAssetWorkbench.ts` 当前
`navigateModelingWithPersistedRuntimeScope()` 只会生成：

- `{ section: 'modeling' }`

而不会带：

- assistant intent
- route hint
- relationships / semantics flow hint

这与 Cloud 当前“独立 route flow”承接方式不一致。

### 4.4 本地 pages 里还没有 Cloud 那两个 sibling routes

当前 `wren-ui/src/pages` 下能看到：

- `modeling.tsx`（而且只是兼容跳转页）

但没有：

- `recommend-relationships`
- `recommend-semantics`

这说明如果要先对齐 Cloud，第一步更接近：

- 新增 assistant-owned route page

而不是只在现有 modeling 页面里补一些 query 参数。

### 4.5 本地仍有可复用的 relationships 编辑底座，但它还停留在 setup/modeling 原语层

从现有代码看，relationships 这块并不是“从零开始”：

- `wren-ui/src/hooks/useRelationshipModal.tsx`
  - 已能把 diagram relation / model 节点转成关系编辑 modal 所需的默认值
- `wren-ui/src/components/pages/setup/DefineRelations.tsx`
  - 已有推荐关系列表
  - 已有编辑 / 删除 / 添加按钮
  - 已有最终保存动作
- `wren-ui/src/features/setup/ManageSetupRelationshipsPage.tsx`
  - 已有旧 setup 承接壳子
- `wren-ui/src/hooks/useSetupRelations.tsx`
  - 已接 `fetchAutoGeneratedRelations`
  - 已接 `saveSetupRelations`

因此本地更准确的状态是：

- 缺的不是“关系编辑 primitives”
- 缺的是 **Cloud 式 assistant route shell + route semantics + 页面级动作语义**

### 4.6 本地前端还没有对等的 semantics / AI relationship route surface

当前本地 `wren-ui` 能看到：

- suggestion questions 的前端接线
- setup relationships 的旧流程

但没有看到：

- `recommend-semantics` route page
- `recommend-relationships` route page
- semantics wizard 的前端壳子
- Cloud 那套 top-back guarded leave / step-back / cancel-go-back 语义

同时，代码里能看到：

- `wren-ai-service/src/web/v1/routers/semantics_description.py`
- `wren-ai-service/src/web/v1/routers/relationship_recommendation.py`

说明 AI service 已经有对应能力入口；
但 `wren-ui` 当前并没有一个和 Cloud 等价的前端 route / workflow surface 去消费它们。

---

## 5. 对实施顺序的修正建议

如果目标是“先对齐 Cloud”，建议把原文实施顺序改成：

### Phase A：对齐 Cloud 当前 IA / route

- Modeling 顶部 Assistant dropdown
- sibling routes：
  - recommend-relationships
  - recommend-semantics
- guarded leave

### Phase B：对齐当前 wizard / 空态行为

- semantics 两步 flow
- relationships 空态页
- top back / step back / cancel-go-back 三类动作语义

### Phase C：再补本地增强项

- deep-link / `openAssistant=...`
- relationships 空态下 manual add
- 更强的编辑工作台
- 更完整的 semantics/save workflow

这样更符合：

- 先对齐 Cloud 当前产品壳子；
- 再决定哪些部分是本地增强，而不是错误地把“规划增强”写成“Cloud 已有能力”。

---

## 6. 最终结论

这次 Cloud 实测后的最重要结论是：

> 旧的 2026-04-21 方案文档产品方向仍然成立，但它已经不能代表 Cloud 当前真实的 Modeling AI Assistant 交互；尤其在 `assistant IA / sibling routes / leave guard / wizard state semantics` 这几层上，必须补一份现状对齐 patch。

一句话概括：

> Cloud 当前不是 “V1 relationships panel + V3 semantics”，而是  
> **`assistant dropdown + recommend-relationships route + recommend-semantics route + guarded leave + reset-on-exit`**。

---

## Appendix A. 2026-04-22 二次 Playwright 复核（fresh verification）

为避免 patch 只停留在首次观察，本次又针对同一项目 `15008` 做了一轮复核，重点确认与原计划最容易走偏的 5 个点。

### A.1 Modeling 顶部入口仍然是 dropdown，而不是 panel toggle

复核结果：

- `https://cloud.getwren.ai/projects/15008/modeling` 顶部仍存在 `Modeling AI Assistant`
- dropdown 内仍可见：
  - `Recommend semantics`
  - `Recommend relationships`

证据：

- `tmp/modeling-fresh-modeling-page.png`
- `tmp/modeling-fresh-assistant-dropdown.png`

这进一步确认：

> Cloud 当前的 assistant 入口 contract 是 `dropdown launcher`，不是 `in-canvas panel switcher`。

### A.2 Relationships route 仍是空态确认页，不是完整编辑工作台

复核结果：

- 进入 `https://cloud.getwren.ai/projects/15008/recommend-relationships`
- 页面仍显示：
  - `Generate relationships`
  - `No additional recommended relationships`
  - `No relationships are recommended.`
- 可见主动作仍是：
  - `Back to modeling`
  - `Cancel and Go Back`
  - `Save` disabled

证据：

- `tmp/modeling-fresh-recommend-relationships.png`

这意味着：

> 至少在当前项目与当前空态下，relationships flow 仍然不应被实现成“默认可手动新增/编辑的 full workbench”。

### A.3 Relationships 顶部返回仍然是 guarded leave

复核结果：

- 在 `recommend-relationships` 顶部点击 `Back to modeling`
- 仍会弹出确认框：
  - `Go back to the modeling page?`
  - 离开不会保存当前进度
- 点击 `Cancel` 后，仍停留在 `/recommend-relationships`

证据：

- `tmp/modeling-fresh-relationships-back-modal.png`

这再次确认：

> `Back to modeling` 应建模为 route-level guarded leave，而不是普通 router back。

### A.4 Semantics step 1 仍然是 submit-then-validate，而不是 disabled gating

复核结果：

- 在 `https://cloud.getwren.ai/projects/15008/recommend-semantics` step 1 不选 model 直接点 `Next`
- 页面仍出现：
  - `Please select at least one model.`

证据：

- `tmp/modeling-fresh-semantics-full.png`
- `tmp/modeling-fresh-semantics-validation.png`

这说明：

> 原计划若把 step 1 写成“未选择前禁用 Next”，将与 Cloud 当前行为不一致。

### A.5 Semantics step 2 的 example prompt 仍不自动回填；guard cancel 仍保留输入

复核结果：

- 选择一个 model 进入 step 2 后，页面仍显示：
  - `Generate semantics`
  - `College`
  - `E-commerce`
  - `Human Resources`
- 点击 `College` 后，输入框内容保持不变（空值不被自动填充）
- 手动输入 prompt 后点击顶部 `Back to modeling`
  - 出现 leave confirm
  - 点击 `Cancel` 后，输入框内容仍被保留

证据：

- `tmp/modeling-fresh-generate-semantics.png`
- `tmp/modeling-fresh-semantics-prompt-retained.png`
- `tmp/modeling-semantics-step2-prompt-2026-04-22.png`

这说明：

1. example prompt 当前是 reference content，不是 click-to-fill 模板；
2. semantics route 内状态保留语义，当前仍然成立。

### A.6 `openAssistant=relationships` 仍然只是 landing 在 modeling

复核结果：

- 打开 `https://cloud.getwren.ai/projects/15008/modeling?openAssistant=relationships`
- 页面仍然只是 normal modeling canvas
- 页面内可见 `Modeling AI Assistant`
- 但不会直接进入 `Generate relationships`

证据：

- `tmp/modeling-fresh-openAssistant-relationships-noop.png`

这再次确认：

> `openAssistant=...` 目前仍应被视为 future hook，而不是 Cloud 当前已生效的 deep-link contract。

### A.7 Semantics step 2 的 `Back` 仍会清空 step 1 选择

复核结果：

- step 1 勾选 model 后进入 step 2
- 点击底部 `Back`
- 返回 step 1 后，原本勾选的 model 已被清空

证据：

- `tmp/modeling-fresh-semantics-step-back-clears-selection.png`

这说明：

> 当前 Cloud 的 wizard 内回退，不只是“返回上一页”，而是会把 pick-models selection reset 掉。

2026-04-22 深夜 fresh rerun 又补了一条更强的 completed-state 版本：

- 在单模型成功 `Generate`，页面已经进入 `Generated semantics` completed review state 后；
- 点击底部 `Back`
- 页面会直接回到 fresh step 1 `Pick models`
- `Generated semantics` / `Regenerate` 消失
- 6 个 checkbox 全部重置为 `false`

这说明：

> completed review state 的底部 `Back` 也不是“回到带 prompt 的 step 2”；  
> 它同样会把 semantics wizard 直接打回 fresh step 1，并清空 selection。

同轮 fresh network 里也没有出现 `SaveModelDescriptions`，说明 completed-state 的底部 `Back` 同样不会顺手持久化当前 preview。

### A.8 Semantics step 1 即使 untouched，顶部 `Back to modeling` 也仍会触发 guard

复核结果：

- 在 fresh step 1、不勾选任何 model 的情况下点击顶部 `Back to modeling`
- 仍出现：
  - `Go back to the modeling page?`
  - `Please be aware that leaving the page will not save your progress...`

证据：

- `tmp/modeling-fresh-semantics-step1-back-modal.png`

这意味着：

> 这套顶部返回保护当前仍然是 route-level leave guard，不依赖 dirty state。

### A.9 真正 `Go back` 退出后，重进 semantics 仍然是 fresh step 1

复核结果：

- 在 semantics step 2 输入 prompt 后，通过顶部 `Back to modeling` -> modal `Go back` 真正退出
- URL 可回到 `/projects/15008/modeling`
- 再次进入 `recommend-semantics` 后：
  - 回到 `Pick models`
  - checkbox 未保留之前勾选状态

证据：

- `tmp/modeling-fresh-semantics-reenter-reset.png`
- `tmp/modeling-semantics-step1-reentry-reset-2026-04-22.png`

这再次确认：

> semantics flow 当前的状态生命周期仍然是：`Cancel in modal => preserve in-route state`，`Go back exit => reset on re-entry`。

### A.10 Relationships 底部 `Cancel and Go Back` 仍是直接退出，不弹确认

复核结果：

- 在 `recommend-relationships` 点击底部 `Cancel and Go Back`
- 页面可直接返回 `/projects/15008/modeling`
- 中间未出现 `Go back to the modeling page?` confirm modal

这再次说明：

> Cloud 当前至少同时存在两种退出 contract：
> 1. 顶部 `Back to modeling`：guarded leave
> 2. 底部 `Cancel and Go Back`：direct exit

### A.11 Multi-model semantics 在本次 fresh run 中暴露了一个失败模式

本次继续用 fresh run 复核 multi-model semantics 时，观察到一个**当前 Cloud 失败模式**：

- 在 `recommend-semantics` step 1 勾选两个 model：
  - `employees`
  - `dept_emp`
- step 2 输入 prompt 后点击 `Generate`
- GraphQL 先成功触发：
  - `CreateModelDescriptionTask(modelIds: [134798, 134799], prompt: ...)`
- 随后轮询 `ModelsDescriptionTask(taskId)` 的过程中，出现：
  - `502` 响应
- 页面最终落到：
  - `Application error: a client-side exception has occurred`

同时浏览器 console 可见：

- `[Network error]: ServerError: Response not successful: Received status code 502`
- `TypeError: Cannot read properties of undefined (reading 'message')`

证据：

- `tmp/modeling-fresh-semantics-multi-model-502-client-error.png`
- Playwright network：
  - `CreateModelDescriptionTask(modelIds:[134798,134799], prompt: ...)`
  - `ModelsDescriptionTask(taskId)` 中出现 `502`

这条证据的含义要谨慎处理：

1. 它**不是**我们要对齐的理想交互 contract；
2. 它是 2026-04-22 在 Cloud 当前环境里观察到的**真实失败模式**；
3. 因此本地实现不能只复刻 happy path，还必须保证：
   - task polling 失败时进入 recoverable failed state；
   - 页面不能因为缺失 `error.message` 而直接 client crash。

### A.12 Multi-model semantics 的 happy path 仍然存在，而且结果会按已选 model 分组

为了确认 A.11 不是“multi-model 永远不可用”，本次又做了一轮 fresh multi-model run：

- step 1 勾选：
  - `employees`
  - `dept_emp`
- step 2 输入 prompt：
  - `HR dataset for employees and department assignments.`
- 点击 `Generate` 后，这一轮成功进入 completed state：
  - `Generate` -> `Regenerate`
  - `Save` enabled
  - `Generated semantics` 展示成功
  - 页面正文同时包含：
    - `dept_emp`
    - `employees`

证据：

- `tmp/modeling-fresh-semantics-after-generate-multi-model-success-2026-04-22.png`

这说明：

1. multi-model semantics 在 Cloud 当前并非必然失败；
2. A.11 更像是**间歇性 / 上游异常时的失败模式**；
3. 本地实现既要支持 multi-model grouped success，也要稳住 failure fallback。

### A.13 Semantics `Save` 的当前 contract：提交 descriptions 后退出回 modeling

本次继续对 `Save` 动作做 fresh 复核，结果如下：

- 在 `recommend-semantics` 生成完成态点击 `Save`
- 页面会直接返回：
  - `/projects/15008/modeling`

同时，本轮抓到 Cloud 当前的保存 mutation：

- `SaveModelDescriptions`

请求 payload 结构是：

- `data.models[]`
  - `modelId`
  - `description`
- `data.columns[]`
  - `columnId`
  - `description`

保存完成后，再从 modeling 页直接查询 `Diagram`，可以看到：

- model `description` 已写入
- field `description` 已写入

本轮 fresh 证据：

- `tmp/modeling-semantics-save-network-2026-04-22.txt`
- `SaveModelDescriptions`
- modeling 页内 `Diagram` 查询返回已更新的：
  - `employees.description`
  - `employees.fields[].description`

这说明：

> Cloud 当前 semantics flow 不只是“生成后预览”；  
> `Save` 已经是一个真实的 **persist + exit-to-modeling** contract。

补充复核：

- 从 modeling 再次进入 `recommend-semantics`
- 页面会回到 fresh `Pick models`
- checkbox 选择数为 `0`

这说明：

> `Save` 的退出语义与顶部 `Go back` 一样，都会结束当前 route session；  
> 重新进入 assistant flow 时不会保留之前的 step/selection。

### A.14 生成完成但未 `Save` 时，顶部 `Go back` 不会持久化新语义

本次继续用 `salaries` 做了一轮 fresh 验证：

- 进入 `recommend-semantics`
- 选择 `salaries`
- 输入中文 prompt 后点击 `Generate`
- 页面内生成出的 preview 是新的中文描述，例如：
  - `员工薪资历史明细表，记录每位员工在不同时间段的薪资金额...`
- 此时**不点击 `Save`**
- 直接走顶部：
  - `Back to modeling` -> modal `Go back`

退出回 modeling 后，再直接查询 `Diagram`：

- `salaries.description` 仍然是原先已存在的英文描述：
  - `Records employee salary details over time in the Employees sample database`
- field descriptions 也仍是原先持久化值，并未被这次 preview 覆盖

2026-04-22 深夜 fresh rerun 又在单模型 `employees` 上补了一次更直接的对照：

- preview review state 中，页面展示的未保存描述是：
  - `员工主数据模型，记录员工基础档案信息（编号、姓名、性别、出生日期、入职日期等），作为HR分析中连接部门、薪资与经理关系等主题数据的核心维度表。`
- 此时**不点 `Save`**，而是走顶部：
  - `Back to modeling` -> `Go back`
- 回到 modeling 后，直接用页面内 GraphQL `Diagram` 查询读取 persisted `employees.description`，拿到的仍是：
  - `员工主数据表，存储员工基础档案信息（如姓名、性别、出生日期、入职日期等），用于HR员工管理以及与部门分配等主题数据关联分析。`

这组 fresh 结果说明：当前生成出来的 preview 文本与 persisted diagram 值是可区分的，而 `Go back` 后 persisted description 没有被 preview 覆盖。

同一轮 fresh rerun 还顺手复核了“未保存退出后的重新进入”：

- 从 modeling 再次进入 `recommend-semantics`
- 页面重新回到 fresh step 1 `Pick models`
- 6 个 checkbox 全部为 `false`
- 页面上不存在 step-2 prompt textarea
- 页面上不存在 `Generated semantics` / `Regenerate`
- fresh re-entry network 里也没有 `CreateModelDescriptionTask` / `ModelsDescriptionTask`

这说明：即使是“Generate 成功但未 Save 再 Go back”的场景，assistant route session 也会在真实退出后被彻底重置。

这说明：

> semantics flow 当前的持久化边界很清楚：  
> **只有 `Save` 会写入；仅生成 preview 再 `Go back` 不会持久化。**

### A.15 2026-04-23 凌晨再次快速复核：launcher / sibling route / `openAssistant` 仍无变化

为避免结论只锚定在 2026-04-22 白天与深夜的几轮结果，本次又在本地 shell 时钟
`2026-04-23 04:46 CST` 附近做了一轮低风险快速复核，重点只看三个最容易在实施时走偏的 contract：

1. `modeling` 顶部的 `Modeling AI Assistant` 仍然是 dropdown launcher；
2. 从 launcher 点击 `Recommend relationships` 后，仍进入独立 sibling route：
   - `/projects/15008/recommend-relationships`
3. `modeling?openAssistant=relationships` 仍只是落在 modeling 画布，不会自动打开 assistant flow。

这轮复核里，launcher 展开后仍可见：

- `Recommend semantics`
- `Recommend relationships`

点击 `Recommend relationships` 后，页面仍落在：

- `Generate relationships`
- `No additional recommended relationships`
- `No relationships are recommended.`
- `Save` disabled

随后直接访问：

- `https://cloud.getwren.ai/projects/15008/modeling?openAssistant=relationships`

页面仍然只是普通 modeling 画布，顶部可见 `Modeling AI Assistant`，没有自动跳到：

- `/recommend-relationships`

也没有出现 assistant route 的内容壳子。
同轮 network 里仍只看到 bootstrap queries（如 `Me` / `GetSettings` / `Diagram` / `Subscription`），没有：

- `CreateModelRelationshipsTask`
- `ModelRelationshipsTask`

这一轮 fresh rerun 的意义主要是再次确认：

> 即使在新一轮会话里，Cloud 当前 contract 仍然是  
> **dropdown launcher + sibling route**，而不是 `openAssistant=...` deep-link 生效。

新增证据：

- `tmp/playwright-modeling-fresh-rerun-snapshot-2026-04-23.md`
- `tmp/playwright-modeling-fresh-rerun-network-2026-04-23.txt`
- `tmp/playwright-modeling-fresh-rerun-dropdown-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-relationships-empty-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-relationships-network-2026-04-23.txt`
- `tmp/playwright-modeling-fresh-rerun-openAssistant-relationships-noop-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-openAssistant-relationships-network-2026-04-23.txt`

### A.16 2026-04-23 同轮补充：semantics launcher 仍走 sibling route，而 `openAssistant=semantics` 仍不生效

同一轮快速复核又补了一条与实施同样相关的对照：

1. 从 modeling 顶部 launcher 点击 `Recommend semantics`
2. 页面仍进入：
   - `/projects/15008/recommend-semantics`
3. 首屏仍停在 step 1：
   - `Pick models`

同轮 route-entry network 里看到的仍然只是 bootstrap queries，例如：

- `Me`
- `GetSettings`
- `OnboardingStatus`
- `Diagram`
- `Subscription`
- `Credits`
- `DeployStatus`

没有看到：

- `CreateModelDescriptionTask`
- `ModelsDescriptionTask`
- `SaveModelDescriptions`

这再次确认：**从 launcher 进入 semantics route 本身，不会自动触发生成任务。**

随后又直接访问：

- `https://cloud.getwren.ai/projects/15008/modeling?openAssistant=semantics`

结果仍然只是普通 modeling 画布，顶部可见 `Modeling AI Assistant`，没有自动进入：

- `/recommend-semantics`

同轮 `openAssistant=semantics` network 里也仍只看到 bootstrap queries，没有：

- `CreateModelDescriptionTask`
- `ModelsDescriptionTask`

这说明：到 2026-04-23 这轮 fresh rerun 为止，`openAssistant=semantics` 与 `openAssistant=relationships` 一样，仍应被视作未生效的 future hook，而不是 Cloud 当前 active contract。

新增证据：

- `tmp/playwright-modeling-fresh-rerun-semantics-step1-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-semantics-route-entry-network-2026-04-23.txt`
- `tmp/playwright-modeling-fresh-rerun-openAssistant-semantics-noop-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-openAssistant-semantics-network-2026-04-23.txt`

### A.17 2026-04-23 同轮再补一条：step 1 仍是 submit-then-validate，example prompt 仍不自动回填

为了避免“虽然 route 结构没变，但 wizard 细节可能已悄悄调整”的误判，同一轮又做了两条极低风险交互复核：

#### A.17.1 step 1 `Next` with no selection

在 fresh `recommend-semantics` step 1：

- 不勾选任何 model
- 直接点击 `Next`

结果仍然是：

- 页面停留在 `Pick models`
- 出现 inline validation：
  - `Please select at least one model.`

同轮 network 里仍只看到 bootstrap queries：

- `Me`
- `GetSettings`
- `OnboardingStatus`
- `Diagram`
- `Subscription`
- `Credits`
- `DeployStatus`

没有：

- `CreateModelDescriptionTask`
- `ModelsDescriptionTask`
- `SaveModelDescriptions`

这说明 step 1 当前仍然是：

> **允许点击 `Next`，再做 submit-time validation**  
> 而不是“未选中前就禁用 `Next`”。

#### A.17.2 step 2 example prompt

随后又在同一 fresh rerun 里：

- 勾选 `employees`
- 进入 step 2 `Generate semantics`
- 点击 example prompt：`College`

结果是：

- textarea 点击前为空
- 点击后仍为空

同轮 network 里也仍然没有：

- `CreateModelDescriptionTask`
- `ModelsDescriptionTask`
- `SaveModelDescriptions`

这再次确认：Cloud 当前 example prompts 仍是**参考文案块**，而不是 click-to-fill 模板。

新增证据：

- `tmp/playwright-modeling-fresh-rerun-semantics-next-validation-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-semantics-next-validation-network-2026-04-23.txt`
- `tmp/playwright-modeling-fresh-rerun-semantics-example-no-fill-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-semantics-example-no-fill-network-2026-04-23.txt`

### A.18 2026-04-23 同轮再补：step 2 `Back` 仍重置到 fresh step 1；untouched step 1 顶部 back 仍带 guard

同一轮 fresh rerun 最后又补了两条“返回语义”验证，避免后续实现时把 step-back 和 route-exit 混在一起：

#### A.18.1 step 2 bottom `Back`

在 fresh step 2 `Generate semantics`（已选 `employees`）点击底部 `Back` 后：

- 页面重新回到 `Pick models`
- 6 个 checkbox 全部未选中
- 页面上没有 step-2 的 `User Prompt` 区块
- 页面重新只保留 step-1 的 `Next`

同轮 network 里仍只看到 bootstrap queries：

- `Me`
- `GetSettings`
- `OnboardingStatus`
- `Diagram`
- `Subscription`
- `Credits`
- `DeployStatus`

没有：

- `CreateModelDescriptionTask`
- `ModelsDescriptionTask`
- `SaveModelDescriptions`

这说明：step 2 的底部 `Back` 当前仍然是**reset wizard state**，而不是“保留 step 2 草稿后返回 step 1”。

#### A.18.2 untouched step 1 top `Back to modeling`

随后在 fresh step 1（未勾选任何 model）直接点击顶部 `Back to modeling`，页面仍弹出统一 confirm modal：

- `Go back to the modeling page?`
- `Please be aware that leaving the page will not save your progress, and this action cannot be undone.`

modal 里仍有：

- `Cancel`
- `Go back`

点击 `Cancel` 后：

- 页面仍留在 `/recommend-semantics`
- `Pick models` 仍可见
- 仍是 fresh step 1（0 selection）

同轮 network 里同样没有：

- `CreateModelDescriptionTask`
- `ModelsDescriptionTask`
- `SaveModelDescriptions`

这说明：即使 step 1 还是 untouched，Cloud 当前也仍把顶部 back 视为 **route-level guarded leave**，而不是“无状态直接返回”。

新增证据：

- `tmp/playwright-modeling-fresh-rerun-semantics-back-reset-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-semantics-back-reset-network-2026-04-23.txt`
- `tmp/playwright-modeling-fresh-rerun-semantics-step1-top-back-modal-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-semantics-step1-top-back-modal-network-2026-04-23.txt`
- `tmp/playwright-modeling-fresh-rerun-semantics-step1-top-back-cancel-2026-04-23.png`

### A.19 2026-04-23 同轮补：relationships 的 top-back 仍 guarded，bottom cancel 仍直接退出

为了和 semantics 的“返回语义”对照完整，同一轮又回到 `recommend-relationships` 做了一次 fresh 验证。

#### A.19.1 top `Back to modeling`

在 relationships empty state 页面点击顶部 `Back to modeling` 后，仍弹出统一 confirm modal：

- `Go back to the modeling page?`
- `Please be aware that leaving the page will not save your progress, and this action cannot be undone.`

modal 里仍有：

- `Cancel`
- `Go back`

而且 modal 打开时，底层 empty state 仍可见：

- `No additional recommended relationships`

点击 `Cancel` 后：

- 页面仍留在 `/recommend-relationships`
- empty state 仍然保留
- 底部 `Cancel and Go Back` 仍可见

这说明 relationships 页顶部 back 当前仍然是 **route-level guarded leave**，不是直接返回。

#### A.19.2 bottom `Cancel and Go Back`

随后在同一 empty state 页面点击底部 `Cancel and Go Back`：

- 页面直接回到：
  - `/projects/15008/modeling`
- modeling 页面再次显示：
  - `Modeling AI Assistant`
- 页面上没有出现 confirm modal

同轮 route sequence network 也只体现为：

- 进入 relationships 时的 `CreateModelRelationshipsTask`
- 后续的 `ModelRelationshipsTask` polling
- 退出回 modeling 后的 bootstrap / `Diagram` / `DeployStatus`

没有看到额外保存类操作。

这进一步确认：

> relationships 页当前仍然维持和之前一致的双返回语义：  
> **top back = guarded leave**；  
> **bottom `Cancel and Go Back` = direct exit to modeling**。

新增证据：

- `tmp/playwright-modeling-fresh-rerun-relationships-top-back-modal-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-relationships-top-back-cancel-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-relationships-bottom-cancel-return-modeling-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-relationships-return-sequence-network-2026-04-23.txt`

### A.20 2026-04-23 同轮意外暴露：relationships route 存在间歇性 client-side exception 失败模式

在继续做 fresh rerun 时，又额外暴露出一个之前文档里还没单独记录的失败模式：

- 直接访问 `https://cloud.getwren.ai/projects/15008/recommend-relationships`
- 页面在等待 empty state 期间没有正常落稳
- 随后页面进入 Next.js 通用错误页：
  - `Application error: a client-side exception has occurred`

这一轮抓到的 console / network 进一步说明，这不是单纯的前端静态崩溃，而更像是：

1. relationships route 正常发出了：
   - `CreateModelRelationshipsTask`
   - `ModelRelationshipsTask`
2. 随后 `https://cloud.getwren.ai/api/graphql` 返回了：
   - `502`
3. 前端在处理失败结果时抛出：
   - `TypeError: Cannot read properties of undefined (reading 'message')`

console stack 还直接指向：

- `_app-f059b193095030b2.js`
- `pages/projects/[projectId]/recommend-relationships-*.js`

这说明 Cloud 当前 relationships flow 除了“正常 empty state contract”之外，还存在一条**上游失败 + 前端错误处理不稳**的异常分支：

> 当 GraphQL task/poll 失败到某些返回形态时，relationships route 可能不是优雅落到可恢复错误态，  
> 而是直接进入 client-side exception 页面。

这类 failure mode 与前文 A.11 中记录的 multi-model semantics 间歇性失败不同，属于另一条更偏前端容错的风险。

新增证据：

- `tmp/playwright-modeling-fresh-rerun-relationships-client-error-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-relationships-client-error-console-2026-04-23.txt`
- `tmp/playwright-modeling-fresh-rerun-relationships-client-error-network-2026-04-23.txt`

### A.21 2026-04-23 同轮再补：同一路径重试后又可恢复到 empty state，说明 relationships 崩溃目前更像间歇性失败

在 A.20 暴露出 client-side exception 后，同一 tab 立即再次访问：

- `https://cloud.getwren.ai/projects/15008/recommend-relationships`

这一次页面又成功恢复到正常空态：

- `Generate relationships`
- `No additional recommended relationships`
- `No relationships are recommended.`

也就是说，A.20 中观察到的异常并不是“进入 relationships route 必现崩溃”，而更像：

> **同一路径在某些时刻会因为上游 / 错误处理问题进入 client-side exception，  
> 但立刻重试又可能恢复到正常 empty state。**

这一轮 recovery rerun 的 network 仍然符合正常 contract：

- `CreateModelRelationshipsTask`
- `ModelRelationshipsTask` polling
- 最终落到空态

本轮没有再次观察到：

- `502`
- client-side exception 页面

因此目前更合理的表述应是：

- relationships route 的“正常 contract”依然是 recommendation task -> empty state
- 但 Cloud 当前还存在一条 **intermittent crash branch**
- 这条 crash branch 具有 **可重试恢复** 特征

新增证据：

- `tmp/playwright-modeling-fresh-rerun-relationships-recovery-empty-state-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-relationships-recovery-network-2026-04-23.txt`

### A.22 2026-04-23 同轮再补：3 次连续 direct visit stability probe 未复现崩溃

为了避免 A.20 / A.21 还停留在“撞到一次崩溃、重试一次恢复”的偶然样本，同一轮又补做了一次小型稳定性探测：

- 同一 tab
- 连续 3 次直接访问：
  - `https://cloud.getwren.ai/projects/15008/recommend-relationships`
- 每次等待最多 20s，只判断两种终态：
  - `No additional recommended relationships`
  - `Application error: a client-side exception has occurred`

本轮 probe 的 3 次结果全部都是：

- `empty-state`

没有再次复现：

- client-side exception 页面

这进一步说明，当前更合理的表述不是“relationships route 很容易稳定崩溃”，而是：

> relationships route 存在一条 **intermittent / non-deterministic crash branch**，  
> 但默认与多数重试结果仍然是正常 empty-state contract。

换句话说：

- A.20 证明了异常分支**真实存在**
- A.21 证明了它**可重试恢复**
- A.22 则补强：在一个小样本 3 连续重试中，它**没有再次复现**

新增证据：

- `tmp/playwright-modeling-fresh-rerun-relationships-stability-probe-2026-04-23.md`

### A.23 2026-04-23 对照补充：semantics 的 3 次连续 direct visit stability probe 全部稳定落到 step 1

为了让 A.22 的 relationships stability probe 有一个对照样本，同一轮又对 semantics route 做了同样的小样本稳定性探测：

- 同一 tab
- 连续 3 次直接访问：
  - `https://cloud.getwren.ai/projects/15008/recommend-semantics`
- 每次等待最多 20s，只判断两种终态：
  - `Pick models`
  - `Application error: a client-side exception has occurred`

本轮 probe 的 3 次结果全部都是：

- `step1`

也就是全部稳定落在 fresh step 1：

- `Pick models`

没有复现：

- client-side exception 页面

这说明，在当前这轮样本里：

- `recommend-semantics` 的默认 route entry 比 `recommend-relationships` 更稳定；
- 至少在这次 3 连续直达 probe 中，没有观察到与 A.20 同等级别的崩溃分支。

注意这并不证明 semantics route 完全没有异常路径，只是说明：

> 在当前小样本直达探测里，semantics route 的表现是**稳定一致地回到 fresh step 1**。

新增证据：

- `tmp/playwright-modeling-fresh-rerun-semantics-stability-probe-2026-04-23.md`

### A.24 2026-04-23 再补一条：`openAssistant=...` 的 4 次交替 direct visit 全部稳定 noop

为了避免“`openAssistant=...` 虽然通常不生效，但可能偶发地半激活 deep-link”这种误判，同一轮又对这两个 query 入口做了一个更直接的交替探测：

- 同一 tab
- 4 次交替直接访问：
  1. `modeling?openAssistant=relationships`
  2. `modeling?openAssistant=semantics`
  3. `modeling?openAssistant=relationships`
  4. `modeling?openAssistant=semantics`

每次等待最多 15s，只判断两种终态：

- 正常 modeling 画布（可见 `Modeling AI Assistant`，且不出现 assistant route 主体内容）
- client-side exception 页面

本轮 4 次结果全部都是：

- `modeling-noop`

而且配套 network 里看到的仍然只是 modeling 画布的 bootstrap 查询，例如：

- `Me`
- `GetSettings`
- `OnboardingStatus`
- `Diagram`
- `Subscription`
- `Credits`
- `DeployStatus`

没有看到：

- `CreateModelRelationshipsTask`
- `ModelRelationshipsTask`
- `CreateModelDescriptionTask`
- `ModelsDescriptionTask`

这进一步说明：当前更合理的表述不是“`openAssistant=...` 偶尔会成功，只是很不稳定”，而是：

> `openAssistant=relationships|semantics` 目前仍然是 **稳定 noop / inactive future hook**，  
> 而不是 flaky partially-active deep-link contract。

新增证据：

- `tmp/playwright-modeling-fresh-rerun-openAssistant-stability-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-openAssistant-stability-network-2026-04-23.txt`
- `tmp/playwright-modeling-fresh-rerun-openAssistant-stability-probe-2026-04-23.md`
- `tmp/playwright-modeling-fresh-rerun-relationships-history-back-return-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-relationships-top-goback-history-return-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-semantics-history-back-return-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-semantics-history-step2-reenter-empty-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-history-probe-2026-04-23.md`
- `tmp/playwright-modeling-fresh-rerun-launcher-expanded-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-launcher-collapsed-after-back-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-launcher-history-probe-2026-04-23.md`

---


### A.25 2026-04-23 再补一条：退出 assistant route 后，浏览器 Back 仍会回到刚才的 assistant 页

为了避免把“UI 上已经返回 modeling”误读成“history 也已被 replace 掉”，本轮又单独做了两条浏览器历史探测：

#### A.25.1 relationships：bottom `Cancel and Go Back` 后再按浏览器 Back

步骤：

1. 进入 `/projects/15008/recommend-relationships`
2. 等待页面落到 empty state：
   - `No additional recommended relationships`
3. 点击底部：
   - `Cancel and Go Back`
4. 页面回到：
   - `/projects/15008/modeling`
5. 随后立即触发浏览器 `Back`

结果：

- 页面又回到：
  - `/projects/15008/recommend-relationships`
- 并重新稳定落在同一个 empty state：
  - `Generate relationships`
  - `No additional recommended relationships`

这说明：从用户可见效果上看，relationships 的底部 direct exit **不会压扁浏览器历史**；
虽然 UI 直接回到了 modeling，但浏览器 Back 仍会带用户回到刚才那条 assistant route。

#### A.25.2 semantics：top `Back to modeling` -> `Go back` 后再按浏览器 Back

步骤：

1. 进入 fresh `/projects/15008/recommend-semantics`
2. 停留在 step 1：
   - `Pick models`
3. 点击顶部：
   - `Back to modeling`
4. 在 confirm modal 里点击：
   - `Go back`
5. 页面回到：
   - `/projects/15008/modeling`
6. 随后立即触发浏览器 `Back`

结果：

- 页面又回到：
  - `/projects/15008/recommend-semantics`
- 并重新稳定落在 fresh step 1：
  - `Pick models`

这说明：semantics 顶部 guarded leave 在用户可见层面上同样是 **history-preserving exit**。

#### A.25.3 对本地实现的约束含义

更谨慎的表述应是：

> Cloud 当前 assistant routes 的退出动作在 UI 上是“返回 modeling”，  
> 但从浏览器可见行为看，仍然保留了刚刚那条 assistant route 的 history entry。

因此本地如果要对齐 Cloud，应该把这类动作理解为：

- **UI contract**：
  - relationships bottom cancel = direct exit
  - semantics top `Go back` = confirmed exit
- **history contract**：
  - exit 后浏览器 `Back` 仍可回到原 assistant route

这里我们只陈述用户可见效果；至于底层究竟是 `push` 还是某种等价实现，当前证据还不足以做代码级断言。

新增证据：

- `tmp/playwright-modeling-fresh-rerun-relationships-history-back-return-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-relationships-top-goback-history-return-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-semantics-history-back-return-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-semantics-history-step2-reenter-empty-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-history-probe-2026-04-23.md`
- `tmp/playwright-modeling-fresh-rerun-launcher-expanded-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-launcher-collapsed-after-back-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-launcher-history-probe-2026-04-23.md`

---


### A.26 2026-04-23 再补一条：semantics step 2 未保存草稿在 browser Back 链路下也不会恢复成可见 draft

为了确认 A.25 里“browser Back 会回到 assistant route”这件事，是否也意味着**会把 step 2 的未保存 prompt 草稿完整恢复出来**，本轮又追加了一条更细的 step-2 历史探测。

步骤：

1. 进入 fresh `/projects/15008/recommend-semantics`
2. 勾选 `employees`
3. 进入 step 2：
   - `Generate semantics`
4. 在 prompt 输入框里输入：
   - `History probe step2 prompt 2026-04-23`
5. 点击顶部 `Back to modeling`
6. 在 confirm modal 里点击：
   - `Go back`
7. 页面回到 `/projects/15008/modeling`
8. 随后立即触发浏览器 `Back`

结果分两层：

#### A.26.1 用户可见层

browser Back 返回 assistant route 后，用户可见页面是：

- `/projects/15008/recommend-semantics`
- fresh step 1：
  - `Pick models`
- 0 个 checked checkboxes

也就是说，从用户可见交互上看：

> browser Back 虽然会把用户带回 semantics route，  
> 但**不会直接把 step 2 的 typed prompt draft 恢复成当前可见状态**。

#### A.26.2 DOM 仪表层（仅作实现线索，不作为产品 contract）

本轮用页面内 DOM 仪表又观察到一个更细的实现现象：

- 回到 step 1 后，页面 DOM 中仍可读到一个隐藏的 `textarea`
- 它带有：
  - `aria-hidden="true"`
  - `visibility: hidden`
- 这个隐藏节点里仍然残留上一轮输入的：
  - `History probe step2 prompt 2026-04-23`

但随后再次：

1. 在 step 1 重新勾选 `employees`
2. 重新进入 step 2

用户可见的 prompt 输入框仍然是空的，只显示默认 placeholder：

- `This dataset is to ...`

这说明：

- 即使底层 DOM 某处短暂残留了隐藏 textarea 值，
- **用户可见 contract 仍应视为“draft 未恢复”**，
- 本地实现不应把这类隐藏节点残值误判成 Cloud 的正式恢复语义。

#### A.26.3 对齐含义

更稳妥的对齐表述是：

- A.25 证明：assistant route 的 history entry 会被保留
- A.26 补充：**history entry 保留 ≠ step-2 draft 恢复**

因此如果本地想贴近 Cloud 当前交互，应该优先实现为：

- browser Back 可回到 assistant route
- 但未保存 step-2 draft 仍按 fresh wizard 处理
- 不要默认做成“离开后再 Back 就恢复可见 prompt 草稿”

新增证据：

- `tmp/playwright-modeling-fresh-rerun-semantics-history-step2-reenter-empty-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-history-probe-2026-04-23.md`
- `tmp/playwright-modeling-fresh-rerun-launcher-expanded-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-launcher-collapsed-after-back-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-launcher-history-probe-2026-04-23.md`

---


### A.27 2026-04-23 再补一条：relationships 顶部 `Go back` 退出后，browser Back 同样会回到 assistant route

A.25 已经确认了：

- relationships 底部 `Cancel and Go Back`
- semantics 顶部 `Back to modeling` -> `Go back`

这两条退出路径都会保留 assistant route 的 history entry。为了把 relationships 的两条退出动作补成完整矩阵，本轮又单独复核了 **relationships 顶部 guarded leave 的 confirmed exit**。

步骤：

1. 进入 `/projects/15008/recommend-relationships`
2. 等待 empty state：
   - `No additional recommended relationships`
3. 点击顶部：
   - `Back to modeling`
4. 在 confirm modal 里点击：
   - `Go back`
5. 页面回到：
   - `/projects/15008/modeling`
6. 随后立即触发浏览器 `Back`

结果：

- 页面重新回到：
  - `/projects/15008/recommend-relationships`
- 并再次稳定落在同一个 empty state：
  - `Generate relationships`
  - `No additional recommended relationships`

这说明：

> relationships 顶部 guarded leave 与底部 direct exit 在“是否保留 browser history entry”这件事上，
> 当前用户可见结果是一致的：**两者都会把用户带回 modeling，但浏览器 Back 仍能回到 assistant route。**

因此更完整的对齐表述应是：

- relationships top `Go back` = guarded exit + history preserved
- relationships bottom `Cancel and Go Back` = direct exit + history preserved

新增证据：

- `tmp/playwright-modeling-fresh-rerun-relationships-top-goback-history-return-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-history-probe-2026-04-23.md`
- `tmp/playwright-modeling-fresh-rerun-launcher-expanded-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-launcher-collapsed-after-back-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-launcher-history-probe-2026-04-23.md`

---

### A.28 2026-04-23 再补一条：semantics wizard 内部 step `Back` 当前不会写入浏览器历史

为了区分两类“返回”到底谁会进入 browser history，本轮又补做了一次针对 semantics wizard 内部 `Back` 的探测。

步骤：

1. 在 fresh tab 直接打开：
   - `/projects/15008/recommend-semantics`
2. 勾选 `employees`
3. 点击 `Next` 进入 step 2：
   - `Generate semantics`
4. 点击 step 2 底部：
   - `Back`
5. 页面返回 step 1：
   - `Pick models`
   - 0 个 checked checkboxes
6. 此时立即触发浏览器 `Back`

结果：

- 浏览器直接离开当前 assistant route，回到：
  - `about:blank`
- 没有出现：
  - 回到 step 2
  - 或停留在 `/recommend-semantics` 的另一段 wizard state

这说明：

> 至少在本轮 fresh direct-visit 样本里，semantics 的内部 step 切换当前**不会额外写入浏览器历史**；
> step 2 -> step 1 的 `Back` 更像纯 wizard state reset，而不是 route-level navigation。

因此本地如果要贴近 Cloud 当前交互，应该把两类返回严格区分：

- route-level exit（回 modeling）
  - 会保留 assistant route 的 browser history entry
- wizard internal back（step 2 -> step 1）
  - **不应默认实现成 browser-history-aware transition**

这里的结论仍然只针对用户可见行为；它说明“浏览器 Back 不会回到 step 2”，而不是断言内部绝对没有任何状态机痕迹。

新增证据：

- `tmp/playwright-modeling-fresh-rerun-history-probe-2026-04-23.md`
- `tmp/playwright-modeling-fresh-rerun-launcher-expanded-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-launcher-collapsed-after-back-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-launcher-history-probe-2026-04-23.md`

---


### A.29 2026-04-23 再补一条：顶部 leave modal 的 `Cancel` 当前也不会额外写入浏览器历史

A.27 / A.28 已经把两类“返回”拆得更清楚了：

- confirmed exit to modeling
- wizard internal back

为了把顶部 leave modal 的第三种动作也补完整，本轮又分别对两个 assistant route 做了 fresh direct-visit 探测：

#### A.29.1 semantics：top back -> `Cancel` -> browser Back

步骤：

1. fresh tab 直接打开 `/projects/15008/recommend-semantics`
2. 停留在 fresh step 1：
   - `Pick models`
3. 点击顶部：
   - `Back to modeling`
4. 在 confirm modal 里点击：
   - `Cancel`
5. 页面仍留在：
   - `/projects/15008/recommend-semantics`
6. 此时立即触发浏览器 `Back`

结果：

- 浏览器直接离开当前 route，回到：
  - `about:blank`
- 没有出现：
  - `/projects/15008/modeling`
  - 或新的 assistant route 历史跳转

#### A.29.2 relationships：top back -> `Cancel` -> browser Back

步骤：

1. fresh tab 直接打开 `/projects/15008/recommend-relationships`
2. 等待 empty state：
   - `No additional recommended relationships`
3. 点击顶部：
   - `Back to modeling`
4. 在 confirm modal 里点击：
   - `Cancel`
5. 页面仍留在：
   - `/projects/15008/recommend-relationships`
6. 此时立即触发浏览器 `Back`

结果：

- 浏览器同样直接离开当前 route，回到：
  - `about:blank`

#### A.29.3 对齐含义

这说明：

> 顶部 leave modal 的 `Cancel` 当前是**纯粹的 stay-on-page 行为**；  
> 它不会像 confirmed exit 那样把 modeling 留在浏览器历史后面，  
> 也不会像 route-level exit 一样改变当前用户的 history 轨迹。

因此当前更完整的返回矩阵可以写成：

- top back -> `Cancel`
  - stay on current route
  - **no extra browser-history mutation**
- top back -> `Go back`
  - exit to modeling
  - assistant route history preserved
- relationships bottom `Cancel and Go Back`
  - direct exit to modeling
  - assistant route history preserved
- semantics internal step `Back`
  - wizard reset
  - no browser-history step

新增证据：

- `tmp/playwright-modeling-fresh-rerun-history-probe-2026-04-23.md`
- `tmp/playwright-modeling-fresh-rerun-launcher-expanded-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-launcher-collapsed-after-back-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-launcher-history-probe-2026-04-23.md`

---

### A.30 2026-04-23 再补一条：modeling launcher 当前是折叠式 dropdown，且 launcher-originated route 切换会进入正常 browser history

前面的验证主要集中在 assistant route 自己的退出/返回语义。这一轮又把 **modeling 页 launcher 自身的交互 contract** 补齐了。

#### A.30.1 launcher 默认折叠；header click 才展开

本轮在 fresh `/projects/15008/modeling` 上直接读取 `data-guideid="modeling-copilot"` 下的 collapse block，观察到：

- header click 之前：
  - collapse block computed height = `0px`
- 对 `Modeling AI Assistant` header dispatch click 之后：
  - collapse block computed height = `69px`

并且展开后，页面可见项就是：

- `Recommend semantics`
- `Recommend relationships`

这说明：

> Cloud 当前的 `Modeling AI Assistant` 更准确地说是 **collapsed-by-default dropdown launcher**，  
> 而不是“默认常驻展开的列表”。

同时也要注意：即使 collapse block 在折叠态仍存在 DOM 文本，这也不应被误判成用户可见态。

#### A.30.2 modeling -> `Recommend semantics`

本轮又从 modeling 页 launcher 直接进入 semantics：

1. 打开 fresh `/projects/15008/modeling`
2. 展开 launcher
3. 触发 `Recommend semantics`
4. 页面进入：
   - `/projects/15008/recommend-semantics`
   - `Pick models`
5. 浏览器 `Back` 后回到：
   - `/projects/15008/modeling`
6. 浏览器 `Forward` 后再次进入：
   - `/projects/15008/recommend-semantics`
   - `Pick models`

这说明 launcher-originated 的 semantics navigation 当前就是 **标准的 browser-history route transition**。

#### A.30.3 modeling -> `Recommend relationships`

同轮又对 relationships 做了完全对称的 probe：

1. 打开 fresh `/projects/15008/modeling`
2. 展开 launcher
3. 触发 `Recommend relationships`
4. 页面进入：
   - `/projects/15008/recommend-relationships`
   - `Generate relationships`
5. 浏览器 `Back` 后回到：
   - `/projects/15008/modeling`
6. 浏览器 `Forward` 后再次进入：
   - `/projects/15008/recommend-relationships`

这说明 relationships 侧也一样：

- modeling launcher entry -> assistant route
- assistant route -> browser back -> modeling
- modeling -> browser forward -> same assistant route

#### A.30.4 对齐含义

这一轮补强后，更完整的 modeling/assistant navigation 语义可以写成：

- launcher 本身：
  - collapsed-by-default dropdown
- launcher item click：
  - route-level navigation to assistant sibling route
  - **进入正常 browser history**
- assistant route 内部：
  - confirmed exit / direct exit 会保留 assistant history entry
  - wizard internal back / modal cancel 不写额外 browser history

因此本地如果要贴近 Cloud，不能把 launcher 理解成：

- 默认展开的静态入口列表
- 或“不进入 history 的临时 overlay 跳转”

新增证据：

- `tmp/playwright-modeling-fresh-rerun-launcher-expanded-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-launcher-collapsed-after-back-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-launcher-history-probe-2026-04-23.md`

---

### A.31 2026-04-23 再补一条：launcher-originated flow 下，internal Back / modal Cancel 的 history 语义与 direct-visit 结论一致

A.28 / A.29 主要是在 fresh direct-visit tab 里验证：

- semantics internal step `Back`
- top leave modal `Cancel`

这两类动作都不会额外写入 browser history。为了避免“direct-visit 场景成立，但真实用户从 modeling launcher 进入时可能不同”这种疑问，本轮又补了 launcher-originated 对照。

#### A.31.1 launcher -> semantics -> internal `Back` -> browser `Back`

本轮按更贴近日常使用的链路复核：

1. 从 fresh `/projects/15008/modeling` 展开 launcher
2. 进入 `Recommend semantics`
3. 勾选 `employees` 并点击 `Next` 进入 step 2
4. 点击 internal bottom `Back` 回到 step 1
5. step 1 仍然是：
   - `Pick models`
   - `0` checked checkboxes
6. 随后立即触发浏览器 `Back`

结果：

- 浏览器直接回到：
  - `/projects/15008/modeling`
- 没有返回 step 2

这说明：

> 即使是在 launcher-originated 的真实用户路径里，semantics internal `Back` 也仍然只是 wizard reset，  
> **不会新增一个可被浏览器 Back 命中的 step-2 history entry。**

#### A.31.2 launcher -> semantics -> top back `Cancel` -> browser `Back`

同轮又测了另一条同样重要的链路：

1. 从 fresh `/projects/15008/modeling` 展开 launcher
2. 进入 `Recommend semantics`
3. 点击顶部 `Back to modeling`
4. 在 confirm modal 中点击：
   - `Cancel`
5. 页面继续停留在：
   - `/projects/15008/recommend-semantics`
6. 随后立即触发浏览器 `Back`

结果：

- 浏览器回到：
  - `/projects/15008/modeling`

这进一步说明：

> modal `Cancel` 在 launcher-originated 流程里同样不改写 history；  
> 浏览器 Back 只是回到进入 assistant route 之前的 modeling 页面。

#### A.31.3 对齐含义

因此现在可以更稳地把 A.28 / A.29 从“direct-visit 样本”提升成更一般的交互判断：

- internal wizard `Back`
  - 不写 browser history
- modal `Cancel`
  - 不写 browser history
- 两者在 direct-visit 场景下会让 browser Back 离开到 `about:blank`
- 在 launcher-originated 场景下，则会让 browser Back 回到 modeling

也就是说，**browser Back 去哪里，取决于用户进入 assistant route 之前的上一条 history entry；  
而不是取决于 internal Back / modal Cancel 自己是否制造了新 entry。**

---

### A.32 2026-04-23 再补一条：browser Back 回到 modeling 后，launcher 视觉上会重新折叠

A.30 已经确认 launcher 是 collapsed-by-default dropdown。为了确认“从 assistant route browser Back 回到 modeling”时，会不会保留 launcher 的展开态，本轮又在返回 modeling 后立即复核了 collapse block。

观察结果：

- browser Back 回到 modeling 后，`ModelingCopilot__CollapseBlock` 的 computed height 再次是：
  - `0px`
- 同时截图中只看到：
  - `Modeling AI Assistant` header row
- 没有看到展开中的：
  - `Recommend semantics`
  - `Recommend relationships` 列表面板

注意：collapse block 的 DOM text 仍可能存在，因此单纯依赖 `document.body.innerText` 会误以为 launcher 还在展开；但用户可见层上它已经重新收起。

这说明：

> modeling <- browser Back <- assistant route 这一条历史回退，不会保留 launcher 的可见展开态；  
> launcher 在用户可见层上会恢复成折叠状态。

因此本地如果要贴近 Cloud，应该把 launcher 理解成：

- 展开态是瞬时 UI state
- route 往返后默认回到 collapsed visible state
- 不能把 DOM 残留文本误判成“展开态已恢复”

新增证据：

- `tmp/playwright-modeling-fresh-rerun-launcher-collapsed-after-back-2026-04-23.png`
- `tmp/playwright-modeling-fresh-rerun-launcher-history-probe-2026-04-23.md`

---

### A.33 2026-04-23 再补一条：launcher -> relationships 后，底部 `Cancel and Go Back` 退出同样保留 assistant route 历史

为了补齐“最常见入口路径”的退出矩阵，本轮又专门复核了：

- `modeling`
- 展开 `Modeling AI Assistant`
- 点击 `Recommend relationships`
- 进入 `/recommend-relationships`
- 点击底部 `Cancel and Go Back`

观察结果：

- 点击底部 `Cancel and Go Back` 后，当前路由回到：
  - `/projects/15008/modeling`
- 随后触发 browser `Back`：
  - 会回到 `/projects/15008/recommend-relationships`
  - 页面仍能看到：
    - `Generate relationships`
- 再触发 browser `Forward`：
  - 会回到 `/projects/15008/modeling`

这说明：

> launcher-originated 的 relationships 路径下，底部直接退出动作也不会擦掉 assistant route 的浏览器历史；  
> 它仍然是一次正常的 route-level leave，browser Back 仍会回到刚才的 assistant route。

因此在 Cloud 语义里，`Cancel and Go Back` 应该理解成：

- 改变当前 route，退出到 modeling
- 但不改写“上一条 history entry 是 assistant route”这一事实
- 所以后续 browser Back / Forward 仍按 modeling <-> assistant route 正常往返

新增证据：

- `tmp/playwright-modeling-fresh-rerun-launcher-history-probe-2026-04-23.md`

---

### A.34 2026-04-23 再补一条：launcher -> semantics 后，顶部 `Go back` 确认退出同样保留 assistant route 历史

同一轮又补测了另一条最常见入口：

- `modeling`
- 展开 `Modeling AI Assistant`
- 点击 `Recommend semantics`
- 进入 `/recommend-semantics`
- 点击顶部 `Back to modeling`
- 在 leave modal 中点击 `Go back`

观察结果：

- 确认离开后，当前路由回到：
  - `/projects/15008/modeling`
- 随后触发 browser `Back`：
  - 会回到 `/projects/15008/recommend-semantics`
  - 页面仍能看到：
    - `Pick models`
- 再触发 browser `Forward`：
  - 会回到 `/projects/15008/modeling`

这说明：

> launcher-originated 的 semantics 路径下，顶部 leave modal 里的 `Go back` 也只是一次 route-level exit；  
> 它不会额外改写浏览器历史，因此 browser Back 仍会回到 assistant route。

这与 A.27 / A.29 / A.31 的结论一起，可以把 Cloud 当前 history contract 再收敛成一句：

- **launcher item click** 会写入 modeling -> assistant route 的正常历史 entry
- **assistant 内部的退出动作**（top `Go back` / relationships bottom `Cancel and Go Back`）会把当前 route 带回 modeling
- 但这些退出动作本身**不会清洗掉刚才那条 assistant route history entry**
- 因而 browser Back / Forward 仍按 route history 正常往返

新增证据：

- `tmp/playwright-modeling-fresh-rerun-launcher-history-probe-2026-04-23.md`


### A.35 2026-04-23 再补一条：relationships route 在新数据源下可以进入 result state，而且当前 Cloud 已支持 row-level edit / delete

前面的多轮实测里，`/recommend-relationships` 曾落在：

- `No additional recommended relationships`
- `No relationships are recommended.`

但在 2026-04-23 的新一轮 Playwright 复核中，用户明确说明项目已切到新的数据源，因此又重新从：

- `/projects/15008/modeling`
- `Modeling AI Assistant`
- `Recommend relationships`

做了一次 fresh probe。

这一次的结果**不再是 empty-state**，而是明显的 **result state**：

- 标题仍是：
  - `Generate relationships`
- 当前可见推荐分组：
  - `xai_hr.resume_translations`
- 表格列为：
  - `From`
  - `To`
  - `Type`
  - `Description`
- 当前观测到的推荐关系至少有 1 条：
  - From：`xai_hr_resume_translations.reviewed_by`
  - To：`xai_hr_auth_users.id`
  - Type：`Many-to-one`
- `Save` 当前是：
  - **enabled**

更重要的是，这轮补测确认了当前 Cloud 的 relationships result state **不是只读列表**。

row 级别当前已经有：

- `edit` icon
- `delete` icon

点击 `edit` 后会打开 `Update relationship` dialog，其中可见：

- From model（disabled combobox）
- From column（editable combobox）
- To model（editable combobox）
- To column（editable combobox）
- Type（editable combobox）
- Description（textbox）
- `Cancel` / `Submit`

点击 `delete` 后则会出现轻量确认：

- `Confirm to delete?`
- `Cancel`
- `Delete`

这说明最新可确认的 Cloud contract 应改写为：

> `Recommend relationships` 是 route-enter auto-trigger 的 recommendation task page；  
> 它的终态是**数据相关**的，可能是 empty-state，也可能是 result state。

并且在 **result state** 下，当前 Cloud 已经支持至少这些 pre-save adjustment：

- 编辑单条推荐关系
- 删除单条推荐关系
- 再由 `Save` 统一提交

仍然没有在这一轮看到的能力包括：

- 全局 `Add relationship` / `New relationship` CTA
- 明显的“从零新增关系”入口

因此更准确的说法不应再是：

- “Cloud 当前 relationships 基本就是 empty-state page”

而应是：

- “Cloud 当前 relationships 是 async recommendation route，empty/result 取决于数据；在 result state 下已具备 row-level edit/delete + save”

安全边界说明：

- 本轮没有点击 `Save` / `Submit` / 确认 `Delete`
- 因为这些动作会直接修改 live Cloud project state
- 本轮只做了非破坏性 UI 观测

新增证据：

- `tmp/playwright-modeling-relationships-result-state-2026-04-23.md`


### A.36 2026-04-23 再补一条：relationships 的 `Save` 当前是实义 persist/apply，而不是仅退出 route

在 A.35 已确认新数据源下 `Recommend relationships` 可以进入 result state，并且：

- row 级别已有 `edit` / `delete`
- `Save` 是 enabled

随后按照用户明确要求，又继续做了一次 **有副作用的 Save 验证**。

操作链路如下：

1. 先在 `/recommend-relationships` 看到可保存推荐：
   - `xai_hr_resume_translations.reviewed_by`
   - `-> xai_hr_auth_users.id`
   - `Many-to-one`
2. 点击：
   - `Save`
3. 页面随后返回：
   - `/projects/15008/modeling`
4. 返回 modeling 后，再次检查 launcher 文案，当前已出现：
   - `Recommend relationships 1 Done`
5. 随后再次从 launcher 进入 `Recommend relationships`
6. 页面重新 loading 后，最终落到：
   - `No additional recommended relationships`
   - `No relationships are recommended.`
   - `Save` disabled

这一串证据组合起来，当前最合理的结论是：

> relationships 的 `Save` 不是“只是把用户带回 modeling”；  
> 它当前是一次真实的 persist/apply 动作，会把当前 recommendation set 应用到项目状态里。

至少对本次实测的这个推荐关系来说，`Save` 后带来的可见结果包括：

- route 返回 modeling
- assistant launcher 从 `Todo` 变成 `Done`
- 再次进入 relationships route 时，原先那条 recommendation 已不再出现，而是回到 empty state

注意：这条证据链虽然非常强，但本轮仍保守表述为 **practical evidence of persist/apply**，原因是：

- 本轮没有额外再去做 schema-level diff 截图对比
- 也没有再做 GraphQL payload 逐字段抓包整理

但从用户可见行为看，当前已经足够确认：

- `Save` 是实义动作
- 而不是 placeholder / close-only action

新增证据：

- `tmp/playwright-modeling-relationships-save-verification-2026-04-23.md`


## Appendix B. 2026-04-22 本地仓库复核（repo verification）

除了 Cloud 页面复核外，本次又对本地 `wren-ui` / `wren-ai-service` 做了一轮代码快照核对，确认当前仓库与 Cloud 现状之间的断层位置。

### B.1 本地 `modeling` 入口目前只是 compatibility redirect

本地 `wren-ui/src/pages/modeling.tsx` 只有一行：

- `export { default } from '@/features/modeling/ModelingCompatibilityRedirectPage';`

而 `wren-ui/src/features/modeling/ModelingCompatibilityRedirectPage.tsx` 当前是：

- legacy `/modeling` -> canonical `Path.Knowledge` 的兼容跳转页

这说明：

> 本地 repo 当前并不存在一个与 Cloud `/projects/:id/modeling` 对等的 assistant-aware route shell；`modeling.tsx` 本身只是 compatibility surface。

### B.2 本地 pages 下仍不存在 `recommend-relationships` / `recommend-semantics`

复核结果：

- `wren-ui/src/pages` 顶层可见：
  - `_app.tsx`
  - `_document.tsx`
  - `auth.tsx`
  - `index.tsx`
  - `modeling.tsx`
  - `register.tsx`
  - `settings.tsx`
  - `workspace.tsx`
- `find wren-ui/src/pages -type f | rg 'recommend-(semantics|relationships)'` 无结果

这说明：

> 本地 repo 目前还没有 Cloud 同构的 assistant sibling routes。

### B.3 本地 Modeling workspace 仍然只有 diagram + sidebar + drawers/modals

`wren-ui/src/features/modeling/ModelingWorkspaceContent.tsx` 当前渲染结构是：

- `ModelingSidebarPanel` + `DiagramPanel`
- 以及一组页面内 modal / drawer：
  - `MetadataDrawer`
  - `EditMetadataModal`
  - `ModelDrawer`
  - `CalculatedFieldModal`
  - `RelationModal`

但没有看到：

- `Modeling AI Assistant` dropdown
- assistant header shell
- `recommend-relationships` / `recommend-semantics` 的 route-owned page container

对应代码可见：

- `ModelingStage` / `ModelingSidebarPanel` / `DiagramPanel`：`wren-ui/src/features/modeling/ModelingWorkspaceContent.tsx:114-138`
- modal / drawer 收尾：`wren-ui/src/features/modeling/ModelingWorkspaceContent.tsx:139-169`

这进一步确认：

> 当前本地 Modeling 实现仍然是“diagram workspace + entity editing primitives”，而不是 Cloud 当前那套“assistant launcher + sibling routes”壳子。

### B.4 本地 deep-link query contract 仍然只有旧 modeling keys

`wren-ui/src/features/modeling/modelingWorkspaceUtils.ts:56-65` 当前只读取：

- `modelId`
- `viewId`
- `openMetadata`
- `openModelDrawer`
- `relationId`
- `openRelationModal`

`wren-ui/src/utils/knowledgeWorkbench.ts:38-65` 也只把这些 key 作为 modeling deep-link 兼容参数透传。

并且 `wren-ui/src/features/modeling/modelingWorkspaceUtils.test.ts` 的测试也只覆盖：

- `modelId`
- `openMetadata`
- `relationId`

没有：

- `openAssistant`
- `assistantFlow`
- `recommendRelationships`
- `recommendSemantics`

这说明：

> 即使本地要保留 `openAssistant=...` 作为 future hook，目前也还没有进入现有 query contract。

### B.5 Knowledge -> Modeling 跳转当前仍只会带 `section=modeling`

`wren-ui/src/features/knowledgePage/useKnowledgeAssetWorkbench.ts:226-234` 当前：

- `navigateModelingWithPersistedRuntimeScope()`
- 只调用 `buildRuntimeScopeUrl(router.pathname, { section: 'modeling' }, selectorOverride)`

它不会附带：

- assistant route hint
- semantics/relationships flow intent
- `openAssistant`

这与 Cloud 当前的 assistant route 承接方式不一致。

### B.6 但 relationships 编辑原语并不是从零开始

虽然本地缺 Cloud 式 route shell，但已有若干可复用底座：

- `wren-ui/src/components/pages/setup/DefineRelations.tsx`
  - 已有推荐关系列表
  - 已有 `EditOutlined` / `DeleteOutlined` / `PlusOutlined`
  - 已复用 `RelationModal`
- `wren-ui/src/hooks/useSetupRelations.tsx`
  - 已接 `fetchAutoGeneratedRelations`
  - 已接 `saveSetupRelations`
- `wren-ui/src/utils/modelingRest.ts:243-264`
  - 已有 `fetchAutoGeneratedRelations()`
  - 已有 `saveSetupRelations()`

也就是说：

> relationships 方向当前缺的主要不是数据 CRUD primitives，而是 Cloud 风格的 route shell、页面动作语义与 leave-guard contract。

### B.7 AI service 已有后端 route，但前端 route surface 仍缺位

本地 AI service 当前已经有：

- `wren-ai-service/src/web/v1/routers/relationship_recommendation.py`
  - `POST /relationship-recommendations`
  - `GET /relationship-recommendations/{id}`
- `wren-ai-service/src/web/v1/routers/semantics_description.py`
  - `POST /semantics-descriptions`
  - `GET /semantics-descriptions/{id}`

这说明：

> Cloud 当前那套 semantics / relationship recommendation 能力在服务层已有可对接入口；本地主要缺的是 `wren-ui` 侧的 route/workflow 承接面，而不是 AI service 能力完全不存在。

### B.8 当前单测也仍然锚定旧 modeling deep-link contract

本次额外执行了：

```bash
cd wren-ui
yarn test --runTestsByPath \
  src/features/modeling/modelingWorkspaceUtils.test.ts \
  src/utils/knowledgeWorkbench.test.ts
```

结果：

- `PASS src/utils/knowledgeWorkbench.test.ts`
- `PASS src/features/modeling/modelingWorkspaceUtils.test.ts`

而这两组测试当前覆盖的仍然是旧 contract：

- `modelingWorkspaceUtils.test.ts`
  - 只断言 `modelId / openMetadata / relationId`
- `knowledgeWorkbench.test.ts`
  - 只断言 `viewId / openMetadata / openModelDrawer`
  - 明确只保留已知 deep-link keys

这意味着：

> 本地 repo 当前不仅实现上没有 `openAssistant` / assistant routes，连既有测试基线也仍然把 modeling 视作“旧 deep-link + knowledge section”语义。

### B.9 leave guard 方面已有可复用原语，但语义还不是 Cloud 那套 route-level back guard

本次继续核对后发现，knowledge workbench 已有一套可复用的 dirty guard 原语：

- `wren-ui/src/features/knowledgePage/sections/useKnowledgeWorkbenchDirtyGuards.tsx:4-54`
  - 提供 `runWithDirtyGuard(dirty, action)`
  - 底层走 `appModal.confirm(...)`
- `wren-ui/src/features/knowledgePage/sections/useKnowledgeWorkbenchSectionChangeGuard.ts:5-55`
  - 用 dirty state 决定是否放行 section switch

并且本次额外执行了：

```bash
cd wren-ui
yarn test --runTestsByPath \
  src/features/knowledgePage/sections/useKnowledgeWorkbenchDirtyGuards.test.tsx \
  src/features/knowledgePage/sections/useKnowledgeWorkbenchSectionChangeGuard.test.tsx
```

结果：

- `PASS src/features/knowledgePage/sections/useKnowledgeWorkbenchDirtyGuards.test.tsx`
- `PASS src/features/knowledgePage/sections/useKnowledgeWorkbenchSectionChangeGuard.test.tsx`

这带来两个实现层判断：

1. **可以复用已有 confirm / guard 组织方式**，不用从零发明 leave-guard helper；
2. **不能直接照搬 dirty-only 判定**，因为 Cloud 当前 assistant 顶部 `Back to modeling` 是 route-level guard，即使 untouched step 1 也会弹框。

也就是说：

> 本地已有可借的 guard primitive，但 assistant route 需要的是“always-on back leave guard contract”，而不是 knowledge workbench 当前这种“dirty 才拦截”的 section switch 语义。

### B.10 本地 relationships BFF 仍是同步 constraint-based 路径；semantics BFF 仍缺位

本次继续核对 API/BFF 侧后，当前本地 `wren-ui` 明确呈现出以下状态：

#### 已有的 relationships 前端 API surface

- `wren-ui/src/pages/api/v1/relationships/auto-generated.ts`
  - 仅有 `GET`
  - 直接调用 `projectController.autoGenerateRelation({ ctx })`
- `wren-ui/src/pages/api/v1/relationships/import.ts`
  - 仅有 `POST`
  - 直接调用 `projectController.saveRelations(...)`

而 `wren-ui/src/server/controllers/projectControllerReadActions.ts:235-290` 当前
`autoGenerateRelationAction()` 的实现，仍然是：

- 读取 active runtime project
- 读取 models / columns
- 调 `ctx.projectService.getProjectSuggestedConstraint(project)`
- 基于 constraint 映射出 relations

这说明当前本地 relationships 路径更接近：

> **同步 constraint-based auto-generated relations**

而不是 Cloud 对齐文档后续提到的那类：

> **异步 AI recommendation task route**

#### 缺失的 semantics 前端 API surface

本次扫描 `wren-ui/src/pages/api/v1` 后，只看到了：

- `relationships/[id].ts`
- `relationships/auto-generated.ts`
- `relationships/import.ts`
- `relationships/index.ts`

没有看到任何对等的：

- `semantics-descriptions`
- `relationship-recommendations`

前端 API route / BFF surface。

这意味着：

1. 本地 **relationships** 目前已有旧 BFF，但语义仍是 constraint-based、同步读取；
2. 本地 **semantics** 目前连对等 BFF route 都还没有；
3. 若要对齐 Cloud assistant flows，Phase 2 至少需要补一层 `wren-ui` BFF / REST helper，而不是直接假设现有 modelingRest 已覆盖 semantics。

### B.11 legacy `/modeling` 兼容跳转当前有测试保护，不应在 Phase 1 被顺手破坏

本次继续核对后确认：

- `wren-ui/src/utils/compatibilityRoutes.tsx:43-80`
  - `createCompatibilityRuntimeRedirectPage(...)`
  - 会在 `router.isReady` 后调用 `runtimeScopeNavigation.replace(canonicalRoute, buildQuery?.(router.query))`
- `wren-ui/src/utils/compatibilityRoutes.test.tsx:52-88`
  - 已测试 runtime redirect 会保留派生 query params
  - 示例就是 `/modeling -> /knowledge` 且保留 `section=modeling, viewId=42`

并且本次额外执行了：

```bash
cd wren-ui
yarn test --runTestsByPath \
  src/utils/compatibilityRoutes.test.tsx \
  src/features/knowledgePage/useKnowledgeWorkbenchNavigationState.test.tsx
```

结果：

- `PASS src/utils/compatibilityRoutes.test.tsx`
- `PASS src/features/knowledgePage/useKnowledgeWorkbenchNavigationState.test.tsx`

这说明：

> 现有本地架构已经把 legacy `/modeling` 看作“跳转到 canonical knowledge workbench 的兼容入口”，而且这个行为已有测试基线保护。  
> 因此 Phase 1 新增 assistant sibling routes 时，应优先新增独立 route，而不是顺手把 `/modeling` redirect 语义一起打散。

### B.12 本地不存在 Cloud 同名 assistant/copilot 组件；但存在两类可复用页面壳子

本次额外搜索：

- `ModelingCopilot`
- `Modeling AI Assistant`
- `Recommend semantics`
- `Recommend relationships`

在 `wren-ui/src` 中都没有命中本地实现代码。

这说明：

> Cloud DOM 里出现的 `ModelingCopilot` / assistant launcher，目前并不是本地 repo 中一个“已经存在但未接线”的组件；Phase 1 更接近新增 route shell / launcher，而不是把隐藏组件重新打开。

与此同时，本地又确实存在两类可借的页面壳子：

#### 可借 1：`ConsoleShellLayout`

- `wren-ui/src/components/reference/ConsoleShellLayout.tsx`
- 已用于多个 console / workbench 页面
- 更接近 Cloud assistant route 的“独立页面壳子”形态

#### 可借 2：setup 关系页壳子

- `wren-ui/src/features/setup/ManageSetupRelationshipsPage.tsx`
- `wren-ui/src/components/reference/SetupConsoleLayout.tsx`
- `wren-ui/src/components/pages/setup/ContainerCard.tsx`

它们适合作为：

- relationships 内容区 / 卡片布局 / CTA 组织方式的复用来源

但不应原样照搬的部分是：

- onboarding step rail
- “初始化流程”语境

因此更准确的实施判断是：

> **assistant sibling routes 的页面级外壳优先参考 `ConsoleShellLayout`；  
> relationships/semantics 的内容块再局部复用 setup primitives。**

### B.13 当前关键基线测试可一起通过，适合作为 Phase 1 改造前回归锚点

本次又把目前最相关的 6 组单测合并跑了一次：

```bash
cd wren-ui
yarn test --runTestsByPath \
  src/utils/compatibilityRoutes.test.tsx \
  src/features/knowledgePage/useKnowledgeWorkbenchNavigationState.test.tsx \
  src/features/knowledgePage/sections/useKnowledgeWorkbenchDirtyGuards.test.tsx \
  src/features/knowledgePage/sections/useKnowledgeWorkbenchSectionChangeGuard.test.tsx \
  src/utils/knowledgeWorkbench.test.ts \
  src/features/modeling/modelingWorkspaceUtils.test.ts
```

结果：

- `PASS src/features/modeling/modelingWorkspaceUtils.test.ts`
- `PASS src/features/knowledgePage/sections/useKnowledgeWorkbenchDirtyGuards.test.tsx`
- `PASS src/features/knowledgePage/useKnowledgeWorkbenchNavigationState.test.tsx`
- `PASS src/utils/compatibilityRoutes.test.tsx`
- `PASS src/utils/knowledgeWorkbench.test.ts`
- `PASS src/features/knowledgePage/sections/useKnowledgeWorkbenchSectionChangeGuard.test.tsx`

这说明当前与本次对齐分析最相关的几条基线都稳定存在：

1. legacy `/modeling` compatibility redirect
2. knowledge workbench section routing
3. knowledge/modeling deep-link contract
4. dirty guard / section change guard primitive

因此：

> 这 6 组测试很适合作为 Phase 1 assistant route 改造前的最小回归锚点；后续若新增 launcher / sibling routes / leave guard，应优先确保它们继续通过，再补 assistant 新测试。

### B.14 旧 relationships 页面不仅长得像 onboarding，它在路由与 step 定义上也确实属于 onboarding

本次继续核对后可确认：

- `wren-ui/src/features/setup/ManageSetupRelationshipsPage.tsx`
  - 通过 `SetupConsoleLayout + ContainerCard + SETUP_STEPS`
  - 直接把 relationships 页面挂在 setup/init flow 里
- `wren-ui/src/components/pages/setup/utils.tsx`
  - `SETUP.DEFINE_RELATIONS` 当前是 `step: 2`
  - 属于“3 步完成初始化”的最后一步
- `wren-ui/src/hooks/useSetupRelations.tsx`
  - `onBack()` 会回 `Path.OnboardingModels`
  - `onFinish()` 会跳 `Path.Knowledge + section=modeling`

并且本次额外执行了：

```bash
cd wren-ui
yarn test --runTestsByPath src/tests/pages/setup/routes.test.tsx
```

结果：

- `PASS src/tests/pages/setup/routes.test.tsx`

这进一步说明：

> 本地现有 relationships 页面不是一个“几乎可直接重命名为 modeling assistant route”的独立页面；  
> 它在页面壳子、步骤编号、返回目标、route entry 上都仍然明确属于 onboarding/setup 语境。

### B.15 本地已经有可复用的前端 polling hook 模式，适合 semantics / recommendation async task

本次继续核对 async task/polling 复用面后，确认本地 `wren-ui` 已有一套相对干净的 polling 抽象：

- `wren-ui/src/hooks/usePollingRequestLoop.ts`
  - 提供通用：
    - `startPolling(loader)`
    - `stopPolling()`
    - `shouldContinue`
    - `shouldContinueOnError`
- `wren-ui/src/hooks/useThreadRecommendedQuestionsPolling.ts`
  - 是一个现成的“task payload -> polling hook -> 页面消费”样板
  - 复用了 `usePollingRequestLoop`

并且本次额外执行了：

```bash
cd wren-ui
yarn test --runTestsByPath \
  src/hooks/usePollingRequestLoop.test.ts \
  src/hooks/recommendedQuestionsInstructionHelpers.test.ts
```

结果：

- `PASS src/hooks/usePollingRequestLoop.test.ts`
- `PASS src/hooks/recommendedQuestionsInstructionHelpers.test.ts`

这说明：

> 对于 `semantics-descriptions/{id}` 或未来 `relationship-recommendations/{id}` 这类异步任务，  
> 本地前端并不需要从零写 polling 机制；更合理的是复用 `usePollingRequestLoop`，再按 task payload 封装一个 assistant-specific polling hook。

### B.16 本地也已有“GET 读状态 + POST 触发生成”的 API 交互范式，可直接借给 assistant async routes

本次继续核对 API/BFF 侧时，还确认了一个更具体的复用点：

#### 现有模式 1：project recommendation questions

- `wren-ui/src/pages/api/v1/project-recommendation-questions.ts`
  - `GET`：读取当前 recommendation task/result
  - `POST`：触发生成
- `wren-ui/src/hooks/useRecommendedQuestionsInstruction.tsx`
  - 页面层负责：
    - POST 触发
    - GET 轮询
    - settle / timeout / retry 状态

#### 现有模式 2：thread recommendation questions

- `wren-ui/src/pages/api/v1/thread-recommendation-questions/[id].ts`
  - `GET`：读取某个 thread 的 recommendation task/result
  - `POST`：触发生成
- `wren-ui/src/utils/threadRest.ts`
  - 已提供 mutation URL builder 与 trigger helper
- `wren-ui/src/hooks/useThreadRecommendedQuestionsPolling.ts`
  - 负责轮询读取

#### 现有模式 3：model recommendation questions

- `wren-ui/src/pages/api/v1/models/[id]/recommendation-questions.ts`
  - `POST`：触发生成
  - `GET`：读取结果

并且本次额外执行了：

```bash
cd wren-ui
yarn test --runTestsByPath \
  src/tests/api/thread_recommendation_questions_api.test.ts \
  src/tests/api/model_recommendation_questions_api.test.ts
```

结果：

- `PASS src/tests/api/thread_recommendation_questions_api.test.ts`
- `PASS src/tests/api/model_recommendation_questions_api.test.ts`

这说明：

> assistant 的 `semantics-descriptions` / 未来 `relationship-recommendations` 并不需要自创一套全新前端 API 习惯；  
> 本地仓库已经存在成熟的 **`POST trigger + GET status/result + polling hook`** 交互范式，可直接沿用。


### B.17 Cloud 当前 transport contract 也已经能进一步拆清：relationships 是 route-enter auto-trigger；semantics step switch 仍是本地状态切换

本次继续用 Playwright network 做了一轮 fresh 复核，补到两个关键 transport 事实：

#### Cloud relationships route load

直接打开：

- `https://cloud.getwren.ai/projects/15008/recommend-relationships`

本轮 network 中可以看到：

- `CreateModelRelationshipsTask`
- 随后连续轮询：`ModelRelationshipsTask(taskId)`

并且 `ModelRelationshipsTask` 的 response shape 仍然带：

- `response.fromConstraint`
- `response.fromLLM`

fresh 证据：

- `tmp/modeling-relationships-network-fresh-2026-04-22.txt`

这说明：

> Cloud 当前的 relationships flow 不是“先显示静态页，等用户再点一次 generate”；
> 它是在 **route enter 时就自动触发 recommendation task，然后 polling 落到 empty/result state**。

#### Cloud semantics step 1 -> step 2

本次在 fresh tab 中执行：

- 进入 `recommend-semantics`
- step 1 勾选 `employees`
- 点击 `Next` 进入 step 2

对应 network 中只看到页面初始查询，例如：

- `Me`
- `GetSettings`
- `OnboardingStatus`
- `Diagram`
- `Subscription`
- `Credits`
- `DeployStatus`

而**没有**出现：

- `CreateModelDescriptionTask`
- `ModelsDescriptionTask`

fresh 证据：

- `tmp/modeling-semantics-step-transition-network-fresh-2026-04-22.txt`

这说明：

> semantics 的 step 1 -> step 2 当前仍然只是 **client-local wizard transition**；
> 真正的 async generation task 直到用户点击 `Generate` 才会开始。

这两个 transport 事实对本地实现非常关键：

1. `recommend-relationships` page 应在 route enter 时自动触发 task；
2. `recommend-semantics` step 切换不要过早打后端；
3. semantics BFF / polling 触发点应绑定在 `Generate`，而不是 `Next`。


### B.18 当前本地改造前回归基线已 fresh rerun，可作为 Slice 1 / 2 起点

为了确认前面文档里提到的本地复用面不是“静态阅读推断”，本次又在 `wren-ui` 做了一轮统一的 fresh pre-change baseline rerun：

```bash
cd wren-ui
yarn test --runTestsByPath \
  src/features/modeling/modelingWorkspaceUtils.test.ts \
  src/utils/knowledgeWorkbench.test.ts \
  src/utils/compatibilityRoutes.test.tsx \
  src/features/knowledgePage/sections/useKnowledgeWorkbenchDirtyGuards.test.tsx \
  src/features/knowledgePage/sections/useKnowledgeWorkbenchSectionChangeGuard.test.tsx \
  src/hooks/usePollingRequestLoop.test.ts \
  src/hooks/recommendedQuestionsInstructionHelpers.test.ts \
  src/hooks/useThreadRecommendedQuestionsPolling.test.ts \
  src/tests/api/thread_recommendation_questions_api.test.ts \
  src/tests/api/model_recommendation_questions_api.test.ts \
  src/hooks/useRuntimeScopeNavigation.test.ts \
  src/tests/pages/modeling-page-redirect.test.tsx
```

结果：

- `PASS src/features/modeling/modelingWorkspaceUtils.test.ts`
- `PASS src/utils/knowledgeWorkbench.test.ts`
- `PASS src/utils/compatibilityRoutes.test.tsx`
- `PASS src/features/knowledgePage/sections/useKnowledgeWorkbenchDirtyGuards.test.tsx`
- `PASS src/features/knowledgePage/sections/useKnowledgeWorkbenchSectionChangeGuard.test.tsx`
- `PASS src/hooks/usePollingRequestLoop.test.ts`
- `PASS src/hooks/recommendedQuestionsInstructionHelpers.test.ts`
- `PASS src/hooks/useThreadRecommendedQuestionsPolling.test.ts`
- `PASS src/tests/api/thread_recommendation_questions_api.test.ts`
- `PASS src/tests/api/model_recommendation_questions_api.test.ts`
- `PASS src/hooks/useRuntimeScopeNavigation.test.ts`
- `PASS src/tests/pages/modeling-page-redirect.test.tsx`
- 汇总：`12 passed, 12 total` / `49 passed, 49 total`

fresh 证据：

- `tmp/wren-ui-modeling-assistant-unified-prechange-baseline-2026-04-22.txt`

这意味着：

1. 当前本地关于 modeling legacy deep-link、compatibility redirect、runtime-scope preservation、dirty-guard、polling、recommendation helper、`POST trigger + GET status/result` API pattern 的基线仍是健康的；
2. Phase 1 改造时应该把这组测试当成 **pre-change regression anchor**；
3. 若后续新增 assistant sibling routes / async task BFF / always-on leave guard，应优先扩充这组基线，而不是绕开它们直接改大范围路由语义。

### B.19 当前本地 route primitive 也已被 fresh 验证：`Path.Modeling` 仍被视为 knowledge-scoped redirect surface

结合本次 rerun 的两个测试：

- `src/hooks/useRuntimeScopeNavigation.test.ts`
- `src/tests/pages/modeling-page-redirect.test.tsx`

当前本地有两个非常具体的路由语义已经被测试钉住：

1. `shouldPreserveKnowledgeRuntimeScope(Path.Modeling) === true`
   - 说明 runtime navigation 当前把 `/modeling` 视作 **knowledge-scoped destination**；
2. `/modeling` 页面仍会 redirect 到 `Path.Knowledge`，并保留 modeling deep-link params，例如：
   - `section=modeling`
   - `viewId=42`
   - `openMetadata=1`

这进一步说明：

> Phase 1 新增 Cloud-style assistant sibling routes 时，
> 更安全的做法是 **新增独立 route surface**，而不是顺手把 `Path.Modeling` 的 legacy redirect / runtime-scope 语义一并推翻。



### B.20 `Path` 常量当前也没有 Cloud assistant sibling routes，说明 Slice 1 需要显式补 route 常量

本次继续核对本地路由常量后，`wren-ui/src/utils/enum/path.ts` 当前只有：

- `Path.Modeling = '/modeling'`
- `Path.Knowledge = '/knowledge'`
- 以及 setup / home / settings / workspace 等既有路由

但没有：

- `Path.RecommendRelationships`
- `Path.RecommendSemantics`

这意味着：

> 本地要对齐 Cloud 当前的 assistant sibling routes，
> 不是只新增 page 文件就够了；还需要在现有 path / runtime navigation 常量层补上显式 route 定义。

### B.21 本地已经有可复用的 recommendation polling / settlement helper，并且 fresh test 仍通过

除了前面提到的 `POST trigger + GET status/result` API 范式外，本次还继续核对了两组更细的前端 helper：

- `wren-ui/src/hooks/recommendedQuestionsInstructionHelpers.ts`
  - 已提供：
    - `buildEmptyRecommendedQuestionsTask()`
    - `shouldContinueRecommendationPolling()`
    - `createRecommendationPollingLoader()`
    - `resolveRecommendedQuestionsSettlement()`
- `wren-ui/src/hooks/useRecommendedQuestionsInstruction.tsx`
  - 已把它们接到：
    - `GET /api/v1/project-recommendation-questions`
    - `POST /api/v1/project-recommendation-questions`
    - `usePollingRequestLoop`
- `wren-ui/src/hooks/useThreadRecommendedQuestionsPolling.ts`
  - 已提供 thread-scoped recommendation polling 封装

本次 fresh rerun：

```bash
cd wren-ui
yarn test --runTestsByPath \
  src/hooks/recommendedQuestionsInstructionHelpers.test.ts \
  src/hooks/useThreadRecommendedQuestionsPolling.test.ts
```

结果：

- `PASS src/hooks/recommendedQuestionsInstructionHelpers.test.ts`
- `PASS src/hooks/useThreadRecommendedQuestionsPolling.test.ts`
- 汇总：`2 passed, 2 total` / `8 passed, 8 total`

fresh 证据：

- `tmp/wren-ui-recommendation-helper-primitives-2026-04-22.txt`

这说明：

1. assistant async task 页面并不需要自创新的 polling/settlement 语言；
2. relationships / semantics 可以优先借现有 recommendation helper 思路来做：
   - preloaded task -> polling loader
   - continue / settle 判定
   - timeout / retry / recoverable failure
3. Phase 1 更像是把这些既有原语迁移到 modeling assistant route 语境，而不是从零重新发明。 


### B.22 现有 page shell 里，`ConsoleShellLayout` 比 `DirectShellPageFrame` 更接近 Cloud assistant route 需求

本次继续核对本地壳子组件后，两个候选差异已经比较清楚：

#### `DirectShellPageFrame`

- 只是给页面套一层 `DolaAppShell`
- 负责：
  - nav items
  - history items
  - embedded bypass
- **不负责**：
  - 标题/描述 header
  - section tabs
  - sidebar back action

对应代码：

- `wren-ui/src/components/reference/DirectShellPageFrame.tsx`

#### `ConsoleShellLayout`

除了套 `DolaAppShell` 之外，还内建了：

- title / description / eyebrow
- `sections` segmented nav
- `titleExtra`
- `sidebarBackAction`
- `hideHistorySection`
- `hideSidebarBranding`
- `hideSidebarFooterPanel`
- `hideSidebarCollapseToggle`
- `contentBorderless` / `stretchContent`

对应代码：

- `wren-ui/src/components/reference/ConsoleShellLayout.tsx`

并且当前 modeling 主页面本身就已经是用 `ConsoleShellLayout` 包起来的：

- `wren-ui/src/components/pages/modeling/ModelingWorkspace.tsx`

本次 fresh rerun：

```bash
cd wren-ui
yarn test --runTestsByPath \
  src/components/reference/DirectShellPageFrame.test.tsx \
  src/components/reference/ConsoleShellLayout.test.ts
```

结果：

- `PASS src/components/reference/ConsoleShellLayout.test.ts`
- `PASS src/components/reference/DirectShellPageFrame.test.tsx`
- 汇总：`2 passed, 2 total` / `6 passed, 6 total`

fresh 证据：

- `tmp/wren-ui-shell-primitives-2026-04-22.txt`

这说明：

1. 如果 assistant sibling routes 想尽量贴近 Cloud 当前那种“独立页面 + 顶部 back + 标题描述 + 结果区”的形态，`ConsoleShellLayout` 是更直接的复用起点；
2. `DirectShellPageFrame` 更适合只需要 shell chrome、但 header/body 完全自绘的简单页面；
3. Phase 1 默认应优先用 `ConsoleShellLayout`，只有在 Cloud 视觉要求明显偏离时再降级成 `DirectShellPageFrame + 自绘 header`。


### B.23 `DolaAppShell` / `ConsoleShellLayout` 已经具备 Cloud assistant route 需要的 back / focused-shell primitive

在继续核对 shell 控件层后，本次确认了一个更具体的落点：

- `DolaAppShell` 已直接支持：
  - `hideHistorySection`
  - `sidebarBackAction`
  - `hideSidebarBranding`
  - `hideSidebarFooterPanel`
  - `hideSidebarCollapseToggle`
- `ConsoleShellLayout` 会把这些 focused-shell props 继续透传给 `DolaAppShell`

这意味着如果 assistant sibling routes 想做成更贴近 Cloud 的“独立任务页”：

- 顶部/侧边存在 `Back to modeling`
- 不强调历史对话区
- 不需要完整 home-thread 式 shell 密度

本地并不需要从零造一套 shell 容器；更合理的是：

1. 以 `ConsoleShellLayout` 为主壳；
2. 使用 `sidebarBackAction` 承接 `Back to modeling`；
3. 视需要打开 `hideHistorySection` / `hideSidebarFooterPanel` / `hideSidebarBranding`，把页面收敛成更 focused 的 assistant task shell。

本次 fresh rerun：

```bash
cd wren-ui
yarn test --runTestsByPath \
  src/components/reference/DolaAppShell.test.tsx \
  src/components/reference/ConsoleShellLayout.test.ts \
  src/components/reference/DirectShellPageFrame.test.tsx
```

结果：

- `PASS src/components/reference/DolaAppShell.test.tsx`
- `PASS src/components/reference/ConsoleShellLayout.test.ts`
- `PASS src/components/reference/DirectShellPageFrame.test.tsx`
- 汇总：`3 passed, 3 total` / `15 passed, 15 total`

fresh 证据：

- `tmp/wren-ui-shell-back-history-primitives-2026-04-22.txt`

这进一步说明：

> Phase 1 若需要快速对齐 Cloud assistant 独立页，
> 现有 shell primitive 已足够支撑“有 back、有 focused sidebar、无完整历史区”的页面结构。 
