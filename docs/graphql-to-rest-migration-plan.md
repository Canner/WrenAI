# GraphQL → REST 迁移方案与清单

> 更新时间：2026-04-15  
> 适用范围：`wren-ui` 运行时前端调用链、对应 `src/pages/api/v1/*` REST facade、Apollo 退役路径

## 1. 目标与边界

### 1.1 目标

这轮迁移的目标不是“把所有 GraphQL 一次性删光”，而是把 **更适合 REST 的资源型 / 管理型 / 稳定字段型能力** 先收口到 REST，让前端页面逐步摆脱 Apollo cache、`updateQuery`、`refetchQueries`、模块级缓存补丁和 GraphQL generated hook 的耦合。

最终目标有三层：

1. **页面层**：资源管理台、设置页、知识库管理页、线程详情与轮询页优先走 REST helper。
2. **基础设施层**：`ApolloProvider` 只保留给确实尚未迁移的页面，直到 Home ask 链路和 Modeling 收口完成。
3. **退役层**：当运行时页面不再依赖 Apollo hook 后，再评估裁撤 `src/pages/api/graphql.ts`、`src/apollo/client/index.ts`、对应 generated hooks 与不再需要的 resolver 暴露面。

### 1.2 非目标

当前 **不建议** 把下面这些内容一口气重写：

- `wren-ui/src/pages/modeling.tsx` 主建模工作台
- 建模相关 schema change / calculated field / relationship / deploy 全链路
- GraphQL `__types__` 的类型引用一次性清零

原因很直接：这些区域目前仍然是 **组合型、图结构型、状态机关联型**，虽然也能 REST 化，但需要先把 server 侧资源边界设计完整，不适合和 Home / Settings 这类低风险收口混在一起做。

---

## 2. 当前状态快照（基于 2026-04-15 最新代码）

### 2.1 已经基本完成 REST 收口的区域

下面这些区域已经是 REST 主链路，或者只剩少量 GraphQL 尾巴：

- 工作空间 / 设置页：`/api/v1/workspace/*`、`/api/v1/settings/*`
- 知识库列表 / 详情主链路：`/api/v1/knowledge/bases/*`、`/api/v1/knowledge/diagram.ts`
- 分析规则 / SQL 模板：`/api/v1/knowledge/instructions/*`、`/api/v1/knowledge/sql_pairs/*`
- 连接器 / 技能可用列表：`/api/v1/connectors/*`、`/api/v1/skills/available.ts`
- API history / diagnostics：`/api/v1/api-history/index.ts`
- Dashboard 主页面：`/api/v1/dashboards/*`、`/api/v1/dashboard-items/*`
- Runtime selector state hook：`/api/v1/runtime/scope/current.ts`
- Thread detail / response polling / recommendation polling：`/api/v1/threads/*`、`/api/v1/thread-responses/*`、`/api/v1/thread-recommendation-questions/*`
- Onboarding / learning records：`/api/v1/onboarding/status.ts`、`/api/v1/learning/index.ts`

### 2.2 仍在使用运行时 GraphQL 的入口

下面这些文件仍然直接使用 Apollo hook / GraphQL document / Apollo client 查询：

