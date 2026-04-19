# Frontend Route Inventory — 2026-04-18

对应 backlog：`docs/frontend-architecture-backlog-2026-04-18.md` Wave 0 / Wave 1。

## 目标

明确 `wren-ui/src/pages` 中哪些文件是 route entry，哪些对象已经迁出或需要保持为 route 兼容层，避免后续继续把业务组件塞回 `pages/`。

## 结论

### 1. 页面路由入口（UI）

以下目录保留为页面入口：

- `src/pages/index.tsx`
- `src/pages/auth.tsx`
- `src/pages/register.tsx`（兼容 alias）
- `src/pages/home/index.tsx`
- `src/pages/home/[id].tsx`
- `src/pages/home/dashboard.tsx`
- `src/pages/knowledge/index.tsx`
- `src/pages/modeling.tsx`（兼容 redirect）
- `src/pages/workspace.tsx`
- `src/pages/workspace/schedules.tsx`（兼容 alias）
- `src/pages/settings.tsx`
- `src/pages/settings/*`
- `src/pages/api-management/history.tsx`（兼容 alias）

### 2. 已迁出、不得回流到 `pages/` 的知识库业务组件

已迁出目标：

- `src/features/knowledgePage/sections/AssetDetailContent.tsx`
- `src/features/knowledgePage/sections/KnowledgeMainStage.tsx`
- `src/features/knowledgePage/modals/AssetWizardModal.tsx`
- `src/features/knowledgePage/modals/KnowledgeBaseModal.tsx`

页面 `src/pages/knowledge/index.tsx` 现在只负责：

- route 参数解析
- runtime scope / workbench state orchestration
- 组合 feature section / modal

### 2.5 settings 页面辅助组件已迁入 feature 目录

此前残留在 `src/components/pages/settings/*` 的身份健康 helper 已迁移到：

- `src/features/settings/identity/identityHealth.ts`

当前 `src/components/pages/settings` 已无运行时文件，不再作为 settings 域的 feature 容器。

### 3. API route 目录中的非 route helper

为降低 `pages/api/v1` 污染，以下 helper 已迁移到 `src/server/api/`：

- `src/server/api/apiContext.ts`
- `src/server/api/restApi.ts`
- `src/server/api/dashboardRestShared.ts`
- `src/server/api/threadPayloadSerializers.ts`

`src/pages/api/v1/*` 只保留真正的 API handler 文件；测试目录 `src/pages/api/tests/*` 仍为遗留测试放置方式，后续可继续并入 `src/tests/pages/api`。

## 当前约束

### pages 目录规则

1. `src/pages/**` 只允许：
   - route entry
   - compatibility / redirect route
   - API handler
2. 页面子组件、modal、drawer、section：
   - 放到 `src/features/<domain>/...`
   - 或 `src/components/...`
3. API route 的共享 helper：
   - 放到 `src/server/api/...`
   - 不再放在 `src/pages/api/v1` 下

## Owner / 目标位置

| 对象类型 | 当前 owner | 目标位置 |
|---|---|---|
| 知识库业务 section | knowledge domain | `src/features/knowledgePage/sections/*` |
| 知识库业务 modal | knowledge domain | `src/features/knowledgePage/modals/*` |
| API route shared helper | server/api | `src/server/api/*` |
| route alias / redirect | route layer | `src/pages/*`（仅保留薄壳） |

## 剩余注意项

- `src/pages/api/tests/*` 仍在 `pages` 目录内，是测试遗留结构，不是运行时 route 污染。
- `src/pages/modeling.tsx`、`src/pages/register.tsx`、`src/pages/settings/access.tsx`、`src/pages/settings/security.tsx`、`src/pages/workspace/schedules.tsx`、`src/pages/api-management/history.tsx` 仍是兼容入口，详见 legacy route inventory。
