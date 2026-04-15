---
kb_asset_type: sql_template
import_target: sql_pair
import_format_version: v1
dialect: tidb_mysql8
parameter_style: colon_named
result_grain: first_deposit_user
id: T03
title: 首存 cohort 提取
report: ROI回收表
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
  - 找出某时间段内某渠道的首存用户、首存日期、首存金额。
  - 查询某渠道在指定时间段的首存用户名单与首存金额
source_documents:
  - 第一期数据报表需求V1.xlsx
  - 数据报表API对应SQL&DSL语句整理.xlsx
  - 数据报表表结构Design_with_comments（4.15 v1.2）.sql
---

# T03 首存 cohort 提取

## 模板用途

找出某时间段内某渠道的首存用户、首存日期、首存金额。

## 建议问题（可转为 sql_pair.question）

- 找出某时间段内某渠道的首存用户、首存日期、首存金额。
- 查询某渠道在指定时间段的首存用户名单与首存金额

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
WITH first_deposit_cohort AS (
    SELECT
        d.tenant_plat_id,
        d.channel_id,
        DATE(d.callback_time) AS first_deposit_date,
        d.player_id,
        d.player_username,
        d.actual_amount AS first_deposit_amount,
        d.callback_time AS first_deposit_time,
        d.regist_time
    FROM dwd_order_deposit d
    WHERE d.status = 2
      AND d.times = 1
      AND d.tenant_plat_id = :tenant_plat_id
      AND d.channel_id = :channel_id
      AND d.callback_time >= :cohort_start_date
      AND d.callback_time < DATE_ADD(:cohort_end_date, INTERVAL 1 DAY)
)
SELECT
    c.first_deposit_date,
    c.tenant_plat_id,
    c.channel_id,
    c.player_id,
    c.player_username,
    c.first_deposit_amount,
    c.first_deposit_time,
    DATE(c.regist_time) AS register_date,
    CASE
        WHEN DATE(c.regist_time) = DATE(c.first_deposit_time) THEN 1
        ELSE 0
    END AS is_new_customer_first_deposit,
    p.vip_id AS current_vip_id,
    p.regist_device,
    p.regist_domain
FROM first_deposit_cohort c
LEFT JOIN dim_player p
       ON p.id = c.player_id
      AND p.tenant_plat_id = c.tenant_plat_id
ORDER BY c.first_deposit_date, c.player_id;
```

## 备注

- 首存定义按 times = 1 且状态成功。
- SQL 按 TiDB / MySQL 8 风格编写；导入前需在实际 runtime datasource 下做一次校验。
- 当前可视为 SQL 草案，校验通过后可转为 sql_pair。
