# Frontend Dependency Audit — 2026-04-18

对应：`docs/frontend-architecture-backlog-2026-04-18.md` Wave 7。

## 当前结论

### 已收口

- `next`: `14.2.35`
- `eslint-config-next`: `14.2.35`
- `@next/bundle-analyzer`: `14.2.35`
- `vega-embed`: `^7.1.0`
- `react-is`: `18.2.0`
- `yarn dedupe --check` 已无可继续 dedupe 的包

这三项现在已经对齐，不再存在 Wave 7 最初记录的主版本漂移。
同时，先前 `yarn install --mode=skip-build` 暴露的两类 workspace 级依赖告警已收口：

- `vega@^6.2.0` / `vega-lite@^6.2.0` 与 `vega-embed` 的 peer 不再冲突
- `styled-components` 已由 direct dependency `react-is@18.2.0` 显式满足 peer

### 已确认的重复 / 可疑依赖样本

#### `cron-parser`

- 当前只保留一份：`dependencies.cron-parser@^5.1.1`
- `yarn why cron-parser` 结果显示：仅由 `wren-ui` 自身直接声明使用
- 已从 `devDependencies` 中移除重复声明
- 当前仍被以下链路直接使用，不能在本波次中直接删除：
  - `src/server/services/dashboardServiceSupport.ts`
  - `src/server/backgrounds/dashboardCacheBackgroundTracker.ts`
  - `src/server/backgrounds/scheduleWorker.ts`
  - `src/utils/validator/cronValidator.ts`
  - `src/components/pages/home/dashboardGrid/CacheSettingsDrawer.tsx`

## 当前保留项 / 评估项

| 依赖 | 当前状态 | 说明 |
|---|---|---|
| `next` | 保留 | Pages Router + API routes 当前仍依赖 Next 运行时 |
| `eslint-config-next` | 保留 | 与 Next 版本对齐，避免 lint 规则漂移 |
| `@next/bundle-analyzer` | 保留 | 前端 bundle 审计工具，需与 Next 主版本一致 |
| `cron-parser` | 保留 | 调度 / 系统任务相关逻辑仍直接使用 |
| `antd` | 保留待评估 | repo 中约 290 个文件直接 import `antd`，迁移面很大 |
| `react-is` | 保留 | 作为 `styled-components` 的 direct peer 依赖显式声明，避免 workspace 级 peer warning |
| `vega-embed` | 保留 | 已升级到 `7.x` 以匹配当前 `vega 6` / `vega-lite 6` 组合 |
| `next-with-less` | 保留待评估 | `next.config.js`、`_app.tsx` 与 `src/styles/**/*.less` 当前仍依赖它 |
| `styled-components` | 保留待评估 | `_document.tsx` 负责 SSR，repo 中约 93 个文件直接使用 |
| `@types/node` | 保留待评估 | 当前为 `18.16.9`，后续需和实际 Node 运行环境一起评估升级窗口 |

## 当前治理缺口

- 重复依赖 / 可疑依赖首版清单已经补出，当前进入逐包 keep-or-drop 决策阶段
- 已新增 `yarn deps:audit` / `yarn deps:audit:check` 固化当前事实校验，并已接入 `.github/workflows/ui-lint.yaml`
- `yarn install --mode=skip-build` 仍会有依赖树内部的 peer warning 噪音，但 Wave 7 当前最直接的 workspace 级依赖告警已经收口
- `antd` / `less` / `next-with-less` / `styled-components` 还只有评估目标，没有明确路线图

## Wave 7 路线图（dependency closure 之后）

### 新鲜证据（2026-04-20）

