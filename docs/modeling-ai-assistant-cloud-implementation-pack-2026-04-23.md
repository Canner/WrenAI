# Modeling AI Assistant Cloud Implementation Pack（2026-04-23）

> 目的：
> 这份文档不是再补产品背景，而是把当前实现真正需要的信息压缩成一个最小包。
>
> 使用方式：
> - **准备实现时，先看这份**
> - 遇到行为歧义，再回到证据主档查证
>
> 当前总纲：
> - `docs/modeling-ai-assistant-cloud-final-alignment-summary-2026-04-23.md`
>
> 当前证据主档：
> - `docs/modeling-ai-assistant-cloud-alignment-patch-2026-04-22.md`

---

## 1. Source of Truth

如果后续实现时出现文档冲突，按这个优先级处理：

1. **本文件**
   - 实现必需信息
   - 当前推荐执行顺序
2. **`modeling-ai-assistant-cloud-final-alignment-summary-2026-04-23.md`**
   - 最终口径 / 总纲
3. **`modeling-ai-assistant-cloud-alignment-patch-2026-04-22.md`**
   - Playwright 实测证据主档

一句话：

> **实现以 Cloud-current contract 为准，不以 2026-04-21 的旧 panel-first 方案为准。**

---

## 2. 先钉住的核心 contract

## 2.1 IA / route contract

必须实现成：

- Modeling 顶部统一入口：`Modeling AI Assistant`
- 默认折叠：collapsed-by-default dropdown
- launcher 项：
  - `Recommend relationships`
  - `Recommend semantics`
- 点击后进入 sibling routes：
  - `/recommend-relationships`
  - `/recommend-semantics`

**不要实现成：**
- modeling 内 overlay
- right panel
- drawer-only assistant

---

## 2.2 Browser history / leave contract

必须保持 Cloud 当前 route 语义：

- launcher click = 正常 route push
- browser Back / Forward 在 `modeling <-> assistant route` 间正常往返
- 顶部 `Back to modeling` = always-on leave guard
- modal `Cancel`：
  - 保留 route state
  - 不新增 history entry
- modal `Go back`：
  - 返回 modeling
  - 不清掉 assistant route history
- semantics step-2 `Back`：
  - 只是 wizard-local back
  - 不是 browser history step
- relationships 底部 `Cancel and Go Back`：
  - direct exit
  - 不弹 confirm

**不要实现成：**
- query replace hack
- 本地 state 伪返回
- 把 step back 混成 browser back

---

## 2.3 Relationships contract

`Recommend relationships` 当前应理解为：

> **route-enter auto-trigger 的 recommendation review page**

### 固定行为
- 首屏先 generating/loading
- route 自动触发 task
- polling 收敛结果

### 终态有两种

#### empty state
- `No additional recommended relationships`
- `No relationships are recommended.`
- `Save` disabled

#### result state
- recommendation table
- 列至少包含：
  - `From`
  - `To`
  - `Type`
  - `Description`
- `Save` enabled

### result state 最低能力
- row-level `edit`
- row-level `delete`
- `Save` = 真实 apply/persist

### 已被实测确认的 Save 语义
- 点击 `Save` 后返回 modeling
- launcher 可体现 `Recommend relationships 1 Done`
- re-entry 后原 recommendation 不再重复出现
- route 可重新落到 empty state

**不要误实现成：**
- 固定 empty-state 页
- 只读建议列表
- 假 `Save`（只关闭页面）

### 当前不必在 Phase 1 强做
- 全局 `Add relationship`
- 从零 authoring builder
- 批量关系编辑台

---

## 2.4 Semantics contract

`Recommend semantics` 当前应理解为：

> **两步式生成与持久化 wizard**

### Step 1: `Pick models`
- 先选 model
- `Next` 是 submit-then-validate
- 未选时点击 `Next` 才显示 inline validation
- 不是 disabled gating

### Step 2: `Generate semantics`
- prompt 输入区
- example prompts 仅参考
- example prompt 不自动填充输入框
- 点击 `Generate` 才真正触发任务

### 完成态
- `Generate` -> `Regenerate`
- `Save` enabled
- 出现 `Generated semantics`
- multi-model grouped review 已被验证可工作

### Save 语义
- `Save` = 真实 persist
- 保存后退出回 modeling
- unsaved preview 不得落库

**不要误实现成：**
- step 1 disabled-next gating
- example click-to-fill
- preview-only save

---

## 3. Phase 1 的最小目标

Phase 1 只做 Cloud 当前最需要的对齐，不做未来态增强。

