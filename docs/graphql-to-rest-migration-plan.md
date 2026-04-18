# GraphQL → REST 迁移方案与清单

> 更新时间：2026-04-16  
> 适用范围：`wren-ui` 运行时前端、`wren-ui` API/BFF、`wren-ai-service` 对 `wren-ui` 的内部调用链、以及相关文档/测试清理。

## 0. 结论先说

截至 **2026-04-16**，这份文档已经不再是“前端迁移计划草案”，而是：

1. **已完成迁移的验收快照**
2. **剩余 GraphQL 相关残留的收尾计划**
3. **后续真正需要继续做的清单**

当前最新事实：

- `wren-ui/src` 里的**运行时前端 GraphQL / Apollo 客户端引用已清零**
- `src/pages/_app.tsx` 已经**没有 `ApolloProvider`**
- `wren-ui/src/pages/api/graphql.ts` 已经**不存在**
- `wren-ui/src/apollo/` 目录已经**不存在**
- `home / thread / dashboard / knowledge / workspace / settings / runtime scope / modeling` 页面主链都已经走 REST helper / REST route
- `wren-ai-service` 对 `wren-ui` 的内部调用也已经切到 internal REST

因此，迁移主任务已经完成；后续重点不再是“继续把 UI 从 GraphQL 迁走”，而是：

1. 继续清理历史文档、旧路径和遗留说明
2. 同步压缩 controller / 注释里的 GraphQL 历史语义
3. 保持新增 server-to-server 调用继续走 REST / internal REST

---

## 1. 已验证的当前状态

### 1.1 `wren-ui` 前端运行时状态

已验证事实：

- `rg -n '@/apollo/client/graphql/.+generated|useQuery\(|useMutation\(|useLazyQuery\(|useApolloClient\(|apolloClient\.query|apolloClient\.mutate|ApolloProvider' wren-ui/src`
  - 结果：**0 命中**
- `wren-ui/src/pages/_app.tsx`
  - 结果：仅保留 `GlobalConfigProvider`、`PostHogProvider`、`RuntimeScopeBootstrap`、`RuntimeSelectorStateProvider`
  - **无 `ApolloProvider`**
- `wren-ui/src/pages/api/graphql.ts`
  - 结果：**文件不存在**
- `wren-ui/src/apollo`
  - 结果：**目录不存在**
- `@/apollo/client/graphql/__types__`、generated GraphQL hooks
  - 运行时代码中已不再引用

### 1.2 当前剩余的 GraphQL 代码残留

当前真正还在跑 `/api/graphql` 的业务代码：**无**。

最新已完成收口：

| 分组 | 文件 | 当前状态 |
| --- | --- | --- |
| ai-service internal call | `wren-ai-service/src/providers/engine/wren.py` | 已切到 `POST /api/v1/internal/sql/preview` |
| ai-service internal call | `wren-ai-service/src/force_deploy.py` | 已切到 `POST /api/v1/internal/deploy` |
| pytest | `wren-ai-service/tests/pytest/providers/test_wren_engine.py` | 已改为断言 internal REST URL / payload |

### 1.3 已不再需要继续推进的旧波次

下面这些原计划波次，按最新代码看都已经完成：

- Runtime bootstrap 改 REST
- Home / thread / dashboard / knowledge rules 改 REST
- Runtime scope bootstrap 改 REST
- ApolloProvider 退役
- 运行时 generated hooks / `@/types/api` 清理
- `wren-ui` 前端 GraphQL client 主链退役

也就是说：**前端 UI 侧 GraphQL → REST 迁移已完成，不需要再按旧文档继续做 Wave 0 / Wave 1 / Wave 2。**

---

## 2. 迁移完成面（已完成）

### 2.1 前端 / 页面层

| 状态 | 区域 | 说明 |
| --- | --- | --- |
| [x] | `_app.tsx` | `ApolloProvider` 已移除 |
| [x] | runtime scope bootstrap | 已走 `GET /api/v1/runtime/scope/current` |
| [x] | home ask / thread detail | 已走 REST helper / REST polling |
| [x] | dashboard | 已走 REST route / helper |
| [x] | knowledge bases / instructions / sql pairs | 已走 REST |
| [x] | workspace / settings / connectors / skills | 已走 REST |
| [x] | modeling 主链 | 当前运行时客户端已不再直接依赖 Apollo / GraphQL hooks |

### 2.2 基础设施层

| 状态 | 项目 | 说明 |
| --- | --- | --- |
| [x] | `src/pages/api/graphql.ts` | 已删除 |
| [x] | `src/apollo/` | 已删除 |
| [x] | runtime generated GraphQL hooks | 已不再被运行时代码引用 |
| [x] | `@/types/api` | 已拆分/清零 |

### 2.3 文档层（持续进行中）

| 状态 | 项目 | 说明 |
| --- | --- | --- |
| [x] | 活跃操作文档 | 已改成当前 REST 主链与真实测试路径 |
| [x] | 历史设计/closeout/backlog 文档 | 已补“历史说明”横幅，避免误导为当前实现 |
| [ ] | 全量历史文案收尾 | 仍可继续逐步压缩 GraphQL/Apollo 旧表述 |

