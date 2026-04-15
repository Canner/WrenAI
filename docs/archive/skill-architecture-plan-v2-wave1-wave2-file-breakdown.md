# Skill 架构 V2 — Wave 1 / Wave 2 文件级拆解

## 状态说明（2026-04-11）

> 本文档保留为 **Wave 1 / Wave 2 历史拆解记录**。
> Ask/runtime 的现行口径已切到 `docs/deepagents-ask-architecture.md`；其中涉及 `runner_first` / `hybrid` / `SkillRunner` / `SKILL` 的内容不再作为当前实现目标。


更新时间：2026-04-10  
关联文档：

- `docs/archive/skill-architecture-plan-v2.md`
- `docs/archive/skill-architecture-plan-v2-implementation-checklist.md`

---

## 0. 本文用途

这份文档只服务于 **Wave 1 / Wave 2 开工**：

- Wave 1：AI Service 行为桥接
- Wave 2：wren-ui / runtime contract 接线

目标不是重复架构设计，而是把“第一批实际要改的文件”拆成：

1. 为什么要改
2. 要改什么
3. 先后顺序
4. 每步的验证命令

---

## 1. Wave 1 / Wave 2 总体顺序

```text
Step 1  AI service contract 扩字段
Step 2  AI service 注入 effective_instructions
Step 3  AI service 改为 per-skill execution mode
Step 4  wren-ui adaptor/model 跟进新字段
Step 5  askContext 拼装新字段
Step 6  skill preview / ask contract 验证
```

依赖关系：

- Step 1 是 Step 2/3/4/5 的前置
- Step 2 和 Step 3 可以同 wave 内连续落地
- Step 4 必须在 Step 1 之后
- Step 5 必须在 Step 4 之后
- Step 6 最后统一回归

---

## 2. Step 1 — AI service contract 扩字段

## 2.1 主文件

### `wren-ai-service/src/web/v1/services/ask.py`

### 目标

把 skill 的 V2 运行时字段正式纳入 ask request contract。

### 必改项

#### A. `AskSkillCandidate`

新增字段：

- `instruction`
- `execution_mode`

要求：

- `instruction` 兼容：
  - `instruction`
- `execution_mode` 兼容：
  - `execution_mode`
  - `executionMode`

建议形态：

```python
instruction: Optional[str] = None
execution_mode: Literal["inject_only", "runner_first", "hybrid"] = Field(
    default="inject_only",
    validation_alias=AliasChoices("execution_mode", "executionMode"),
)
```

#### B. 保留现有字段不动

不能误删：

- `runtime_kind`
- `source_type`
- `source_ref`
- `entrypoint`
- `skill_config`
- `limits`

### 为什么先改这个文件

因为它是整个 skill ask contract 的入口类型定义。  
如果这里不先扩字段，后面的：

- `legacy_ask_tool`
- `deepagents_orchestrator`
- `wrenAIAdaptor`
- `askContext`

都没有稳定 contract 可以对齐。

### 完成定义

- AI service request model 能接受新字段
- 旧 payload 不报错
- 旧 skill runner 路径不退化

---

## 2.2 配套测试文件

### `wren-ai-service/tests/pytest/services/test_tool_router_shadow_compare.py`

#### 要补的用例

1. skill 带 `instruction`
2. skill 带 `execution_mode=inject_only`
3. skill 带 `execution_mode=runner_first`
4. skill 带 `execution_mode=hybrid`

#### 此步只验证

- 解析正确
- payload 结构正确

不要求这一层就覆盖完整行为。

---

## 2.3 这一小步建议验证命令

```bash
cd wren-ai-service
poetry run python -m py_compile src/web/v1/services/ask.py
poetry run pytest tests/pytest/services/test_tool_router_shadow_compare.py -q
```

---

## 3. Step 2 — legacy ask path 注入 `effective_instructions`

## 3.1 主文件

### `wren-ai-service/src/core/legacy_ask_tool.py`

### 目标

把 skill instruction 作为统一 runtime instruction 注入旧 ask 主链。

### 必改项

#### A. 新增 helper

建议新增：

```python
def extract_skill_instructions(skills: Sequence[Any]) -> list[dict]:
    ...
```

规则：

1. 优先取 `skill.instruction`
2. 其次取 `skill.skill_config["instruction"]`
3. 都没有则跳过
4. **不要 fallback 到 `skill_name`**

#### B. 统一构造 `effective_instructions`

在 legacy ask 主链中，原本的：

- `instructions`

改为：

- `effective_instructions = list(instructions) + skill_instructions`

#### C. 注入阶段

至少覆盖：

1. `intent_classification`
2. `sql_generation_reasoning`
3. `followup_sql_generation_reasoning`
4. `sql_generation`
5. `followup_sql_generation`

### 风险点

1. 不要影响 historical hit 分支
2. 不要影响 `GENERAL / USER_GUIDE / MISLEADING_QUERY`
3. 不要让 instruction 注入重复追加多次

### 完成定义