### 必做
1. modeling launcher
2. sibling route pages
3. route-level history / leave guard
4. relationships task page
5. relationships empty/result 双终态
6. relationships row-level edit/delete affordance
7. relationships real save/apply boundary
8. semantics two-step wizard
9. semantics generate/regenerate/completed state
10. semantics real save/persist boundary
11. route-local failed state（至少 semantics 不能 crash）

### 明确不做
1. `openAssistant=...` 生效 deep-link
2. panel-first assistant
3. relationships full authoring workbench
4. onboarding -> modeling assistant 自动 handoff
5. 更强的 AI 推理增强

---

## 4. 推荐执行顺序

### Slice 1 — launcher + routes
先做：
- `Path` 常量
- `recommend-relationships.tsx`
- `recommend-semantics.tsx`
- `ModelingAssistantLauncher`
- modeling 顶部接入

### Slice 2 — leave/history
再做：
- `Back to modeling`
- modal `Cancel` / `Go back`
- semantics step-2 `Back`
- relationships direct exit

### Slice 3 — relationships page
再做：
- auto-trigger task
- loading
- empty-state
- result-state
- row-level edit/delete
- save/apply

### Slice 4 — semantics wizard
再做：
- step 1 / step 2
- generate / regenerate
- grouped review
- route-local error state

### Slice 5 — semantics save bridge
最后做：
- save -> metadata persist
- save -> exit modeling
- unsaved preview 不落库

---

## 5. 文件级起点

实现时优先看这些落点：

### Route / enum
- `wren-ui/src/utils/enum/path.ts`
- `wren-ui/src/pages/recommend-relationships.tsx`
- `wren-ui/src/pages/recommend-semantics.tsx`

### Modeling launcher
- `wren-ui/src/features/modeling/ModelingWorkspaceContent.tsx`
- `wren-ui/src/features/modeling/components/ModelingAssistantLauncher.tsx`（新增）

### Assistant route 共享层
- `wren-ui/src/features/modeling/assistant/modelingAssistantRoutes.ts`（新增）
- `wren-ui/src/features/modeling/assistant/useModelingAssistantLeaveGuard.ts`（新增）

### Relationships
- `wren-ui/src/features/modeling/assistant/recommendRelationships/RecommendRelationshipsPage.tsx`（新增）
- `wren-ui/src/features/modeling/assistant/recommendRelationships/useRecommendRelationshipsTask.ts`（新增）
- 可参考复用：
  - `wren-ui/src/components/pages/setup/DefineRelations.tsx`
  - `wren-ui/src/hooks/useSetupRelations.tsx`

### Semantics
- `wren-ui/src/features/modeling/assistant/recommendSemantics/RecommendSemanticsPage.tsx`（新增）
- `wren-ui/src/features/modeling/assistant/recommendSemantics/useRecommendSemanticsWizard.ts`（新增）
- `wren-ui/src/features/modeling/assistant/recommendSemantics/useSemanticsDescriptionPolling.ts`（新增）
- `wren-ui/src/features/modeling/assistant/recommendSemantics/GeneratedSemanticsReview.tsx`（新增）

### Persist / BFF
- `wren-ui/src/utils/modelingRest.ts`
- `wren-ui/src/pages/api/v1/models/[id]/metadata.ts`
- `wren-ui/src/features/modeling/useModelingMetadataMutationHandler.ts`
- `wren-ui/src/server/services/modelServiceDatasetSupport.ts`

---

## 6. 最低验收 checklist

实现完成后，至少要用它验：

1. modeling 可见 `Modeling AI Assistant`
2. launcher 默认折叠
3. launcher 点击进入两个 sibling routes
4. browser Back / Forward 语义正确
5. relationships route 自动 trigger task
6. relationships 可进入 empty 或 result
7. relationships result state 至少支持 edit/delete
8. relationships `Save` 是真实 apply，不是只关页
9. semantics step 1 是 submit-then-validate
10. semantics example prompt 不自动填充
11. semantics completed state 正确
12. semantics `Save` 是真实 persist
13. failure 不会把整页打崩

---

## 7. 何时回查其他文档

### 需要看证据时
回：
- `docs/modeling-ai-assistant-cloud-alignment-patch-2026-04-22.md`

典型场景：
- “Back / Forward 到底该怎么表现？”
- “relationships 的 Save 到底有没有真实持久化？”
- “为什么不做 panel？”

### 需要看完整总纲时
回：
- `docs/modeling-ai-assistant-cloud-final-alignment-summary-2026-04-23.md`

### 需要看具体证据时
可直接查看 tmp 下对应 Playwright 产物，例如：
- `tmp/playwright-modeling-relationships-result-state-2026-04-23.md`
- `tmp/playwright-modeling-relationships-save-verification-2026-04-23.md`

---

## 8. 一句话实施原则

> **先把 Cloud 当前 route-first contract 做对，再考虑更理想的未来态。**
