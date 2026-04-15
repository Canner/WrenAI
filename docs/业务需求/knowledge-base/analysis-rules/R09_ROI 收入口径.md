---
kb_asset_type: analysis_rule
import_target: instruction
import_format_version: v1
id: R09
title: ROI 收入口径
scope: question_match
priority: high
status: draft
applies_to:
  - ROI回收表
keywords:
  - ROI
  - 渠道收入
  - 累计收入
source_documents:
  - 第一期数据报表需求V1.xlsx
  - 数据报表API对应SQL&DSL语句整理.xlsx
---

# R09 ROI 收入口径

## 规则内容

渠道收入 = 输赢金额 -（任务彩金 + 洗码金额 + 营销金额 + 优惠加扣款）；ROI = 渠道累计收入 / 投放金额。

## 导入建议

- scope = `question_match`
- 后续建议导入为 knowledge instruction

## 作用报表

- ROI回收表

## 关键词

- ROI
- 渠道收入
- 累计收入

## 备注

如果缺少投放金额源，则只能输出累计收入，不能输出 ROI。
