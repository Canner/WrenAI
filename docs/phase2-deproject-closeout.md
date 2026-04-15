# Phase 2 De-project Cutover Closeout

更新时间：2026-04-07

## 最新验证状态

本轮 closeout 完成后已再次执行：

- `wren-ui`: `yarn test --runInBand`
  - **73 suites passed / 506 tests passed**
- `wren-ai-service`: `.venv/bin/pytest`
  - **210 passed / 26 skipped**
- `bash misc/scripts/scan-current-project.sh`
  - `no getCurrentProject() usage found`
- `bash misc/scripts/scan-runtime-identity.sh`
  - `only allowlisted bridge usages remain`
  - `runtime identity contract checks passed`

说明：

- `projectId / project_id` 的剩余命中当前主要集中在：
  - DB schema / repository 字段
  - legacy request compatibility
  - deploy / onboarding / reset 等真实 project 主键路径
- runtime 主链未再依赖 `getCurrentProject()`
- canonical runtime 读路径已经稳定在 `workspaceId / knowledgeBaseId / kbSnapshotId / deployHash`

2026-04-07 补充：

- repository / service / resolver / utils 的 bridge-only helper 已继续收口
- route / resolver / runtime helper 不再新增新的 `getCurrentProject()` 或 pipeline legacy parameter
- 最新 repo-wide 扫描后，剩余命中已基本可归类为：
  - 领域主键
  - schema / repository 列
  - adaptor 兼容协议
  - allowlisted bridge helper

2026-04-07 repo-wide inventory（最新）：

- 本轮继续完成：
  - `asking / adjustment` 的 `runtimeScopeId-first` 收口
  - `modelResolver` 主路径统一走 `runtimeIdentity-first`
  - `modelService` 的 scoped wrapper 进一步委托 runtime-aware API
  - `dashboardResolver / runtimeExecutionContext / dashboardRuntime`
    的 project bridge fallback helper 收口到 shared utility
- `modelResolver` 已统一复用 shared runtime identity helper（canonical normalize / persisted patch / bridge fallback），主路径继续保持 runtimeIdentity-first
- `modelService` 已继续压缩 legacy scoped wrapper：scoped 入口统一桥接到 runtime-aware API，关系/视图/字段校验 helper 进一步向 shared runtime identity 语义靠拢
- `mdlService` 已将 runtime identity lookup / project recovery 的局部类型与 helper 命名进一步收口，project fallback 仍保留在 manifest/deploy 恢复边界
- `deployService` 已继续缩小 runtime lookup 类型与 canonical deploy lookup helper，deploy log 仍保持真实 `projectId` 作为存储锚点
- `projectResolver / runtimeScope / persistedRuntimeIdentity` 已继续复用 shared canonical helper，并把 legacy project bridge 读取/选择器构造进一步收口到内部 helper
- `modelService / modelResolver` 第二轮收口已完成：modelResolver 直接复用 scope->canonical helper，modelService 将多处 project-domain 参数名进一步明确为 legacy project bridge 语义，热点继续下降
- 重新扫描后的热点命中（含测试）主要集中在：
  - `wren-ui/src/apollo/server/services/modelService.ts`
  - `wren-ui/src/apollo/server/services/deployService.ts`
  - `wren-ui/src/apollo/server/context/runtimeScope.ts`
  - `wren-ui/src/apollo/server/services/mdlService.ts`
  - `wren-ui/src/apollo/server/services/dashboardService.ts`
  - `wren-ui/src/apollo/server/resolvers/modelResolver.ts`
- 这些热点里的剩余命中，已经越来越集中到：
  1. 真实领域主键 / 持久化字段
  2. legacy scoped API 包装层
  3. runtimeScope 兼容输入桥
  4. dashboard / deploy / mdl 的 fallback-only helper

当前统计观察（repo-wide 粗扫）：

- 最新热点计数（2026-04-07 当前轮次后）：
  - `modelService.ts` → `69`
  - `runtimeScope.ts` → `35`
  - `mdlService.ts` → `27`
  - `persistedRuntimeIdentity.ts` → `23`
  - `modelResolver.ts` → `23`
  - `projectResolver.ts` → `17`
  - `deployService.ts` → `11`
  - `dashboardRuntime.ts` → `10`
  - `runtimeExecutionContext.ts` → `6`

- `modelService.ts` 仍是第一热点，但多数是：
  - scoped wrapper 参数名
  - relation/view/model 的真实 `projectId` 持久化字段
  - 旧 API 兼容壳
