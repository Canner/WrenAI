# Frontend Runtime Upgrade Plan — 2026-04-21

对应：

- `docs/frontend-architecture-review-2026-04-18.md`
- `docs/frontend-dependency-audit-2026-04-18.md`
- `docs/frontend-architecture-progress-summary-2026-04-19.md`
- `docs/frontend-architecture-backlog-2026-04-18.md`
- `docs/frontend-antd-v4-to-v6-migration-plan-2026-04-20.md`

> 本文档为 `wren-ui` 运行时升级的 **主计划文档**。Wave 0 清单、Less inventory、SSR / build inventory、验证门槛都已合并到本文，不再需要拆读多个临时草稿才能开工。

---

## 目标

在 **不把框架升级、样式桥接重构、SSR 迁移、React 大版本变化一次性叠满** 的前提下，给 `wren-ui` 制定一条可落地的运行时升级路线，回答以下问题：

1. `Next.js` 要不要升、先升到哪一版
2. `less` 要不要升、是否还值得继续保留
3. `next-with-less` 是继续投资还是尽快退场
4. `styled-components` / `React` 应该排在什么顺序

结论先行：

- **要升 Next.js**，但建议 **先 `14 -> 15`，暂不直接跳 `16`**
- **`less` 不是当前主升级目标**，更关键的是压缩它的使用面
- **`next-with-less` 不是升级目标，而是退场目标**
- **`styled-components@6` 与 `React 19` 可评估，但应排在 Next 15 稳定之后**

---

## Wave 0 基线（执行前 repo facts）

基于 `wren-ui/package.json` / `next.config.js` / 本地扫描：

### 当前依赖版本

- `next = 14.2.35`
- `react = 18.2.0`
- `react-dom = 18.2.0`
- `antd = 6.3.6`
- `less = ^4.2.0`
- `less-loader = ^12.2.0`
- `next-with-less = ^3.0.1`
- `styled-components = 5.3.6`
- `typescript = 5.2.2`

### 当前最新版本（2026-04-21 盘点）

- `next = 16.2.4`
- `next@15 latest = 15.5.15`
- `react = 19.2.5`
- `less = 4.6.4`
- `less-loader = 12.3.2`
- `next-with-less = 3.0.1`
- `styled-components = 6.4.0`
- `typescript = 6.0.3`

### 当前结构事实

- 仍是 **Pages Router**：`src/app` 不存在，`src/pages/*` 为主
- `next.config.js` 直接使用 `withLess(...)`
- `next.config.js` 中存在较长的 `transpilePackages` 名单
- `compiler.styledComponents` 已启用 SWC transform
- repo 中约：
  - `antd` 直接 import 非测试文件：**303**
  - `styled-components` 非测试文件：**92**
  - `.less` 文件：**23**

### 当前文档已经记录的判断

- `docs/frontend-architecture-review-2026-04-18.md`
  - `pages` 目录组织会增加后续 **App Router / route 分层迁移成本**
- `docs/frontend-dependency-audit-2026-04-18.md`
  - `less` / `next-with-less` 应视为 **bridge**
  - `styled-components` 应 **stop spreading**
- `docs/frontend-architecture-progress-summary-2026-04-19.md`
  - 当前技术栈评估面仍集中在 `antd` / `styled-components` / `src/styles/**/*.less`

---

## 外部依据（official / primary sources）

### Next.js

- Next.js 15 官方发布说明：Pages Router 仍支持 React 18
  - https://nextjs.org/blog/next-15
- Next.js 16 官方升级文档：
  - 默认走 Turbopack 路径
  - 对 custom webpack / build pipeline 约束更强
  - https://nextjs.org/docs/app/guides/upgrading/version-16

### 其他依赖

- Less npm：https://www.npmjs.com/package/less
- less-loader npm：https://www.npmjs.com/package/less-loader
- next-with-less npm：https://www.npmjs.com/package/next-with-less
- styled-components FAQ / migration：https://styled-components.com/docs/faqs
- React 官方 blog：https://react.dev/blog

---

## 关键判断

### 1. Next.js：有必要升级，但先到 15

原因：

1. 当前仓库还是 **典型 Pages Router 单体结构**
   - `src/pages/*` 路由面很大
   - `src/app` 还没有落地
