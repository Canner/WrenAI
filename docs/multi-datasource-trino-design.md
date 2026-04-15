# 多数据源 Knowledge Base — Trino 联邦方案（修订版）

## 1. 背景与已确认决策

WrenAI 当前执行链路的核心边界不是“KB 下有多少个 connector”，而是：

- `project`
- `deployment`
- `deployHash`
- `runtimeIdentity`

因此，多数据源方案不能只在 KB 层按 connector 数量分支；必须把“联邦后的执行数据源”落到现有 `project -> deploy -> query/ask` 主链路里。

本方案按以下已确认决策收敛：

- v1 只覆盖数据库型数据源联邦；但需区分“已完全支持”和“已接入但仅部分模式可用”：
  - PostgreSQL：已支持
  - MySQL：已支持
  - BigQuery：已支持
  - Snowflake：部分支持（当前仅 password 鉴权可自动联邦，privateKey-only 尚未实现）
  - Redshift：部分支持（当前仅 password 鉴权可自动联邦，IAM 尚未实现）
  - Trino：暂未实现 Trino-to-Trino 自动联邦；当前仅保留 provider 语义与 runtime data source 能力，不进入 v1 自动联邦集合
- `REST JSON API`、`Python Tool` 不进入联邦执行层
- DuckDB 保持现有独立 engine 路径，不支持 DuckDB 与其他源混合联邦
- 每个多源 KB 维护一个隐藏的 Trino runtime project
- `snapshot` 语义为“只保最新”，不承诺历史严格可重放
- MDL 不新增 `sourceId`，继续复用现有 `tableReference.catalog/schema/table`

---

## 2. 现状约束（基于当前代码）

### 2.1 运行时与执行边界

当前执行上下文由 `runtimeScope` 解析出 `project`、`deployment` 与 `manifest`，再驱动 query / dry-run / ask。

这意味着多源方案必须回答两个问题：

1. 多源 KB 最终映射到哪个 `project`
2. 这个 `project` 如何进入现有 `deploy` 与 `runtimeIdentity` 链路

### 2.2 connector 仍是通用集成对象

当前 `connector` 并不是 typed datasource 实体，而是通用对象：

- `type` 只有 `database` / `rest_json` / `python_tool`
- `configJson` 与 `secretRecordId` 为泛型结构
- 连接测试目前只支持 `database`
- `database` 连接测试当前按 PostgreSQL 处理

所以 v1 不能把现有 connector 直接等同于 “Postgres connector / BigQuery connector / Snowflake connector”；必须先把数据库型 connector 的 provider 语义补齐。

### 2.3 MDL 已具备 catalog/schema/table 表达能力

现有 MDL、`wren-ui` type、builder、`wren-engine` substitute 已经都识别：

- `tableReference.catalog`
- `tableReference.schema`
- `tableReference.table`

这足以表达 Trino 的三段式引用。

因此不需要在 MDL 里引入新的 `sourceId` 字段；联邦来源映射应由 runtime binding 负责，而不是扩张 MDL 语义。

### 2.4 Trino 在仓库里已有基础支持

现有仓库已经有这些基础能力：

- `wren-ui` 支持 `TRINO` 数据源类型
- `dataSource.ts` 能将 Trino `connectionInfo` 转成 ibis 需要的格式
- `wren-engine/ibis-server` 支持 Trino metadata / query / functions

但当前 `ibisAdaptor` 的能力并不完全一致：

- `getTables()` 已支持 Trino 多 schema fan-out
- `dryRun()` / `validate()` / `modelSubstitute()` / `getVersion()` 仍按单一默认 `catalog.schema` 工作

所以方案里必须显式定义“默认 catalog/schema”的来源，不能假设多 catalog 下所有调用都天然成立。

---

## 3. 目标架构

### 3.1 单源 KB（保持现状）

```text
KB
  -> primary connector
  -> existing execution project
  -> wren-ibis / engine
  -> underlying datasource
```

单源 KB 继续沿用现有执行路径，不引入隐藏 runtime project。

### 3.2 多源 KB（新增联邦层）