- `deployService.ts` 剩余命中大多属于：
  - deploy log 以 `projectId` 为存储锚点
  - delete / in-progress / last-deploy 等按项目主键读取的领域逻辑
- `mdlService.ts` 剩余命中大多属于：
  - 从 deployment/models 恢复真实项目实体
  - manifest-backed project recovery
- `dashboardRuntime.ts / dashboardResolver.ts / runtimeExecutionContext.ts`
  已从“手写 fallback”进一步收口为 shared helper 驱动，现阶段剩余命中基本可接受
- `runtimeScope.ts` 仍是 Phase 2 后段最大兼容桥：
  - `legacyProjectId`
  - body/header/query 兼容输入
  - `kbSnapshot.legacyProjectId` / `deployment.projectId` 协调
  这部分不应在 protocol 全切完之前激进删除

## 结论

当前仓库的 **runtime 主语义** 已基本切到：

- `workspaceId`
- `knowledgeBaseId`
- `kbSnapshotId`
- `deployHash`

`projectId` 现在主要剩在以下三类位置：

1. **必须保留**
   - 项目实体主键 / repository schema 字段
   - deploy write path / 删除 path / onboarding path
   - 旧数据兼容桥
2. **已收口但仍有文本命中**
   - canonical runtime helper / fallback path
   - resolver/service 内部的 bridge-only 分支
3. **后续可继续收口**
   - 命名层面的 `projectId` -> `projectBridgeId`
   - 扫描脚本扩展为“分层校验”而不是只做 allowlist

---

## 已完成的主链收口

- `runtimeScope`
- `deployService`
- `deployLogRepository`
- `dashboardRuntime`
- `dashboardResolver`
- `runtimeExecutionContext`
- `askingService`
- `askingTaskTracker`
- `projectResolver`
- `mdlService`
- `modelService`
- `instructionService`
- `sqlPairService`
- `dashboardService`
- `askingResolver`
- `sqlPairResolver`
- `apiHistoryResolver`
- `threadRepository`
- `threadResponseRepository`
- `instructionRepository`
- `sqlPairRepository`
- `modelRepository`
- `viewRepository`
- `relationshipRepository`

共享 helper 已沉淀到：

- `hasCanonicalRuntimeIdentity`
- `normalizeCanonicalPersistedRuntimeIdentity`
- `toCanonicalPersistedRuntimeIdentityFromScope`
- `toLegacyProjectRuntimeIdentity`
- `toPersistedRuntimeIdentityPatch`
- `resolvePersistedProjectBridgeId`

---

## 剩余热点分层

### A. 必须保留：实体/主键/删除路径

这些命中当前不应继续删除：

#### `wren-ui/src/apollo/server/services/projectService.ts`
- 全部是项目实体主键 API
- 属于正常领域模型，不是 runtime 主语义误用

#### `wren-ui/src/apollo/server/managers/dataSourceSchemaDetector.ts`
- 全部围绕真实 `project.id`
- 属于数据源探测/变更分析流程

#### `wren-ui/src/apollo/server/services/deployService.ts`
- deploy log 读写仍依赖 `projectId`
- delete/reset path 也需要真实项目主键
- 这里大部分不是误用，而是 deploy/log domain 仍以 project 为存储锚点

#### `wren-ui/src/apollo/server/services/modelService.ts`
- 大量 `*Scoped(projectId, ...)` 方法本身就是 legacy scoped API
- 同时承担 onboarding / deleteAllByProjectId / relation scope 校验
- 当前多数命中是“保留兼容 API”，不是 canonical runtime 误用

#### `wren-ui/src/apollo/server/services/dashboardService.ts`
- dashboard 当前仍以 `projectId` 作为 legacy binding fallback
- 但 canonical scope 已优先使用 `knowledgeBaseId / kbSnapshotId / deployHash`
- 这里的剩余命中主要是 dashboard 兼容桥，不是 runtime 主链误用

---

### B. 兼容桥：应保留但已尽量缩圈

#### `wren-ui/src/apollo/server/context/runtimeScope.ts`
- `legacyProjectId`
- request/header/body 中旧字段兼容读取
- kb snapshot / deployment / project bridge 一致性校验

说明：
- 这里是 **兼容层核心入口**
- 现在不适合进一步激进删除

#### `wren-ui/src/apollo/server/utils/persistedRuntimeIdentity.ts`
- `projectId` 是兼容桥字段定义的一部分
- 不能删除，只能继续强化 helper 语义

