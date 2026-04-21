# Frontend Runtime Upgrade Wave 0 Checklist — 2026-04-21

对应：

- `docs/frontend-runtime-upgrade-plan-2026-04-21.md`

## 目标

在开始 `Next.js 14 -> 15` 之前，先冻结当前基线，并把 Less / SSR / build pipeline 风险点盘清楚。

---

## 1. 基线验证命令

在 `wren-ui/` 下执行：

```bash
yarn check-types
yarn lint
yarn test
yarn build
```

记录内容：

- 命令是否通过
- 失败命令的完整报错摘要
- 是否存在 flaky / 环境相关失败
- 构建时长（可选）

---

## 2. 关键路由 smoke list

至少验证以下页面：

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

---

## 3. Less inventory 模板

| file | type | usage | risk | replacement target | note |
| --- | --- | --- | --- | --- | --- |
| `src/styles/...` | global / override / local | theme / antd override / page style | high / medium / low | keep / css modules / css vars / antd token | ... |

### 分类规则

#### global

- 全局样式入口
- 全局变量
- 全局 reset / theme 注入

#### override

- `.ant-*` 相关覆盖
- 依赖 Antd DOM 结构的样式
- 历史组件兼容补丁

#### local

- 页面或 feature 局部样式
- 不依赖 Less 特性的普通样式

### 风险规则

#### high

- 影响全局主题
- 大量 `.ant-*` DOM 耦合
- 与 `_app.tsx` / `next.config.js` / 构建链直接相关

#### medium

- 影响单页大区域
- 与共用组件样式相关

#### low

- 明显局部页面样式
- 可机械迁移到 CSS Modules

---

## 4. SSR / build inventory 模板

### 4.1 `_app.tsx`

记录：

- 全局样式入口
- Provider 注入顺序
- Antd / theme / styled-components 相关初始化

### 4.2 `_document.tsx`

记录：

- `styled-components` SSR 注入方式
- 是否还有其他样式提取逻辑
- 是否存在 hydration 风险点

### 4.3 `next.config.js`

记录：

- `withLess(...)` 是否仍包裹主配置
- `transpilePackages` 清单
- `compiler.styledComponents` 配置
- 是否存在额外 webpack patch

### 4.4 其他 build 脚本

记录：

- `package.json` 中 dev/build/start/postinstall 是否有补丁脚本
- 这些脚本是否与 Antd / Less / rc-component 兼容有关

---

## 5. Wave 1 升级前的通过门槛

开始 `Next 14 -> 15` 之前，应至少满足：

- `yarn check-types` 可通过
- `yarn lint` 可通过
- `yarn build` 可通过
- 关键路由 smoke 已完成一轮
- Less inventory 已完成首版
- SSR / build inventory 已完成首版

---

## 6. Wave 1 仅允许改动的范围

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

---

## 一句话目标

**Wave 0 的成功标准不是“开始升级”，而是“把升级前的风险地图画清楚”。**
