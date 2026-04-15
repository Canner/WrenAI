---
kb_asset_type: analysis_rule
import_target: instruction
import_format_version: v1
id: R06
title: VIP 分层口径
scope: question_match
priority: high
status: draft
applies_to:
  - ROI回收表
  - 投充比与杀率
keywords:
  - VIP0
  - VIP1
  - VIP2
  - VIP3
  - VIP分层
source_documents:
  - 第一期数据报表需求V1.xlsx
  - 数据报表API对应SQL&DSL语句整理.xlsx
---

# R06 VIP 分层口径

## 规则内容

当问题涉及 VIP0/VIP1/VIP2... 分层时，统一按所选统计区间内达到的最高 VIP 等级归类，不按查询时点当前 VIP 归类。

## 导入建议

- scope = `question_match`
- 后续建议导入为 knowledge instruction

## 作用报表

- ROI回收表
- 投充比与杀率

## 关键词

- VIP0
- VIP1
- VIP2
- VIP3
- VIP分层

## 备注

若当前没有 SQL 化的玩家日 VIP 模型，需要先补数据模型。