- skill instruction 在 text-to-sql 路径全链路可见
- followup 路径也可见
- 未选 skill 时行为不变

---

## 3.2 配套测试文件

### 新增建议

#### `wren-ai-service/tests/pytest/services/test_legacy_ask_tool_skill_instruction_injection.py`

#### 最少覆盖

1. intent classification 收到 `effective_instructions`
2. sql generation reasoning 收到 `effective_instructions`
3. sql generation 收到 `effective_instructions`
4. followup generation 收到 `effective_instructions`
5. 没有 skill 时保持原行为

---

## 3.3 这一小步建议验证命令

```bash
cd wren-ai-service
poetry run python -m py_compile src/core/legacy_ask_tool.py
poetry run pytest \
  tests/pytest/services/test_legacy_ask_tool_skill_instruction_injection.py \
  tests/pytest/services/test_tool_router_shadow_compare.py -q
```

---

## 4. Step 3 — deepagents 改为 per-skill execution mode

## 4.1 主文件

### `wren-ai-service/src/core/deepagents_orchestrator.py`

### 目标

把当前“全体 skills 一律 runner-first”的逻辑，改为“每个 skill 自己声明执行模式”。

### 必改项

#### A. `SkillCandidate` protocol 增字段

需要新增：

- `instruction`
- `execution_mode`

#### B. 新增 mode 归一化 helper

建议新增：

```python
def _resolve_execution_mode(skill) -> Literal["inject_only", "runner_first", "hybrid"]:
    ...
```

允许：

- 缺省值默认 `inject_only`

#### C. `run_skill_first()` 行为重构

现在的 `run_skill_first()` 会尝试所有 skills。  
V2 下要改成：

- `inject_only`
  - 不进入 runner 候选队列
- `runner_first`
  - 进入 runner 尝试队列
- `hybrid`
  - 进入 runner 尝试队列
  - 同时保留 instruction 给 fallback

#### D. `run()` 保持整体接口稳定

对 `ToolRouter` 来说，`run()` 的签名尽量不大改，只在内部根据 skill mode 决定：

- 是否先跑 runner
- fallback 后 metadata 怎么标

### 风险点

1. 不要破坏 `shadow_compare`
2. 不要让 `inject_only` 意外返回 `SKILL`
3. `hybrid` fallback 时必须还带 instruction

---

## 4.2 次文件

### `wren-ai-service/src/core/tool_router.py`

### 目标

尽量少改，仅做 orchestrator 调整后的适配。

### 必改项

1. 保留 `ask_runtime_mode`
2. 不引入全局 `skill_execution_mode`
3. 继续让：
   - `deepagents`
   - `legacy`

作为系统级运行模式

### 完成定义

- ToolRouter 仍然只做 runtime routing + shadow compare
- 不承担 per-skill 行为决策

---

## 4.3 配套测试文件

### 新增建议

#### `wren-ai-service/tests/pytest/services/test_deepagents_skill_execution_mode.py`

#### 最少覆盖

1. `inject_only` 不跑 runner
2. `runner_first` runner success 返回 `SKILL`
3. `runner_first` runner fail fallback
4. `hybrid` runner fail 但 fallback 仍保留 instruction

---

## 4.4 这一小步建议验证命令

```bash
cd wren-ai-service
poetry run python -m py_compile \
  src/core/deepagents_orchestrator.py \
  src/core/tool_router.py
poetry run pytest \
  tests/pytest/services/test_deepagents_skill_execution_mode.py \
  tests/pytest/services/test_tool_router_shadow_compare.py -q
```

---

## 5. Step 4 — wren-ui model/adaptor 透传新字段

## 5.1 主文件

### `wren-ui/src/apollo/server/models/adaptor.ts`

### 目标

让 wren-ui 内部 skill contract 与 AI service 对齐。

### 必改项

在 `AskSkillCandidate` 上新增：

- `instruction?: string | null`
- `executionMode?: 'inject_only' | 'runner_first' | 'hybrid'`

要求：

- 类型字面量尽量收紧
- 不要只用 `string`

---

### `wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts`

### 目标

把新字段真正发给 AI service。

### 必改项

在 `transformSkills()` 增加：

- `instruction`
- `executionMode`

### 风险点

1. 不要改坏 preview API
2. 不要改坏 ask / stream ask

### 完成定义

- 发送到 AI service 的 skill payload 带上新字段

---

## 5.2 配套测试文件

### `wren-ui/src/apollo/server/adaptors/tests/wrenAIAdaptor.test.ts`

#### 要补的用例

1. ask payload 透传 `instruction`
2. ask payload 透传 `executionMode`
3. preview payload 透传新字段

---

## 5.3 这一小步建议验证命令

```bash
cd wren-ui
yarn test --runInBand src/apollo/server/adaptors/tests/wrenAIAdaptor.test.ts
yarn check-types
```

---

## 6. Step 5 — askContext 拼装新字段

## 6.1 主文件

### `wren-ui/src/apollo/server/utils/askContext.ts`

### 目标

让 `buildAskRuntimeContext()` 能在旧模型兼容期拼出 V2 skill candidate。

