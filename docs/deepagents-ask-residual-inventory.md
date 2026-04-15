# DeepAgents Ask 收口后残留盘点

更新时间：2026-04-12

## 结论

按 `docs/deepagents-ask-architecture.md` 定义的 **ask 主链实现范围**：

- 代码主路径已收口完成
- 真实 PostgreSQL migration 已执行完成
- 当前剩余命中主要属于：
  1. **现行文档中的历史/完成态说明**
  2. **archive 历史方案记录**
  3. **migrations 历史文件**
  4. **非 ask 主链的通用 skill contract**

换言之，当前 **没有发现仍会影响 ask 主链行为的残留实现**。

---

## 1. 已确认无残留的主路径

以下范围内，已无需要继续处理的 ask 主链残留：

### 1.1 Ask 主链实现

- `wren-ai-service/src/core/deepagents_orchestrator.py`
- `wren-ai-service/src/core/tool_router.py`
- `wren-ai-service/src/core/fixed_order_ask_runtime.py`
- `wren-ai-service/src/web/v1/services/ask.py`

### 1.2 BFF / adaptor / ask context

- `wren-ui/src/apollo/server/utils/askContext.ts`
- `wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts`
- `wren-ui/src/apollo/server/services/askingService.ts`
- `wren-ui/src/apollo/server/resolvers/askingResolver.ts`

### 1.3 持久化

- `thread_response.skill_result` 已从真实 PostgreSQL 删除
- 当前 ask 主链不再写入 / 读取 `skill_result`

---

## 2. 剩余命中分类

### 2.1 现行文档中的完成态/历史说明

这些命中是**文档在描述已经完成的迁移或历史状态**，不是活代码：

- `docs/deepagents-ask-architecture.md`
- `docs/phase3-next-stage-implementation-plan.md`

典型内容包括：

- `runner_first / hybrid`
- `SkillRunner`
- `skill_result / SKILL_QUERY`

处理结论：

- **保留**
- 它们承担的是“设计基线 / 迁移记录 / 完成态说明”作用

### 2.2 archive 历史方案

这些文档是历史归档，保留旧设计分支是合理的：

- `docs/archive/skill-architecture-plan-v2.md`
- `docs/archive/skill-architecture-plan-v2-implementation-checklist.md`
- `docs/archive/skill-architecture-plan-v2-wave1-wave2-file-breakdown.md`
- `docs/archive/skill-architecture-plan-v2-wave3-wave4-file-breakdown.md`

处理结论：

- **保留**
- 不作为当前实现真相来源

### 2.3 migration 历史文件

以下文件保留 `skill_result` 字段是正常的：

- `wren-ui/migrations/20260402103000_add_skill_result_to_thread_response.js`
- `wren-ui/migrations/20260411153000_drop_skill_result_from_thread_response.js`

处理结论：

- **保留**
- 这是数据库历史，不应为了“清词”去改迁移历史

### 2.4 非 ask 主链的通用 skill contract

这层 legacy 输入字段已在本轮删除：

- `actor_claims`
- `connectors`
- `secrets`
- `skill_config`

处理结论：

- **已完成清理**
- 旧 payload 即使仍发送这些字段，也会因 contract `extra="ignore"` 被安全忽略

---

## 3. 本轮已完成的关键收口

- DeepAgents 接管 fixed-order ask 主编排
- ask contract 收口为 inject-only
- ask 主路径移除 `SkillRunner`
- ask 主路径移除 `SKILL / skill_result / SKILL_QUERY`
- `test_ask_skill_runner.py` 已重命名为 `test_tool_router_shadow_compare.py`
- `thread_response.skill_result` drop migration 已执行到真实 PostgreSQL

---

## 4. 建议的后续优先级

### P0

无。当前没有发现仍影响 ask 主链行为的残留实现。

### P1

如要继续“全仓库洁癖式清理”，建议下一波处理：

1. archive / plan 文档统一增加“历史记录”提示
2. 做一次更广义的 repo terminology cleanup（仅限文档，不动历史 migration）

### P2

如果只关心产品可用性，当前可转去做：

1. 控制面闭环完善
2. KB / connector / secret / schedule 等产品验收项
3. 非 ask 主链的 e2e / smoke 覆盖

---

## 5. 一句话总结

**deepagents ask 这条主链已经收干净；现在剩下的基本都是历史记录、迁移历史或非 ask 主链公共契约，不构成当前 ask 架构的实现缺口。**
