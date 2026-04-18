# SQL 模板预期结果样例（基于 `seed.sql`）

## 1. 用途

这份文档给 `docs/业务需求/seed.sql` 配一套**人工对账用预期结果**，用于校验目前已补好的 11 个 `draft_sql` 模板。

> 为了便于人工核对，下面默认只列**关键业务列**；像 `tenant_id / tenant_plat_name / channel_status / create_time` 这类静态字段，可直接按 `seed.sql` 原值核对。

## 2. 固定测试参数

| 参数 | 值 |
| --- | --- |
| tenant_plat_id | 990001 |
| 主测试渠道 channel_id | 990011 |
| 对照渠道 channel_id | 990012 |
| start_date | 2026-04-01 |
| end_date | 2026-04-07 |
| cohort_start_date | 2026-04-01 |
| cohort_end_date | 2026-04-03 |
| top_n | 3 |
| n_days | 7 |
| period_days | 7 |

## 3. 本轮覆盖范围

- **已覆盖**：T01 / T02 / T03 / T04 / T06 / T08 / T09 / T10 / T11 / T12 / T13
- **仍不在本轮回归范围**：T05 / T07 / T14 / T15
  - T05 / T14：缺投放金额
  - T07：缺“统计区间最高 VIP”等级 SQL 化模型
  - T15：缺 PV / UV / 下载点击 UV

## 4. 一眼对账点

- 主渠道 `990011` 在 `2026-04-01 ~ 2026-04-07`：
  - 总充值金额 = **3248**
  - 总提现金额 = **160**
  - 总有效投注 = **7300**
  - 总输赢 = **580**
- TOP3（按区间累计有效投注）固定为：**990101 / 990102 / 990103**
- 对照渠道 `990012` 只用于校验**渠道隔离**与 **T02 默认折扣=100%**

---

## T01 渠道日基础汇总

### T01-A 主指标

| biz_date | login_user_count | register_user_count | deposit_user_count | deposit_amount | withdrawal_amount | charge_withdraw_diff | first_deposit_user_count | new_customer_first_deposit_user_count | develop_user_count | new_customer_deposit_amount | valid_bet_amount | win_loss_amount | bet_deposit_ratio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-04-01 | 3 | 2 | 2 | 30 | 0 | 30 | 2 | 1 | 1 | 10 | 1300 | 110 | 43.3333 |
| 2026-04-02 | 3 | 2 | 3 | 2080 | 0 | 2080 | 2 | 2 | 0 | 2080 | 1800 | 120 | 0.8654 |
| 2026-04-03 | 3 | 1 | 3 | 238 | 40 | 198 | 1 | 1 | 0 | 138 | 1400 | 120 | 5.8824 |
| 2026-04-04 | 0 | 0 | 1 | 100 | 20 | 80 | 0 | 0 | 0 | 100 | 400 | 40 | 4.0000 |
| 2026-04-05 | 0 | 0 | 2 | 400 | 100 | 300 | 0 | 0 | 0 | 200 | 1300 | 100 | 3.2500 |
| 2026-04-06 | 0 | 0 | 2 | 400 | 0 | 400 | 0 | 0 | 0 | 400 | 1100 | 90 | 2.7500 |

### T01-B 优惠/彩金子项

| biz_date | rebate_amount | discount_adjust_amount | vip_award_amount | activity_amount | task_amount | promote_activity_amount | lottery_amount | promotion_total_amount |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-04-01 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2026-04-02 | 5 | 0 | 30 | 20 | 0 | 0 | 10 | 60 |
| 2026-04-03 | 10 | 12 | 0 | 0 | 8 | 0 | 0 | 20 |
| 2026-04-04 | 0 | 0 | 0 | 0 | 0 | 15 | 0 | 15 |
| 2026-04-05 | 0 | -6 | 0 | 0 | 0 | 0 | 0 | -6 |
| 2026-04-06 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

> 说明：`2026-04-05` 的 `promotion_total_amount = -6` 是**预期结果**，因为这天只有一笔 `2204` 优惠扣款。

---

## T02 渠道与折扣映射

静态字段可按 seed 核对：`tenant_id = 980001`、`tenant_plat_id = 990001`、`tenant_plat_name = KB_TEST_P1`、`channel_status = 3`。

| channel_id | channel_name | channel_partner_id | channel_partner_username | report_percent | report_percent_ratio | has_percent_config | percent_config_modify_time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 990011 | KB主渠道A | 980021 | partner_a | 90.0000 | 0.900000 | 1 | 2026-03-27 08:00:00 |
| 990012 | KB对照渠道B | 980022 | partner_b | 100.0000 | 1.000000 | 0 | NULL |

---

## T03 首存 cohort 提取

