---
kb_asset_type: sql_template
import_target: sql_pair
import_format_version: v1
dialect: tidb_mysql8
parameter_style: colon_named
result_grain: player_id
id: T06
title: TOP3/非TOP3 分层
report: ROI/投充比与杀率
priority: high
status: draft_sql
source_tables:
  - dwd_bet_order
parameters:
  - tenant_plat_id
  - channel_id
  - start_date
  - end_date
  - top_n
question_variants:
  - 按统计区间累计有效投注排名，给用户打 TOP3 / 非TOP3 标签
  - 统计某渠道在指定区间内 TOPN 与非TOPN 用户分层结果
source_documents:
  - 第一期数据报表需求V1.xlsx
  - 数据报表API对应SQL&DSL语句整理.xlsx
  - 数据报表表结构Design_with_comments（4.15 v1.2）.sql
---

# T06 TOP3/非TOP3 分层

## 模板用途

按统计区间累计有效投注排名，给用户打 TOP3 / 非TOP3 标签。

## 建议问题（可转为 sql_pair.question）

- 按统计区间累计有效投注排名，给用户打 TOP3 / 非TOP3 标签
- 统计某渠道在指定区间内 TOPN 与非TOPN 用户分层结果

## 核心表/模型

- dwd_bet_order

## 参数

- tenant_plat_id
- channel_id
- start_date
- end_date
- top_n

## SQL 模板

```sql
WITH bet_rank_base AS (
    SELECT
        b.tenant_plat_id,
        b.channel_id,
        b.player_id,
        SUM(b.valid_bet_amount) AS total_valid_bet_amount,
        SUM(b.win_loss_amount) AS total_win_loss_amount,
        COUNT(*) AS total_bet_times
    FROM dwd_bet_order b
    WHERE b.settle_status = 1
      AND b.tenant_plat_id = :tenant_plat_id
      AND b.channel_id = :channel_id
      AND b.settle_time >= :start_date
      AND b.settle_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    GROUP BY b.tenant_plat_id, b.channel_id, b.player_id
),
ranked_users AS (
    SELECT
        br.*,
        ROW_NUMBER() OVER (
            ORDER BY br.total_valid_bet_amount DESC, br.player_id
        ) AS bet_rank,
        COUNT(*) OVER () AS ranked_user_count
    FROM bet_rank_base br
)
SELECT
    tenant_plat_id,
    channel_id,
    player_id,
    total_valid_bet_amount,
    total_win_loss_amount,
    total_bet_times,
    bet_rank,
    ranked_user_count,
    CASE
        WHEN bet_rank <= :top_n THEN CONCAT('TOP', :top_n)
        ELSE CONCAT('非TOP', :top_n)
    END AS user_segment,
    CASE
        WHEN bet_rank <= :top_n THEN 1
        ELSE 0
    END AS is_top_n
FROM ranked_users
ORDER BY bet_rank, player_id;
```

## 备注

- TOPN 口径按**整个统计区间累计有效投注**排序，不按单日排序。
- 并列时按 `player_id` 升序打散，保证结果稳定可复现。
- 结果可直接作为 `T09 / T12` 的上游分层输入。
- SQL 按 TiDB / MySQL 8 风格编写；导入前需在实际 runtime datasource 下做一次校验。
- 当前可视为 SQL 草案，校验通过后可转为 sql_pair。
