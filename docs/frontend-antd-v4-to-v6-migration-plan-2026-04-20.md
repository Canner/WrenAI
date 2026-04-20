# Frontend Antd V4 → V6 Migration Plan — 2026-04-20

对应：

- `docs/frontend-architecture-backlog-2026-04-18.md`
- `docs/frontend-dependency-audit-2026-04-18.md`
- `docs/frontend-architecture-progress-summary-2026-04-19.md`
- `docs/frontend-architecture-next-batch-2026-04-19.md`

## 目标

在 **同一条升级分支 / 同一个 PR** 内，将 `wren-ui` 从 `antd@4.20.4` 升级到 `antd@6.x`，但保持 **分阶段、分 commit、分验证门槛** 的执行方式，避免“一次性跳版本 + 一次性硬修”。

结论：

- **可以一次做完**
- **不应该一个超大 commit 做完**
- 推荐按 **9 个逻辑 commit** 推进

## 执行状态（2026-04-21）

当前这 9 个逻辑 commit 已全部落地，另外补了 1 个 repo-wide lint/build 收尾提交，把默认验证链路也恢复到可通过状态：

1. `e93ec9a4` — 对齐到最新 `antd@4.24.x` 基线
2. `54441e97` — 移除内部 Antd 类型导入
3. `a59bd41c` — 用 `Form.Item.useStatus()` 替代私有 context
4. `895f76b5` — 删除 `antd` facade / alias，恢复官方根导入
5. `d41bf21c` — 完成 Antd v5 css-in-js + Pages Router SSR 接入
6. `c9acc38d` — 完成 popup `open/menu` API 迁移
7. `25378f6d` — 接入 `AntdAppBridge` 并迁移首批 feedback surface
8. `521bc2e4` — 升级到 `antd@6.3.6` / `@ant-design/icons@6.1.1` / `@ant-design/cssinjs@2.1.2`，清零 `Tabs.TabPane` / `destroyOnClose` / `moment`，补齐 Antd 6 类型兼容与构建兼容脚本
9. `3a170704` — 清零 legacy popup/style props，统一迁移到 `styles` / `classNames` 语义化 API，并回填迁移文档
10. `本次补充收尾提交` — 批量清理 repo-wide prettier / lint debt，并修复剩余 2 个真实 ESLint 错误，让默认 `yarn lint` / `yarn build` 重新通过

### 本轮最终验证结果

- `yarn check-types` ✅
- `yarn lint:changed` ✅
- `yarn test --runTestsByPath src/server/utils/tests/docker.test.ts --runInBand` ✅
- `rg "Tabs\.TabPane|<TabPane\b" src` ✅ 0 命中
- `rg "\bdestroyOnClose\b" src` ✅ 0 命中
- `rg "\bmoment\b" src` ✅ 0 命中
- `rg "bodyStyle|headerStyle|maskStyle|overlayStyle|dropdownClassName|popupClassName|overlayClassName" src` ✅ 0 命中
- `yarn lint` ✅ 通过
- `yarn build` ✅ 通过
- `./node_modules/.bin/next build --no-lint` ✅ 通过

### 额外兼容修复

Antd 6 在当前 Next.js Pages Router / Node 22 组合下，会在 `Collecting page data` 阶段触发部分 `@rc-component/*/es` 裸扩展名导入问题。

因此本轮额外补了：

- `wren-ui/scripts/patch_rc_component_util_esm.mjs`
- `package.json` 中的 `patch:rc-component-util-esm` / `postinstall` / `dev` / `build` / `start` 前置修复链路

该补丁只会给真实存在的 `*.js` 目标补齐扩展名，用来保证 `next build --no-lint` 与默认 `yarn build` 都能稳定完成 SSR / page-data 阶段。

---

## Fresh verification basis（2026-04-20）

当前仓库基线：

- `antd = 4.20.4`
- 私有 Antd 导入文件：**9**
- `visible/onVisibleChange/onDropdownVisibleChange`：**54**
- `Tabs.TabPane`：**12**
- `destroyOnClose`：**31**
- `moment` 命中文件：**5**
- `message` 直接 import 文件：**80**
- `Modal.confirm/info/...` 文件：**5**
- `package.json` 当前 **未显式声明** `@ant-design/icons`
- `package.json` 当前 **未显式声明** `@ant-design/cssinjs`

当前关键结构事实：