#### `wren-ui/src/apollo/server/resolvers/projectResolver.ts`
- `buildProjectBridgeRuntimeIdentity()` 仍需要给 deploy/onboarding 构造 legacy bridge
- 当前已改成统一走 canonical persisted identity helper + `toLegacyProjectRuntimeIdentity()`

#### `wren-ui/src/apollo/server/services/askingService.ts`
- 剩余命中基本都是真实 persistence / deployment / manifest fallback
- 已不再用 project bridge 作为 canonical read lookup 主语义

#### `wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts`
- 仍保留 `projectBridgeId` / `projectId` 的兼容协议映射
- canonical runtime 字段已优先于 legacy bridge
- 这是当前 allowlisted 的协议边界之一

---

### C. 已基本正确，但还有“文本命中”的文件

#### `wren-ui/src/apollo/server/services/mdlService.ts`
- 仍有 projectId 命中，但主要是：
  - `makeCurrentModelMDL(projectBridgeId)`
  - deployment/project fallback
  - manifest-backed project recovery

#### `wren-ui/src/apollo/server/resolvers/modelResolver.ts`
- 剩余命中主要是：
  - response/model/view 持久化字段
  - execution context 最终回填 `deployment.projectId`
  - legacy bridge persist

#### `wren-ui/src/apollo/server/utils/runtimeExecutionContext.ts`
- 仍要从 deployment/project 恢复真实项目实体
- 现在 canonical runtime 下返回的 runtime identity 已归零 project bridge

#### `wren-ui/src/apollo/server/utils/dashboardRuntime.ts`
- dashboard 运行时恢复仍允许从 `kbSnapshot.legacyProjectId` / `dashboard.projectId` 回推 bridge
- 但内部命名已继续收口为 fallback-only 语义

#### `wren-ui/src/apollo/server/resolvers/askingResolver.ts`
- 已切到 `getCurrentPersistedRuntimeIdentity()` / `getActiveRuntimeProject()`
- 剩余 `projectId` 文本命中主要来自测试数据与下游真实 project 解析

#### `wren-ui/src/apollo/server/resolvers/projectResolver.ts`
- 已切到 `getActiveRuntimeProjectOrThrow()` / `resolveActiveRuntimeProject()`
- 剩余命中主要属于 reset / onboarding / sample dataset / relation ownership 的真实 project 业务域

#### `wren-ui/src/apollo/server/resolvers/dashboardResolver.ts`
- 已切到 persisted runtime 命名与 response runtime source 命名
- 剩余 `projectId` 文本命中主要是 dashboard item response payload / 测试数据

---

## 当前不建议继续做的事

以下动作在这一阶段收益不高，风险更大：

1. 全量删除所有 `projectId` 文本命中
2. 删除数据库表里的 `project_id` 字段
3. 删除 `runtimeScope` 里的 legacy request/header 兼容
4. 删除 deploy / onboarding / reset 里对真实项目主键的依赖
5. 对 `modelService` / `projectService` 做 repo-wide 机械替换
6. 在 `runtimeScope.ts` 中直接删除 `legacyProjectId` 兼容输入
7. 在 deploy / mdl / dashboard 域里删除仍承担真实项目主键职责的 `projectId`

---

## 建议的下一阶段顺序

### Wave C1：文义收口
- 把纯命名层的 `projectId` 参数逐步改名成 `projectBridgeId`
- 优先改 service/resolver 内部私有方法

### Wave C2：收尾与冻结
- 对 `runtimeScope / mdlService / modelService` 只做“低风险 helper 收口”，不再做机械替换
- 以扫描脚本 + 定向测试作为 closeout gate
- 未命中的真实领域主键/持久化列视为 Phase 2 可接受残留
- 优先批次：
  - `dashboardService`
  - `instructionService`
  - `sqlPairService`
  - `askingTaskTracker`

2026-04-07 Wave C1 追加：

- `instructionService / sqlPairService / askingTaskTracker`
  已不再各自手写 `normalizedRuntimeIdentity.projectId ?? null`
  逻辑，统一改用 `toPersistedRuntimeIdentityPatch()`
- `dashboardService` 内部参数命名继续收口为
  `legacyProjectBridgeId`
- 本轮目标仍然是把 bridge-only 逻辑集中到 shared helper /
  fallback-only 命名，而不是删除 schema 或真实项目主键

2026-04-07 Wave C2 追加：

- `deployService` 的 canonical runtime deploy lookup 与 deploy runtime
  persistence patch 已继续收口到 shared helper
