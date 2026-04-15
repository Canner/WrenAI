---
kb_asset_type: analysis_rule
import_target: instruction
import_format_version: v1
id: R14
title: ES 数据使用限制
scope: question_match
priority: high
status: draft
applies_to:
  - ROI回收表
  - 投充比与杀率
  - 游戏类型流水分布
keywords:
  - ES
  - 玩家日汇总
  - VIP日快照
source_documents:
  - 第一期数据报表需求V1.xlsx
  - 数据报表API对应SQL&DSL语句整理.xlsx
---

# R14 ES 数据使用限制

## 规则内容

当问题需要使用 legacy ES 指标（如玩家日 VIP、玩家日游戏或线路汇总）时，优先使用对应 SQL 映射表或视图；如果未提供 SQL 映射，不要输出 ES DSL，应说明当前系统仅支持 SQL 模板。

## 导入建议

- scope = `question_match`
- 后续建议导入为 knowledge instruction

## 作用报表

- ROI回收表
- 投充比与杀率
- 游戏类型流水分布

## 关键词

- ES
- 玩家日汇总
- VIP日快照

## 备注

当前系统 SQL pair 创建时会做 SQL 校验，不能直接导入 DSL。
