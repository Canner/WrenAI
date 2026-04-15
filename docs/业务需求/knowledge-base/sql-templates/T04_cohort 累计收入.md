---
kb_asset_type: sql_template
import_target: sql_pair
import_format_version: v1
dialect: tidb_mysql8
parameter_style: colon_named
result_grain: first_deposit_date + relative_day_no
id: T04
title: cohort 累计收入
report: ROI回收表
priority: high
status: draft_sql
source_tables:
  - dwd_order_deposit
  - dwd_bet_order
  - dwd_order_rebate
  - dwd_order_task
  - dwd_order_activity
  - dwd_order_promote_activity
  - dwd_order_add_or_sub
parameters:
  - tenant_plat_id
  - channel_id
  - cohort_start_date
  - cohort_end_date
  - period_days
question_variants:
  - 计算首存 cohort 在 D1/D3/D7/D15/D30...D360 的累计渠道收入。
  - 统计某渠道首存 cohort 在指定回收周期内的累计渠道收入。
source_documents:
  - 第一期数据报表需求V1.xlsx
  - 数据报表API对应SQL&DSL语句整理.xlsx
  - 数据报表表结构Design_with_comments（4.15 v1.2）.sql
---

# T04 cohort 累计收入

## 模板用途

计算首存 cohort 在 D1/D3/D7/D15/D30...D360 的累计渠道收入。

## 建议问题（可转为 sql_pair.question）

- 计算首存 cohort 在 D1/D3/D7/D15/D30...D360 的累计渠道收入。
- 统计某渠道首存 cohort 在指定回收周期内的累计渠道收入。

## 核心表/模型

- dwd_order_deposit
- dwd_bet_order
- dwd_order_rebate
- dwd_order_task
- dwd_order_activity
- dwd_order_promote_activity
- dwd_order_add_or_sub

## 参数

- tenant_plat_id
- channel_id
- cohort_start_date
- cohort_end_date
- period_days

## SQL 模板