| 分组 | 文件 | 当前 GraphQL 能力 |
| --- | --- | --- |
| 基础设施 | `src/pages/_app.tsx` | `ApolloProvider` |
| Runtime bootstrap | `src/components/runtimeScope/RuntimeScopeBootstrap.tsx` | `RUNTIME_SELECTOR_STATE` query |
| Home ask | `src/pages/home/index.tsx` | `suggestedQuestions`、`createThread`、`createAskingTask` |
| Home ask | `src/hooks/useAskPrompt.tsx` | asking task 查询/取消/重跑、instant recommended questions |
| Home ask | `src/hooks/useAdjustAnswer.tsx` | adjust answer、adjust cancel/rerun |
| Home ask | `src/hooks/useResponsePreviewData.ts` | `previewData` mutation |
| Home ask | `src/hooks/useRecommendedQuestionsInstruction.tsx` | project recommendation questions query/mutation |
| Home ask | `src/hooks/useNativeSQL.tsx` | `getSettings`、`nativeSql` |
| Home ask / dashboard pin | `src/components/pages/home/promptThread/ChartAnswer.tsx` | `dashboards` query、`createDashboardItem` mutation |
| Learning | `src/components/learning/guide/index.tsx` | `getSettings` query |
| Modeling | `src/pages/modeling.tsx` | diagram、deploy status、model/metadata/calculated field/relationship CRUD |
| Modeling | `src/components/deploy/Deploy.tsx` | deploy mutation |
| Modeling | `src/components/modals/CalculatedFieldModal.tsx` | validate calculated field |
| Modeling | `src/components/modals/ImportDataSourceSQLModal.tsx` | model substitute |
| Modeling / setup | `src/hooks/useSetupConnectionDataSource.tsx` | save data source |
| Modeling / setup | `src/hooks/useSetupModels.tsx` | list datasource tables、save tables |
| Modeling / setup | `src/hooks/useSetupRelations.tsx` | auto-generate relations、save relations |
| Modeling / setup | `src/hooks/useAutoComplete.tsx` | diagram query |
| Modeling / setup | `src/components/pages/modeling/form/ModelForm.tsx` | list datasource tables |
| Modeling / setup | `src/components/sidebar/modeling/ModelTree.tsx` | schema change query、detect、resolve |

### 2.3 额外注意：类型耦合仍然很多

大量文件虽然已经不再直接发 GraphQL 请求，但仍然引用 `@/apollo/client/graphql/__types__` 里的 enum / type。  
这 **不会阻塞运行时迁移**，但会阻塞 Apollo 完全退役。

建议把类型退役放到最后一波做：

- 先把运行时调用链切到 REST
- 再把公共枚举/DTO 提取到 `src/types/*` 或 REST DTO 文件
- 最后再删 generated GraphQL client/types

---

## 3. 迁移原则

### 3.1 先资源、后编排

优先迁：

- 稳定资源列表
- 设置项
- 管理台 CRUD
- 线程/任务/看板项这类明确资源

暂缓迁：

- 图结构建模
- 高耦合状态机
- 一次请求要跨多个实体深度拼装的 UI

### 3.2 先补 REST facade，再改页面

每个能力迁移都遵循固定顺序：

1. 补 `src/pages/api/v1/*` endpoint
2. 补 `src/utils/*Rest.ts` helper
3. 页面/hook 从 generated hook 切到 REST helper
4. 删 Apollo cache update / refetchQueries / GraphQL document import
5. 补测试

### 3.3 允许阶段性混合，但要有“零客户端”收口点

允许 `modeling` 还走 GraphQL，`home` 已经走 REST。  
但每一波都要定义清楚“哪些 GraphQL 客户端入口已经清零”，否则 Apollo 永远退不掉。

### 3.4 先把 Apollo 从“业务状态源”降级成“残余兼容层”

迁移不是先删 ApolloProvider，而是先让 Apollo **不再承载新页面主状态**。  
等 Home ask 和 Modeling 之外的页面都收口后，再处理 provider 与 graphql endpoint 的最终退役。

---

## 4. 推荐迁移波次

## Wave 0：低风险尾巴收口（优先级 P0）

这波的目标是把已经有 REST 基座、但还残留 GraphQL 尾巴的地方一次收干净。