```text
KB
  -> 多个 database connector
  -> 隐藏 Trino runtime project
  -> deployment / deployHash / runtimeIdentity
  -> wren-ibis
  -> Trino
  -> 各上游数据库 catalog
```

### 3.3 核心实体关系

多源模式下引入一个新的内部执行对象：

- `knowledge_base.runtimeProjectId -> project.id`

这个 `project` 满足以下条件：

- `type = TRINO`
- 对用户不可见
- 仅用于 deploy / query / ask / preview / metadata
- 其 `connectionInfo` 由当前 KB 下所有“可联邦数据库 connector”动态汇总生成

### 3.4 多源判断规则

只有满足以下条件的 connector 才进入联邦集合：

- `type = database`
- `databaseProvider` 属于联邦支持列表
- connector 处于可用状态

联邦启用条件：

```typescript
federatableConnectors.length >= 2;
```

不是所有 KB connector 都参与联邦，更不是所有 connector 类型都要接入 Trino。

---

## 4. 数据模型与内部接口调整

### 4.1 `knowledge_base`

新增字段：

```sql
ALTER TABLE knowledge_base
ADD COLUMN runtime_project_id INTEGER NULL REFERENCES project(id);
```

语义：

- 单源 KB：`runtime_project_id = NULL`
- 多源 KB：指向隐藏 Trino runtime project

现有 `primary_connector_id` 保留，但在多源模式下语义调整为：

- 默认数据源
- 默认 catalog/schema 选择依据
- UI 默认展示源

它不再代表“真正执行路径的唯一 connector”。

### 4.2 `connector`

新增字段：

```sql
ALTER TABLE connector
ADD COLUMN database_provider VARCHAR NULL;

ALTER TABLE connector
ADD COLUMN trino_catalog_name VARCHAR NULL;

CREATE UNIQUE INDEX connector_trino_catalog_name_uq
ON connector(trino_catalog_name)
WHERE trino_catalog_name IS NOT NULL;
```

字段语义：

- `database_provider`
  - 仅 `type = database` 时有值
  - 枚举值示例：`postgres` / `mysql` / `bigquery` / `snowflake` / `redshift` / `trino`
- `trino_catalog_name`
  - 仅多源模式下参与联邦的 connector 才有值
  - 由系统生成，不允许用户手填

catalog 命名规则使用稳定 ID，而不是 slug：

```text
kb_<knowledgeBaseId8>_<connectorId8>
```

这样不会因 KB / connector 重命名而漂移。

### 4.3 隐藏 runtime project

隐藏 Trino runtime project 继续复用现有 `project` 表，不新增专门表。

其关键字段：

- `type = TRINO`
- `displayName = [internal] <kb-name> federated runtime`
- `connectionInfo = TRINO_CONNECTION_INFO`
- `catalog` / `schema` 取默认 binding 的 catalog/schema

Trino `connectionInfo` 使用当前仓库已实现的真实结构：

```json
{
  "host": "trino",
  "port": 8080,
  "schemas": "catalog_a.schema_a,catalog_b.schema_b",
  "username": "wrenai",
  "password": "",
  "ssl": false
}
```

说明：

- `schemas` 是逗号分隔的 `catalog.schema` 列表
- 默认 binding 必须排在第一个，供当前单默认 catalog 的调用链路使用
- 当前实现的“隐藏”主要依赖：
  - 内部命名约定：`[internal] <kb-name> federated runtime`
  - 运行时不把该 project 当作用户手工维护的数据源
  - 设置页不允许直接修改该 runtime project
- 当前**尚未**引入单独的 `hidden flag / internal kind` 作为数据库级强约束；如果后续出现新的 project 列表暴露面，再补这层硬隐藏机制

### 4.4 model / MDL

不新增 `sourceId`。

model 建模时直接写入：

```json
{
  "tableReference": {
    "catalog": "kb_ab12cd34_ef56gh78",
    "schema": "public",
    "table": "orders"
  }
}
```

多源模型的 `sourceTableName` 使用 fully qualified compact name：

```text
catalog.schema.table
```

原因：

- 避免跨源同名表冲突
- 与 Trino metadata 返回的紧凑表名保持一致

---

## 5. Catalog Binding 与 Trino 管理

### 5.1 设计目标

Trino 层需要一个适配器负责：