- 非测试代码中约 **278 个文件** 直接 import `antd`
- `src/import/antd.ts` 当前维护 **47** 个 Antd 4 组件别名导出
- 仍有约 **21 个非测试文件** 直接 import `antd/lib/*` 或 `antd/es/*`
- `next.config.js` 仍通过 `withLess(...)` 驱动 Less 编译，并把 `antd$` alias 指向 `src/import/antd.ts`
- `src/pages/_app.tsx` 仍全局 `require('../styles/index.less')`
- `src/styles/index.less` 仍直接引入 `~antd/dist/antd.less`
- `src/styles/antd-variables.less` 仍直接引入 `~antd/lib/style/themes/default.less`
- 当前 `src/styles/**/*.less` 共 **23** 个 Less 文件
- 非测试代码中约 **93 个文件** 使用 `styled-components`
- `styled-components` 当前仍依赖：
  - `next.config.js` 中的 SWC `styledComponents` transform
  - `src/pages/_document.tsx` 中的 `ServerStyleSheet` SSR 注入

这意味着：

- `antd` / `less` / `next-with-less` / `styled-components` 仍然是一个 **耦合栈**，不适合在同一波里粗暴并行迁移
- Wave 7 当前更合理的目标不是“立刻升级 UI 栈”，而是先形成 **冻结规则 + 迁移顺序 + 拆分前置条件**

### 建议路线图

| 阶段 | 目标 | 具体动作 | 暂不做 |
|---|---|---|---|
| Phase A | 冻结新增技术债 | 禁止新增 `antd/lib/*` / `antd/es/*` import；新页面尽量不再新增全局 Less；新 feature 若无必要避免继续扩张 `styled-components` | 不启动 Antd 5 / Next 大版本升级 |
| Phase B | 先清桥接层 | 把剩余 `antd/lib/*` / `antd/es/*` 入口尽量收回 facade / public type import；梳理 `src/import/antd.ts` 的真实使用面 | 不改业务组件视觉表现 |
| Phase C | 提前抽主题约束 | 盘点 `antd-variables.less` 与 `src/styles/**/*.less` 中真正仍被使用的变量和 override；形成 token 映射表 | 不一次性改写全部 Less 为新方案 |
| Phase D | 决策最终栈方向 | 在证据齐全后评估：继续围栏 Antd 4，还是拆成 Antd 5 / token 化 / 样式方案替换独立波次 | 不把依赖清理和样式栈迁移混成一个 commit |
| Phase E | 执行迁移波次 | 按 “theme → shell/layout → domain components” 顺序拆波次推进 | 不跨域大爆炸式迁移 |

### 当前建议的 keep / freeze 决策

| 项目 | 当前决策 | 原因 |
|---|---|---|
| `antd@4` | **Keep + Freeze** | 使用面太大，且仍有 facade + internal import 双轨存在，适合先围栏再迁 |
| `less` | **Keep as bridge** | 当前主题变量和大量 override 仍直接依赖 Less |
| `next-with-less` | **Keep as bridge** | 只要 Antd 4 + Less 主题链还在，就不能先删 |
| `styled-components` | **Keep + Stop spreading** | 仍承担 shell / brand / layout / SSR 角色，但不应继续在新 feature 中扩张 |

### 下一批最值得做的不是“升级”，而是“收口”

1. 先把 `antd/lib/*` / `antd/es/*` 的 21 个非测试入口压回统一边界
2. 补一份 Less override / token 映射表，明确哪些变量是真正在用
3. 给 `styled-components` 设定边界：优先保留在 shell/layout/brand，避免继续往 data/feature 层扩张
4. 证据齐全后，再单独决定是否开：
   - Antd 5 迁移波次
   - Less 退场波次
   - styled-components 收缩波次

## 如果评估 “Antd 4 → 最新稳定版”

### 2026-04-20 fresh registry / repo evidence

- `npm view antd dist-tags --json` 显示：
  - `latest-4 = 4.24.16`
  - `latest-5 = 5.29.3`
  - `latest = 6.3.6`
- `npm view @ant-design/icons dist-tags --json` 显示：
  - `latest = 6.1.1`
