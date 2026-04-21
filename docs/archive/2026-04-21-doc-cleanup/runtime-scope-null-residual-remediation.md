# Runtime scope residual remediation（2026-04-10）

## 背景

本轮 workspace 隔离修复已经把运行时查询从：

- `where(column, value).orWhereNull(column)`
- `COALESCE(...) IS NULL OR COALESCE(...) = ?`

收紧为**严格 canonical runtime scope 匹配**。

这会堵住跨租户读泄漏，但也带来一个收口动作：

> 数据库里如果还留有 `project_id` 时代的旧行，且 `workspace_id / knowledge_base_id / kb_snapshot_id / deploy_hash` 仍为 `NULL`，这些行会从 canonical 查询里“隐身”。

所以需要做两件事：

1. **先审计**：确认哪些表还有 residual rows  
2. **再回填**：只做“有确定锚点”的安全回填；剩余 `project_id`-only 行走人工处理

---

## 覆盖表

- `thread`
- `thread_response`
- `asking_task`
- `instruction`
- `sql_pair`
- `view`
- `model`
- `relation`

辅助表：

- `knowledge_base`
- `kb_snapshot`

---

## 新增脚本

### 1) 只读审计

```bash
bash misc/scripts/runtime-scope-null-residual-audit.sh "$PG_URL"
```

对应 SQL：

```bash
misc/sql/runtime-scope-null-residual-audit.sql
```

输出重点：

- `legacy_bridge_only_rows`
  - `project_id` 还在，但 4 个 canonical scope 字段全空
  - 这类行**不能自动猜**属于哪个 workspace
- `missing_workspace_rows`
  - 还有 workspace 隔离缺口
- `deterministic_backfill_candidate_rows`
  - 可以通过 `thread / knowledge_base / kb_snapshot` 等**确定性来源**自动补齐

---

### 2) 事务回滚演练

```bash
bash misc/scripts/runtime-scope-null-residual-backfill-rehearsal.sh "$PG_URL"
```

特点：

- 先打印审计
- 在事务里执行 backfill
- 再打印审计
- 最后 `ROLLBACK`

适合先看效果，不落库。

---

### 3) 带备份的真实回填

```bash
bash misc/scripts/runtime-scope-null-residual-backfill-apply.sh "$PG_URL"
```

特点：

- 先 `pg_dump`
- 执行确定性 backfill
- 输出 before / after 审计

备份目录：

```bash
tmp/runtime-scope-backups/
```

---

## Backfill 做了什么

只做**确定性**补齐，不猜测：

1. `thread_response` 从父 `thread` 继承 runtime scope
2. `asking_task` 从 `thread_response / thread` 继承 runtime scope
3. 对所有目标表：
   - `knowledge_base_id + deploy_hash -> kb_snapshot_id`
   - `kb_snapshot_id -> knowledge_base_id / deploy_hash / workspace_id`
   - `knowledge_base_id -> workspace_id`

---

## 不会自动处理的情况

以下情况仍需要人工处理：

- 只有 `project_id`，没有任何 canonical 锚点
- `deploy_hash` 有值，但缺少 `knowledge_base_id`，无法安全唯一定位 snapshot
- 行内 scope 自相矛盾，需要业务判定

也就是：

> `legacy_bridge_only_rows` 不会被这个 backfill 直接清零。

---

## 建议执行顺序

1. 先跑：

```bash
bash misc/scripts/runtime-scope-null-residual-audit.sh "$PG_URL"
```

2. 如果 `deterministic_backfill_candidate_rows > 0`，先演练：

```bash
bash misc/scripts/runtime-scope-null-residual-backfill-rehearsal.sh "$PG_URL"
```

3. 结果符合预期后再真实执行：

```bash
bash misc/scripts/runtime-scope-null-residual-backfill-apply.sh "$PG_URL"
```

4. 最后把 audit 输出里剩余的 `legacy_bridge_only_rows` 拉清单，人工补 runtime binding

---

## 单 runtime / project-only 人工映射路径

如果审计后只剩：

- `model`
- `relation`

这类 **`project_id` 存在、4 个 canonical scope 字段全空** 的旧行，而且现场已经确认：

- 只有 1 个目标 workspace
- 只有 1 个目标 knowledge base
- 只有 1 个目标 kb_snapshot
- 这些旧行都应归到同一个 runtime scope

可以走单独的**人工确认映射 backfill**：

```bash
bash misc/scripts/runtime-scope-null-residual-project-only-rehearsal.sh \
  <source_project_id> <workspace_id> <knowledge_base_id> <kb_snapshot_id> <deploy_hash>

bash misc/scripts/runtime-scope-null-residual-project-only-apply.sh \
  <source_project_id> <workspace_id> <knowledge_base_id> <kb_snapshot_id> <deploy_hash>
```

对应 SQL：

```bash
misc/sql/runtime-scope-null-residual-project-only-backfill.sql
```

### 这个 deploy_hash 应该怎么选

不要机械地取“最新 deploy_log.hash”。

应取**当前运行时真正会解析出的 canonical deploy_hash**。当前实现里，默认显式 scope 解析顺序是：

1. `selector.deployHash`
2. `kb_snapshot.deploy_hash`
3. 之后才会再去按 scope 找 deploy log

因此如果现场存在：

- `kb_snapshot.deploy_hash = A`
- 最新 `deploy_log.hash = B`

而默认 runtime scope 实际仍解析到 `A`，那回填也应写成 `A`，否则模型 / relation 会继续对当前 runtime “不可见”。

### 这个人工映射脚本做了什么

- 先校验 `knowledge_base -> workspace`
- 再校验 `kb_snapshot -> knowledge_base + deploy_hash`
- 再校验 `deploy_log(project_id, hash)` 至少存在一条
- 最后只更新 `project_id = source_project_id` 且 canonical 字段全空的 `model` / `relation`

脚本是**幂等**的：已经补过后再次执行不会重复写脏数据。

---

## 备注

- 这一步是**数据收口**，不是代码热修
- 代码侧的 workspace 隔离漏洞已收紧；这里处理的是**历史遗留数据可见性 / 可运维性**