| first_deposit_date | player_id | player_username | first_deposit_amount | register_date | is_new_customer_first_deposit | current_vip_id |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-04-01 | 990101 | kb_p01 | 10 | 2026-04-01 | 1 | 1 |
| 2026-04-01 | 990102 | kb_p02 | 20 | 2026-03-31 | 0 | 1 |
| 2026-04-02 | 990103 | kb_p03 | 50 | 2026-04-02 | 1 | 2 |
| 2026-04-02 | 990104 | kb_p04 | 2000 | 2026-04-02 | 1 | 3 |
| 2026-04-03 | 990105 | kb_p05 | 88 | 2026-04-03 | 1 | 1 |

---

## T04 cohort 累计收入

表格单元格格式：`当日渠道收入 / 截止当日累计渠道收入`

| first_deposit_date | cohort_user_count | D1 | D2 | D3 | D4 | D5 | D6 | D7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-04-01 | 2 | 110/110 | 45/155 | 80/235 | 25/260 | 106/366 | 50/416 | 0/416 |
| 2026-04-02 | 2 | 50/50 | 0/50 | 0/50 | 0/50 | 40/90 | 0/90 | 0/90 |
| 2026-04-03 | 1 | 10/10 | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 |

关键口径点：
- `2026-04-01 cohort` 的 `D2 = 70 - 5 - 20 = 45`
- `2026-04-01 cohort` 的 `D3 = 110 - 10 - 8 - 12 = 80`
- `2026-04-01 cohort` 的 `D5 = 100 - (-6) = 106`（因为扣款会回补渠道收入）

---

## T06 TOP3/非TOP3 分层

| player_id | total_valid_bet_amount | total_win_loss_amount | total_bet_times | bet_rank | user_segment |
| --- | --- | --- | --- | --- | --- |
| 990101 | 3000 | 300 | 6 | 1 | TOP3 |
| 990102 | 2500 | 180 | 3 | 2 | TOP3 |
| 990103 | 1500 | 120 | 2 | 3 | TOP3 |
| 990104 | 200 | -30 | 1 | 4 | 非TOP3 |
| 990105 | 100 | 10 | 1 | 5 | 非TOP3 |

> `ranked_user_count` 固定为 `5`。

---

## T08 首存 cohort 续存

| first_deposit_date | register_user_count | first_deposit_user_count | first_deposit_rate | first_deposit_avg_amount | second_deposit_user_count | second_deposit_rate | second_deposit_avg_amount | third_deposit_user_count | third_deposit_rate | third_deposit_avg_amount | fourth_deposit_user_count | fourth_deposit_rate | fourth_deposit_avg_amount | fifth_deposit_user_count | fifth_deposit_rate | fifth_deposit_avg_amount | sixth_deposit_user_count | sixth_deposit_rate | sixth_deposit_avg_amount |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-04-01 | 2 | 2 | 1.0000 | 15.00 | 2 | 1.0000 | 65.00 | 2 | 1.0000 | 125.00 | 1 | 0.5000 | 100.00 | 1 | 0.5000 | 200.00 | 1 | 0.5000 | 300.00 |
| 2026-04-02 | 2 | 2 | 1.0000 | 1025.00 | 1 | 0.5000 | 100.00 | 0 | 0.0000 | NULL | 0 | 0.0000 | NULL | 0 | 0.0000 | NULL | 0 | 0.0000 | NULL |
| 2026-04-03 | 1 | 1 | 1.0000 | 88.00 | 0 | 0.0000 | NULL | 0 | 0.0000 | NULL | 0 | 0.0000 | NULL | 0 | 0.0000 | NULL | 0 | 0.0000 | NULL |

> `2026-04-01 cohort` 的 `second_deposit_avg_amount = (30 + 100) / 2 = 65.00`，`third_deposit_avg_amount = (50 + 200) / 2 = 125.00`。

---

## T09 所有用户区间汇总

> `user_segment` 传参映射：`ALL` / `TOPN` / `NON_TOPN`

| user_segment | user_count | deposit_user_count | deposit_amount | withdrawal_user_count | withdrawal_amount | charge_withdraw_diff | bet_user_count | valid_bet_amount | win_loss_amount | kill_rate | bet_deposit_ratio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ALL | 5 | 5 | 3248 | 3 | 160 | 3088 | 5 | 7300 | 580 | 0.079452 | 2.247537 |
| TOPN | 3 | 3 | 1160 | 2 | 60 | 1100 | 3 | 7000 | 600 | 0.085714 | 6.034483 |
| NON_TOPN | 2 | 2 | 2088 | 1 | 100 | 1988 | 2 | 300 | -20 | -0.066667 | 0.143678 |

---

## T10 首存用户日龄趋势

下面只列**有行为的行**；未列出的 `Dn` 行，SQL 仍会返回，但其值应为：
- `deposit_user_count / withdrawal_user_count / bet_user_count = 0`
- `deposit_amount / withdrawal_amount / valid_bet_amount / win_loss_amount = 0`
- `kill_rate / bet_deposit_ratio = NULL`

