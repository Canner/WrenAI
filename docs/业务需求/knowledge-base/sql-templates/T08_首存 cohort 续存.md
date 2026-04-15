---
kb_asset_type: sql_template
import_target: sql_pair
import_format_version: v1
dialect: tidb_mysql8
parameter_style: colon_named
result_grain: first_deposit_date + channel_id
id: T08
title: 首存 cohort 续存
report: 首存及续存率
priority: high
status: draft_sql
source_tables:
  - dwd_order_deposit
  - dim_player
parameters:
  - tenant_plat_id
  - channel_id
  - cohort_start_date
  - cohort_end_date
question_variants:
  - 统计某日/某段首存 cohort 的 2~6 存人数、率、人均金额
source_documents:
  - 第一期数据报表需求V1.xlsx
  - 数据报表API对应SQL&DSL语句整理.xlsx
  - 数据报表表结构Design_with_comments（4.15 v1.2）.sql
---

# T08 首存 cohort 续存

## 模板用途

统计某日/某段首存 cohort 的 2~6 存人数、率、人均金额。

## 建议问题（可转为 sql_pair.question）

- 统计某日/某段首存 cohort 的 2~6 存人数、率、人均金额

## 核心表/模型

- dwd_order_deposit
- dim_player

## 参数

- tenant_plat_id
- channel_id
- cohort_start_date
- cohort_end_date

## SQL 模板

```sql
WITH register_daily AS (
    SELECT
        DATE(p.create_time) AS register_date,
        p.channel_id,
        COUNT(*) AS register_user_count
    FROM dim_player p
    WHERE p.tenant_plat_id = :tenant_plat_id
      AND p.channel_id = :channel_id
      AND p.create_time >= :cohort_start_date
      AND p.create_time < DATE_ADD(:cohort_end_date, INTERVAL 1 DAY)
    GROUP BY DATE(p.create_time), p.channel_id
),
first_deposit_cohort AS (
    SELECT
        DATE(d.callback_time) AS first_deposit_date,
        d.channel_id,
        d.player_id
    FROM dwd_order_deposit d
    WHERE d.status = 2
      AND d.times = 1
      AND d.tenant_plat_id = :tenant_plat_id
      AND d.channel_id = :channel_id
      AND d.callback_time >= :cohort_start_date
      AND d.callback_time < DATE_ADD(:cohort_end_date, INTERVAL 1 DAY)
),
player_deposit_pivot AS (
    SELECT
        c.first_deposit_date,
        c.channel_id,
        c.player_id,
        MAX(CASE WHEN d.times = 1 THEN d.actual_amount END) AS amount_1,
        MAX(CASE WHEN d.times = 2 THEN d.actual_amount END) AS amount_2,
        MAX(CASE WHEN d.times = 3 THEN d.actual_amount END) AS amount_3,
        MAX(CASE WHEN d.times = 4 THEN d.actual_amount END) AS amount_4,
        MAX(CASE WHEN d.times = 5 THEN d.actual_amount END) AS amount_5,
        MAX(CASE WHEN d.times = 6 THEN d.actual_amount END) AS amount_6
    FROM first_deposit_cohort c
    LEFT JOIN dwd_order_deposit d
           ON d.player_id = c.player_id
          AND d.tenant_plat_id = :tenant_plat_id
          AND d.channel_id = c.channel_id
          AND d.status = 2
          AND d.times BETWEEN 1 AND 6
    GROUP BY c.first_deposit_date, c.channel_id, c.player_id
)
SELECT
    p.first_deposit_date,
    p.channel_id,
    COALESCE(r.register_user_count, 0) AS register_user_count,
    COUNT(*) AS first_deposit_user_count,
    ROUND(COUNT(*) / NULLIF(COALESCE(r.register_user_count, 0), 0), 4) AS first_deposit_rate,
    ROUND(SUM(COALESCE(p.amount_1, 0)) / NULLIF(COUNT(*), 0), 2) AS first_deposit_avg_amount,
    SUM(CASE WHEN p.amount_2 IS NOT NULL THEN 1 ELSE 0 END) AS second_deposit_user_count,
    ROUND(SUM(CASE WHEN p.amount_2 IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 4) AS second_deposit_rate,
    ROUND(SUM(COALESCE(p.amount_2, 0)) / NULLIF(SUM(CASE WHEN p.amount_2 IS NOT NULL THEN 1 ELSE 0 END), 0), 2) AS second_deposit_avg_amount,
    SUM(CASE WHEN p.amount_3 IS NOT NULL THEN 1 ELSE 0 END) AS third_deposit_user_count,
    ROUND(SUM(CASE WHEN p.amount_3 IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 4) AS third_deposit_rate,
    ROUND(SUM(COALESCE(p.amount_3, 0)) / NULLIF(SUM(CASE WHEN p.amount_3 IS NOT NULL THEN 1 ELSE 0 END), 0), 2) AS third_deposit_avg_amount,
    SUM(CASE WHEN p.amount_4 IS NOT NULL THEN 1 ELSE 0 END) AS fourth_deposit_user_count,
    ROUND(SUM(CASE WHEN p.amount_4 IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 4) AS fourth_deposit_rate,
    ROUND(SUM(COALESCE(p.amount_4, 0)) / NULLIF(SUM(CASE WHEN p.amount_4 IS NOT NULL THEN 1 ELSE 0 END), 0), 2) AS fourth_deposit_avg_amount,
    SUM(CASE WHEN p.amount_5 IS NOT NULL THEN 1 ELSE 0 END) AS fifth_deposit_user_count,
    ROUND(SUM(CASE WHEN p.amount_5 IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 4) AS fifth_deposit_rate,
    ROUND(SUM(COALESCE(p.amount_5, 0)) / NULLIF(SUM(CASE WHEN p.amount_5 IS NOT NULL THEN 1 ELSE 0 END), 0), 2) AS fifth_deposit_avg_amount,
    SUM(CASE WHEN p.amount_6 IS NOT NULL THEN 1 ELSE 0 END) AS sixth_deposit_user_count,
    ROUND(SUM(CASE WHEN p.amount_6 IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 4) AS sixth_deposit_rate,
    ROUND(SUM(COALESCE(p.amount_6, 0)) / NULLIF(SUM(CASE WHEN p.amount_6 IS NOT NULL THEN 1 ELSE 0 END), 0), 2) AS sixth_deposit_avg_amount
FROM player_deposit_pivot p
LEFT JOIN register_daily r
       ON p.first_deposit_date = r.register_date
      AND p.channel_id = r.channel_id
GROUP BY p.first_deposit_date, p.channel_id, r.register_user_count
ORDER BY p.first_deposit_date, p.channel_id;
```

## 备注

- 建议做 player_id 级别的 deposit_times 透视或窗口函数模板。
- SQL 按 TiDB / MySQL 8 风格编写；导入前需在实际 runtime datasource 下做一次校验。
- 当前可视为 SQL 草案，校验通过后可转为 sql_pair。