2. 当前样式链仍依赖：
   - `less`
   - `less-loader`
   - `next-with-less`
   - `styled-components`
3. 如果直接从 `14 -> 16`：
   - 会把 **框架升级风险**
   - **样式桥接风险**
   - **build pipeline 风险**
   一次性叠加
4. Next.js 15 官方仍保留 **Pages Router + React 18** 路线，适合作为中间稳定台阶

结论：

- **推荐下一跳：`Next 14 -> 15.5.15`**
- **不建议现在直接 `14 -> 16`**

---

### 2. Less：不是主升级目标，更像桥接栈收口对象

原因：

1. 当前 repo 虽然只有约 **23 个 `.less` 文件**，但它们多数不是单纯局部样式，而是：
   - 全局样式入口
   - Antd 覆盖
   - 变量映射
   - 历史主题链路
2. `less 4.2 -> 4.6.x` 本身收益有限
3. 当前真正的升级阻力不在 Less 语法，而在 **Less 仍挂在 Next 的构建入口里**

结论：

- `less` / `less-loader` **可以顺手小升**
- 但 **不要把它当成主升级目标**
- 当前更有价值的是：
  - 梳理 Less 使用面
  - 迁移局部样式
  - 缩小全局 override

---

### 3. `next-with-less`：不是升级目标，是退场目标

本地依赖源码可见：

- 它通过复制 / 改写 Next 的 Sass 规则来接入 Less
- 包内注释仍写着 **“tested on next@11.0.1”**
- 本质上是一个 **webpack patch bridge**

这意味着：

- 它在 Next 14 下还能工作，**不代表它是长期稳定基础设施**
- 继续升更高 Next 版本时，它会成为最明显的 build 风险点之一
- 尤其在 Next 16 默认 Turbopack 的语境下，custom webpack bridge 的长期价值更低

结论：

- **不要继续投资“怎么把 next-with-less 升得更高”**
- 应把它当成 **退场对象**

---

### 4. `styled-components` / `React`：值得评估，但应后置

#### `styled-components`

当前使用面很大（约 92 个非测试文件），仍承担：

- shell
- brand
- layout
- SSR

因此：

- 它不是一个可以“顺手大版本升级”的小包
- `5 -> 6` 应该放在：
  - Next 15 稳定之后
  - Less bridge 压缩之后
  再单独评估

#### `React`

由于 Next.js 15 官方仍允许 Pages Router 使用 React 18，所以：

- **React 19 不是当前必须同步做的第一步**
- 更合理的顺序是：
  1. `Next 14 -> 15`
  2. 稳住 build / SSR / style bridge
  3. 再评估 `React 19`

---

## 升级优先级矩阵

| 项目 | 当前 | latest | 建议 | 优先级 | 说明 |
| --- | --- | --- | --- | --- | --- |
| Next.js | 14.2.35 | 16.2.4 | **先升到 15.5.15** | 高 | 当前最值得升级 |
| React | 18.2.0 | 19.2.5 | 暂缓到 Next 15 后 | 中 | 不是第一跳 |
| less | ^4.2.0 | 4.6.4 | 可小升，但不是重点 | 低/中 | 真问题是 bridge 仍在 |
| less-loader | ^12.2.0 | 12.3.2 | 跟 less 一起小升 | 低/中 | 不单独成波次 |
| next-with-less | ^3.0.1 | 3.0.1 | **不继续投资，准备移除** | 高 | 是退场项，不是升级项 |
| styled-components | 5.3.6 | 6.4.0 | 后置评估 v6 | 中 | 使用面大，需单独波次 |
| TypeScript | 5.2.2 | 6.0.3 | 暂缓 | 低 | 不应与 Next / styles 同时爆改 |

---

## 今日基线验证（2026-04-21）

### 已实际执行

在 `wren-ui/` 下执行：

- `yarn check-types` ✅
- `yarn lint` ✅
- `yarn build` ✅

### Build 当前可用性结论

- 当前 `Next 14.2.35 + Antd 6.3.6 + next-with-less + styled-components 5` 组合，**构建仍然可以通过**
- `yarn build` 当前仍依赖：
  - `next-with-less`

