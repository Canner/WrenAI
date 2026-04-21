# SQL 模板（导入准备）

> `sql-templates/*.md` 是后续导入的权威来源；字段规范见 [`./import-format.md`](./import-format.md)。本页只做浏览和排期汇总。

## 状态说明

- `spec_only`：已有模板定义，但 SQL 还未落地
- `draft_sql`：已有 SQL 草案，但还没在实际 runtime datasource 验证
- `blocked_missing_source`：缺外部数据源，当前不能形成可执行 SQL
- `blocked_missing_sql_model`：缺 SQL 化模型，当前不能形成可执行 SQL

## 当前进度

| 状态 | 数量 | 说明 |
| --- | ---: | --- |
| `draft_sql` | 11 | 已有 SQL 草案 |
| `spec_only` | 0 | 仅有模板说明 |
| `blocked_missing_source` | 3 | 缺外部数据源 |
| `blocked_missing_sql_model` | 1 | 缺 SQL 化模型 |

第一批与第二批合计已补 SQL 草案：`T01`、`T02`、`T03`、`T04`、`T06`、`T08`、`T09`、`T10`、`T11`、`T12`、`T13`。

## 模板总览

| ID | 标题 | 报表 | 优先级 | 状态 | result_grain | 文件 | 当前说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T01 | 渠道日基础汇总 | 综合日报表 | `high` | `draft_sql` | `biz_date + channel_id` | [T01_渠道日基础汇总.md](./sql-templates/T01_渠道日基础汇总.md) | 可作为 SQL 草案校验对象 |
| T03 | 首存 cohort 提取 | ROI回收表 | `high` | `draft_sql` | `first_deposit_user` | [T03_首存 cohort 提取.md](./sql-templates/T03_首存%20cohort%20提取.md) | 可作为 SQL 草案校验对象 |
| T04 | cohort 累计收入 | ROI回收表 | `high` | `draft_sql` | `first_deposit_date + relative_day_no` | [T04_cohort 累计收入.md](./sql-templates/T04_cohort%20累计收入.md) | 可作为 SQL 草案校验对象 |
| T06 | TOP3/非TOP3 分层 | ROI/投充比与杀率 | `high` | `draft_sql` | `player_id` | [T06_TOP3-非TOP3 分层.md](./sql-templates/T06_TOP3-非TOP3%20分层.md) | 可作为 SQL 草案校验对象 |
| T08 | 首存 cohort 续存 | 首存及续存率 | `high` | `draft_sql` | `first_deposit_date + channel_id` | [T08_首存 cohort 续存.md](./sql-templates/T08_首存%20cohort%20续存.md) | 可作为 SQL 草案校验对象 |
| T09 | 所有用户区间汇总 | 投充比与杀率 | `high` | `draft_sql` | `time_range + user_segment` | [T09_所有用户区间汇总.md](./sql-templates/T09_所有用户区间汇总.md) | 可作为 SQL 草案校验对象 |
| T10 | 首存用户日龄趋势 | 投充比与杀率 | `high` | `draft_sql` | `first_deposit_date + relative_day_no` | [T10_首存用户日龄趋势.md](./sql-templates/T10_首存用户日龄趋势.md) | 可作为 SQL 草案校验对象 |
| T11 | 按游戏类型分布 | 游戏类型流水分布 | `high` | `draft_sql` | `game_type_id` | [T11_按游戏类型分布.md](./sql-templates/T11_按游戏类型分布.md) | 可作为 SQL 草案校验对象 |
| T13 | 首存金额分桶 | 首存金额分布与占比 | `high` | `draft_sql` | `first_deposit_date + bucket_name` | [T13_首存金额分桶.md](./sql-templates/T13_首存金额分桶.md) | 可作为 SQL 草案校验对象 |
| T02 | 渠道与折扣映射 | 综合日报表 | `medium` | `draft_sql` | `channel_id` | [T02_渠道与折扣映射.md](./sql-templates/T02_渠道与折扣映射.md) | 可作为 SQL 草案校验对象 |
| T12 | TOP3/5 游戏类型分层 | 游戏类型流水分布 | `medium` | `draft_sql` | `user_segment + game_type_id` | [T12_TOP3-5 游戏类型分层.md](./sql-templates/T12_TOP3-5%20游戏类型分层.md) | 可作为 SQL 草案校验对象 |
| T05 | cohort ROI | ROI回收表 | `high` | `blocked_missing_source` | `first_deposit_date + relative_day_no` | [T05_cohort ROI.md](./sql-templates/T05_cohort%20ROI.md) | 依赖外部源，当前不能产出 SQL |
| T14 | 投放金额并表 | 综合日报表/ROI回收表 | `high` | `blocked_missing_source` | `biz_date + channel_id` | [T14_投放金额并表.md](./sql-templates/T14_投放金额并表.md) | 依赖外部源，当前不能产出 SQL |
| T15 | 流量指标并表 | 综合日报表 | `high` | `blocked_missing_source` | `biz_date + channel_id` | [T15_流量指标并表.md](./sql-templates/T15_流量指标并表.md) | 依赖外部源，当前不能产出 SQL |
| T07 | VIP 最高等级分层 | ROI/投充比与杀率 | `high` | `blocked_missing_sql_model` | `player_id` | [T07_VIP 最高等级分层.md](./sql-templates/T07_VIP%20最高等级分层.md) | 依赖 ES 对应 SQL 模型，当前不能产出 SQL |

## 导入建议

1. **优先校验 `draft_sql`**：先在真实 datasource 上校验 11 个草案 SQL，确认字段、状态码、时间字段是否与生产一致。
2. **blocked 项单独补齐**：
   - `T05/T14/T15` 依赖投放金额、PV、UV、下载点击UV；
   - `T07` 依赖“统计区间内最高 VIP”对应的 SQL 化日模型。
3. **后续导入脚本**：直接按 `import-format.md` 解析 front matter，再抽取 `## SQL 模板` 正文即可。
