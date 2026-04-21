# `projectId / project_id` 盘点（2026-04-09）

> 历史说明（2026-04-16）：本文保留的是 Apollo/GraphQL 时代的设计、排障或执行记录。当前 `wren-ui` 运行时前端已经切到 REST，代码目录也已收口到 `src/server/*` 与 `src/pages/api/v1/*`；文中的旧 GraphQL 入口、resolver 与 Apollo 上下文描述仅作历史背景，不再代表当前主链路。

## 结论

- **主链路状态**：runtime identity 主链路已经是 `runtime_scope_id / workspace / knowledge_base / deploy_hash` 优先，`misc/scripts/scan-runtime-identity.sh` 当前可通过。
- **仍未彻底移除**：仓库里依然存在大量 `projectId / project_id` 残留，不能说“都改完了”。
- **剩余命中应分三类看**：
  1. **兼容桥**：后续可继续收口，但不应在未切断兼容前机械删除。
  2. **project 域 / schema**：当前系统内部仍真实依赖，默认暂留。
  3. **外部数据源字段**：例如 BigQuery / GCP 的 `project_id`，不属于 runtime identity 遗留，不应纳入 deproject 清零目标。

> 注意：下面的数字是 **repo 搜索 hit count**，不是 distinct file count；用于看趋势和分层，不用于做精确资产统计。
>
> 另外，这个口径会同时统计 `legacy*` 和 `projectBridge*` 文本，所以**桥接命名标准化**有时会先把命中从一种别名迁移到另一种桥接别名，数字不一定每一步都单调下降。
> 当某一类命中降到 **10 个及以下** 时，`misc/scripts/inventory-project-identity.sh` 现在会直接打印 exact remaining matches，方便做最后边界盘点。
> 其中 compatibility bridge 类在 **10 个及以下** 时，还会打印 per-file `boundary-actions`，直接给出 cutover 建议。

## 最新验证基线

- `bash misc/scripts/scan-runtime-identity.sh` ✅
- `bash misc/scripts/inventory-project-identity.sh` ✅

当前分层扫描（默认排除 docs 与大部分 tests）结果：

| 类别 | hit count | 处理建议 | 含义 |
| --- | ---: | --- | --- |
| 兼容桥 / legacy selector / project bridge | 1 | 仅剩持久化 key 映射 | AI service 的 bridge alias 接收与前端 legacy query alias 已切除，剩余只在存储兼容边界 |
| project 域 / 持久化锚点 | 43 | 暂留 | `project` 表、`ProjectService`、历史项目解析层记录、各业务表 `project_id` |
| 外部数据源语义 | 4 | 不该删 | BigQuery / GCP / dbt connector 的真实 `project_id` |

## 剩余兼容边界

当前已经没有继续“安全收口”的主链路实现残留；剩余命中都属于**明确保留的兼容边界**。

Wave 1 / Wave 2 已完成：AI service 不再接收旧 bridge alias，前端 runtime scope 也不再解析旧 legacy query alias。

剩余 1 个 implementation hit 当前固定在以下 1 个文件：

- `wren-ui/src/server/repositories/kbSnapshotRepository.ts`  
  保留 `legacyProjectId -> legacy_project_id` 存储映射

判断口径：

- 新链路已经可以只靠 canonical runtime identity 工作。
- 旧 bridge 命名不再承担主链路语义，只承担边界兼容。
- 继续删除这些命中，将进入 breaking change 范围，而不再是普通 cleanup。
- `misc/scripts/scan-runtime-identity.sh` 已新增 allowlist 守门，防止 legacy alias / key 再次扩散到其他实现文件。
- `misc/scripts/scan-runtime-identity.sh` 现在会顺带执行 `misc/scripts/scan-kb-snapshot-bridge-fallback.sh`，默认把最后一个 Wave 3 code fallback 边界也纳入主守门流程。
- 这些边界文件和 cutover 动作现在收束在 `misc/project-identity-compatibility-boundaries.tsv`，作为脚本和后续移除工作的单一事实源。
- breaking cutover 执行清单可直接看 `docs/project-identity-cutover-checklist.md`；如需刷新当前 line hits，可运行 `bash misc/scripts/project-identity-cutover-checklist.sh > docs/project-identity-cutover-checklist.md`。
- 最后一个 `kb_snapshot` 边界的 DB / 代码前置盘点可直接看 `docs/project-identity-kb-snapshot-wave3-audit.md`。
- 真实库审计 SQL 已固化到 `misc/sql/project-identity-kb-snapshot-wave3-audit.sql`，不必再从文档手抄。
- `bash misc/scripts/scan-kb-snapshot-bridge-fallback.sh` 仍可单独运行，用来只看 Wave 3 仍允许存在的代码 fallback 面是否留在 allowlist 内。
- 这几轮累计把 active implementation 的桥接命中从 219 压到 1；当前新增代码不应再扩散 `projectId / project_id / projectBridgeId` 直出命名。

## 暂留

这类不是单纯“没改名”，而是当前系统里 **仍然存在的 project 领域模型或持久化锚点**。

代表路径：

- `wren-ui/src/server/services/projectService.ts`
- `wren-ui/src/server/repositories/projectRepository.ts`
- 历史 project resolver 记录（当前主链已收口到 REST route + server service/repository）
- `wren-ui/migrations/20240125070643_create_project_table.js`
- `wren-ui/migrations/20240125071855_create_model_table.js`
- `wren-ui/migrations/20250102074255_create_dashboard_table.js`
- 以及 model / view / relation / deploy / api_history / instruction / sql_pair / thread_response 等表上的 `project_id`

判断口径：

- 这些位置现在仍承担真实项目主键、关联键、deploy 恢复锚点或旧域服务职责。
- 删除它们不是“清残留”，而是一次更大的领域迁移。
- 在没有新的持久化主键方案前，不建议机械去掉。

## 不该删

这类 `project_id` 不是 Wren 旧 runtime identity 的遗留，而是 **外部系统真实字段名**。

代表路径：

- `wren-ui/src/components/pages/setup/connections/BigQueryProperties.tsx`
- `wren-engine/ibis-server/app/model/__init__.py`
- `wren-launcher/commands/dbt/data_source.go`

判断口径：

- BigQuery / GCP 的 `project_id` 是上游真实概念。
- 这类字段是否保留，应由数据源协议决定，而不是 deproject 迁移决定。

## 建议的后续验收口径

后续不要再把“repo 里搜不到 `projectId` 文本”当作目标；更合理的验收口径是：

1. **主链路不新增 `projectId / project_id` 依赖**。
2. **兼容桥持续收缩，但边界明确**。
3. **project 域与外部数据源字段分开统计**。
4. **BigQuery / GCP `project_id` 永远不算 deproject 债务**。