- `resolveRuntimeProjectBridgeId()` 语义已继续收紧为
  `resolveLegacyProjectBridgeIdForRuntimeLookup()`
- `mdlService` 的 runtime lookup / canonical deploy lookup 也已改成
  复用 `toPersistedRuntimeIdentityPatch()`

2026-04-07 Wave C3 追加：

- `modelService` 的 runtime-scope 过滤逻辑已集中到
  `matchesRuntimeIdentityScope()` / `filterRecordsByRuntimeIdentityScope()`
- `createRelationByRuntimeIdentity()` 与
  `checkCalculatedFieldCanQuery()` 已改成复用
  `toPersistedRuntimeIdentityPatch()`
- canonical runtime 路径下，不再因为 stale `runtimeIdentity.projectId`
  对 model/view/relation 再做额外 legacy bridge 过滤

### Wave C2：schema / migration 补强
- 为 runtime-aware 表补 backfill 说明
- 明确哪些表的 `project_id` 仅作 legacy bridge

### Wave C3：全量回归
- `wren-ui` 全量 test
- `wren-ai-service` 全量 pytest
- 必要时补 repo-wide smoke checks

### Wave C4：Phase 2 最后收口建议
1. 先做 `dashboardService` 的 bridge-only 命名与 fallback 收口
2. 再做 `instructionService / sqlPairService / askingTaskTracker` 的 shared helper 对齐
3. 最后再评估是否进入 `runtimeScope.ts` 的兼容输入缩圈

---

## 当前判定

Phase 2 de-project cutover 已从“主链迁移中”进入：

> **runtime 主语义已切换完成，剩余主要是 schema/兼容桥/领域主键保留项。**

后续重点不再是“大面积改代码”，而是：

- 分层确认哪些命中必须保留
- 控制命名债
- 做全量回归与最终收口

---

## 2026-04-07 Closeout 判定

### 最新 repo-wide inventory（Wave C3 之后）

本轮再次粗扫后，`wren-ui/src/apollo/server` 的热点分布大致为：

- `services/modelService.ts`：77
- `context/runtimeScope.ts`：33
- `services/mdlService.ts`：26
- `resolvers/modelResolver.ts`：20
- `utils/persistedRuntimeIdentity.ts`：19
- `services/deployService.ts`：19
- `services/projectService.ts`：16
- `resolvers/projectResolver.ts`：15

说明：

- `modelService.ts` 仍然高，是因为它同时承载：
  - legacy scoped API
  - relation / view / model 的真实持久化字段
  - onboarding / deleteAllByProjectId 等领域逻辑
- `runtimeScope.ts` 仍然高，是因为它本来就是兼容桥入口
- `mdlService.ts / deployService.ts` 的剩余命中，已经更多是：
  - deployment/project recovery
  - deploy log 主键锚点
  - fallback-only helper

`wren-ai-service/src` 的热点分布大致为：

- `utils.py`
- `core/runtime_identity.py`
- `web/v1/services/runtime_models.py`
- `web/v1/services/__init__.py`

说明：

- 这些剩余命中已基本落在 allowlisted bridge boundary
- 当前 `scan-runtime-identity.sh` 仍通过，说明 AI service 侧已进入
  “边界稳定、主链已切换”的状态

### 当前剩余项再分类

#### 1. 必须保留
- `runtimeScope.ts` 的 legacy selector 兼容
- `projectResolver.ts / projectService.ts` 中真实项目主键业务
- `deployService.ts / deployLogRepository.ts` 的 deploy log 锚点
- `mdlService.ts` 的 deployment/project 恢复链路

#### 2. fallback-only，可接受
- `persistedRuntimeIdentity.ts` 中的 `projectId` 兼容字段
- `modelResolver.ts` 中 response/runtimeSource 回填
- `dashboardRuntime.ts / runtimeExecutionContext.ts` 中 fallback 恢复逻辑
- `wrenAIAdaptor.ts` 协议兼容映射

#### 3. 仍可继续收口，但不是高风险阻塞
- `modelResolver.ts` 内部 bridge-only 命名
- `projectResolver.ts` 个别 helper 的命名统一
- `modelService.ts` / `deployService.ts` / `mdlService.ts` 少量参数命名文义收尾

### 最快收尾路径

如果目标是“尽快把 Phase 2 做到可收口状态”，建议顺序为：

1. **`modelResolver` 文义收口**
   - 只改 bridge-only 命名与 fallback helper 名称
   - 不碰 schema / response contract