- `ensureCatalog()`
- `dropCatalog()`
- `listCatalogs()`

建议新建：

```text
wren-ui/src/apollo/server/adaptors/trinoAdaptor.ts
```

注意：本文不假定某个特定 Trino 版本一定存在“动态 REST catalog API”。  
`trinoAdaptor` 只定义管理抽象，底层实现必须以选定 Trino 版本的可验证机制为准。

### 5.2 provider 到 Trino catalog properties 映射

当前实现状态如下：

| provider    | Trino connector | 当前实现状态 | 说明                                                               |
| ----------- | --------------- | ------------ | ------------------------------------------------------------------ |
| `postgres`  | `postgresql`    | 已支持       | 标准 PostgreSQL                                                    |
| `mysql`     | `mysql`         | 已支持       | 标准 MySQL                                                         |
| `bigquery`  | `bigquery`      | 已支持       | BigQuery                                                           |
| `snowflake` | `snowflake`     | 部分支持     | 当前仅 password 鉴权可自动联邦；privateKey-only connector 会被拒绝 |
| `redshift`  | `redshift`      | 部分支持     | 当前仅 password 鉴权可自动联邦；IAM connector 会被拒绝             |
| `trino`     | `trino`         | 未实现       | `Trino-to-Trino` catalog 映射尚未落地，因此不在 v1 自动联邦集合内  |

### 5.3 Connector 生命周期

#### 新增或更新 connector

1. 校验：
   - `type = database`
   - `databaseProvider` 合法
   - provider-specific config / secret 完整
2. 重新计算该 KB 的联邦 connector 集合
3. 若联邦集合数量 `< 2`
   - 不创建隐藏 runtime project
   - 清空该 KB 所有 connector 的 `trinoCatalogName`
   - 若之前存在 runtime project，则归档或删除
4. 若联邦集合数量 `>= 2`
   - 为所有联邦 connector 生成稳定 `trinoCatalogName`
   - 调用 `trinoAdaptor.ensureCatalog(...)`
   - 创建或更新隐藏 runtime project
   - 更新 `knowledge_base.runtime_project_id`

#### 删除 connector

1. 若 connector 存在 `trinoCatalogName`，删除对应 catalog
2. 重新计算联邦集合
3. 若集合数量降为 `< 2`
   - 清空 runtime project 绑定
   - 清空剩余 connector 的 `trinoCatalogName`
   - KB 回退到单源路径
4. 若集合数量仍 `>= 2`
   - 重建隐藏 runtime project 的 `schemas`
   - 触发最新 deploy

---

## 6. 查询、部署与 Ask 链路

### 6.1 统一原则

多源 KB 不直接把 connector 传给 `queryService` 或 `metadataService`。  
所有执行都先解析出“当前执行 project”：

- 单源 KB：现有执行 project
- 多源 KB：隐藏 Trino runtime project

### 6.2 执行 project 解析

建议新增一个内部服务，例如：

```text
wren-ui/src/apollo/server/services/federatedRuntimeProjectService.ts
```

职责：

- 计算联邦 connector 集合
- 维护隐藏 runtime project
- 为 query / deploy / metadata 提供“当前执行 project”

### 6.3 `metadataService`

多源 KB 下：

- `listTables()` 使用隐藏 Trino runtime project
- 返回的表名按 `catalog.schema.table` 紧凑形式展示
- UI 按 `catalog` 分组展示

### 6.4 `queryService`

多源 KB 下：

- `preview`
- `dryRun`
- `validate`

都走隐藏 Trino runtime project：

```text
project.type = TRINO
project.connectionInfo = aggregated Trino schemas
```

### 6.5 `sqlPairService` / `modelSubstitute`

当前这条链路仍依赖“单默认 catalog/schema”。

因此方案必须定义：

- 默认 binding 来源：`knowledge_base.primary_connector_id`
- 若该 connector 不在联邦集合里，则回退到联邦集合中的第一个 connector
- 该默认 binding 同步写入隐藏 runtime project 的 `catalog` / `schema`
- `connectionInfo.schemas` 里默认 binding 排第一

这样可以兼容当前：

- `modelSubstitute`
- `getVersion`
- 部分 SQL pair 生成逻辑