所以当前构建链是：

- **可用**
- 但 **明显存在桥接与兼容补丁债务**

### Jest 当前状态

在 `wren-ui/` 下执行：

- `yarn test --runInBand` ❌

本次运行中观察到的失败 / 红灯包括：

- `src/server/services/tests/mdlService.test.ts`
- `src/server/services/tests/automationService.test.ts`
- `src/pages/api/v1/connectors/test.ts`
- `src/components/pages/apiManagement/DetailsDrawer.test.tsx`
- `src/components/pages/workspace/ScheduleRunDetailsDrawer.test.tsx`
- `src/server/services/tests/workspaceService.test.ts`
- `src/tests/pages/workspace/schedules.test.tsx`

### 当前测试层暴露出的 Antd 6 兼容余波

本次 Jest 输出还反复出现这些 deprecation warning：

- `Space.direction` -> 应改 `orientation`
- `Alert.message` -> 应改 `title`
- `Drawer.width` -> 应改 `size`

结论：

- **运行时 build 已稳定，但测试基线还不是全绿**
- `Next 15` 升级前应先接受一个现实：
  - 当前主风险不是“项目完全 build 不起来”
  - 而是“测试基线本身已有业务债 + Antd 6 余波 + 兼容页 debt”

## Wave 1 当前执行状态（2026-04-21）

### 已落地的升级与兼容修复

- `next / eslint-config-next / @next/bundle-analyzer` 已升级到 `15.5.15`
- `package.json` 的 `lint` 已切到 `eslint` CLI，避免继续依赖 Next 16 将移除的 `next lint` 包装
- `package.json` 的 `start` 已改为 `node .next/standalone/server.js`，与 `output: 'standalone'` 对齐，避免继续触发 `next start` 警告
- 为兼容 Next 15 更严格的 `pages/api` validator，已把以下 **非 route helper** 从 `src/pages/api/**` 收口到 `src/server/api/**`：
  - `auth/responseUser.ts`
  - `auth/sessionCookie.ts`
  - `scim/audit.ts`
  - `platform/platformApiUtils.ts`
  - `skills/shared.ts`
  - `stream/streamAskHelpers.ts`
  - `workspace/scheduleActionSupport.ts`
  - `workspace/schedulesOverviewSupport.ts`
  - `workspace/workspaceCurrentPermissions.ts`
  - `workspace/workspaceCurrentViews.ts`
- 相关 API route import 已同步改到 `@server/api/**`，并补上 `platform/system-tasks/**` 的遗漏引用

### 当前验证结果（Wave 1 代码级 gate）

在 `wren-ui/` 下重新执行：

- `yarn check-types` ✅
- `yarn lint` ✅
- `yarn build` ✅
- `PORT=3100 yarn start` ✅
- `next dev` 关键页面请求 ✅

轻量 route smoke（本地启动后直接请求 HTML）已覆盖：

- `/`
- `/home`
- `/home/dashboard`
- `/knowledge`
- `/settings`
- `/settings/workspace`
- `/settings/skills`
- `/workspace`
- `/workspace/schedules`
- `/setup/connection`
- `/setup/models`
- `/setup/relationships`

上述路由在本地 `standalone` server 下都返回 `200`。

额外补充一条 **Next 15 dev-only 修复**：

- 曾在本地 dev server 复现 `/home/[id]` 返回 `500`
- HTML 中的根因是：
  - `Module not found: Can't resolve 'private-next-instrumentation-client'`
- 该问题不是业务页逻辑问题，而是 `next-with-less` 仍挂在构建链时，Next 15 client dev alias 未被稳定保留
- 已在 `wren-ui/next.config.js` 的 client webpack 配置中显式补齐：
  - `private-next-instrumentation-client`
  - `private-next-empty-module`
- 修复后已重新验证：
  - `http://localhost:3002/home/19?...` 返回 `200`
  - 返回 HTML 中不再包含 `private-next-instrumentation-client`
  - 原先报错时会跟着出现的 fallback chunk 请求不再返回 `500`（当前为正常 `404`，因为不再进入错误页 fallback 兜底链路）