- `wren-ui/next.config.js` 仍有 `antd$ -> src/import/antd.ts` alias
- `wren-ui/src/import/antd.ts` 仍是 Antd 4 时代 facade
- `wren-ui/src/pages/_app.tsx` 仍全局 `require('../styles/index.less')`
- `wren-ui/src/pages/_document.tsx` 只有 `styled-components` SSR，没有 Antd CSS-in-JS SSR
- `wren-ui/src/styles/index.less` 仍直接 `@import '~antd/dist/antd.less'`
- `wren-ui/src/styles/antd-variables.less` 仍直接 `@import '~antd/lib/style/themes/default.less'`

当前验证命令：

```bash
cd wren-ui
yarn check-types
yarn lint
yarn build
```

---

## 总体执行原则

1. **先拆桥，再升版本**
   - 先清私有导入、alias、facade，再进入 v5 / v6 迁移。
2. **同一条分支做完，但保留 commit 边界**
   - 不做一个大 commit。
3. **关键 checkpoint 必跑 build**
   - Commit 4 / 5 / 8 / 9 后必须跑 `yarn build`。
4. **先做机械迁移，再做样式回归**
   - `Tabs.TabPane` / `destroyOnClose` / `moment` 这种机械替换和 `styles/classNames` / DOM 语义样式调整不要混在一个 commit。

---

## 9 个 commit 执行表

### Commit 1

#### `chore(wren-ui): bump antd to latest 4.x before migration`

**改动文件**

- `wren-ui/package.json`
- `wren-ui/yarn.lock`

**改动**

- `antd: 4.20.4 -> 4.24.16`

**目的**

- 先拿到最新 4.x 的公共 API 窗口，为后续移除私有 `form/context` 依赖做准备。

**验证**

```bash
cd wren-ui
yarn install
yarn check-types
yarn lint
```

**通过标准**

- typecheck / lint 全绿

---

### Commit 2

#### `refactor(wren-ui): remove internal antd types with public/local replacements`

**改动文件**

- `src/components/table/TableTransfer.tsx`
- `src/components/diagram/CustomDropdown.tsx`
- `src/components/table/MultiSelectBox.tsx`

**改动**

- `TransferItem`（内部路径）→ 本地最小 record 类型
- `ItemType`（内部路径）→ `MenuProps['items']`
- `ColumnsType`（内部路径）→ `TableColumnsType`

**验证**

```bash
cd wren-ui
./node_modules/.bin/prettier --write \
  src/components/table/TableTransfer.tsx \
  src/components/diagram/CustomDropdown.tsx \
  src/components/table/MultiSelectBox.tsx
yarn check-types
./node_modules/.bin/next lint \
  --file src/components/table/TableTransfer.tsx \
  --file src/components/diagram/CustomDropdown.tsx \
  --file src/components/table/MultiSelectBox.tsx
```

**通过标准**

- 私有 Antd 导入文件数：**9 -> ~6**

---

### Commit 3

#### `refactor(wren-ui): replace private form context reads with public form item status`

**改动文件**

- `src/components/editor/MarkdownEditor.tsx`
- `src/components/editor/SQLEditor.tsx`
- `src/components/selectors/lineageSelector/index.tsx`
- `src/components/table/MultiSelectBox.tsx`
- `src/components/table/SelectionTable.tsx`

**删除文件**

- `src/hooks/useAntdFormItemStatus.ts`

**改动**

- 私有 `FormItemInputContext` / `FormItemStatusContextProps` → `Form.Item.useStatus()`

**验证**

```bash
cd wren-ui
./node_modules/.bin/prettier --write \
  src/components/editor/MarkdownEditor.tsx \
  src/components/editor/SQLEditor.tsx \
  src/components/selectors/lineageSelector/index.tsx \
  src/components/table/MultiSelectBox.tsx \
  src/components/table/SelectionTable.tsx
yarn check-types
./node_modules/.bin/next lint \
  --file src/components/editor/MarkdownEditor.tsx \
  --file src/components/editor/SQLEditor.tsx \
  --file src/components/selectors/lineageSelector/index.tsx \
  --file src/components/table/MultiSelectBox.tsx \
  --file src/components/table/SelectionTable.tsx
rg -l "from 'antd/(lib|es)/|from \"antd/(lib|es)/" src --glob '!**/*.test.*' --glob '!**/tests/**'
```

**通过标准**

- 私有 Antd 导入应只剩：`src/import/antd.ts`

---

### Commit 4

#### `refactor(wren-ui): remove antd alias facade and restore official root imports`

**改动文件**

- `wren-ui/next.config.js`
- 删除 `wren-ui/src/import/antd.ts`

**改动**

- 删除 `antd$` alias
- 删除 Antd facade 文件
- 让所有 `from 'antd'` 真正命中官方包根导出

**验证**

```bash
cd wren-ui
yarn check-types
yarn lint
rg -l "from 'antd/(lib|es)/|from \"antd/(lib|es)/" src --glob '!**/*.test.*' --glob '!**/tests/**'
yarn build
```

