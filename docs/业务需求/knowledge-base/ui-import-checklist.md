# UI 导入检查清单

这份清单面向“通过 UI 手工导入分析规则与 SQL 模板”的场景，目标是让导入顺序、导入范围和阻塞项清楚可执行。

## 1. 当前结论

- **分析规则**：14 个，当前都可作为 instruction 导入
- **SQL 模板**：15 个
  - 可先导入：11 个 `draft_sql`
  - 暂不导入：4 个阻塞模板（`T05/T07/T14/T15`）

## 2. 导入前统一检查

在 UI 导入前，逐条确认：

- front matter 存在
- `id` 唯一
- `kb_asset_type` / `import_target` 正确
- `title`、`priority`、`status` 已填写
- `question_variants` 非空（仅 SQL 模板）
- `## 规则内容` 或 `## SQL 模板` 主体存在

> 2026-04-21 复核结果：当前 `analysis-rules/*.md` 与 `sql-templates/*.md` 均满足上述基础格式要求。

## 3. 建议导入顺序

### Step 1：先导入分析规则

目录：

- `docs/业务需求/knowledge-base/analysis-rules/`

建议顺序：

1. `R01_汇总口径.md`
2. `R02_首存定义.md`
3. `R03_新客首存.md`
4. `R04_开发人数.md`
5. `R05_TOPN 口径.md`
6. `R06_VIP 分层口径.md`
7. `R07_投充比公式.md`
8. `R08_杀率公式.md`
9. `R09_ROI 收入口径.md`
10. `R10_续存口径.md`
11. `R11_游戏类型分布口径.md`
12. `R12_首存金额分桶.md`
13. `R13_缺失数据源处理.md`
14. `R14_ES 数据使用限制.md`

说明：

- 规则建议优先导入，因为它们会影响后续问答和 SQL 模板的解释边界。
- `R13` 和 `R14` 属于“缺失源 / ES 限制”类规则，建议必须导入，避免系统误答。

### Step 2：再导入可用 SQL 模板

目录：

- `docs/业务需求/knowledge-base/sql-templates/`

建议先导入这 11 个：

1. `T01_渠道日基础汇总.md`
2. `T02_渠道与折扣映射.md`
3. `T03_首存 cohort 提取.md`
4. `T04_cohort 累计收入.md`
5. `T06_TOP3-非TOP3 分层.md`
6. `T08_首存 cohort 续存.md`
7. `T09_所有用户区间汇总.md`
8. `T10_首存用户日龄趋势.md`
9. `T11_按游戏类型分布.md`
10. `T12_TOP3-5 游戏类型分层.md`
11. `T13_首存金额分桶.md`

### Step 3：阻塞模板先不导入

下面 4 个文件建议在 UI 中标记为“待补齐”，不要当作可执行 SQL 模板导入：

| ID | 文件 | 当前状态 | 阻塞原因 |
| --- | --- | --- | --- |
| T05 | `T05_cohort ROI.md` | `blocked_missing_source` | 缺投放金额数据源 |
| T07 | `T07_VIP 最高等级分层.md` | `blocked_missing_sql_model` | 缺“统计区间最高 VIP”等级 SQL 化模型 |
| T14 | `T14_投放金额并表.md` | `blocked_missing_source` | 缺投放金额数据源 |
| T15 | `T15_流量指标并表.md` | `blocked_missing_source` | 缺 PV / UV / 下载点击 UV 数据源 |

## 4. UI 导入后的验证顺序

导入完成后，建议按下面顺序验证：

1. 先问规则类问题，确认口径是否被正确约束
   - 首存定义
   - 新客首存
   - TOPN 口径
   - VIP 分层口径
   - 缺失数据源处理
2. 再问模板类问题，确认是否能命中对应 SQL 模板
   - 综合日报
   - cohort 收入
   - TOPN 分层
   - 日龄趋势
   - 游戏类型分布
3. 最后用测试数据做验收
   - 造数：`../seed.sql`
   - 执行说明：`../test-runbook.md`
   - 预期结果：`../expected-results.md`
   - Excel 核对：`../csv/`

## 5. 推荐的 UI 导入批次

如果 UI 一次导入量不宜过大，建议拆成 3 批：

### 批次 A：全局 / 通用规则

- R01
- R02
- R03
- R04
- R05
- R06
- R07
- R08
- R13
- R14

### 批次 B：报表专项规则

- R09
- R10
- R11
- R12

### 批次 C：SQL 模板

- T01
- T02
- T03
- T04
- T06
- T08
- T09
- T10
- T11
- T12
- T13

## 6. 当前主数据源

当前 UI 导入只应使用下面两个目录作为权威来源：

- `analysis-rules/`
- `sql-templates/`

下面这些都**不应作为当前 UI 导入输入源**：

- `../_archive/knowledge-base/analysis-rules.md`
- `../_archive/knowledge-base/sql-templates.md`
- `../_archive/knowledge-base/_templates/`
- `../_archive/knowledge-base/table-suggested-questions.generated.csv`
- `../_archive/knowledge-base/table-suggested-questions.generated.json`
