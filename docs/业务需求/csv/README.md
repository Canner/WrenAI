# CSV 导出说明

这批 CSV 是把 `expected-results.md` 和 `test-runbook.md` 拆成更适合 Excel 打开的结构化文件。

- 编码：UTF-8 with BOM（`utf-8-sig`），便于 Excel 直接打开中文
- 建议打开顺序：
  1. `00_测试参数与总校验点.csv`
  2. `01_T01_渠道日基础汇总.csv` ~ `11_T13_首存金额分桶.csv`
  3. `99_回归执行清单.csv`

说明：CSV 不支持多 sheet，所以这里按“每个模板一份 CSV”的方式来模拟 Excel 多页签。