### 6.6 `deployService`

`deployService` 的核心持久化与 hash 机制可以复用，但多源 flow 不能再写成“无需改动”。

正确说法是：

- `deployService` 继续负责 `manifest + runtimeIdentity -> deploy log`
- 但多源模式下，传入它的必须是“隐藏 Trino runtime project 对应的 manifest 和 runtimeIdentity”
- connector 变化、默认 binding 变化、模型变化都会触发新的 runtime project deploy

---

## 7. MDL 生成与建模 UI

### 7.1 建模时的来源表达

多源模型建模时，直接写入现有 `catalog/schema/table`：

```text
orders
  -> tableReference: { catalog: "kb_aaaabbbb_ccccdddd", schema: "public", table: "orders" }

invoices
  -> tableReference: { catalog: "kb_aaaabbbb_eeeeffff", schema: "finance", table: "invoices" }
```

不再引入：

- `sourceId`
- `connectorId -> deploy 时再替换成 catalog` 的两段式语义

### 7.2 UI

复用现有 connector 管理页面与 REST API，不单独发明新的 GraphQL 主链路。

需要补齐的 UI 能力：

- `database` connector 表单新增 `databaseProvider`
- 按 provider 展示不同配置项
- 连接测试按 provider 真正走对应 datasource，而不是统一当作 PostgreSQL
- 模型构建页按 `catalog` 分组展示表
- 用户选中表后，直接持久化对应 `catalog/schema/table`

---

## 8. AI、Schema Indexing 与 SQL 方言

### 8.1 `project_meta`

多源 KB 的隐藏 runtime project 部署后，其 MDL `dataSource` 为 `TRINO`。

因此：

- `project_meta.py` 中写入的 `data_source` 应为 `trino`
- dry-plan / ask 后处理据此走 Trino 语义

### 8.2 `db_schema`

DDL chunking 保持 fully qualified table identity，并补充来源信息：

```sql
/* {"alias":"orders","source_catalog":"kb_aaaabbbb_ccccdddd","description":"..."} */
CREATE TABLE kb_aaaabbbb_ccccdddd.public.orders (...);
```

这样 LLM 能稳定感知：

- 表来自哪个 catalog
- SQL 应使用 `catalog.schema.table`

### 8.3 SQL 方言处理

不能只改 `sql_generation.py`。

Trino 方言知识必须进入共享 SQL 规则层，覆盖：

- `sql_generation.py`
- `followup_sql_generation.py`
- `sql_correction.py`
- `generation/utils/sql.py`

目标是让以下链路一致感知：

- 初次 SQL 生成
- follow-up SQL 生成
- dry-run 失败后的 SQL correction

需要明确注入的 Trino 规则包括：

- 使用 `catalog.schema.table`
- 避免 PostgreSQL / BigQuery 特有语法
- 使用 Trino 兼容函数

---

## 9. Snapshot 语义（只保最新）

### 9.1 定义

多源 KB 的 `snapshot` 在本方案中不是严格历史回放对象，而是：

- 当前可执行建模版本的切换点
- 最新 runtime deploy 的可见锚点

它不承诺：

- 历史 connector binding 可重放
- 历史凭据语义可重放
- 历史 catalog 指向可重放

### 9.2 执行策略

多源 KB 下：

- 只有“最新 snapshot + 最新 deployHash”允许执行 query / ask / preview
- 历史 snapshot 仅保留为建模记录
- 历史 snapshot 页面允许查看模型定义，但不允许触发执行

### 9.3 Connector 变更后的行为

connector 新增、删除、修改连接信息后：

1. 更新 Trino catalog binding
2. 更新隐藏 runtime project
3. 触发新的 deploy
4. 将 KB 默认执行指向新的 latest snapshot / latest deploy

旧 snapshot 的行为：

- 可显示
- 可标记为 outdated
- 不保证还能执行

这就是“只保最新”的完整产品语义。

---

## 10. 预计改动文件清单

### 10.1 `wren-ui`

数据库与运行时：

- `wren-ui/migrations/*`
  - `knowledge_base.runtime_project_id`
  - `connector.database_provider`
  - `connector.trino_catalog_name`