- 另外，在 Next 15 Pages Router dev 模式下，本地浏览器控制台还会收到：
  - `[HMR] Invalid message: {"action":"isrManifest"...}`
  - `TypeError: Cannot read properties of undefined (reading 'components')`
- 根因来自 Next 15 的 dev indicator 在 `isrManifest` 消息早于 `window.next.router` 初始化时访问 `router.components`
- 当前已通过 `next.config.js -> devIndicators: false` 暂时关闭该 dev-only 指示器，消除控制台 warning；代价是本地不再显示 Next 自带的 dev build/static indicator

当前 Next 15 运行时链路仍暴露一项待清理结构：

1. `next.config.js` 仍依赖 `next-with-less` 处理全局 less 入口

### 当前对 Wave 1 的判断

- **Next 15 最小升级 + pages/api helper 收口已经跑通**
- **Next 15 dev server 的 `private-next-instrumentation-client` 裂缝也已补上**
- **代码级兼容门槛已通过**
- **交互 smoke / 关键页面人工回归仍建议补一轮**，但这不再是 build blocker

---

# 执行波次

## Wave 0 — 升级前冻结基线

### 目标

把当前运行时状态与关键风险冻结下来，避免升级时“到底是新问题还是老问题”说不清。

### 本波次必须完成的事情

#### W0-1. 冻结命令基线

标准命令：

```bash
cd wren-ui
yarn check-types
yarn lint
yarn test --runInBand
yarn build
```

记录格式：

| command | status | note |
| --- | --- | --- |
| `yarn check-types` | pass | 2026-04-21 已验证 |
| `yarn lint` | pass | 2026-04-21 已验证 |
| `yarn test --runInBand` | fail | 当前基线已有多组失败与 Antd 6 warning |
| `yarn build` | pass | 2026-04-21 已验证 |

#### W0-2. 冻结关键路由 smoke list

至少覆盖：

- `/`
- `/home`
- `/home/[id]`
- `/home/dashboard`
- `/knowledge`
- `/settings`
- `/settings/workspace`
- `/settings/skills`
- `/workspace`
- `/workspace/schedules`
- `/setup/connection`
- `/setup/models`
- `/setup/relationships`

每个页面至少记录：

- 页面是否能打开
- 首屏是否有 SSR / hydration / 样式异常
- 控制台是否报错
- 是否有明显布局错位 / FOUC

#### W0-3. 冻结样式桥接 inventory

- 哪些 `.less` 是 global / override / local
- 哪些 override 强依赖 `.ant-*`
- 哪些文件可直接迁到 CSS Modules / CSS vars / tokens

#### W0-4. 冻结 SSR / build inventory

- `_app.tsx`
- `_document.tsx`
- `next.config.js`
- `package.json` scripts

### Wave 0 完成标准

- 基线命令状态已记录
- 路由 smoke list 已定义
- Less inventory 已有首版
- SSR / build inventory 已有首版
- 能清楚区分：
  - **Next 15 的阻塞项**
  - **Next 16 才会变成硬阻塞项**

---

## Wave 1 — 升级 Next.js 14 -> 15.5.15

### 目标

把框架先升级到更稳妥的中间台阶，不一次性冲到 Next 16。

### 范围

- `next`
- `eslint-config-next`
- `@next/bundle-analyzer`

先保持不动：

- `react` / `react-dom = 18`
- `styled-components = 5`
- `next-with-less`
- `less` / `less-loader`
- `typescript`

### 原则

- 只做 **框架升级 + 最小兼容修复**
- 不把 Less 退场、styled-components 大版本升级、React 19 混进同一波
- 不在这波顺手清所有 Antd 6 deprecation warning

### 推荐 commit 切法

#### Commit A

- bump `next` / `eslint-config-next` / `@next/bundle-analyzer`

#### Commit B

- 处理 Next 15 直接报错 / 类型错误 / lint 兼容项

#### Commit C

- 跑 build 与关键页面 smoke，记录回归结果

### 验收

- `yarn check-types`
- `yarn lint`
- `yarn build`
- 关键页面 smoke 通过
- `next-with-less` 仍能在 Next 15 下稳定工作

### 本波次风险点