- `npm view antd@6 peerDependencies --json` 显示 `react` / `react-dom` 均要求 `>=18.0.0`
- 当前 repo 里与 Antd 升级直接相关的改动面包括：
  - 非测试代码中约 **278** 个文件直接 import `antd`
  - Antd prep Batch 0A 落地前约 **21** 个非测试文件直接 import `antd/lib/*` / `antd/es/*`
  - 当前已先清掉其中 **14** 个纯 low-risk 文件，剩余 **7** 个 internal-import 文件：
    - `src/components/diagram/CustomDropdown.tsx`
    - `src/components/editor/MarkdownEditor.tsx`
    - `src/components/editor/SQLEditor.tsx`
    - `src/components/selectors/lineageSelector/index.tsx`
    - `src/components/table/MultiSelectBox.tsx`
    - `src/components/table/SelectionTable.tsx`
    - `src/import/antd.ts`
  - `src/import/antd.ts` 维护 **47** 个 Antd 4 alias export
  - 约 **45** 处 `visible=`
  - 约 **4** 处 `onVisibleChange` / `onDropdownVisibleChange`
  - 约 **12** 处 `Tabs.TabPane`
  - 约 **19** 处 `bodyStyle` / `maskStyle` / `overlayStyle` / `dropdownClassName` 等旧 prop
  - 约 **18** 处 `moment`
  - `src/styles/**/*.less` 共 **23** 个
  - `.ant-*` 覆盖命中约 **403** 处

### 对这个仓库的实际含义

把 `antd@4.20.4` 升到最新稳定版，不是单纯改 `package.json`，而是至少要拆成两段：

1. **v4 → v5**
   - 先收回 `antd/lib/*` / `antd/es/*` 与 `src/import/antd.ts` 这层 Antd 4 时代桥接
   - 把 `visible` / `onVisibleChange` 一类旧 API 迁到 `open` / `onOpenChange`
   - 把 `moment` 相关日期链路改成当前版本允许的做法
   - 把 Antd 4 的 Less 主题链（`~antd/dist/antd.less`、`~antd/lib/style/themes/default.less`、`next-with-less` + `_app.tsx` 全局 Less）迁到 `ConfigProvider` / token / `@ant-design/cssinjs`
   - `src/pages/_document.tsx` 需要补 Antd CSS-in-JS 的 Next Pages Router SSR 注入，不能只保留 `styled-components` 的 `ServerStyleSheet`
2. **v5 → v6**
   - 再清 `Tabs.TabPane`、`destroyOnClose`、`bodyStyle` / `headerStyle` / `maskStyle`、`dropdownClassName` / `overlayClassName` / `popupClassName` 等 v6 前的旧接口
   - 回归所有依赖 `.ant-*` DOM 结构的 Less / styled-components 覆盖
   - 再决定是否顺手收缩 `next-with-less` / Less 全局 override / styled-components 扩张面

### 当前判断

- 对 Wren UI 来说，“Antd 4 → 最新稳定版”本质上是 **主题系统迁移 + SSR 适配 + 组件 API 批量改名 + 覆盖样式回归**
- 这条线 **不适合** 作为 Wave 7 dependency closure 的顺手小改
- 更合理的顺序仍然是：
1. 冻结新增 Antd 4 技术债
2. 先清 internal import / facade / Less 变量桥接层
3. 再决定是否开独立的 Antd 升级波次

补充执行进展（2026-04-20）：

- Batch 0A 已先完成 **14** 个纯 low-risk internal import 文件的 public-surface 回收
- 这一轮验证通过后，剩余 internal-import 文件已下降到 **7**
- 当前更适合下一步继续收的是：
  - mixed 文件：`components/table/MultiSelectBox.tsx`
  - private 依赖文件：`SelectionTable.tsx`、`MarkdownEditor.tsx`、`SQLEditor.tsx`、`lineageSelector/index.tsx`、`CustomDropdown.tsx`
  - 最后再处理 `src/import/antd.ts` 这层全局 facade

### 建议的执行批次（按文件群）

#### Batch 0 — 先清桥接层（最值得先做）