```sql
WITH RECURSIVE seq AS (
    SELECT 1 AS relative_day_no
    UNION ALL
    SELECT relative_day_no + 1
    FROM seq
    WHERE relative_day_no < :period_days
),
first_deposit_cohort AS (
    SELECT
        d.tenant_plat_id,
        d.channel_id,
        d.player_id,
        DATE(MIN(d.callback_time)) AS first_deposit_date
    FROM dwd_order_deposit d
    WHERE d.status = 2
      AND d.times = 1
      AND d.tenant_plat_id = :tenant_plat_id
      AND d.channel_id = :channel_id
      AND d.callback_time >= :cohort_start_date
      AND d.callback_time < DATE_ADD(:cohort_end_date, INTERVAL 1 DAY)
    GROUP BY d.tenant_plat_id, d.channel_id, d.player_id
),
cohort_size AS (
    SELECT
        c.tenant_plat_id,
        c.channel_id,
        c.first_deposit_date,
        COUNT(*) AS cohort_user_count
    FROM first_deposit_cohort c
    GROUP BY c.tenant_plat_id, c.channel_id, c.first_deposit_date
),
bet_revenue AS (
    SELECT
        c.player_id,
        DATE(b.settle_time) AS event_date,
        SUM(b.win_loss_amount) AS win_loss_amount,
        0 AS rebate_amount,
        0 AS task_amount,
        0 AS marketing_amount,
        0 AS discount_adjust_amount,
        SUM(b.win_loss_amount) AS channel_revenue_amount
    FROM first_deposit_cohort c
    INNER JOIN dwd_bet_order b
            ON b.player_id = c.player_id
           AND b.tenant_plat_id = c.tenant_plat_id
           AND b.channel_id = c.channel_id
    WHERE b.settle_status = 1
      AND b.settle_time >= c.first_deposit_date
      AND b.settle_time < DATE_ADD(c.first_deposit_date, INTERVAL :period_days DAY)
    GROUP BY c.player_id, DATE(b.settle_time)
),
rebate_cost AS (
    SELECT
        c.player_id,
        DATE(r.receive_time) AS event_date,
        0 AS win_loss_amount,
        SUM(r.amount) AS rebate_amount,
        0 AS task_amount,
        0 AS marketing_amount,
        0 AS discount_adjust_amount,
        -SUM(r.amount) AS channel_revenue_amount
    FROM first_deposit_cohort c
    INNER JOIN dwd_order_rebate r
            ON r.player_id = c.player_id
           AND r.tenant_plat_id = c.tenant_plat_id
           AND r.channel_id = c.channel_id
    WHERE r.status = 1
      AND r.receive_time >= c.first_deposit_date
      AND r.receive_time < DATE_ADD(c.first_deposit_date, INTERVAL :period_days DAY)
    GROUP BY c.player_id, DATE(r.receive_time)
),
task_cost AS (
    SELECT
        c.player_id,
        DATE(t.receive_time) AS event_date,
        0 AS win_loss_amount,
        0 AS rebate_amount,
        SUM(t.amount) AS task_amount,
        0 AS marketing_amount,
        0 AS discount_adjust_amount,
        -SUM(t.amount) AS channel_revenue_amount
    FROM first_deposit_cohort c
    INNER JOIN dwd_order_task t
            ON t.player_id = c.player_id
           AND t.tenant_plat_id = c.tenant_plat_id
           AND t.channel_id = c.channel_id
    WHERE t.status = 2
      AND t.receive_time >= c.first_deposit_date
      AND t.receive_time < DATE_ADD(c.first_deposit_date, INTERVAL :period_days DAY)
    GROUP BY c.player_id, DATE(t.receive_time)
),
activity_cost AS (
    SELECT
        c.player_id,
        DATE(a.receive_time) AS event_date,
        0 AS win_loss_amount,
        0 AS rebate_amount,
        0 AS task_amount,
        SUM(a.amount) AS marketing_amount,
        0 AS discount_adjust_amount,
        -SUM(a.amount) AS channel_revenue_amount
    FROM first_deposit_cohort c
    INNER JOIN dwd_order_activity a
            ON a.player_id = c.player_id
           AND a.tenant_plat_id = c.tenant_plat_id
           AND a.channel_id = c.channel_id
    WHERE a.status = 2
      AND a.receive_time >= c.first_deposit_date
      AND a.receive_time < DATE_ADD(c.first_deposit_date, INTERVAL :period_days DAY)
    GROUP BY c.player_id, DATE(a.receive_time)
),
promote_cost AS (
    SELECT
        c.player_id,
        DATE(p.send_time) AS event_date,
        0 AS win_loss_amount,
        0 AS rebate_amount,
        0 AS task_amount,
        SUM(p.amount) AS marketing_amount,
        0 AS discount_adjust_amount,
        -SUM(p.amount) AS channel_revenue_amount
    FROM first_deposit_cohort c
    INNER JOIN dwd_order_promote_activity p
            ON p.player_id = c.player_id
           AND p.tenant_plat_id = c.tenant_plat_id
           AND p.channel_id = c.channel_id
    WHERE p.status = 1
      AND p.send_time >= c.first_deposit_date
      AND p.send_time < DATE_ADD(c.first_deposit_date, INTERVAL :period_days DAY)
    GROUP BY c.player_id, DATE(p.send_time)
),
discount_adjust AS (
    SELECT
        c.player_id,
        DATE(a.modify_time) AS event_date,
        0 AS win_loss_amount,
        0 AS rebate_amount,
        0 AS task_amount,
        0 AS marketing_amount,
        SUM(
            CASE
                WHEN a.add_or_sub_type_id IN (1207, 1209) THEN a.amount
                WHEN a.add_or_sub_type_id IN (2204, 2207) THEN -a.amount
                ELSE 0
            END
        ) AS discount_adjust_amount,
        SUM(
            CASE
                WHEN a.add_or_sub_type_id IN (1207, 1209) THEN -a.amount
                WHEN a.add_or_sub_type_id IN (2204, 2207) THEN a.amount
                ELSE 0
            END
        ) AS channel_revenue_amount
    FROM first_deposit_cohort c
    INNER JOIN dwd_order_add_or_sub a
            ON a.player_id = c.player_id
           AND a.tenant_plat_id = c.tenant_plat_id
           AND a.channel_id = c.channel_id
    WHERE a.status = 2
      AND a.add_or_sub_type_id IN (1207, 1209, 2204, 2207)
      AND a.modify_time >= c.first_deposit_date
      AND a.modify_time < DATE_ADD(c.first_deposit_date, INTERVAL :period_days DAY)
    GROUP BY c.player_id, DATE(a.modify_time)
),
player_revenue_events AS (
    SELECT * FROM bet_revenue
    UNION ALL
    SELECT * FROM rebate_cost
    UNION ALL
    SELECT * FROM task_cost
    UNION ALL
    SELECT * FROM activity_cost
    UNION ALL
    SELECT * FROM promote_cost
    UNION ALL
    SELECT * FROM discount_adjust
),
daily_revenue AS (
    SELECT
        c.tenant_plat_id,
        c.channel_id,
        c.first_deposit_date,
        DATEDIFF(e.event_date, c.first_deposit_date) + 1 AS relative_day_no,
        SUM(e.win_loss_amount) AS daily_win_loss_amount,
        SUM(e.rebate_amount) AS daily_rebate_amount,
        SUM(e.task_amount) AS daily_task_amount,
        SUM(e.marketing_amount) AS daily_marketing_amount,
        SUM(e.discount_adjust_amount) AS daily_discount_adjust_amount,
        SUM(e.channel_revenue_amount) AS daily_channel_revenue
    FROM first_deposit_cohort c
    INNER JOIN player_revenue_events e
            ON e.player_id = c.player_id
    WHERE DATEDIFF(e.event_date, c.first_deposit_date) + 1 BETWEEN 1 AND :period_days
    GROUP BY
        c.tenant_plat_id,
        c.channel_id,
        c.first_deposit_date,
        DATEDIFF(e.event_date, c.first_deposit_date) + 1
)
SELECT
    cs.tenant_plat_id,
    cs.channel_id,
    cs.first_deposit_date,
    CONCAT('D', s.relative_day_no) AS day_label,
    s.relative_day_no,
    cs.cohort_user_count,
    COALESCE(dr.daily_win_loss_amount, 0) AS daily_win_loss_amount,
    COALESCE(dr.daily_rebate_amount, 0) AS daily_rebate_amount,
    COALESCE(dr.daily_task_amount, 0) AS daily_task_amount,
    COALESCE(dr.daily_marketing_amount, 0) AS daily_marketing_amount,
    COALESCE(dr.daily_discount_adjust_amount, 0) AS daily_discount_adjust_amount,
    COALESCE(dr.daily_channel_revenue, 0) AS daily_channel_revenue,
    SUM(COALESCE(dr.daily_channel_revenue, 0)) OVER (
        PARTITION BY cs.tenant_plat_id, cs.channel_id, cs.first_deposit_date
        ORDER BY s.relative_day_no
    ) AS cumulative_channel_revenue
FROM cohort_size cs
CROSS JOIN seq s
LEFT JOIN daily_revenue dr
       ON dr.tenant_plat_id = cs.tenant_plat_id
      AND dr.channel_id = cs.channel_id
      AND dr.first_deposit_date = cs.first_deposit_date
      AND dr.relative_day_no = s.relative_day_no
ORDER BY cs.first_deposit_date, s.relative_day_no;
```

## 备注

- 渠道收入口径：`输赢金额 - 洗码金额 - 任务彩金 - 营销金额 - 优惠加扣款`。
- 这里的“营销金额”按 `dwd_order_activity + dwd_order_promote_activity` 处理；若后续确认还要纳入其他营销表，再补到模板中。
- `period_days` 建议直接传最大回收天数（如 30 / 60 / 90 / 180 / 360），结果会返回 `D1 ~ Dn` 的每日值和累计值。
- SQL 按 TiDB / MySQL 8 风格编写；若运行环境不支持递归 CTE，可改成数字维表/日期维表实现。
- 当前可视为 SQL 草案，校验通过后可转为 sql_pair。