- Pages Router 下的数据获取语义变化
- 老的 build / lint 行为变化
- `transpilePackages` 对构建时序的影响
- `next-with-less` 在 Next 15 下是否引入新裂缝
- `next-with-less` 退场前的最小 less 兼容面还能否继续压缩

### 本波次 Definition of Done

- `Next 15.5.15` build 通过
- key routes 没有明显 SSR / hydration / FOUC 回归
- 不引入新的 build-time patch 依赖

---

## Wave 2 — 压缩 Less bridge 面积

### 目标

不是“先把 Less 升到最新”，而是先缩小它对运行时与构建链的影响面。

### 当前执行状态（2026-04-21）

- 已完成 **前三刀低风险 utility / foundation / component global class 迁移**
- 新增：
  - `wren-ui/src/styles/runtime-utilities.css`
  - `wren-ui/src/styles/runtime-foundation.css`
- `src/pages/_app.tsx` 现在同时引入：
  - `../styles/index.less`
  - `../styles/runtime-foundation.css`
  - `../styles/runtime-utilities.css`
- 已从 Less bridge 中移出 14 个低风险文件：
  - `src/styles/components/avatar.less`
  - `src/styles/components/button.less`
  - `src/styles/components/scrollbar.less`
  - `src/styles/components/driver.less`
  - `src/styles/layouts/global.less`
  - `src/styles/layouts/main.less`
  - `src/styles/utilities/animation.less`
  - `src/styles/utilities/display.less`
  - `src/styles/utilities/flex.less`
  - `src/styles/utilities/grid.less`
  - `src/styles/utilities/color.less`
  - `src/styles/utilities/spacing.less`
  - `src/styles/utilities/text.less`
  - `src/styles/utilities/border.less`
- 基线是 **23 个 `.less` 文件**；当前已降到 **9 个 `.less` 文件**
- 目前已迁出的内容包括：
  - `@keyframes fade-in`
  - display / cursor / overflow 工具类
  - flex 工具类
  - grid / gap 工具类
  - color utility（`bg-* / text color / border color`）
  - spacing utility（`m/p + axis + negative spacing`）
  - text utility（font size / weight / align / truncate / family）
  - border / rounded utility
  - `adm-avatar-xs`
  - `adm-btn-no-style`
  - `adm-onboarding-btn`
  - `adm-modeling-header-btn`
  - `adm-fix-it-btn`
  - `adm-scrollbar-track`
  - `:root` color vars / disabled var
  - `adm-main / adm-layout / adm-content`
  - driver.js popover 全局皮肤
- 当前仍未处理的变量型 / override 型 Less 主要集中在：
  - `themes/nova.less`
  - `components/table.less`
  - `components/chart.less`
  - `components/transfer.less`
  - `components/select.less`
  - `components/alert.less`
  - `components/tag.less`
  - `antd-variables.less`
- 这意味着剩余 Less 已基本收敛到：
  - legacy variable layer
  - Nova theme
  - Antd DOM override / component-specific override

### 当前验证结果（Wave 2 第三刀后）

在 `wren-ui/` 下执行：

- `yarn lint` ✅
- `yarn build` ✅

结论：

- **utility + foundation 层已经基本脱离 Less loader**
- **Next 15 build 仍稳定**
- **剩下的 Less 已经集中到真正难拆的 theme / override 区域**

### 任务

#### W2-1. 将 `.less` 文件分级

分成 3 类：

1. **可迁走**
   - 页面局部样式
   - 不依赖 Less 变量能力的文件
2. **暂留**
   - 仍承担全局变量 / 主题映射的文件
3. **高风险 override**
   - 大量 `.ant-*` DOM 结构耦合
   - 依赖历史 DOM 语义的覆盖层

#### W2-2. 优先迁走局部样式

优先迁向：

- CSS Modules
- CSS variables
- 已经存在的 token / theme 层

#### W2-3. 缩小全局 Antd override

目标不是一次清零，而是：

- 先把最脆弱的 DOM 结构覆盖找出来
- 标记哪些能被 Antd v6 token / semantic API 替代

#### W2-4. 小版本刷新 Less 链

这一步是 **顺手动作**，不是主目标：

- `less -> 4.6.4`
- `less-loader -> 12.3.2`

### 验收