| 项目 | 文件 | 目标 REST | 后端状态 | 风险 |
| --- | --- | --- | --- | --- |
| Runtime bootstrap 改 REST | `src/components/runtimeScope/RuntimeScopeBootstrap.tsx` | 复用 `GET /api/v1/runtime/scope/current` | **已存在** | 低 |
| Learning guide 设置读取 | `src/components/learning/guide/index.tsx` | 复用 `fetchSettings()` | **已存在** | 低 |
| Native SQL 的 settings 读取 | `src/hooks/useNativeSQL.tsx` | 复用 `fetchSettings()` | **已存在** | 低 |
| Preview data | `src/hooks/useResponsePreviewData.ts` | `GET /api/v1/thread-responses/:id/preview-data` | **需新增** | 低 |
| Project recommendation questions | `src/hooks/useRecommendedQuestionsInstruction.tsx` | `GET/POST /api/v1/project-recommendation-questions` | **需新增** | 低到中 |
| Home starter suggested questions | `src/pages/home/index.tsx` | `GET /api/v1/suggested-questions` | **需新增** | 低 |
| Chart pin to dashboard | `src/components/pages/home/promptThread/ChartAnswer.tsx` | `GET /api/v1/dashboards` + `POST /api/v1/dashboard-items` | list 已有 / create item 需新增 | 低到中 |

**Wave 0 完成标志**：

- `RuntimeScopeBootstrap` 不再触发 GraphQL bootstrap query
- settings 读取不再依赖 `useGetSettingsQuery`
- `previewData` / project recommendation / suggestedQuestions / dashboard pin 全部有 REST facade

## Wave 1：Home ask 主链路资源化（优先级 P1）

这波是 **Apollo 退役的关键战场**。

| 项目 | 文件 | 目标 REST | 后端状态 | 风险 |
| --- | --- | --- | --- | --- |
| 创建 thread | `src/pages/home/index.tsx` | `POST /api/v1/threads` | **需新增** | 中 |
| 创建 asking task | `src/pages/home/index.tsx`、`src/hooks/useAskPrompt.tsx` | `POST /api/v1/asking-tasks` | **需新增** | 中 |
| asking task 轮询 | `src/hooks/useAskPrompt.tsx` | `GET /api/v1/asking-tasks/:id` | **需新增** | 中 |
| cancel asking task | `src/hooks/useAskPrompt.tsx` | `POST /api/v1/asking-tasks/:id/cancel` | **需新增** | 中 |
| rerun asking task | `src/hooks/useAskPrompt.tsx` | `POST /api/v1/thread-responses/:id/rerun-asking-task` | **需新增** | 中 |
| instant recommended questions | `src/hooks/useAskPrompt.tsx` | `POST /api/v1/instant-recommended-questions` + `GET /api/v1/instant-recommended-questions/:taskId` | **需新增** | 中 |
| native SQL | `src/hooks/useNativeSQL.tsx` | `GET /api/v1/thread-responses/:id/native-sql` | **需新增** | 中 |
| adjust answer | `src/hooks/useAdjustAnswer.tsx` | `POST /api/v1/thread-responses/:id/adjust-answer` | **需新增** | 中 |
| adjustment task query / cancel / rerun | `src/hooks/useAdjustAnswer.tsx` | `GET /api/v1/adjustment-tasks/:id`、`POST /api/v1/adjustment-tasks/:id/cancel`、`POST /api/v1/thread-responses/:id/rerun-adjustment` | **需新增** | 中到高 |

**Wave 1 完成标志**：

- `src/pages/home/index.tsx`
- `src/hooks/useAskPrompt.tsx`
- `src/hooks/useAdjustAnswer.tsx`
- `src/hooks/useNativeSQL.tsx`
- `src/hooks/useResponsePreviewData.ts`
- `src/hooks/useRecommendedQuestionsInstruction.tsx`

以上文件全部不再依赖 generated GraphQL hook。

## Wave 2：Modeling / Setup / Deploy 收口（优先级 P2）

这是收益高、但风险明显更高的一波。  
建议在 Wave 0/1 落稳后再开始，且拆成多批 PR。