1. 收口 `antd/lib/*` / `antd/es/*`

   当前命中文件：

   - `src/components/diagram/CustomDropdown.tsx`
   - `src/components/editor/MarkdownEditor.tsx`
   - `src/components/editor/SQLEditor.tsx`
   - `src/components/pages/modeling/form/ModelForm.tsx`
   - `src/components/pages/setup/DefineRelations.tsx`
   - `src/components/pages/setup/SelectModels.tsx`
   - `src/components/selectors/DescriptiveSelector.tsx`
   - `src/components/selectors/lineageSelector/index.tsx`
   - `src/components/sidebar/home/ThreadTree.tsx`
   - `src/components/sidebar/modeling/ModelTree.tsx`
   - `src/components/sidebar/modeling/ViewTree.tsx`
   - `src/components/sidebar/utils.tsx`
   - `src/components/table/ModelRelationSelectionTable.tsx`
   - `src/components/table/MultiSelectBox.tsx`
   - `src/components/table/SelectionTable.tsx`
   - `src/components/table/TableTransfer.tsx`
   - `src/features/knowledgePage/modals/AssetWizardModal.tsx`
   - `src/features/settings/platform-users/ManagePlatformUsersPage.tsx`
   - `src/features/settings/platform-workspaces/ManagePlatformWorkspacesPage.tsx`
   - `src/features/workspace/components/WorkspacePrimaryPanel.tsx`
   - `src/import/antd.ts`

2. 决定 `src/import/antd.ts` 的命运：
   - 若继续升 Antd，建议把这层 Antd 4 alias facade 逐步清空
   - 至少不要再新增新的 alias export

#### Batch 1 — 先做 v4 → v5 API 改名

1. `visible` / `onVisibleChange` / `onDropdownVisibleChange`

   典型文件群：

   - modals / drawers：
     - `src/components/modals/*.tsx`
     - `src/components/pages/knowledge/*Drawer.tsx`
     - `src/components/pages/modeling/*Drawer.tsx`
     - `src/features/settings/users/*.tsx`
     - `src/features/settings/connectors/*.tsx`
     - `src/features/knowledgePage/modals/*.tsx`
     - `src/features/knowledgePage/sections/*Drawer*.tsx`
   - 交互控件：
     - `src/components/diagram/CustomDropdown.tsx`
     - `src/components/reference/DolaShellFooterPanel.tsx`
     - `src/components/selectors/lineageSelector/FieldSelect.tsx`
     - `src/components/pages/home/promptThread/TextBasedAnswer.tsx`

2. `moment`

   当前核心命中文件：

   - `src/components/pages/apiManagement/historyQuery.ts`
   - `src/components/pages/apiManagement/timeRange.ts`
   - `src/components/pages/home/dashboardGrid/CacheSettingsDrawer.tsx`
   - `src/features/settings/diagnostics/ManageDiagnosticsPage.tsx`
   - `src/utils/table.tsx`

#### Batch 2 — 接 Antd 5 主题与 SSR

必看文件：

- `next.config.js`
- `src/pages/_app.tsx`
- `src/pages/_document.tsx`
- `src/styles/index.less`
- `src/styles/antd-variables.less`

当前判断：

- 这 5 个文件共同定义了 Antd 4 的 Less 主题桥接链
- 若不先迁这条链，`antd@5+` 不算真正落地

#### Batch 3 — 再做 v5 → v6 API 清理

1. `Tabs.TabPane`

   当前命中文件：

   - `src/components/pages/home/promptThread/AnswerResult.tsx`
   - `src/features/settings/platform-workspaces/ManagePlatformWorkspacesPage.tsx`
   - `src/features/workspace/ManageWorkspacePage.tsx`

