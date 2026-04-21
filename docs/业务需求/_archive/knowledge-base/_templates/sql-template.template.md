---
kb_asset_type: sql_template
import_target: sql_pair
import_format_version: v1
dialect: tidb_mysql8
parameter_style: colon_named
result_grain: biz_date + channel_id
id: TXX
title: 模板标题
report: 报表名称
priority: high
status: spec_only
source_tables:
  - 表1
  - 表2
parameters:
  - tenant_plat_id
  - channel_id
  - start_date
  - end_date
question_variants:
  - 示例问法1
  - 示例问法2
source_documents:
  - 第一期数据报表需求V1.xlsx
  - 数据报表API对应SQL&DSL语句整理.xlsx
  - 数据报表表结构Design_with_comments（4.15 v1.2）.sql
---

# TXX 模板标题

## 模板用途

一句话说明这个 SQL 模板是用来算什么的。

## 建议问题（可转为 sql_pair.question）

- 示例问法1
- 示例问法2

## 核心表/模型

- 表1
- 表2

## 参数

- tenant_plat_id
- channel_id
- start_date
- end_date

## SQL 模板

```sql
-- TODO: 补充可执行 SQL
```

## 备注

- status 推荐值：`spec_only` / `draft_sql` / `blocked_missing_source` / `blocked_missing_sql_model`
- `result_grain` 用于描述结果粒度，方便后续导入和运行时选择结果展示方式。
- 若已经有可执行 SQL 但还没过实际数据源校验，建议先标记为 `draft_sql`。
