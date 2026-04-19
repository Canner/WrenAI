# Frontend Dependency Audit — 2026-04-18

对应：`docs/frontend-architecture-backlog-2026-04-18.md` Wave 7。

## 当前结论

### 已收口

- `next`: `14.2.35`
- `eslint-config-next`: `14.2.35`
- `@next/bundle-analyzer`: `14.2.35`

这三项现在已经对齐，不再存在主版本漂移。

### 重复 / 可疑依赖检查

#### `cron-parser`

- 当前只保留一份：`dependencies.cron-parser@^5.1.1`
- `yarn why cron-parser` 结果显示：仅由 `wren-ui` 自身直接声明使用
- 已从 `devDependencies` 中移除重复声明

## 保留理由

| 依赖 | 当前状态 | 说明 |
|---|---|---|
| `next` | 保留 | Pages Router + API routes 当前仍依赖 Next 运行时 |
| `eslint-config-next` | 保留 | 与 Next 版本对齐，避免 lint 规则漂移 |
| `@next/bundle-analyzer` | 保留 | 前端 bundle 审计工具，需与 Next 主版本一致 |
| `cron-parser` | 保留 | 调度 / 系统任务相关逻辑仍直接使用 |

## 后续建议

1. 若进入下一轮前端技术栈升级，再统一评估 Next / React / TypeScript 升级窗口。
2. 如要继续做依赖瘦身，优先从“仅被单一 feature 使用、可替换成本低”的工具类包开始。
3. 保持 bundle analyzer、eslint config 与 Next 主版本锁步，避免再次漂移。
