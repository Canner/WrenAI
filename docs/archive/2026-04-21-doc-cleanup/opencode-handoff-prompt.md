# OpenCode 接续提示词

> 历史说明（2026-04-16）：本文保留的是 Apollo/GraphQL 时代的设计、排障或执行记录。当前 `wren-ui` 运行时前端已经切到 REST，代码目录也已收口到 `src/server/*` 与 `src/pages/api/v1/*`；文中的旧 GraphQL 入口、resolver 与 Apollo 上下文描述仅作历史背景，不再代表当前主链路。

下面这份提示词可以直接贴给 OpenCode，用来让它接续当前 WrenAI V1 改造方案与任务实现。

```text
你现在接手的是一个正在持续实现中的 WrenAI 改造项目。请直接基于当前仓库状态继续推进，不要从头重新规划，不要回滚 working tree，不要丢弃已有修改。

## 你的工作方式
- 使用中文回复
- 自动继续明显下一步，不要反复征求确认
- 先读代码和现有文档，再改
- 不要重置 git，不要 revert 现有改动
- 不要新增依赖，除非明确必要
- 保持小步、可验证、可回滚
- 每次汇报必须包含：
  1. 改了哪些文件
  2. 做了哪些简化
  3. 剩余风险
- 完成每一批改动后必须跑验证，不要只说“理论上没问题”

---

## 项目背景 / 总目标
这是一个基于 WrenAI 的 V1 重构项目，核心方向是：

1. 从“Project 语义”逐步切到“runtime scope / workspace / knowledge base”语义
2. 去掉旧的 Project 中心设计，逐步改成 workspace + knowledge base + runtime identity
3. 后续要支持 user-authored skill（既可连 API，也可连数据库）
4. 统一 PostgreSQL + pgvector
5. 逐步替换 ask 编排
6. 当前正在做的是 **Phase 2：de-project cutover（去 Project 化收口）**

---

## 先读这些文件，再开始
请先阅读并吸收这些内容，然后再动手：

### 需求与方案
- `docs/需求V1.md`
- `docs/refer_dula` 下的参考设计
- `.omx/plans/phase2-deproject-cutover.md`
- `.omx/notepad.md`
- `.omx/state/ralph-state.json`

### 当前已经收口的关键代码
#### wren-ai-service
- `wren-ai-service/src/core/runtime_identity.py`
- `wren-ai-service/src/pipelines/common.py`
- `wren-ai-service/src/core/legacy_ask_tool.py`
- `wren-ai-service/src/web/v1/services/__init__.py`
- `wren-ai-service/src/web/v1/services/runtime_models.py`

#### wren-ui
- `wren-ui/src/server/context/runtimeScope.ts`
- `wren-ui/src/server/services/askingService.ts`
- `wren-ui/src/server/services/deployService.ts`
- `wren-ui/src/server/services/modelService.ts`

---

## 当前已经完成的实现（非常重要，不要重复做）
下面这些已经做完了，你要在此基础上继续，而不是重做：

### 1) wren-ui 侧已完成的大块
- dashboard runtime / controller / 历史 resolver / background tracker 收口
- model controller / 历史 resolver / service 第一轮 runtime-identity-first 收口
- asking persistence / route / adaptor / API 主链路多轮收口
- runtime REST / client / route 层大批 `projectId` 暴露已移除或压缩
- askingService / deployService 已统一 runtime identity helper
- runtimeScope + modelService 联动收口已完成一轮

### 2) wren-ai-service pipelines 已完成整包收口
已把 indexing / retrieval / generation 主链路改为 **runtime_scope_id-first**
- indexing/retrieval/generation 的 pipeline 输入已优先使用 `runtime_scope_id`
- `project_id` 在 pipelines 内主要只剩：
  - legacy storage meta 字段名
  - engine 调用桥
  - compatibility alias
- 相关测试已改并通过

### 3) wren-ai-service service + legacy_ask_tool 调用侧已完成整包收口
- `web/v1/services/*`
- `core/legacy_ask_tool.py`
- `relationship_recommendation` router
已经统一改成 `runtime_scope_id` 优先调用
- `BaseRequest` 已支持 `runtime_scope_id` / `runtimeScopeId` 输入
- `project_id` 在 request/service 层基本只剩兼容桥

---

## 已完成后的验证结果（可作为回归基线）
这些之前已经通过，后续如果你动到了相关区域，应该继续保持通过：

### wren-ai-service
- `cd wren-ai-service && poetry run pytest tests/pytest/services -q`
  - 通过基线：`60 passed, 13 skipped`
- `cd wren-ai-service && poetry run pytest tests/pytest/pipelines tests/pytest/core/test_runtime_identity.py tests/pytest/services/test_runtime_identity_bridge.py -q`
  - 通过基线：`102 passed, 10 skipped`

### 扫描
- `bash misc/scripts/scan-current-project.sh`
- `bash misc/scripts/scan-runtime-identity.sh`

### wren-ui
如果你动到 UI / runtime REST / controller / service：
- `cd wren-ui && yarn check-types`

---

## 当前最重要的未完成项
你接下来优先做的是 **继续 Phase 2 去 Project 化收口**，按下面优先级执行：

### Priority A：继续缩小 request / compatibility bridge
重点目标：
- 继续收口 `BaseRequest` / request model 内部的 `project_id` 兼容桥
- 让内部主语义更接近 `runtime_scope_id`
- 保持 API 兼容，但新代码和主链路不要再扩散 `project_id`

你要重点排查：
- `wren-ai-service/src/web/v1/services/__init__.py`
- `wren-ai-service/src/web/v1/services/runtime_models.py`
- 与 request model 相关的调用链
- tests 中是否还在用旧语义表达主路径

### Priority B：继续做 wren-ui / persistence / repository 层去 Project 化
当前剩余的大桶之一是底层 bridge 还在，包括但不限于：
- `thread`
- `thread_response`
- `asking_task`
- repository / service / persistence 层里的 project bridge
- runtimeScope.project bridge 仍未彻底降级

你需要先盘点热点，再按影响面最小、收益最高的顺序推进。

### Priority C：继续整体方案实现，不偏离现有计划
如果 A/B 完成后还有空间，继续沿着 `.omx/plans/phase2-deproject-cutover.md` 推进，不要自己发散到不相关重构。

---

## 重要约束 / 不要回退
1. 不要回滚已有改动
2. 不要把已经 `runtime_scope_id-first` 的地方改回 `project_id`
3. 新代码优先使用：
   - `runtime_scope_id`
   - `runtime identity`
   - canonical helper
4. `project_id` 目前只是兼容桥，不是主语义
5. 扫描脚本必须保持通过
6. 不要重新引入非 allowlist 的 `getCurrentProject()`
7. 不要新增依赖

---

## 你动手前建议先做的盘点
先跑这些，快速确认当前热点，再开始改：

```bash
git status --short

grep -R "project_id\\|projectId\\|legacy_project_id" -n wren-ai-service/src wren-ui/src | head -n 300

bash misc/scripts/scan-current-project.sh
bash misc/scripts/scan-runtime-identity.sh
```

如果你先做 wren-ai-service request / bridge 收口，再补充看：
```bash
grep -R "project_id\\|runtime_scope_id" -n wren-ai-service/src/web/v1/services wren-ai-service/src/core
```

如果你继续做 wren-ui / persistence：
```bash
grep -R "projectId\\|project_id\\|runtimeProject\\|legacyProject" -n wren-ui/src | head -n 400
```

---

## 你本轮的执行要求
1. 先读文档和当前代码
2. 先做盘点
3. 明确“本轮切片”
4. 直接实现
5. 跑验证
6. 汇报结果
7. 如果验证失败，继续修到通过，不要只停在分析

---

## 汇报格式
每次阶段性汇报请严格按这个格式：

### 当前模式
- 当前在做什么切片

### 已完成
- 列表说明具体改动

### 改动文件
- 逐个列出文件路径

### 做了哪些简化
- 说明删除了什么桥接、统一了什么 helper、减少了什么重复逻辑

### 验证
- 写出执行的命令
- 写出结果

### 剩余风险
- 说明还没处理完的 bridge / 未收口点

### 下一步建议
- 给出最合理的下一批

---

## 额外说明
- 当前 repo 是脏树状态，属正常连续开发状态
- 你要基于现状推进，不要追求一次性“全仓大清洗”
- 目标是：**沿着现有方案持续推进，实现尽可能多的可验证收口**
- 如果出现多个可选方向，优先选：
  1. 能减少 `project_id` 主路径扩散的
  2. 能减少兼容桥复杂度的
  3. 能保持测试稳定通过的

现在请直接开始：
1. 阅读上述文件
2. 盘点当前 Phase 2 剩余热点
3. 选择一个最值得推进的切片
4. 实现并验证
5. 按要求汇报
```
