# Modeling AI Assistant Cloud 对齐最终摘要（2026-04-23）

> 这份文档是当前建模助手对齐工作的单点入口。
>
> 建议配套阅读：
> - `docs/modeling-ai-assistant-cloud-implementation-pack-2026-04-23.md`
> - `docs/modeling-ai-assistant-cloud-alignment-patch-2026-04-22.md`
>
> 最新关键证据：
> - `tmp/playwright-modeling-relationships-result-state-2026-04-23.md`
> - `tmp/playwright-modeling-relationships-save-verification-2026-04-23.md`
> - `tmp/playwright-modeling-fresh-rerun-launcher-history-probe-2026-04-23.md`

---

## 1. 最终结论

截至 2026-04-23，商业版 Modeling AI Assistant 应被理解为：

> **Modeling 顶部统一 launcher + route-first assistant flows + async task/polling + review/adjust + real persist boundaries**

它不是：

- modeling 内的常驻 AI panel
- 一个未来态占位入口
- 单纯的 empty-state helper

而是已经上线并可用的建模侧 AI 工作流枢纽。

---

## 2. 当前 Cloud 真实 contract

### 2.1 IA / route shape

- Modeling 顶部已有 `Modeling AI Assistant`
- 当前是 **collapsed-by-default dropdown**
- launcher 至少包含：
  - `Recommend relationships`
  - `Recommend semantics`
- 点击后进入 sibling routes：
  - `/recommend-relationships`
  - `/recommend-semantics`

### 2.2 Browser history / leave 语义

- launcher click = 正常 route push
- browser Back / Forward 在 `modeling <-> assistant route` 间正常往返
- 顶部 `Back to modeling` = always-on leave guard
- modal `Cancel` 不新增 history entry
- modal `Go back` 返回 modeling，但不清掉 assistant route history
- semantics step-2 `Back` 只是 wizard-local back，不是 browser history step
- relationships 底部 `Cancel and Go Back` = direct exit

### 2.3 Relationships

当前更准确的定义是：

> **route-enter auto-trigger 的 relationship recommendation review page**

#### 固定特征
- 页面标题：`Generate relationships`
- 首屏先 generating/loading
- 结果通过 polling 收敛

#### 终态是数据相关的
- 可能 empty：
  - `No additional recommended relationships`
  - `No relationships are recommended.`
  - `Save` disabled
- 也可能 result：
  - recommendation table
  - `From / To / Type / Description`
  - `Save` enabled

#### 最新新增确认
在新数据源下，已观测到 result state，并确认：
- row-level `edit`
- row-level `delete`
- `Save` 是真实 persist/apply
- 保存后返回 modeling
- launcher 显示 `Recommend relationships 1 Done`
- re-entry 后原 recommendation 不再重复出现，并落到 empty-state

#### 仍未确认存在
- 全局 `Add relationship`
- 明显从零 authoring 的入口

因此它目前更接近：

- **AI 推荐关系审阅页**

而不是：

- 全功能关系建模工作台

### 2.4 Semantics

当前更准确的定义是：

> **两步式语义生成与持久化 wizard**

#### Step 1: `Pick models`
- 选择 model
- `Next` 是 submit-then-validate
- 未选时才出现 inline validation

#### Step 2: `Generate semantics`
- prompt 输入区
- example prompts 仅参考，不自动填充
- 只有点击 `Generate` 才真正触发任务

#### 完成态
- `Generate` -> `Regenerate`
- `Save` enabled
- 出现 `Generated semantics`
- multi-model 分组展示已验证可工作

#### Save 边界
- `Save` 会真实写回 model / column descriptions
- 成功后退出回 modeling
- 若只生成 preview 不 save 就离开，则不持久化

---

## 3. 对本地实现的最终指导

### 3.1 必须坚持的方向

本地实现应以 **Cloud-current contract** 为准，而不是回到 2026-04-21 的 panel-first 设想。

也就是说应优先做：

1. Modeling 顶部 launcher
2. sibling routes
3. route-level history / leave guard
4. relationships async recommendation review
5. semantics two-step wizard + persist

### 3.2 第一阶段不要做错的点

#### 不要做成 panel-first
不要先在 modeling canvas 内硬塞：
- overlay
- right panel
- drawer-based assistant

#### 不要把 `openAssistant=...` 当成现行 contract
当前 Cloud 里它仍然更像 noop / future hook。

#### 不要把 relationships 误做成固定 empty-state
它必须支持：
- loading
- empty-state
- result-state

#### 不要把 relationships `Save` 做成假按钮
它应该是：
- 真 apply recommendation set
- 并让后续 modeling / re-entry 读取结果体现变化

#### 不要把 semantics `Save` 做成 preview-only
它必须是：
- 真 persist
- 保存后退出
- unsaved preview 不得落库

#### 不要破坏 browser history
不要用：
- query replace hack
- 本地 state 伪返回

来替代真实 route navigation。

---

## 4. 推荐的本地实施顺序

### Slice 1
- modeling launcher
- sibling routes 壳子
- path / route helper
- browser history contract

### Slice 2
- 通用 leave guard
- top back / modal cancel / modal go back
- semantics internal back
- relationships direct exit

### Slice 3
- relationships task page
- loading / empty / result
- row-level edit/delete
- real save boundary

### Slice 4
- semantics wizard
- generate / regenerate
- multi-model review
- failed state

### Slice 5
- semantics save persist
- save -> exit -> re-entry fresh

### Slice 6
- error hardening
- replay/reset
- Playwright + Jest coverage

---

## 5. Phase 1 最低验收

本地 Phase 1 最低要满足：

1. modeling 可见 `Modeling AI Assistant`
2. launcher 默认折叠
3. launcher 点击进入两个 sibling routes
4. browser Back / Forward 语义与 Cloud 一致
5. relationships route 自动 trigger task
6. relationships 同时支持 empty/result 两类终态
7. result state 至少支持单条建议 edit/delete
8. relationships `Save` 是真实 apply，不是只关页
9. semantics step 1 是 submit-then-validate
10. semantics step 2 example prompt 不自动填充
11. semantics `Generate` / `Regenerate` / completed state 正确
12. semantics `Save` 是真实 persist，unsaved preview 不落库
13. failures 进入 route-local failed state，而不是整页 crash

---

## 6. 当前最重要的风险提醒

### 6.1 Cloud 当前也不是完美实现
已观测到 semantics 存在：
- `502`
- client-side exception

所以本地不要只复刻 happy path，必须顺带做 failure hardening。

### 6.2 relationships 虽然已支持 save/edit/delete，但仍不是 full authoring workbench
不要在 Phase 1 里额外膨胀为：
- add-new relationship builder
- 批量 authoring 台
- 通用关系管理中心

### 6.3 这条对齐工作应以 route contract 为主线
先把：
- launcher
- routes
- history
- leave guard
- save boundary

做对，再做增强。

---

## 7. 最终建议

如果现在开始动代码，后续实现应默认遵循这条总原则：

> **先按 Cloud 的 route-first assistant contract 做对齐；不要为了“更理想的未来态”而跳过当前已验证的产品语义。**

换句话说：

- 先做正确的 launcher
- 再做正确的 route
- 再做正确的 save/apply
- 最后再考虑更强的 authoring / deep-link / onboarding handoff