| 项目 | 文件 | 推荐 REST 面 | 后端状态 | 风险 |
| --- | --- | --- | --- | --- |
| diagram 读取 | `src/pages/modeling.tsx`、`src/hooks/useAutoComplete.tsx` | `GET /api/v1/diagram` 或 `GET /api/v1/models/runtime-graph` | **需新增统一面** | 高 |
| deploy status | `src/pages/modeling.tsx` | `GET /api/v1/deploy/status` | **需新增** | 中到高 |
| deploy action | `src/components/deploy/Deploy.tsx` | `POST /api/v1/deploy` | **需新增** | 中到高 |
| model CRUD | `src/pages/modeling.tsx` | `POST/PATCH/DELETE /api/v1/models` | **部分已存在，需要补齐写接口** | 高 |
| metadata 更新 | `src/pages/modeling.tsx` | `PATCH /api/v1/models/:id/metadata`、`PATCH /api/v1/views/:id/metadata` | **需新增** | 高 |
| calculated field validate / CRUD | `src/components/modals/CalculatedFieldModal.tsx`、`src/pages/modeling.tsx` | `/api/v1/calculated-fields/*` | **需新增** | 高 |
| relationship CRUD | `src/pages/modeling.tsx` | `/api/v1/relationships/*` | **需新增** | 高 |
| datasource tables | `src/hooks/useSetupModels.tsx`、`src/components/pages/modeling/form/ModelForm.tsx` | `GET /api/v1/data-source/tables` | **需新增** | 中 |
| save tables | `src/hooks/useSetupModels.tsx` | `POST /api/v1/models/import` 或 `POST /api/v1/setup/models` | **需新增** | 中 |
| save data source | `src/hooks/useSetupConnectionDataSource.tsx` | `PATCH /api/v1/settings/data-source` | **已存在** | 低 |
| auto-generated relations | `src/hooks/useSetupRelations.tsx` | `GET /api/v1/relationships/auto-generated` | **需新增** | 中 |
| save relations | `src/hooks/useSetupRelations.tsx` | `POST /api/v1/relationships/import` | **需新增** | 中 |
| schema change detect / resolve | `src/components/sidebar/modeling/ModelTree.tsx` | `GET /api/v1/schema-changes`、`POST /api/v1/schema-changes/detect`、`POST /api/v1/schema-changes/resolve` | **需新增** | 高 |
| SQL dialect substitute | `src/components/modals/ImportDataSourceSQLModal.tsx` | `POST /api/v1/sql/model-substitute` | **需新增** | 中 |

**Wave 2 完成标志**：

- Modeling / setup / deploy 页面不再直接依赖 generated GraphQL hook
- `_app.tsx` 中 ApolloProvider 只剩极少数兼容用途，或已经可以移除

## Wave 3：Apollo / GraphQL client 退役（优先级 P3）

当 Wave 0~2 完成后，才进入退役阶段：

1. 移除 `src/pages/_app.tsx` 中的 `ApolloProvider`
2. 删除页面层 `useQuery/useMutation/useLazyQuery/useApolloClient` 依赖
3. 清理 `src/apollo/client/graphql/*.generated.ts` 的运行时使用
4. 提取 `__types__` 中仍然需要的 enum / DTO 到 `src/types/*`
5. 评估 `src/pages/api/graphql.ts` 是否可以下线，或仅保留极窄兼容窗口
6. 最后再处理 resolver/schema 的真正删减

---

## 5. 详细迁移清单（按文件）

### 5.1 低风险 / 应先做

