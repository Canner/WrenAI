---
kb_asset_type: analysis_rule
import_target: instruction
import_format_version: v1
id: R05
title: TOPN 口径
scope: question_match
priority: high
status: draft
applies_to:
  - ROI回收表
  - 首存及续存率
  - 投充比与杀率
  - 游戏类型流水分布
keywords:
  - TOP3
  - TOP5
  - 非TOP3
  - 非TOP5
source_documents:
  - 第一期数据报表需求V1.xlsx
  - 数据报表API对应SQL&DSL语句整理.xlsx
---

# R05 TOPN 口径

## 规则内容

当问题涉及 TOP3/TOP5/非TOP3/非TOP5 时，必须按所选统计区间内的累计有效投注排序，不按单日排序。

## 导入建议

- scope = `question_match`
- 后续建议导入为 knowledge instruction

## 作用报表

- ROI回收表
- 首存及续存率
- 投充比与杀率
- 游戏类型流水分布

## 关键词

- TOP3
- TOP5
- 非TOP3
- 非TOP5

## 备注

TOPN 应先在整段区间内排名，再回写到指标统计。