**通过标准**

- 私有 Antd 导入文件数：**0**
- `build` 通过

**说明**

- 这是第一道大门：仓库里当前约有 **281** 个 `from 'antd'` 文件，这一步后它们第一次真正命中官方导出。

---

### Commit 5

#### `feat(wren-ui): adopt antd v5 css-in-js theme and next pages router SSR`

**改动文件**

- `wren-ui/package.json`
- `wren-ui/yarn.lock`
- `wren-ui/src/pages/_document.tsx`
- `wren-ui/src/pages/_app.tsx`
- `wren-ui/src/styles/index.less`
- `wren-ui/src/styles/antd-variables.less`
- `wren-ui/next.config.js`

**新增/升级依赖**

- `antd -> 5.29.3`
- `@ant-design/icons -> 5.6.1`
- `@ant-design/cssinjs`

**改动**

- `_document.tsx`：合并 `styled-components` SSR 与 Antd Pages Router CSS-in-JS SSR
- `_app.tsx`：接入 `ConfigProvider`
- `styles/index.less`：删除 `@import '~antd/dist/antd.less'`
- `styles/antd-variables.less`：停止作为 Antd Less 主题入口，转为 token inventory
- `next.config.js`：保留 `next-with-less`，但仅用于业务 Less

**验证**

```bash
cd wren-ui
yarn install
yarn check-types
yarn lint
yarn build
rg -n "antd\.less|themes/default\.less" src next.config.js
```

**通过标准**

- `build` 通过
- Antd 主题链已切到 cssinjs / token
- `antd.less` / `themes/default.less` 不再出现在有效入口链路中

**风险最高**

- `_document.tsx` 的 SSR 合并
- 删除 `antd.less` 后首屏样式缺失

---

### Commit 6

#### `refactor(wren-ui): migrate popup visibility and dropdown API onto antd v5 surfaces`

**第一批高优先文件**

- `src/components/reference/DolaShellFooterPanel.tsx`
- `src/components/sidebar/home/TreeTitle.tsx`
- `src/components/diagram/CustomDropdown.tsx`
- `src/features/settings/permissions/PermissionsRoleCatalogSidebar.tsx`
- `src/features/settings/permissions/PermissionsRoleCatalogEditor.tsx`
- `src/features/settings/permissions/PermissionsRoleCatalogPermissionGroups.tsx`
- 第一批核心 `Modal` / `Drawer` 受控文件

**改动**

- `visible` → `open`
- `onVisibleChange` / `onDropdownVisibleChange` → `onOpenChange`
- Dropdown `overlay` → `menu`

**验证**

```bash
cd wren-ui
yarn check-types
yarn lint
rg -n "\bvisible=|\bonVisibleChange\b|\bonDropdownVisibleChange\b" src --glob '!**/*.test.*'
rg -n "\boverlay=\{" src --glob '!**/*.test.*'
```

**通过标准**

- 这两类命中显著下降

---

### Commit 7

#### `refactor(wren-ui): add antd App bridge and migrate core context-bound message/modal calls`

**改动文件**

- `wren-ui/src/pages/_app.tsx`
- 新增 `src/components/app/AntdAppBridge.tsx`
- 新增 `src/utils/antdAppBridge.ts`

**第一批迁移调用点**

- `src/hooks/useGlobalConfig.tsx`
- `src/components/modals/DeleteModal.tsx`
- `src/components/settings/ProjectSettings.tsx`
- `src/components/sidebar/modeling/ViewTree.tsx`
- `src/components/pages/home/promptThread/ChartAnswer.tsx`
- `src/features/knowledgePage/sections/useKnowledgeWorkbenchDirtyGuards.tsx`

**改动**

- 根部接 `<App>`
- 建立 `appMessage` / `appModal` / `appNotification` bridge
- 让上述 6 个文件不再直接依赖静态 `message` / `Modal.*`
- bridge 内部保留 fallback，避免初始化时序问题

**验证**

```bash
cd wren-ui
yarn check-types
yarn lint
rg -n "\bModal\.(confirm|info|success|warning|error)\b" \
  src/hooks/useGlobalConfig.tsx \
  src/components/modals/DeleteModal.tsx \
  src/components/settings/ProjectSettings.tsx \
  src/components/sidebar/modeling/ViewTree.tsx \
  src/components/pages/home/promptThread/ChartAnswer.tsx \
  src/features/knowledgePage/sections/useKnowledgeWorkbenchDirtyGuards.tsx
```

**通过标准**

- 上述 6 个文件不再直接使用静态 `Modal.*`
- bridge 正常工作