2. 旧 style/class props

   当前命中文件：

   - `src/components/diagram/CustomDropdown.tsx`
   - `src/components/diagram/CustomPopover.tsx`
   - `src/components/pages/home/promptThread/AnswerResult.tsx`
   - `src/components/selectors/lineageSelector/FieldSelect.tsx`
   - `src/components/settings/index.tsx`
   - `src/components/sidebar/home/TreeTitle.tsx`
   - `src/features/knowledgePage/modals/AssetWizardModal.tsx`
   - `src/features/knowledgePage/modals/KnowledgeBaseModal.tsx`
   - `src/features/knowledgePage/sections/KnowledgeAssetDetailDrawer.tsx`
   - `src/features/knowledgePage/sections/KnowledgeWorkbenchEditorDrawerShell.tsx`
   - `src/features/settings/permissions/PermissionsRoleCatalogEditor.tsx`
   - `src/features/settings/permissions/PermissionsRoleCatalogPermissionGroups.tsx`
   - `src/features/settings/permissions/PermissionsRoleCatalogSidebar.tsx`
   - `src/features/settings/platform-permissions/ManagePlatformPermissionsPage.tsx`

#### Batch 4 — 回归 `.ant-*` 覆盖样式

优先从这几层开始回归：

- `src/styles/themes/nova.less`
- `src/styles/components/*.less`
- `src/features/knowledgePage/styles/*.ts`
- `src/components/pages/home/promptThread/*`
- `src/components/reference/*`
- `src/components/sidebar/*`

这批不适合和版本升级混在一个 commit；更像是独立的视觉/交互回归波次。

## 可疑依赖清单（首版）

判定方法：

- `rg --fixed-strings '<pkg>' wren-ui` 在源码 / scripts / tests / config 中没有命中，只有 `package.json`
- `yarn why <pkg>` 显示它仅由 `wren-ui` 自身直接声明

这份清单当前表示 **“需要显式 keep-or-drop 决策”**。其中 `ts-essentials`、`@testing-library/react`、`duckdb-async`、`duckdb`、`micro`、`micro-cors`、`pg-cursor`、`@google-cloud/bigquery` 与 `@google-cloud/storage` 已完成首批收口样本；当前首版清单已全部清空。

### 已完成的可疑依赖决策

| 依赖 | 当前判断 | 证据 | 结论 |
|---|---|---|---|
| `ts-essentials` | 已移除 | `rg` 仅命中 `package.json`；`yarn why ts-essentials` 显示仅为 `wren-ui` 自身直依赖；移除后 `yarn deps:audit:check` 与 `yarn check-types` 均通过 | 可安全移除，不再列为待决项 |
| `@testing-library/react` | 已移除 | `rg` 仅命中 `package.json`；`yarn why @testing-library/react` 显示仅为 `wren-ui` 自身直依赖；移除后 `yarn deps:audit:check` 与 `yarn check-types` 均通过 | 可安全移除，不再列为待决项 |
| `duckdb-async` | 已移除 | `rg` 仅命中 `package.json`；`yarn why duckdb-async` 显示仅为 `wren-ui` 自身直依赖；移除后 `yarn deps:audit:check` 与 `yarn check-types` 均通过 | 可安全移除，不再列为待决项 |
| `duckdb` | 已移除 | `rg` 未命中 `from 'duckdb'` / `require('duckdb')`；`duckdb-async` 移除后 `yarn why duckdb` 仅剩 `wren-ui` 自身直依赖；移除后 `yarn deps:audit:check` 与 `yarn check-types` 均通过 | 可安全移除，不再列为待决项 |
| `micro` | 已移除 | `rg` 未命中 `from 'micro'` / `require('micro')`；`yarn why micro` 显示仅为 `wren-ui` 自身直依赖；移除后 `yarn deps:audit:check`、`yarn check-types` 通过 | 可安全移除，不再列为待决项 |
| `micro-cors` | 已移除 | `rg` 仅命中 `package.json`；`yarn why micro-cors` 显示仅为 `wren-ui` 自身直依赖；同时移除 `@types/micro-cors` 后 `yarn deps:audit:check`、`yarn check-types` 通过 | 可安全移除，不再列为待决项 |
| `pg-cursor` | 已移除 | `rg` 仅命中 `package.json`；`yarn why pg-cursor` 与 `yarn why @types/pg-cursor` 均显示仅为 `wren-ui` 自身直依赖；同时移除 `@types/pg-cursor` 后 `yarn deps:audit:check`、`yarn check-types` 通过 | 可安全移除，不再列为待决项 |
| `@google-cloud/bigquery` | 已移除 | `rg` 仅命中 `package.json`；代码中的 BigQuery 支持当前通过 connector config + Ibis adaptor 路径完成，未命中 SDK import；移除后 `yarn deps:audit:check`、`yarn check-types` 通过 | 可安全移除，不再列为待决项 |
| `@google-cloud/storage` | 已移除 | `rg` 仅命中 `package.json`；未命中 SDK import；移除后 `yarn deps:audit:check`、`yarn check-types` 通过 | 可安全移除，不再列为待决项 |

