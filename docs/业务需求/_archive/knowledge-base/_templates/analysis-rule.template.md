---
kb_asset_type: analysis_rule
import_target: instruction
import_format_version: v1
id: RXX
title: 规则标题
scope: question_match
priority: high
status: draft
applies_to:
  - 报表A
  - 报表B
keywords:
  - 关键词1
  - 关键词2
source_documents:
  - 第一期数据报表需求V1.xlsx
  - 数据报表API对应SQL&DSL语句整理.xlsx
---

# RXX 规则标题

## 规则内容

在这里写真正要导入 instruction 的规则文本。

## 导入建议

- `scope = global`：适合做全局 instruction
- `scope = question_match`：适合按 questions 关键词命中后生效

## 作用报表

- 报表A
- 报表B

## 关键词

- 关键词1
- 关键词2

## 备注

- `import_target` 固定为 `instruction`。
- `status` 当前建议使用 `draft`，确认口径后再转正式导入资产。