- `.less` 文件总量下降，或至少完成风险分级
- 局部页面样式不再依赖 Less loader
- 全局 `.ant-*` override 数量下降
- Next 15 build 仍然通过

---

## Wave 3 — 移除 `next-with-less`

### 目标

把桥接插件从关键构建链上拿掉，为后续 Next 16 做准备。

### 原则

- 这是 **架构收口波次**，不是简单版本 bump
- 必须先有 Wave 2 的样式迁移结果

### 任务

#### W3-1. 将剩余 Less 依赖隔离到最小壳层

#### W3-2. 去掉 `withLess(...)` 包装

#### W3-3. 移除 `less-loader` / `next-with-less` 依赖

如果仍有少量全局样式残留，则优先改成：

- 原生 CSS
- CSS Modules
- variables
- Antd token

### 验收

- `next.config.js` 不再依赖 `next-with-less`
- `package.json` 不再需要 `next-with-less`
- `less-loader` 已可移除或只剩非常局部的过渡价值
- `yarn build` 在 Next 原生构建链下稳定通过

### 本波次 Definition of Done

- `package.json` scripts 不再依赖 node_modules patch
- build pipeline 不再依赖 Less bridge plugin
- 后续尝试 Next 16 时，不再被 `withLess` / webpack patch 直接阻塞

---

## Wave 4 — 后置评估项

### 4A. Next.js 15 -> 16

前提：

- `next-with-less` 已移除
- build pipeline 已回到 Next 原生路径
- 关键 Pages Router 页面在 Next 15 下已稳定

再决定是否做：

- 如果仍大量依赖 Pages Router + 历史 SSR 约定，则可以暂留 15 一段时间
- 如果 build / routing / styles 已收口，再评估 16

### 4B. React 18 -> 19

前提：

- Next 主版本已稳定
- 依赖兼容性已确认
- 无必须绑定在同一波处理的 SSR 风险

原则：

- 不和 Next 主升级、Less 退场同波执行

### 4C. styled-components 5 -> 6

前提：

- `_document.tsx` / SSR 注入链已清楚
- 关键 shell / layout 页面已有回归验证
- 不再同时叠加 Next / React / Less 迁移

原则：

- 单独评估 prop forwarding / typing / SSR 差异
- 如果只是为了“升最新版”，优先级低于 build pipeline 收口

---

## 不建议的组合升级

以下组合 **不建议合并成一波**：

1. `Next 14 -> 16`
2. `React 18 -> 19`
3. `styled-components 5 -> 6`
4. `Less` 链重构
5. `next-with-less` 退场
6. `TypeScript 5 -> 6`

原因：

- 会把 **框架、运行时、样式、SSR、构建器、类型系统** 六类风险叠满
- 一旦回归，很难快速定位到底是哪一层导致

---

## Wave 0 Less inventory（基线首版）

> 说明：这是 Wave 0 基线盘点。当时 23 个 `.less` 文件全部在 `src/styles/**` 下，并且统一由 `src/styles/index.less` 入口串起来。Wave 2 前三刀已把其中 14 个低风险文件迁到 `runtime-utilities.css` / `runtime-foundation.css`，当前剩余 9 个 `.less` 文件。

