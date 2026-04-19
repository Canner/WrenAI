# Frontend Legacy Route Inventory — 2026-04-18

对应 backlog：`docs/frontend-architecture-backlog-2026-04-18.md` Wave 0 / Wave 6。

## 目标

建立 canonical route 体系，记录兼容路由的当前调用方、删除门槛与处理策略。

## 路由清单

| Legacy / compatibility route | Canonical route | 当前用途 | 删除门槛 | 当前处理 |
|---|---|---|---|---|
| `/register` | `/auth` | 历史登录/注册入口兼容 | 确认无外部入口或旧书签需求 | 保留薄 alias |
| `/settings/access` | `/settings/users` | 历史访问控制入口兼容 | 确认无旧书签 / 外链 / 测试依赖 | 保留薄 alias |
| `/settings/security` | `/settings` | 历史安全设置入口兼容 | 确认无旧书签 / 外链 / 测试依赖 | 保留 server redirect |
| `/api-management/history` | `/settings/diagnostics` | 历史 API 管理页入口兼容 | 确认侧边栏/外链都切走 | 保留薄 alias |
| `/settings/workspace` | `/workspace` | 工作空间管理旧入口 | 确认无内部 hardcode / 收藏链接 | 保留薄 alias |
| `/workspace/schedules` | `/settings/system-tasks` | 系统任务 / 调度旧入口 | 确认无导航/外链使用 | 保留薄 alias |
| `/modeling` | `/knowledge?section=modeling` | 语义建模兼容跳转 | 确认所有入口都已走知识库工作台 | 保留 runtime-aware redirect helper |
| `/api/ask_task/streaming` | `/api/v1/asking-tasks/[id]/stream` | 旧 SSE ask stream API | 确认客户端/外部集成都不再调用 | 保留兼容 wrapper，并发送 `Deprecation` + `Link` header |
| `/api/ask_task/streaming_answer` | `/api/v1/thread-responses/[id]/stream-answer` | 旧 SSE answer stream API | 同上 | 保留兼容 wrapper，并发送 `Deprecation` + `Link` header |
| `/api/v1/settings/data-source` | `/api/v1/settings/connection` | 历史 settings alias | 代码内无调用 | **已删除** |
| `/api/v1/data-source/tables` | `/api/v1/connection/tables` | 历史连接表查询 alias | 确认无外部调用 / 本地脚本迁移完毕 | 保留 compatibility wrapper，直接调用 controller + 返回 deprecation header |

## 当前调用方说明

### `/modeling`
当前已切走 stale E2E helper / runtime deep-link cleanup；兼容路径语义已集中到
`src/utils/knowledgeWorkbench.ts` 的 shared helper，`src/pages/modeling.tsx`
现已收口为指向 `src/features/modeling/ModelingCompatibilityRedirectPage.tsx`
的薄 route entry；redirect 实现继续复用
`src/utils/compatibilityRoutes.tsx` 的 runtime-aware helper，不再手写 route
entry 级跳转副作用。相关消费点仍包括：

- `src/utils/knowledgeWorkbench.ts`
- `src/hooks/useRuntimeScopeNavigation.tsx`
- `src/components/HeaderBar.tsx`
- `src/components/sidebar/index.tsx`
- `src/components/learning/index.tsx`
- `src/utils/brandMeta.ts`
- `src/utils/enum/path.ts`

策略：继续保留 redirect 页，等工作台/导航全量切走后再删除。

### ask streaming legacy routes
客户端已优先使用 canonical v1 路径：

- `src/utils/homeRest.ts`
- `src/utils/threadRest.ts`

策略：兼容层继续保留，但显式返回 deprecation header，后续可统计流量后移除。
当前 `Deprecation` / `Link` / `Warning` header 语义已统一收敛到
`src/server/api/compatibilityApi.ts`。

### `/api/v1/data-source/tables`

当前 repo 运行时代码已统一改用 canonical route：

- `src/utils/modelingRest.ts`

仍保留 alias 的原因：

- 兼容潜在外部调用方 / 旧脚本
- `wren-ui/tmp/ui_init_workspaces.cjs` 仍引用旧路径（非运行时产物，不作为保留门槛）

策略：兼容层不再 `export ... from '../connection/tables'`，而是直接调用
controller 并附带 deprecation header；待确认无外部流量 / 本地脚本迁移完成后删除。
最小验证：`src/pages/api/tests/data_source_tables_api.test.ts` 覆盖 alias
成功返回与 deprecation header 语义，避免 route-to-route alias 回归。

### `/settings/access` / `/settings/security`

- `/settings/access` 当前仍由以下用例覆盖：
  - `e2e/specs/settings-routes.spec.ts`
  - `src/tests/pages/settings/access.test.tsx`
- `/settings/security` 当前作为 server-side redirect 保留：
  - `e2e/specs/settings-routes.spec.ts`
  - `src/pages/settings/security.tsx`

策略：两者都视为兼容入口，不再允许新增内部导航依赖。

### `/settings/workspace` / `/api-management/history`

当前内部导航已切回 canonical route：

- 工作空间页统一走 `/workspace`
- API 历史入口统一走 `/settings/diagnostics`

兼容 route 当前直接复用 feature page：

- `src/pages/register.tsx` -> `src/features/auth/AuthPage.tsx`
- `src/pages/settings/access.tsx` -> `src/features/settings/users/ManageUsersPage.tsx`
- `src/pages/settings/workspace.tsx` -> `src/features/workspace/ManageWorkspacePage.tsx`
- `src/pages/workspace/schedules.tsx` -> `src/features/settings/systemTasks/ManageSystemTasksPage.tsx`
- `src/pages/api-management/history.tsx` -> `src/features/settings/diagnostics/ManageDiagnosticsPage.tsx`

策略：继续保留 alias 以兼容旧书签，但新增入口必须直连 canonical route，且兼容
层不再依赖其他 route entry。

## 标准化废弃流程

1. 如果保留 compatibility route：
   - 只允许薄 alias / redirect / wrapper
   - UI 页面优先复用 `wren-ui/src/utils/compatibilityRoutes.tsx` 共享 helper
   - API 兼容层继续使用 deprecation header
2. 如果 canonical route 已全量落地且 repo 内无调用：
   - 直接删除 alias
3. 删除前至少满足：
   - repo 内无直接调用
   - e2e / smoke 已验证 canonical route 正常
   - 文档 inventory 已更新
