# SQL 模板清单

单文件模板是后续导入的**权威来源**；字段格式约定见 [`../import-format.md`](../import-format.md)，汇总说明见 [`../sql-templates.md`](../sql-templates.md)。

## 当前状态概览

| 状态 | 数量 | 说明 |
| --- | ---: | --- |
| `draft_sql` | 11 | 已有 SQL 草案 |
| `spec_only` | 0 | 仅有模板说明 |
| `blocked_missing_source` | 3 | 缺外部数据源 |
| `blocked_missing_sql_model` | 1 | 缺 SQL 化模型 |

## 单文件列表

| ID | 标题 | 状态 | result_grain | 链接 |
| --- | --- | --- | --- | --- |
| T01 | 渠道日基础汇总 | `draft_sql` | `biz_date + channel_id` | [T01_渠道日基础汇总.md](./T01_渠道日基础汇总.md) |
| T02 | 渠道与折扣映射 | `draft_sql` | `channel_id` | [T02_渠道与折扣映射.md](./T02_渠道与折扣映射.md) |
| T03 | 首存 cohort 提取 | `draft_sql` | `first_deposit_user` | [T03_首存 cohort 提取.md](./T03_首存%20cohort%20提取.md) |
| T04 | cohort 累计收入 | `draft_sql` | `first_deposit_date + relative_day_no` | [T04_cohort 累计收入.md](./T04_cohort%20累计收入.md) |
| T05 | cohort ROI | `blocked_missing_source` | `first_deposit_date + relative_day_no` | [T05_cohort ROI.md](./T05_cohort%20ROI.md) |
| T06 | TOP3/非TOP3 分层 | `draft_sql` | `player_id` | [T06_TOP3-非TOP3 分层.md](./T06_TOP3-非TOP3%20分层.md) |
| T07 | VIP 最高等级分层 | `blocked_missing_sql_model` | `player_id` | [T07_VIP 最高等级分层.md](./T07_VIP%20最高等级分层.md) |
| T08 | 首存 cohort 续存 | `draft_sql` | `first_deposit_date + channel_id` | [T08_首存 cohort 续存.md](./T08_首存%20cohort%20续存.md) |
| T09 | 所有用户区间汇总 | `draft_sql` | `time_range + user_segment` | [T09_所有用户区间汇总.md](./T09_所有用户区间汇总.md) |
| T10 | 首存用户日龄趋势 | `draft_sql` | `first_deposit_date + relative_day_no` | [T10_首存用户日龄趋势.md](./T10_首存用户日龄趋势.md) |
| T11 | 按游戏类型分布 | `draft_sql` | `game_type_id` | [T11_按游戏类型分布.md](./T11_按游戏类型分布.md) |
| T12 | TOP3/5 游戏类型分层 | `draft_sql` | `user_segment + game_type_id` | [T12_TOP3-5 游戏类型分层.md](./T12_TOP3-5%20游戏类型分层.md) |
| T13 | 首存金额分桶 | `draft_sql` | `first_deposit_date + bucket_name` | [T13_首存金额分桶.md](./T13_首存金额分桶.md) |
| T14 | 投放金额并表 | `blocked_missing_source` | `biz_date + channel_id` | [T14_投放金额并表.md](./T14_投放金额并表.md) |
| T15 | 流量指标并表 | `blocked_missing_source` | `biz_date + channel_id` | [T15_流量指标并表.md](./T15_流量指标并表.md) |