| 状态 | 文件 | 当前 GraphQL | 目标 REST helper / endpoint | 备注 |
| --- | --- | --- | --- | --- |
| [ ] | `src/components/runtimeScope/RuntimeScopeBootstrap.tsx` | `RUNTIME_SELECTOR_STATE` query | 直接复用 `buildRuntimeSelectorStateUrl()` + `fetch` | 已经有同域 REST hook，可直接共用 |
| [ ] | `src/components/learning/guide/index.tsx` | `useGetSettingsQuery` | `fetchSettings()` / `src/utils/settingsRest.ts` | 纯替换，低风险 |
| [ ] | `src/hooks/useNativeSQL.tsx` | `useGetSettingsQuery` | `fetchSettings()` / `src/utils/settingsRest.ts` | 只先替换 settings，不影响 native SQL 主体 |
| [ ] | `src/hooks/useResponsePreviewData.ts` | `PreviewDataDocument` mutation | 新增 `getThreadResponsePreviewData()` | 迁完后 ChartAnswer 不再依赖 Apollo client |
| [ ] | `src/hooks/useRecommendedQuestionsInstruction.tsx` | get/generate project recommendation questions | `projectRecommendationQuestionsRest.ts` | 可以对齐 thread recommendation 的 GET/POST 风格 |
| [ ] | `src/pages/home/index.tsx` | `SuggestedQuestions` | `getSuggestedQuestions()` | 这是 sample dataset 静态推荐，不必走 GraphQL |
| [ ] | `src/components/pages/home/promptThread/ChartAnswer.tsx` | `DASHBOARDS` + `CREATE_DASHBOARD_ITEM` | 复用 `dashboardRest.ts`，补 `createDashboardItem()` | Dashboard 主页面已 REST，别让 chart pin 成为尾巴 |

### 5.2 中风险 / Home ask 主链路

| 状态 | 文件 | 当前 GraphQL | 目标 REST helper / endpoint | 备注 |
| --- | --- | --- | --- | --- |
| [ ] | `src/pages/home/index.tsx` | `CreateThread` | `createThread()` -> `POST /api/v1/threads` | 线程创建应资源化 |
| [ ] | `src/pages/home/index.tsx` | `CreateAskingTask` | `createAskingTask()` -> `POST /api/v1/asking-tasks` | 任务创建应资源化 |
| [ ] | `src/hooks/useAskPrompt.tsx` | `AskingTask` lazy query | `getAskingTask(taskId)` | 轮询改 REST |
| [ ] | `src/hooks/useAskPrompt.tsx` | `CancelAskingTask` | `cancelAskingTask(taskId)` | 任务动作改 REST |
| [ ] | `src/hooks/useAskPrompt.tsx` | `RerunAskingTask` | `rerunAskingTask(responseId)` | 推荐挂在 thread response 动作上 |
| [ ] | `src/hooks/useAskPrompt.tsx` | instant recommended questions | `createInstantRecommendedQuestions()` / `getInstantRecommendedQuestions()` | 建议单独 task resource |
| [ ] | `src/hooks/useAdjustAnswer.tsx` | adjust/cancel/rerun adjustment | `adjustThreadResponseAnswer()` / `getAdjustmentTask()` / `cancelAdjustmentTask()` / `rerunAdjustmentTask()` | 需要明确 response 与 task 的边界 |
| [ ] | `src/hooks/useNativeSQL.tsx` | `GetNativeSQL` | `getThreadResponseNativeSql()` | 直接挂到 response resource 最自然 |

### 5.3 高风险 / Modeling 与 setup