| first_deposit_date | day_label | cohort_user_count | deposit_user_count | deposit_amount | withdrawal_user_count | withdrawal_amount | charge_withdraw_diff | bet_user_count | valid_bet_amount | win_loss_amount | kill_rate | bet_deposit_ratio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-04-01 | D1 | 2 | 2 | 30 | 0 | 0 | 30 | 2 | 1300 | 110 | 0.084615 | 43.333333 |
| 2026-04-01 | D2 | 2 | 1 | 30 | 0 | 0 | 30 | 1 | 700 | 70 | 0.100000 | 23.333333 |
| 2026-04-01 | D3 | 2 | 2 | 150 | 1 | 40 | 110 | 2 | 1300 | 110 | 0.084615 | 8.666667 |
| 2026-04-01 | D4 | 2 | 1 | 100 | 1 | 20 | 80 | 1 | 400 | 40 | 0.100000 | 4.000000 |
| 2026-04-01 | D5 | 2 | 2 | 400 | 0 | 0 | 400 | 2 | 1300 | 100 | 0.076923 | 3.250000 |
| 2026-04-01 | D6 | 2 | 1 | 300 | 0 | 0 | 300 | 1 | 500 | 50 | 0.100000 | 1.666667 |
| 2026-04-02 | D1 | 2 | 2 | 2050 | 0 | 0 | 2050 | 2 | 1100 | 50 | 0.045455 | 0.536585 |
| 2026-04-02 | D4 | 2 | 0 | 0 | 1 | 100 | -100 | 0 | 0 | 0 | NULL | NULL |
| 2026-04-02 | D5 | 2 | 1 | 100 | 0 | 0 | 100 | 1 | 600 | 40 | 0.066667 | 6.000000 |
| 2026-04-03 | D1 | 1 | 1 | 88 | 0 | 0 | 88 | 1 | 100 | 10 | 0.100000 | 1.136364 |

未列出的补零行：
- `2026-04-01 cohort`：`D7`
- `2026-04-02 cohort`：`D2 / D3 / D6 / D7`
- `2026-04-03 cohort`：`D2 ~ D7`

---

## T11 按游戏类型分布

| game_type_id | game_type_name | bet_times | valid_bet_amount | avg_bet_amount | win_loss_amount | kill_rate | bet_share |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 990032 | 体育 | 6 | 3900 | 650.0000 | 330 | 0.084615 | 0.534247 |
| 990031 | 电子 | 5 | 1900 | 380.0000 | 140 | 0.073684 | 0.260274 |
| 990033 | 棋牌 | 2 | 1500 | 750.0000 | 110 | 0.073333 | 0.205479 |

---

## T12 TOP3/5 游戏类型分层

> 这里按当前测试参数 `top_n = 3`，所以实际结果为 `TOP3 / 非TOP3`。

| user_segment | segment_sort | game_type_id | game_type_name | bet_user_count | bet_times | valid_bet_amount | avg_bet_amount | win_loss_amount | kill_rate | bet_share_in_segment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TOP3 | 1 | 990032 | 体育 | 3 | 6 | 3900 | 650.0000 | 330 | 0.084615 | 0.557143 |
| TOP3 | 1 | 990031 | 电子 | 1 | 3 | 1600 | 533.3333 | 160 | 0.100000 | 0.228571 |
| TOP3 | 1 | 990033 | 棋牌 | 1 | 2 | 1500 | 750.0000 | 110 | 0.073333 | 0.214286 |
| 非TOP3 | 2 | 990031 | 电子 | 2 | 2 | 300 | 150.0000 | -20 | -0.066667 | 1.000000 |

---

## T13 首存金额分桶

| first_deposit_date | bucket_name | bucket_user_count | total_first_deposit_user_count | bucket_ratio |
| --- | --- | --- | --- | --- |
| 2026-04-01 | 10元 | 1 | 2 | 0.500000 |
| 2026-04-01 | 20元 | 1 | 2 | 0.500000 |
| 2026-04-02 | 50元 | 1 | 2 | 0.500000 |
| 2026-04-02 | 2000元 | 1 | 2 | 0.500000 |
| 2026-04-03 | 其他 | 1 | 1 | 1.000000 |

---

## 5. 使用建议

- 如果只是做人工验数，优先比对：`T01 / T03 / T06 / T09 / T11 / T13`
- 如果要做链路回归，再继续比对：`T08 / T10 / T04`
- 如果某条 SQL 跑出来与这里不一致，先回看：
  1. 是否误把失败充值（`status = 3`）算进去了；
  2. 是否把对照渠道 `990012` 的数据串进主渠道；
  3. 是否把 `NULLIF` 场景误显示成 `0`；
  4. 是否把 `2204` 扣款方向算反了。
