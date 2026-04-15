# Workspace 与 Knowledge Base 设计

## 1. 核心设计原则

### 1.1 Workspace = 访问控制边界

**Workspace 是唯一的访问控制边界。**

谁在哪个 workspace，谁就能访问该 workspace 下的所有 Knowledge Base（KB）。
**不引入 KB 级别的独立成员表**；访问控制统一通过 workspace 成员关系完成。

### 1.2 Workspace 决定可见性，Runtime Selector 决定执行上下文

- Workspace 决定：用户**能访问哪些 KB**
- Runtime Selector 决定：用户当前**在哪个 KB / Snapshot / Deploy 上执行**

运行时主语义继续保持为：

```text
workspaceId + knowledgeBaseId + kbSnapshotId + deployHash
```

因此：

- 权限边界在 workspace
- 执行边界在 KB / Snapshot / Deploy

### 1.3 默认 Workspace 与业务 Workspace 分离

系统内存在两类 workspace：

```text
默认 Workspace（系统样例空间）
  ├── KB: HR
  ├── KB: ECOMMERCE
  ├── KB: MUSIC
  └── KB: NBA

业务 Workspace（团队协作空间）
  ├── KB: 销售数据
  ├── KB: 财务分析
  └── KB: 内部运营数据
```

结论：

- **默认 workspace 只承载系统样例 KB**
- **真实业务数据只进入非默认 workspace**

---

## 2. Workspace 类型

### 2.1 默认 Workspace（系统唯一）

- 系统首次启动（bootstrap）时自动创建
- 自动预置 4 个示例 Knowledge Base：**HR、ECOMMERCE（巴西电商）、MUSIC、NBA**
- 默认 workspace 是**系统样例空间**，只用于体验产品能力
- **不允许用户在默认 workspace 中创建业务 KB、接入业务数据源或混入真实业务数据**
- bootstrap 的第一个用户同时成为：
  - **平台级 admin**
  - 默认 workspace 的 `owner`
- **新注册用户默认加入默认 workspace**，角色为 `member`

#### 默认 Workspace 中示例 KB 的管理规则

默认 workspace 中的示例 KB 属于**系统托管资产**：

- 不允许用户删除
- 不允许用户隐藏
- 不允许用户归档
- 不提供用户侧生命周期管理入口

如需调整示例 KB，只能通过系统初始化、升级、重置或专门的系统运维流程处理。

### 2.2 业务 Workspace

- 业务 workspace 用于承载真实业务数据
- **不预置示例 KB**，从空白开始
- **仅平台级 admin 可以创建新的业务 workspace**
- 创建时必须指定一个**已有用户**作为该 workspace 的初始 `owner`
- 平台级 admin 只是创建者，**不自动成为该 workspace 的 owner**

---

## 3. 用户与 Workspace 关系

| 操作 | 说明 |
|---|---|
| 系统首次启动 | bootstrap 创建默认 workspace；第一个用户成为平台级 admin + 默认 workspace owner |
| 新用户注册 | 自动加入默认 workspace，角色为 `member` |
| 申请加入业务 workspace | 普通用户可申请加入，待该 workspace 的 owner/admin 审批 |
| 邀请加入业务 workspace | 由该 workspace 的 owner/admin 邀请指定用户加入 |
| 创建新业务 workspace | 仅平台级 admin 可创建，并指定初始 owner |
| 访问 KB | 由所在 workspace 决定，无需单独授权 |

用户可以同时属于多个 workspace，并在不同 workspace 之间切换。

---

## 4. 角色模型

### 4.1 平台级角色

| 角色 | 权限 |
|---|---|
| `platform_admin` | 创建业务 workspace、指定业务 workspace 初始 owner、维护系统级能力 |

说明：

- `platform_admin` 是**平台级权限**，不是某个 workspace 内的普通管理角色
- workspace 内的 `owner` / `admin` **不自动拥有**创建新 workspace 的权限

### 4.2 Workspace 级角色

| 角色 | 权限 |
|---|---|
| `owner` | 该 workspace 的最终负责人；可管理成员、审批申请、管理业务资源 |
| `admin` | 该 workspace 的管理员；可管理成员、审批申请、管理业务资源 |
| `member` | 使用与查看该 workspace 中的 KB，不具备资源管理权限 |

说明：

- `owner` / `admin` 的权限范围仅限于**自己所在的 workspace**
- `member` 不具备 KB 生命周期管理权限

---

## 5. Knowledge Base 访问控制与生命周期

### 5.1 访问控制

| 场景 | 控制方式 |
|---|---|
| 控制某些 KB 只对特定团队可见 | 为该团队创建独立 workspace，在其中创建 KB，并通过邀请/审批控制成员 |
| 所有人共用系统样例 KB | 所有人自动加入默认 workspace |
| 某个团队共用一套业务 KB | 让该团队成员加入同一个业务 workspace |

### 5.2 生命周期规则

#### 默认 Workspace 中的示例 KB

- 系统托管
- 不允许 delete / hide / archive
- 对默认 workspace 成员始终可见

#### 业务 Workspace 中的普通 KB

- 只允许 `owner` / `admin` 执行 **archive / unarchive**
- **不提供硬删除（hard delete）入口**
- archived KB 默认不出现在常规列表中
- `member` 不可归档、恢复或删除 KB

---

## 6. Workspace 进入与默认选择

当用户属于多个 workspace 时，系统支持两层偏好：

1. **账号级默认 workspace**
   - 用户可以设置一个 `defaultWorkspaceId`
   - 该偏好保存在服务端，跨设备生效

2. **浏览器本地上次成功选择的 workspace / runtime selector**
   - 页面自动恢复用户上次成功进入的 workspace
   - 可继续与当前 runtime selector 一起持久化

### 6.1 进入优先级

用户进入系统时，workspace 选择优先级固定为：

1. URL / 显式请求参数中的 selector
2. 浏览器本地保存的**上次成功使用的 workspace / selector**
3. 用户设置的 `defaultWorkspaceId`
4. 系统默认 workspace

### 6.2 回退规则

如果上次选择的 workspace：

- 已被移除
- 用户已无权限访问
- 或相关 runtime selector 已失效

则自动回退到下一优先级，不报致命错误。

---

## 7. 不支持的场景

以下场景在当前设计中**不支持**，属于有意为之的范围限制：

- KB 级别的独立成员表
- 在默认 workspace 中接入真实业务数据
- 用户删除 / 隐藏 / 归档系统示例 KB
- `open/public` 方式自助加入业务 workspace
- 普通业务 KB 的硬删除
- workspace `owner` / `admin` 仅凭 workspace 角色就创建新的 workspace