| 状态 | 文件 | 当前 GraphQL | 目标 REST helper / endpoint | 备注 |
| --- | --- | --- | --- | --- |
| [ ] | `src/pages/modeling.tsx` | diagram + deploy status + model/metadata/calculated field/relationship CRUD | 分多批 helper：`diagramRest`、`deployRest`、`modelWriteRest`、`relationshipRest`、`calculatedFieldRest` | 不要一口气大改 |
| [ ] | `src/components/deploy/Deploy.tsx` | `useDeployMutation` | `deployRest.deploy()` | 先独立拆出 deploy 即可 |
| [ ] | `src/components/modals/CalculatedFieldModal.tsx` | validate calculated field | `calculatedFieldRest.validate()` | 可先单独迁 |
| [ ] | `src/components/modals/ImportDataSourceSQLModal.tsx` | model substitute | `sqlModelSubstituteRest.substitute()` | 独立能力，适合早拆 |
| [ ] | `src/hooks/useSetupConnectionDataSource.tsx` | `useSaveDataSourceMutation` | 复用 `/api/v1/settings/data-source` | 这里其实已经有现成 REST |
| [ ] | `src/hooks/useSetupModels.tsx` | list tables + save tables | `dataSourceTableRest.list()` + `setupModelRest.save()` | 需要先补 route |
| [ ] | `src/hooks/useSetupRelations.tsx` | auto generate + save relations | `relationshipRest.getRecommendations()` + `relationshipRest.import()` | 建议与 setup 独立 |
| [ ] | `src/hooks/useAutoComplete.tsx` | diagram query | 复用 diagram REST | 建模辅助能力 |
| [ ] | `src/components/pages/modeling/form/ModelForm.tsx` | list datasource tables | 复用 datasource tables REST | 与 setup 共用同一 helper |
| [ ] | `src/components/sidebar/modeling/ModelTree.tsx` | schema change query/detect/resolve | `schemaChangeRest.*` | 必须先设计资源边界 |

### 5.4 基础设施最终退役

| 状态 | 文件 | 处理 |
| --- | --- | --- |
| [ ] | `src/pages/_app.tsx` | 移除 `ApolloProvider` |
| [ ] | `src/apollo/client/index.ts` | 仅在没有运行时依赖后删除 |
| [ ] | `src/pages/api/graphql.ts` | 等剩余客户端全部迁走后评估下线 |
| [ ] | `src/apollo/client/graphql/*.generated.ts` | 逐步停止运行时引用，最后再删 |
| [ ] | `src/apollo/client/graphql/__types__.ts` | 提取共享 enum/DTO 后再删 |

---

## 6. 建议新增 / 补齐的 REST endpoint 清单

> 这里区分“已经存在，可复用”与“建议新增”。

### 6.1 已存在，可直接复用

- `GET /api/v1/runtime/scope/current`
- `GET /api/v1/settings`
- `PATCH /api/v1/settings/data-source`
- `GET /api/v1/dashboards`
- `GET /api/v1/threads`
- `GET /api/v1/threads/:id`
- `POST /api/v1/threads/:id/responses`
- `GET /api/v1/thread-responses/:id`
- `POST /api/v1/thread-responses/:id/generate-answer`
- `POST /api/v1/thread-responses/:id/generate-chart`
- `POST /api/v1/thread-responses/:id/adjust-chart`
- `GET /api/v1/thread-recommendation-questions/:id`
- `POST /api/v1/thread-recommendation-questions/:id`
- `GET /api/v1/knowledge/bases`
- `GET /api/v1/knowledge/diagram`
- `GET/POST/PATCH/DELETE /api/v1/knowledge/instructions/*`
- `GET/POST/PATCH/DELETE /api/v1/knowledge/sql_pairs/*`
- `GET /api/v1/api-history`
- `GET /api/v1/onboarding/status`
- `GET /api/v1/learning`

### 6.2 建议新增（按优先级）

#### P0

- `GET /api/v1/suggested-questions`
- `GET /api/v1/thread-responses/:id/preview-data`
- `GET /api/v1/project-recommendation-questions`
- `POST /api/v1/project-recommendation-questions`
- `POST /api/v1/dashboard-items`

#### P1

- `POST /api/v1/threads`
- `POST /api/v1/asking-tasks`
- `GET /api/v1/asking-tasks/:id`
- `POST /api/v1/asking-tasks/:id/cancel`
- `POST /api/v1/thread-responses/:id/rerun-asking-task`
- `POST /api/v1/instant-recommended-questions`
- `GET /api/v1/instant-recommended-questions/:taskId`
- `GET /api/v1/thread-responses/:id/native-sql`
- `POST /api/v1/thread-responses/:id/adjust-answer`
- `GET /api/v1/adjustment-tasks/:id`
- `POST /api/v1/adjustment-tasks/:id/cancel`
- `POST /api/v1/thread-responses/:id/rerun-adjustment`