| file | type | usage | risk | replacement target | note |
| --- | --- | --- | --- | --- | --- |
| `src/styles/index.less` | global | 样式总入口，串起全部 less | high | 拆成 global CSS + token/theme + 局部样式入口 | 当前 `_app.tsx` 直接引入 |
| `src/styles/antd-variables.less` | global | 业务 less 仍依赖的 legacy 变量层 | high | CSS vars / TS theme constants / token map | 不是直接 runtime blocker，但决定了 Less 是否能退场 |
| `src/styles/themes/nova.less` | override | Nova 主题 + 多处 `.ant-*` 全局覆盖 | high | 拆到 `antdTheme` token 与少量 global CSS | 当前全局样式耦合最深 |
| `src/styles/layouts/global.less` | global | `:root` / body / dark-prefers 兜底 | medium | global CSS | 可较容易脱离 Less |
| `src/styles/layouts/main.less` | global | shell / main layout 高度规则 | medium | global CSS / shell component style | 与路由壳层相关 |
| `src/styles/components/table.less` | override | Table DOM 结构覆盖 | high | Antd Table token / semantic classNames / rowClassName | `.ant-table*` 耦合最重之一 |
| `src/styles/components/transfer.less` | override | Transfer / empty 态覆盖 | medium | 组件局部样式 + semantic classNames | 带 `.ant-transfer` / `.ant-table-wrapper` |
| `src/styles/components/alert.less` | override | Alert icon / message 对齐 | medium | Alert token / classNames | `.ant-alert` 直接覆盖 |
| `src/styles/components/tag.less` | override | Tag 变体颜色覆盖 | medium | Tag color preset / app class | `.ant-tag` 变体类 |
| `src/styles/components/select.less` | override | grouped option 内边距 | medium | Select semantic classNames | `.ant-select-item-option-grouped` |
| `src/styles/components/chart.less` | local+override | 图表容器样式 + `.ant-btn-icon-only` 细节 | medium | feature-local CSS + 删除 Antd 按钮覆盖 | 需要拆成 feature 样式与 override 两段 |
| `src/styles/components/avatar.less` | local | `adm-avatar-xs` 业务类 | low | CSS Modules / component local style | 无 Antd DOM 耦合 |
| `src/styles/components/button.less` | local | 多个 `adm-*` 按钮业务类 | low | component local style / CSS Modules | 不应继续留在全局 less |
| `src/styles/components/driver.less` | global | driver.js 全局皮肤 | medium | dedicated global CSS | 依赖第三方 DOM，但与 Next 无强耦合 |
| `src/styles/components/scrollbar.less` | global | 滚动条 utility | low | global CSS | 可直接迁出 Less |
| `src/styles/utilities/animation.less` | utility | animation utility | low | global CSS / utility CSS | 机械迁移成本低 |
| `src/styles/utilities/border.less` | utility | border utility classes | low | global CSS / utility CSS | 与 Less 变量层有关，但不复杂 |
| `src/styles/utilities/color.less` | utility | color utility classes | medium | CSS vars + utility CSS | 仍依赖颜色变量生成 |
| `src/styles/utilities/display.less` | utility | display / cursor / overflow 工具类 | low | global CSS / utility CSS | 机械迁移优先项 |
| `src/styles/utilities/flex.less` | utility | flex 工具类 | low | global CSS / utility CSS | 机械迁移优先项 |
| `src/styles/utilities/grid.less` | utility | grid / gap 工具类 | low | global CSS / utility CSS | 机械迁移优先项 |
| `src/styles/utilities/spacing.less` | utility | spacing 工具类 | medium | global CSS / utility CSS / design token util | 使用面可能广，需先统计引用 |
| `src/styles/utilities/text.less` | utility | typography 工具类 | medium | global CSS / utility CSS / typography token util | 与字号/字体变量映射有关 |

### Less inventory 的优先处理顺序

#### 第一优先级（直接决定 `next-with-less` 退场难度）

- `src/styles/index.less`
- `src/styles/antd-variables.less`
- `src/styles/themes/nova.less`
- `src/styles/components/table.less`

#### 第二优先级（高概率可先迁掉）

- `src/styles/components/button.less`
- `src/styles/components/avatar.less`
- `src/styles/components/scrollbar.less`
- `src/styles/utilities/animation.less`
- `src/styles/utilities/display.less`
- `src/styles/utilities/flex.less`
- `src/styles/utilities/grid.less`

#### 第三优先级（可后置，但应明确去留）

- `src/styles/components/chart.less`
- `src/styles/components/driver.less`
- `src/styles/utilities/color.less`
- `src/styles/utilities/spacing.less`
- `src/styles/utilities/text.less`

---

## Wave 0 SSR / build inventory（基线首版）