---

### Commit 8

#### `feat(wren-ui): upgrade to antd v6 and finish mechanical API migration`

**改动文件**

- `wren-ui/package.json`
- `wren-ui/yarn.lock`
- Tabs / Modal / Drawer / Date 相关文件群

**升级依赖**

- `antd -> 6.3.6`
- `@ant-design/icons -> 6.1.1`

**同时做的机械迁移**

#### Tabs

- `src/features/workspace/ManageWorkspacePage.tsx`
- `src/components/pages/home/promptThread/AnswerResult.tsx`
- `src/features/settings/platform-workspaces/ManagePlatformWorkspacesPage.tsx`

`Tabs.TabPane` → `items`

#### destroyOnClose

- 全量 `destroyOnClose` 文件群

`destroyOnClose` → `destroyOnHidden`

#### moment → dayjs

- `src/utils/table.tsx`
- `src/components/pages/apiManagement/timeRange.ts`
- `src/components/pages/apiManagement/historyQuery.ts`
- `src/components/pages/home/dashboardGrid/CacheSettingsDrawer.tsx`
- `src/features/settings/diagnostics/ManageDiagnosticsPage.tsx`

**验证**

```bash
cd wren-ui
yarn install
yarn check-types
yarn lint
yarn build
rg -n "Tabs\.TabPane" src --glob '!**/*.test.*'
rg -n "\bdestroyOnClose\b" src --glob '!**/*.test.*'
rg -n "\bmoment\b" src --glob '!**/*.test.*'
```

**通过标准**

- `Tabs.TabPane`: **0**
- `destroyOnClose`: **0**
- `moment`: **0**
- `build` 通过

---

### Commit 9

#### `refactor(wren-ui): migrate legacy popup/style props to semantic styles and classNames`

**重点文件**

- `src/styles/themes/nova.less`
- `src/components/reference/dolaShellStyles.ts`
- `src/features/auth/authPageStyles.tsx`
- `src/components/pages/setup/ConfigureConnection.tsx`
- `src/components/modals/InstructionModal.tsx`

**需要扫的旧 props**

- `bodyStyle`
- `headerStyle`
- `maskStyle`
- `overlayStyle`
- `dropdownClassName`
- `popupClassName`
- `overlayClassName`

**当前命中**

- 旧 style/class props：**18**

**验证**

```bash
cd wren-ui
yarn check-types
yarn lint
yarn build
rg -n "bodyStyle|headerStyle|maskStyle|overlayStyle|dropdownClassName|popupClassName|overlayClassName" src --glob '!**/*.test.*'
```

**通过标准**

- 旧 prop 命中尽量清到 **0**
- 关键页面人工回归通过

---

## Checkpoint 策略

### 每个 commit 后至少跑

```bash
cd wren-ui
yarn check-types
```

### 中 checkpoint

在以下 commit 后跑：

- Commit 4
- Commit 6
- Commit 7

```bash
cd wren-ui
yarn lint
```

### 大 checkpoint

在以下 commit 后必须跑：

- Commit 4
- Commit 5
- Commit 8
- Commit 9

```bash
cd wren-ui
yarn build
```

---

## 当前已知高风险区

样式 / DOM 覆盖高密度文件：

- `src/styles/themes/nova.less`：`.ant-*` 命中 **63**
- `src/components/reference/dolaShellStyles.ts`：**53**
- `src/features/auth/authPageStyles.tsx`：**36**
- `src/components/pages/setup/ConfigureConnection.tsx`：**35**
- `src/features/knowledgePage/styles/knowledgePageModalStyles.ts`：**27**

这些文件更适合留到 Commit 9 集中处理，不建议和版本升级或机械 API 替换混在一起。

---

## 最终完成标准

全部完成后，至少满足：

- `antd = 6.x`
- `@ant-design/icons = 6.x`
- 私有 Antd 导入文件：**0**
- `Tabs.TabPane`: **0**
- `destroyOnClose`: **0**
- `moment`: **0**
- 旧 popup/style props 命中尽量为 **0**
- `yarn check-types` 通过
- `yarn lint` 通过
- `yarn build` 通过

---

## 参考

- Ant Design v4 → v5 migration: <https://5x.ant.design/docs/react/migration-v5/>
- Ant Design v5 → v6 migration: <https://ant.design/docs/react/migration-v6/>
- Ant Design + Next.js Pages Router: <https://ant.design/docs/react/use-with-next/>
- Ant Design App: <https://ant.design/components/app/>
- npm `antd`: <https://www.npmjs.com/package/antd>
- npm `@ant-design/icons`: <https://www.npmjs.com/package/@ant-design/icons>