#### P2

- `GET /api/v1/deploy/status`
- `POST /api/v1/deploy`
- `GET /api/v1/data-source/tables`
- `POST /api/v1/models/import`
- `GET /api/v1/relationships/auto-generated`
- `POST /api/v1/relationships/import`
- `GET /api/v1/schema-changes`
- `POST /api/v1/schema-changes/detect`
- `POST /api/v1/schema-changes/resolve`
- `POST /api/v1/sql/model-substitute`
- `POST /api/v1/calculated-fields/validate`
- `POST/PATCH/DELETE /api/v1/models`
- `PATCH /api/v1/models/:id/metadata`
- `PATCH /api/v1/views/:id/metadata`
- `POST/PATCH/DELETE /api/v1/relationships`
- `POST/PATCH/DELETE /api/v1/calculated-fields`

---

## 7. 实施顺序建议

### 7.1 最佳顺序

1. **Wave 0 全做完**：因为这些都是现成 REST 周边或低风险 facade。
2. **Home ask 整体切一波**：不要把 `pages/home/index.tsx`、`useAskPrompt.tsx`、`useAdjustAnswer.tsx` 分得过碎，否则会长期双栈。
3. **Modeling 分专题拆**：deploy、datasource tables、calculated field validate、schema change，按专题拆多批。
4. **最后再 Apollo 退役**：只有当客户端 runtime query/mutation 清零后再动 `_app.tsx`。

### 7.2 不推荐顺序

- 不要先动 `modeling.tsx` 主页面大一统改造
- 不要先删 `ApolloProvider`
- 不要边迁 Home ask 边继续新增 GraphQL endpoint
- 不要把类型清理和运行时迁移混成一个 PR

---

## 8. 完成判定（Definition of Done）

迁移完成至少要满足以下条件：

### 8.1 Wave 0 完成

- `RuntimeScopeBootstrap` 不再走 GraphQL
- settings 读取全部改 REST
- preview data / suggested questions / project recommendation / dashboard pin 都有 REST facade

### 8.2 Wave 1 完成

- `home/index.tsx`、`useAskPrompt.tsx`、`useAdjustAnswer.tsx`、`useNativeSQL.tsx` 不再 import generated GraphQL hook
- Home 新对话与线程详情主链路不再依赖 Apollo cache update

### 8.3 Wave 2 完成

- Modeling / setup / deploy 页面不再直接依赖 generated GraphQL hook

### 8.4 最终退役完成

- `rg -n "@/apollo/client/graphql/.+generated|useQuery\(|useMutation\(|useLazyQuery\(|useApolloClient\(|apolloClient\.query|apolloClient\.mutate" wren-ui/src --glob '!**/*.test.*'`
  - 结果应只剩测试、或为 **0**
- `_app.tsx` 可移除 `ApolloProvider`
- `src/pages/api/graphql.ts` 有清晰下线计划或已下线

---

## 9. 建议自检命令

```bash
# 运行时 GraphQL 入口
cd wren-ui
rg -n "@/apollo/client/graphql/.+generated|useQuery\(|useMutation\(|useLazyQuery\(|useApolloClient\(|apolloClient\.query|apolloClient\.mutate" src --glob '!**/*.test.*'

# GraphQL 类型残留（不一定是 blocker，但能看最终退役范围）
rg -n "@/apollo/client/graphql/__types__" src --glob '!**/*.test.*'

# 已有 REST facade
find src/pages/api/v1 -maxdepth 3 -type f | sort
ls src/utils/*Rest.ts
```

---

## 10. 一句话结论

**现在最该做的不是“把所有 GraphQL 一次删掉”，而是：先把 Runtime bootstrap、settings、preview、推荐问题、dashboard pin 这些 P0 尾巴收口；再把 Home ask 主链路整体资源化；最后再处理 Modeling 和 Apollo 退役。**