### 必改项

#### A. `toAskSkillCandidate()`

新增拼装：

- `instruction`
- `executionMode`

#### B. 兼容取值策略

双读兼容期建议优先级：

1. `definition.instruction`
2. `binding.bindingConfig?.instruction`
3. `definition.manifestJson?.instruction`

执行模式建议优先级：

1. `definition.executionMode`
2. `binding.bindingConfig?.executionMode`
3. `definition.manifestJson?.executionMode`
4. 默认 `inject_only`

#### C. 不在此步大改 skill 解析来源

这一阶段 **先不把 binding 完全移除**。  
Wave 1/2 的目标是：

- 让新字段走起来
- 不立刻打断现有链路

也就是说此步还是允许：

- `binding -> definition -> connector/secret`

但输出 skill candidate 要先 V2 化。

### 完成定义

- `buildAskRuntimeContext()` 输出 skill candidate 带 V2 字段
- 当前 skill preview / ask 继续可用

---

## 6.2 配套测试文件

### `wren-ui/src/apollo/server/utils/tests/askContext.test.ts`

#### 要补的用例

1. definition 上有 `instruction`
2. binding config 上有 `instruction`
3. definition 上有 `executionMode`
4. binding config 上有 `executionMode`
5. 默认值为 `inject_only`

---

## 6.3 这一小步建议验证命令

```bash
cd wren-ui
yarn test --runInBand src/apollo/server/utils/tests/askContext.test.ts
yarn check-types
```

---

## 7. Step 6 — preview / ask contract 回归验证

## 7.1 主文件

### `wren-ui/src/pages/api/v1/skills/[id]/test.ts`

### 目标

在最终 preview 主路径上，验证 V2 payload 已能贯通。

补充：

- legacy binding preview route 是过渡期兼容文件
- 该文件已在 Wave 5 删除

### 必改项

1. 保持现有 binding lookup 不变
2. 调用 `toAskSkillCandidate()` 后拿到：
   - `instruction`
   - `executionMode`
3. 发给 `previewSkillExecution()`

### 完成定义

- 旧 preview API 仍工作
- preview payload 已是 V2 skill candidate 形态

---

## 7.2 可选前置文件

### `wren-ui/src/pages/home/index.tsx`

Wave 2 暂时**不需要立刻重构 skill picker 取数模型**，但建议做一个最小确认：

- 当前首页 `selectedSkillIds` 仍正常提交
- V2 字段不会影响 thread 创建与 ask 触发

此文件的真正大改留到后续 UI 切换 wave。

---

## 7.3 配套测试文件

### `wren-ui/src/pages/api/tests/skills_api.test.ts`

#### 要补的用例

1. preview payload 带 `instruction`
2. preview payload 带 `executionMode`
3. legacy binding preview 路由不退化

### 可选补充

#### `wren-ui/src/tests/pages/home/index.test.tsx`

验证：

- `selectedSkillIds` 提交路径仍然稳定

---

## 7.4 这一小步建议验证命令

```bash
cd wren-ui
yarn test --runInBand \
  src/pages/api/tests/skills_api.test.ts \
  src/apollo/server/utils/tests/askContext.test.ts \
  src/apollo/server/adaptors/tests/wrenAIAdaptor.test.ts
yarn check-types
```

---

## 8. Wave 1 / 2 完成定义（DoD）

当以下条件同时成立时，Wave 1 / 2 可以视为完成：

1. AI service 已支持：
   - `instruction`
   - `executionMode`
2. skill instruction 已进入：
   - intent
   - reasoning
   - generation
3. deepagents 已按 skill 级行为决策
4. wren-ui 已可把：
   - `instruction`
   - `executionMode`
     透传给 AI service
5. 现有 skill preview / ask 路径不回归
6. 不需要先做 schema 迁移，也能跑通新行为

---

## 9. 推荐提交拆分

建议不要把 Wave 1 / 2 混成一个 commit。

推荐拆成 4 个提交：

1. **AI contract**
   - `ask.py` + ask contract tests
2. **AI behavior**
   - `legacy_ask_tool.py` + `deepagents_orchestrator.py` + behavior tests
3. **UI contract**
   - `adaptor.ts` + `wrenAIAdaptor.ts` + adaptor tests
4. **Runtime context + preview**
   - `askContext.ts` + skills preview API/tests

---

## 10. 开工建议

如果下一步直接开始写代码，建议顺序就是：

1. `wren-ai-service/src/web/v1/services/ask.py`
2. `wren-ai-service/src/core/legacy_ask_tool.py`
3. `wren-ai-service/src/core/deepagents_orchestrator.py`
4. `wren-ai-service/src/core/tool_router.py`
5. `wren-ui/src/apollo/server/models/adaptor.ts`
6. `wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts`
7. `wren-ui/src/apollo/server/utils/askContext.ts`
8. `wren-ui/src/pages/api/v1/skills/[id]/test.ts`

也就是：

> 先把行为改对，再把透传接上，最后做 preview/ask 回归。