### 运行时 / server 侧可疑项

当前首轮 runtime / server 侧可疑项也已经收口；BigQuery 连接链路当前通过 connector config + Ibis adaptor 承接，不依赖 Node SDK。

### dev / tooling 侧可疑项

当前首轮 dev / tooling 侧可疑项已经收口，本轮没有新的待决包；后续若再发现仅由 workspace 直连、且源码无 import 的工具包，再补入这里。

### 与可疑项强绑定的连带检查

- 上述每个包移除前都应先执行：
  - `yarn deps:audit:check`
  - `yarn check-types`
  - 对应模块的定向 test / smoke

## 剩余 transitive peer warning 决策表

以下 warning 来自 `yarn explain peer-requirements | rg '^p.*✘'`，当前判断是 **记录并暂缓处理**，不作为 Wave 7 的阻塞项：

| Warning ID | 链路 | 当前判断 | 原因 |
|---|---|---|---|
| `p89e94` | `@typescript-eslint/utils` → `@typescript-eslint/typescript-estree` → `typescript` | 暂缓处理 | 这是 `@typescript-eslint` 依赖树内部 peer 关系，workspace 已直接提供 `typescript@5.2.2`，当前 `check-types` / lint 主链未受阻 |
| `p8d462` | `babel-plugin-styled-components` → `@babel/plugin-syntax-jsx` → `@babel/core` | 暂缓处理 | 这是 `babel-plugin-styled-components` 依赖树内部 warning；当前 Next + SWC 主链可用，没有证据表明需要为此额外引入或提升 Babel 复杂度 |
| `p98b67` | `react-resizable` → `react-draggable` → `react-dom` | 暂缓处理 | workspace 已直接提供 `react-dom@18.2.0`，warning 属于 transitive peer 噪音；当前类型检查与本地依赖校验未显示运行时破坏 |

这三项后续只有在以下情形下才建议升级处理：

- 相关依赖本身要升级 / 替换
- CI / 安全门禁要求 peer warning 全量清零
- 出现可复现的构建、类型或运行时问题

## 后续建议

1. 首版可疑依赖清单已经清空；若后续发现新的 workspace-only 直依赖，再按同样方式逐包 keep-or-drop。
2. 优先把 `antd/lib/*` / `antd/es/*` 收回统一边界，而不是马上升级 Antd 主版本。
3. 用 `yarn deps:audit` / `yarn deps:audit:check` 作为 Wave 7 dependency closure 的固定入口，并持续把 `yarn why <pkg>` 结论补入文档。
4. 保持 bundle analyzer、eslint config 与 Next 主版本锁步，避免再次漂移。
5. `antd` / `less` / `next-with-less` / `styled-components` 按“冻结新增债务 → 清桥接层 → 做路线图 → 再开迁移波次”的顺序推进。
6. 若进入下一轮前端技术栈升级，再统一评估 Next / React / TypeScript 升级窗口。
7. 对剩余 transitive peer warning 维持“记录 + 观察”策略，除非出现明确故障证据或依赖升级窗口。
