# Test Spec — WrenAI V1 重构

## 1. 测试目标
在大改控制面、runtime identity 与 ask orchestration 前，先定义验证面，避免后续“功能做了但不可证明”。

## 2. 测试原则
1. 先锁当前行为，再切主脑。
2. 高风险链路必须同时有静态检查、集成验证和回滚验证。
3. `workspace / knowledge_base / kb_snapshot / deploy_hash / actor_claims` 必须做全链路字段传递验证。
4. 所有权限默认 deny-by-default。

## 3. 风险最高的验证面
- `getCurrentProject()` 清理不彻底
- deepagents 接管 ask 后效果回退
- thread / dashboard / schedule 绑定错误上下文
- secret 泄漏或错误注入
- PostgreSQL + pgvector 切换后召回/稳定性下降

## 4. 测试分层

### 4.1 Static / contract checks
- 扫描 UI/API/service/background 主路径中的 `getCurrentProject()` 使用点。
- 扫描 `project_id` / `id` alias 在 AI service request model 中的残留位置。
- 校验所有新 DTO 是否含 runtime identity 必填字段。
- 校验 secret 相关日志/审计不会输出明文。

### 4.2 Unit
#### Auth / session
- 本地账号登录成功/失败
- session 过期、撤销、刷新
- session -> actor claims 解析
- workspace / knowledge_base deny-by-default

#### Runtime identity
- request -> runtime scope resolver
- thread 创建时固化 knowledge base / snapshot
- thread_response / asking_task / api_history 持久化 runtime identity
- dashboard / schedule 创建时固化 deploy hash
- 同一 thread 内切换知识库被拒绝

#### Skill contract
- claims 注入
- secret 注入
- connector 注入
- 输出 normalization
- timeout / runner error -> fallback decision

#### Secret
- 加密、解密、key_version 写入
- 错误主密钥无法解密
- re-encrypt 脚本 dry-run / execute

### 4.3 Integration
#### Legacy project 导入
- `project -> knowledge_base + kb_snapshot + connector + secret_record` 导入
- deploy_log 与 kb_snapshot 的绑定建立
- api_history / thread / dashboard 的 runtime identity 补齐

#### Ask 主链路
- legacy ask 路径回归
- `ASK_RUNTIME_MODE=deepagents` 主路径跑通
- skill-first -> fallback NL2SQL
- structured retrieval 优先，vector 兜底

#### Dashboard / schedule
- 多 dashboard 并存
- dashboard refresh 使用 dashboard 自身 binding
- schedule job 入库、执行、失败重试、审计

#### Thread / history / async
- textBasedAnswerBackgroundTracker 使用 thread 自身 binding
- askingTaskTracker 恢复/取消/重跑不丢 runtime identity
- api_history 记录 actor + runtime scope

#### Storage cutover
- PostgreSQL + pgvector 初始化
- embedding 写入 / 查询
- 旧 qdrant/sqlite 数据导入
- 回滚快照恢复

### 4.4 E2E
- workspace A/B 隔离
- KB A/B 隔离
- 同 workspace 多 KB 下 ask / dashboard / schedule 不串上下文
- skill 查询 API 数据
- skill 查询 DB 数据
- mixed answer 生成与图表展示

## 5. Golden Regression 套件
对当前 ask 主链路建立 golden cases，至少覆盖：
1. 直接命中历史问题
2. SQL pair 命中
3. instruction 命中
4. 正常 NL2SQL
5. SQL correction 后成功
6. general/non-sql query
7. chart generation
8. 带 thread 历史追问

每个 case 记录：
- 输入 query
- runtime identity
- 预期 path（historical / skill / nl2sql / mixed）
- 预期 SQL 或结果结构
- 允许波动范围

## 6. 测试数据与夹具
### 6.1 Metadata fixtures
- 一个 legacy project 样本
- 两个 workspace
- 每个 workspace 至少两个 knowledge base
- 每个 knowledge base 至少两个 `kb_snapshot`

### 6.2 Skill fixtures
- `api_weather_skill`：调用 mock API
- `db_sales_skill`：连接测试 PostgreSQL
- `hybrid_skill`：先 API 再 DB

### 6.3 Security fixtures
- 无权限 session
- 跨 workspace session
- 失效 secret
- runner timeout / network denied

## 7. 观测与证据
### 7.1 必须采集
- ask path 命中率
- skill success / fallback rate
- SQL success rate
- pgvector retrieval latency
- dashboard refresh success rate
- schedule success / retry rate
- permission deny rate

### 7.2 证据产出
- golden regression 报告
- runtime identity propagation 报告
- thread/history/async task 绑定报告
- static scan 报告
- storage cutover 报告
- rollback 演练报告

## 8. 退出门槛
进入 Phase 1 前至少满足：
1. PRD 与 Phase 0 execution spec 已定稿。
2. test matrix 覆盖 auth、runtime identity、skill、secret、schedule、storage、ask regression。
3. golden regression case 已列完并能在 legacy 模式下执行。
4. `getCurrentProject()` 静态扫描与迁移顺序已固化。
5. pgvector cutover 的成功/失败判据已定义。

## 9. 建议优先实现的验证任务
1. `getCurrentProject()` repo-wide 扫描脚本
2. ask golden regression baseline
3. runtime identity contract tests
4. secret encryption contract tests
5. dashboard/schedule binding tests
6. pgvector provider smoke tests
