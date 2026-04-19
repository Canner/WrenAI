# Frontend Request / Cache Convergence — 2026-04-18

对应：`docs/frontend-architecture-backlog-2026-04-18.md` Wave 4。

## 目标

把前端的读取型请求状态机尽量收口到统一原语，同时明确哪些 hook 暂时属于有意保留的例外。

## 当前决策

### 1. 已直接落到 `useRestRequest`

- `useApiHistoryList`
- `useSkillsControlPlaneData`
- `useHomeSidebar` 的线程读取主链路（仅 GET `/api/v1/threads`）
- `features/settings/connectors/useConnectorCatalog` 的连接器列表读取主链路（request-key / payload normalize helper 已下沉到 connectors utils；`useManageConnectorsPage` 仅消费 feature hook，且已有 hook/page 双层回归测试）

说明：`useHomeSidebar` 目前是**部分收口**。
它的读取请求已复用 `useRestRequest`，且 threads request key 已抽到纯 helper；但以下语义继续保留在 hook 本地：

- `sessionStorage` warm cache / TTL
- defer initial load
- load on intent
- network-only refetch
- rename / delete mutation orchestration

这是刻意保留的过渡形态，不再把 `useRestRequest` 硬扩成一个超重的“全能缓存框架”。

### 2. 保留为 intentional exception

#### `useAuthSession`

保留理由：

- 需要跨组件共享 TTL cache
- 需要 in-flight request dedupe
- shell / auth status / runtime bootstrap 都会并发读取
- 语义上更接近“全局会话缓存层”，不是单个页面 hook 的普通读取请求

当前收口动作：

- 抽出统一 fresh-cache 读取 helper
- 保留 `loadAuthSessionPayload` / `prefetchAuthSessionPayload` / `clearAuthSessionCache`
- 不强行把这层塞进普通 `useRestRequest`

#### `useKnowledgeBaseLifecycle`

保留理由：

- 本质是 mutation orchestration，不是 read hook
- 涉及表单校验、toast、list invalidation、runtime selector refetch、路由跳转
- 更适合未来单独抽 `useRestMutation` / `useAsyncAction`，而不是复用读请求原语

## 统一约定

### 默认规则

新增的**读取型** hook，优先使用：

- `useRestRequest`

除非它满足以下任一条件：

- 需要跨组件共享缓存 + in-flight dedupe
- 需要持久化到 storage 的 warm cache / intent gating
- 本质是 mutation / orchestration hook

### cache key / TTL 命名约定

- storage key 前缀用域名，例如：`wren.homeSidebar:*`
- shared in-memory cache 用 `<domain>Cache` / `<domain>RequestCache`
- TTL 常量统一命名：`*_CACHE_TTL_MS`

### 错误反馈约定

- 用户主动触发的失败：toast / inline error
- 后台预取失败：允许静默或轻量 fallback
- abort / superseded request：不视为错误

## 后续动作

1. 继续把普通读取 hook 收口到 `useRestRequest`
2. 如 mutation hook 重复增多，再单独引入 `useRestMutation`
3. 不把 `useRestRequest` 扩成会话缓存框架；auth/session 继续走专门缓存层