---

## 3. 最新收尾清单

## P0（已完成）：ai-service SQL preview internal REST 化

已完成项：

| 状态 | 文件 | 动作 |
| --- | --- | --- |
| [x] | `wren-ui/src/pages/api/v1/internal/sql/preview.ts` | 新增 internal REST preview endpoint |
| [x] | `wren-ui/src/server/controllers/modelController.ts` | 复用 `previewSql` 逻辑并保留 internal ai-service header 语义 |
| [x] | `wren-ai-service/src/providers/engine/wren.py` | 从 `/api/graphql` 改到 internal REST endpoint |
| [x] | `wren-ai-service/tests/pytest/providers/test_wren_engine.py` | URL / payload / header 断言已更新 |

当前 internal preview contract：

```json
{
  "data": { "columns": [], "data": [] },
  "correlationId": "..."
}
```

失败时：

```json
{
  "error": {
    "message": "...",
    "dialectSql": "...",
    "plannedSql": "..."
  },
  "correlationId": "..."
}
```

## P1（已完成）：force deploy REST 化

已完成项：

| 状态 | 文件 | 动作 |
| --- | --- | --- |
| [x] | `wren-ui/src/pages/api/v1/internal/deploy.ts` | 新增 internal force-deploy route |
| [x] | `wren-ui/src/pages/api/v1/deploy/index.ts` | 用户态 deploy route 继续保持非 force 语义 |
| [x] | `wren-ai-service/src/force_deploy.py` | 改成 internal REST 调用 |
| [x] | `wren-ui/src/pages/api/tests/internal_deploy_api.test.ts` | 新增 route 覆盖 |

---

## P2：测试与文档收尾

### 测试

| 状态 | 文件 | 动作 |
| --- | --- | --- |
| [ ] | `wren-ai-service/tests/pytest/providers/test_wren_engine.py` | 断言 REST endpoint，必要时补 dryRun/error metadata case |
| [ ] | `wren-ui` 对应 internal route tests | 覆盖 internal header、runtimeScopeId、dryRun、错误元数据 |
| [ ] | `force_deploy` 相关测试（如补） | 覆盖 `force: true` |

### 文档

| 状态 | 文件/范围 | 动作 |
| --- | --- | --- |
| [x] | `docs/` 活跃操作文档 | 已切换到 REST 主链说明 |
| [x] | 历史文档横幅 | 已补齐主要历史文档 |
| [ ] | `docs/` 继续清理 GraphQL/Apollo 旧措辞 | 逐步压缩为“历史实现”表述 |

---

## 4. 推荐执行顺序（最新）

按现在的代码状态，建议顺序已经变成：

1. **先清历史文档 / 注释残留**
   - 避免读代码的人还被 GraphQL/Apollo 旧说法误导
2. **再压缩 controller / helper 里的 GraphQL 命名残留**
   - 比如 `resolver`、`args/root/ctx` 风格表述
3. **最后做历史归档/删除**
   - 例如进一步归档旧 GraphQL closeout 文档，或缩掉历史说明中的细节段落

---

## 5. Definition of Done（最新口径）

迁移真正完成，至少需要满足：

### 5.1 UI / 前端

- [x] `wren-ui/src` 运行时代码中不再出现 Apollo / generated GraphQL hooks
- [x] `_app.tsx` 中无 `ApolloProvider`
- [x] `src/pages/api/graphql.ts` 不存在
- [x] `src/apollo/` 不存在

### 5.2 server-to-server

- [x] `wren-ai-service/src/providers/engine/wren.py` 不再打 `/api/graphql`
- [x] `wren-ai-service/src/force_deploy.py` 不再打 `/api/graphql`
- [x] repo 中非文档、非测试代码不再出现 `/api/graphql`

### 5.3 测试与文档

- [x] pytest / route tests 已切到 REST 端点
- [ ] 活跃文档不再把 GraphQL/Apollo 描述成当前主链
- [ ] GraphQL/Apollo 仅作为历史说明或完全消失

---

## 6. 建议自检命令（按最新状态）

```bash
# 1) wren-ui 运行时 GraphQL 客户端应为 0
cd /Users/liyi/Code/WrenAI
rg -n '@/apollo/client/graphql/.+generated|useQuery\(|useMutation\(|useLazyQuery\(|useApolloClient\(|apolloClient\.query|apolloClient\.mutate|ApolloProvider' wren-ui/src --glob '!**/*.test.*' --glob '!**/*.spec.*'

# 2) repo 中剩余 /api/graphql 引用（理想状态只剩文档或 0）
rg -n '/api/graphql' wren-ui wren-ai-service --glob '!**/node_modules/**' --glob '!**/.next/**'

# 3) GraphQL/Apollo 文档残留（非 archive）
rg -n 'GraphQL|Apollo|resolver' docs --glob '!docs/archive/**'

# 4) internal preview / deploy 已切完后，/api/graphql 应只剩历史文档，或完全为 0
```

---

## 7. 一句话总结

**GraphQL → REST 的运行时迁移已经完成；现在真正剩下的主要是历史文档、命名残留与收尾清理，而不是业务主链迁移。**