2. **`projectResolver` 小范围文义收口**
   - 只统一 runtime bridge helper 命名
   - 不改 reset / onboarding / sample dataset 真实项目逻辑

3. **做一次全量回归**
   - `wren-ui` 全量 test
   - `wren-ai-service` 全量 pytest

4. **最终 closeout**
   - 输出剩余命中 final inventory
   - 明确 Phase 3 才会碰的内容：
     - schema-level `project_id`
     - `runtimeScope` 兼容输入缩圈
     - protocol-level legacy field removal

### 当前结论

截至本轮：

- runtime 主语义迁移已经完成
- service 主链已经基本收口
- AI service 主链也已经进入 allowlisted boundary 状态
- 剩余任务已经不再是“大规模迁移”，而是：
  - resolver 文义收尾
  - 全量回归
  - 最终 closeout 归档

截至当前：

- `scan-current-project` 持续为 0 命中
- `scan-runtime-identity` 持续仅剩 allowlisted bridge
- `wren-ui` 的 repository / service / resolver / utils 低风险命名收口已基本完成

建议把 Phase 2 视为：

> **closeout 完成，进入“保留项治理 + 下一阶段功能开发”状态。**

剩余工作更适合按下面方式处理，而不是继续大面积 de-project：

1. 在后续功能迭代中，顺手消化局部命名债
2. 对 allowlist 继续做小步缩圈，而不是 repo-wide 替换
3. 把真实 project 主键域与 canonical runtime 域继续分层管理

---

## 2026-04-07 Final Freeze Snapshot

### 最终 closeout 结论

Phase 2 的目标不是“清空仓库里所有 `projectId` 文本”，而是：

1. 让 **runtime 主语义** 从 project-first 切到
   - `workspaceId`
   - `knowledgeBaseId`
   - `kbSnapshotId`
   - `deployHash`
2. 让 repository / service / resolver / pipeline 主链不再依赖 `getCurrentProject()`
3. 把剩余 `projectId` 命中压缩到：
   - 真实领域主键
   - persistence/schema 列
   - 兼容桥边界
   - fallback-only helper

按这个标准，**Phase 2 已可判定为 closeout 完成**。

### 最新热点快照

本轮最终粗扫结果：

- `wren-ui/src/apollo/server/services/modelService.ts` → `69`
- `wren-ui/src/apollo/server/context/runtimeScope.ts` → `35`
- `wren-ui/src/apollo/server/utils/persistedRuntimeIdentity.ts` → `23`
- `wren-ui/src/apollo/server/resolvers/modelResolver.ts` → `23`
- `wren-ui/src/apollo/server/services/mdlService.ts` → `21`
- `wren-ui/src/apollo/server/resolvers/projectResolver.ts` → `17`
- `wren-ui/src/apollo/server/services/deployService.ts` → `11`
- `wren-ui/src/apollo/server/utils/dashboardRuntime.ts` → `10`
- `wren-ui/src/apollo/server/utils/runtimeExecutionContext.ts` → `6`

### 冻结残留（accept as-is for Phase 2）

以下残留在 Phase 2 结束时视为**可接受**：

#### A. 真实领域主键 / 持久化字段
- project entity 主键
- deploy log 的 `projectId`
- relation / model / view 持久化字段中的 `projectId`

#### B. 兼容桥输入
- `runtimeScope.ts` 的：
  - body/query/header 旧字段兼容
  - `legacyProjectId`
  - `kbSnapshot.legacyProjectId` 协调

#### C. fallback-only helper
- `mdlService.ts` 的 deployment/project recovery
- `deployService.ts` 的 deployment lookup / hash fallback
- `runtimeExecutionContext.ts` / `dashboardRuntime.ts` 的 project recovery

#### D. 合同层字段定义
- `persistedRuntimeIdentity.ts` 中保留 `projectId` 兼容字段定义

### Phase 3 才建议处理的内容

以下内容不建议再在 Phase 2 继续推进：

1. 删除数据库 schema 中的 `project_id`
2. 删除 `runtimeScope` 的 legacy request/header 兼容
3. 删除 deploy/onboarding/reset 对真实项目主键的依赖
4. repo-wide 机械替换剩余全部 `projectId`
5. 删除 adaptor / protocol 层的 legacy 映射字段

### 建议的下一阶段入口

从现在开始，更推荐：

1. 进入下一阶段功能开发
2. 在功能开发中顺手治理局部命名债
3. 保持扫描脚本 + 定向测试作为回归护栏
4. 不再把“继续清零 `projectId` 文本命中”作为主目标