- `wren-ui/src/apollo/server/adaptors/trinoAdaptor.ts`
- `wren-ui/src/apollo/server/services/federatedRuntimeProjectService.ts`
- `wren-ui/src/apollo/server/services/connectorService.ts`
- `wren-ui/src/apollo/server/services/knowledgeBaseService.ts`
- `wren-ui/src/apollo/server/services/queryService.ts`
- `wren-ui/src/apollo/server/services/metadataService.ts`
- `wren-ui/src/apollo/server/services/sqlPairService.ts`
- `wren-ui/src/apollo/server/dataSource.ts`

UI：

- `wren-ui/src/pages/knowledge/connectors.tsx`
- `wren-ui/src/components/modeling/*`

### 10.2 `wren-ai-service`

- `wren-ai-service/src/pipelines/indexing/project_meta.py`
- `wren-ai-service/src/pipelines/indexing/db_schema.py`
- `wren-ai-service/src/pipelines/generation/sql_generation.py`
- `wren-ai-service/src/pipelines/generation/followup_sql_generation.py`
- `wren-ai-service/src/pipelines/generation/sql_correction.py`
- `wren-ai-service/src/pipelines/generation/utils/sql.py`

### 10.3 可复用但需要注意边界的现有能力

- `wren-engine/ibis-server` 的 Trino metadata/query 能力可以复用
- `deployService` 的 deploy log / hash 机制可以复用
- 但不能再把这些文件写成“完全无需改动的前提”

---

## 11. 测试策略

### 11.1 单元测试

- connector provider 校验：
  - 不同 `databaseProvider` 对应不同 config/secret 校验
- hidden runtime project 生命周期：
  - 第二个联邦 connector 加入时创建
  - 降回单源时归档或删除
- Trino connectionInfo 聚合：
  - `schemas` 正确拼接
  - 默认 binding 排第一
- `modelSubstitute` / `sqlPairService` 默认 catalog 解析正确

### 11.2 集成测试

1. 单源 KB 流程保持不变
2. PostgreSQL + MySQL 接入后创建隐藏 Trino runtime project
3. metadata 返回按 `catalog.schema.table` 合并后的表
4. deploy 后 ask / preview / dry-run 都走 Trino
5. 删除一个 connector 后 KB 回退到单源路径
6. 更新 connector 连接信息后会刷新 latest deploy

### 11.3 AI / SQL 测试

1. 初次 SQL generation 使用 Trino 三段式表名
2. follow-up generation 保持 Trino 方言
3. correction pipeline 能修正 Trino 语法错误
4. DDL chunking 暴露 `source_catalog`

### 11.4 Snapshot 测试

1. 仅最新 snapshot 可执行
2. 历史 snapshot 进入只读态
3. connector 变化后旧 snapshot 被标为 outdated

---

## 12. 主要风险与缓解

| 风险                                     | 缓解                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| 误把通用 connector 当成 typed datasource | 为 `database` connector 明确引入 `databaseProvider`                     |
| 默认 catalog 选择不一致导致部分链路异常  | 使用 `primaryConnectorId` 作为默认 binding，并将其排在 `schemas` 第一位 |
| 多源能力误扩张到 REST / Python connector | v1 明确只支持数据库型源                                                 |
| 继续把 snapshot 当历史回放对象           | UI 与文档都明确“只保最新”                                               |
| 误以为 `sourceId` 是必需                 | 继续复用现有 `catalog/schema/table`                                     |
| 误以为只改 SQL generation 即可           | 将 Trino 方言收敛到共享 SQL 规则层                                      |
| Trino catalog 管理机制依赖具体版本能力   | `trinoAdaptor` 抽象底层机制，落地前做版本验证                           |

---

## 13. 最终结论

Trino 作为多数据源联邦执行层是可行的，但在当前代码库里，真正需要建立的是：

- 数据库型 connector 的 typed provider 语义
- 隐藏 Trino runtime project
- 基于现有 `project -> deploy -> runtimeIdentity` 的联邦执行主路径

本方案不再把“KB 下有多个 connector”直接当作执行架构本身，而是把多源能力落实为一个内部可部署、可查询、可演进的 Trino runtime project。