| Surface | 当前状态 | 风险等级 | 对升级的含义 |
| --- | --- | --- | --- |
| `src/pages/_app.tsx` | 同时引入 `antd/dist/reset.css` 与 `../styles/index.less`，并用 `ConfigProvider + AntdApp + AntdAppBridge + PersistentConsoleShell` 包住全局 | high | 说明 Antd token、global less、shell provider 三条链并存 |
| `src/pages/_document.tsx` | 同时做 `styled-components` SSR 和 `@ant-design/cssinjs` SSR 提取 | high | Next / React / styled-components 升级都要先保护这条链 |
| `next.config.js` | 使用 `withLess(...)` 包装主配置，带长 `transpilePackages` 清单 | high | `next-with-less` 是 Next 16 前的主要结构阻塞项 |
| `next.config.js` | `compiler.styledComponents` 开启 | medium | 说明 styled-components 已深度接入 SWC transform |
| `package.json` scripts | `dev/build/start` 已不再注入 rc-component ESM patch | low | 说明当前生产构建链路已不依赖 node_modules patch |

### 当前 build pipeline 的真实结论

当前不是“普通 Next 项目”，而是：

- Pages Router
- Antd 6 css-in-js SSR
- styled-components SSR
- global less bridge
- `next-with-less`
也因此：

- **Next 15 可以做，但需要把它当作运行时兼容升级，不是单纯版本 bump**
- **Next 16 不应在当前链路未收口前直接尝试**

---

## Wave 0 清单（合并版）

### 1. 基线验证命令

```bash
cd wren-ui
yarn check-types
yarn lint
yarn test --runInBand
yarn build
```

### 2. 关键路由 smoke list

- `/`
- `/home`
- `/home/[id]`
- `/home/dashboard`
- `/knowledge`
- `/settings`
- `/settings/workspace`
- `/settings/skills`
- `/workspace`
- `/workspace/schedules`
- `/setup/connection`
- `/setup/models`
- `/setup/relationships`

每个页面至少记录：

- 页面是否能打开
- 首屏是否有 SSR / hydration / 样式异常
- 控制台是否报错
- 是否有明显布局错位 / FOUC

### 3. Wave 1 允许改动的范围

允许：

- `next`
- `eslint-config-next`
- `@next/bundle-analyzer`
- 必要的最小兼容修复

不允许混入：

- React 19
- styled-components 6
- next-with-less 退场
- 大规模 Less 重构
- TypeScript 6

### 4. Wave 1 升级前必须满足

- `yarn check-types` 可通过
- `yarn lint` 可通过
- `yarn build` 可通过
- `yarn test --runInBand` 的红灯被记录并分类
- 关键路由 smoke 已完成一轮
- Less inventory 已完成首版
- SSR / build inventory 已完成首版

---

## 推荐执行顺序（最终版）

### P0

- `Next.js 14 -> 15.5.15`

### P1

- 梳理 / 压缩 Less 使用面
- 准备 `next-with-less` 退场

### P2

- `less` / `less-loader` 小升
- `styled-components v6` 可行性评估

### P3

- `Next.js 16`
- `React 19`
- `TypeScript 6`

---

## 第一批可直接开工的任务

### Task 1. 开一个只做 Next 15 的升级分支

只升级：

- `next`
- `eslint-config-next`
- `@next/bundle-analyzer`

并验证：

- `yarn check-types`
- `yarn lint`
- `yarn build`
- 关键路由 smoke

### Task 2. 先迁掉最容易脱离 Less 的文件

建议先动：

- `src/styles/components/button.less`
- `src/styles/components/avatar.less`
- `src/styles/components/scrollbar.less`
- `src/styles/utilities/animation.less`
- `src/styles/utilities/display.less`
- `src/styles/utilities/flex.less`
- `src/styles/utilities/grid.less`

### Task 3. 把高风险 override 单独列成改造清单

至少拆 3 组：

- Table / Transfer
- Nova theme / global `.ant-*`
- Alert / Tag / Select 等零散 override

### Task 4. 单独建一份“测试基线修复 backlog”

把本次 `yarn test --runInBand` 暴露出来的问题单列，不要混到 Next 15 commit 里：

- 失败测试修复
- Antd 6 deprecation warning 清理
- compatibility route 的历史 debt 收口

---

## 一句话结论

**antd 之外，最值得优先升级的是 `Next.js`；`less` 不是当前最该“升版本”的对象，`next-with-less` 更应该被视为需要逐步退场的桥接层。当前最稳妥的路线是：先把 `Next 14 -> 15.5.15` 做稳，再压缩 Less bridge，最后再考虑 `Next 16 / React 19 / styled-components 6`。**
