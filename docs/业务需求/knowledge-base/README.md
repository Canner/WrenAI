# 业务需求知识资产（导入准备）

这套目录用于提前沉淀后续要导入系统知识库的内容。

## 为什么这里建议用 Markdown

建议，**用 Markdown + YAML Front Matter** 最合适，原因是：

1. **人工可读**：产品、数据、研发都能直接看懂和改。
2. **版本友好**：Git diff 清楚，方便评审和追踪口径变更。
3. **后续易导入**：虽然现在还没有导入功能，但后续脚本可以稳定解析 front matter。
4. **能逐步演进**：先沉淀规则和模板说明，后续再补成可直接导入的 SQL pair / instruction。

## 目录约定

- `analysis-rules/`：分析规则，后续建议导入为 **instructions**
- `sql-templates/`：SQL 模板定义，后续建议导入为 **sql_pairs**
- `_templates/`：新建文档时复用的模板
- `import-format.md`：统一 front matter 字段约定
- `import-manifest.sample.yaml`：未来导入脚本可参考的批量导入样例

> 建议把 `analysis-rules/` 与 `sql-templates/` 下的**单文件文档**作为后续导入的权威来源；
> 根目录下的 `analysis-rules.md` / `sql-templates.md` 更适合作为汇总浏览页。

## 推荐导入映射

### 1. 分析规则 -> instruction

- `scope: global` 对应全局 instruction
- `scope: question_match` 对应 questions 匹配型 instruction
- `import_target` 固定为 `instruction`

### 2. SQL 模板 -> sql_pair

每个 SQL 模板文件至少补齐：
- `question_variants`
- `parameters`
- `status`
- `dialect`
- `parameter_style`
- `result_grain`
- `## SQL 模板` 正文

推荐状态：
- `spec_only`：只有模板说明，还没有 SQL
- `draft_sql`：已经有 SQL 草案，但还没在实际 runtime datasource 验证
- `blocked_missing_source`：缺外部数据源
- `blocked_missing_sql_model`：缺 SQL 化模型

## 当前约束

1. 当前系统 SQL pair 创建时会做 SQL 校验，因此 **不能直接导入 ES DSL**。
2. 当前仓库数据源枚举里没有 Elasticsearch/OpenSearch，因此 **ES 口径要先转成 SQL 化模型**。
3. 目前已确认缺失的外部数据源：
   - 投放金额
   - 访问 PV
   - 访问 UV
   - 下载点击 UV

## 当前进度

- 分析规则单文件：14 个
- SQL 模板单文件：15 个
- 其中已补 SQL 草案：11 个
- 仍受阻模板：4 个（`T05/T07/T14/T15`）

## 录入建议

建议先录：
- 分析规则（可先导入）
- SQL 模板定义（先文档化）
- 等 SQL 补完整并完成 runtime 校验后，再导入为 sql pairs

## 测试数据建议

- 造数方案见：[`../test-data-plan.md`](../test-data-plan.md)
- 推荐先按“1个平台 + 2渠道 + 7玩家 + 7天数据”做最小回归样例

- 示例造数脚本：[`../seed.sql`](../seed.sql)
