# dataSource 残留盘点（2026-04-18）

本轮目标：只清理 **非底层协议层**、可安全迁移的 `dataSource` 命名；保留 engine / manifest / ibis / DTO / 第三方 API 约束里的 `DataSource` 语义。

## 本轮已收口

### 文件名 / helper 文件

- `wren-ui/src/server/managers/dataSourceSchemaDetector.ts`
  - → `wren-ui/src/server/managers/connectionSchemaDetector.ts`
- `wren-ui/src/server/utils/dataSourceConnectorBridge.ts`
  - → `wren-ui/src/server/utils/connectionConnectorBridge.ts`
- `wren-ui/src/server/utils/tests/dataSource.test.ts`
  - → `wren-ui/src/server/utils/tests/connection.test.ts`
- `wren-ui/src/utils/dataSourceType.ts`
  - → `wren-ui/src/utils/connectionType.ts`
- `wren-ui/src/utils/enum/dataSources.ts`
  - → `wren-ui/src/utils/enum/connectionTypes.ts`
- `wren-ui/src/components/pages/setup/dataSources/`
  - → `wren-ui/src/components/pages/setup/connections/`
- `wren-ui/public/images/dataSource/`
  - → `wren-ui/public/images/connection/`

### 类型名 / 类名

- `IDataSourceMetadataService`
  - → `IConnectionMetadataService`
- `DataSourceMetadataService`
  - → `ConnectionMetadataService`
- `IDataSourceSchemaDetector`
  - → `IConnectionSchemaDetector`
- `DataSourceSchema`
  - → `ConnectionSchema`
- `DataSourceSchemaChange`
  - → `ConnectionSchemaChange`
- `DataSourceSchemaResolve`
  - → `ConnectionSchemaResolve`
- `DataSourceSchemaDetector`
  - → `ConnectionSchemaDetector`

### legacy 兼容层

- `wren-ui/src/utils/settingsRest.ts`
  - 删除 `SettingsData.dataSource`
  - 删除 `settings?.dataSource` fallback
- `wren-ui/src/utils/connectionSettingsRest.test.ts`
  - 更新为仅校验 `connection` 字段

## 当前保留：属于协议层 / 不建议迁移

以下残留是**有意保留**：

- `wren-ui/src/types/dataSource.ts`
- `wren-ui/src/server/types/dataSource.ts`
- `wren-ui/src/server/dataSource.ts`

这些文件承载的是底层数据源协议、枚举、connectionInfo → ibis / engine 映射，不属于 UI/管理层命名清理范围。

同时继续保留：

- `manifest.dataSource`
- `WrenEngineDataSourceType`
- `DataSourceName`
- `wren.datasource.type`
- `ibisAdaptor` / engine / launcher / AI service 中的 `dataSource` 语义
- Ant Design Table 的 `dataSource` prop

## 可忽略项

- 文档里的历史文件名引用（尤其明确标注“历史”的段落）
- 第三方 schema / Vega / engine 文档中的 `DataSource`
- 测试数据或快照里描述底层协议字段的 `dataSource`

## 结论

UI / 管理层 / helper 层里，能安全迁移的 `dataSource` 主体已基本收口完成；剩余 `dataSource` 命名主要集中在底层协议层与第三方约束，继续强行改名收益低、破坏面高，不建议再动。
