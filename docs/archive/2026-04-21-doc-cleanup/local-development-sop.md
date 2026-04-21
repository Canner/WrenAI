# WrenAI 本地开发 SOP（UI + AI Service 源码，Engine 依赖走 Docker）

> 适用阶段：当前 V1 开发主战场是 `wren-ui` 与 `wren-ai-service`，`wren-engine / ibis-server` 偶尔改动但不作为默认源码常驻服务。
>
> 本文档沉淀当前验证通过的本地开发方式，目标是：
> - 只保留 **一套** WrenAI 开发环境
> - `wren-ui` / `wren-ai-service` 保持源码调试效率
> - `wren-engine` / `ibis-server` / `postgres` / `trino` 保持接近真实运行环境

---

## 1. 默认开发拓扑

### 本地源码运行
- `wren-ui`
- `wren-ai-service`

### Docker 运行
- `bootstrap`
- `postgres`
- `wren-engine`
- `ibis-server`
- `trino`

> 注意：`docker/docker-compose.yaml` 中的 `wren-engine` 与 `ibis-server` 都是从仓库内的 `../wren-engine` 源码构建，不是固定远端二进制。
> 也就是说：**改了 engine 代码后，必须重建对应容器。**

---

## 2. 端口约定

| 服务 | 运行方式 | 端口 |
|---|---|---|
| wren-ui | 本地源码 | `3002` |
| wren-ai-service | 本地源码 | `5555` |
| ibis-server | Docker | `8000` |
| wren-engine | Docker | `8080` |
| trino | Docker | `8081` |
| postgres | Docker | `9432` |

---

## 3. 一次性初始化

### 3.1 Docker 配置

```bash
cd /Users/liyi/Code/WrenAI/docker
cp .env.example .env
```

### 3.2 AI Service 初始化

```bash
cd /Users/liyi/Code/WrenAI/wren-ai-service
poetry install
just init
```

### 3.3 UI 初始化

```bash
cd /Users/liyi/Code/WrenAI/wren-ui
yarn
```

> 建议使用 Node 18。

---

## 4. 每天标准启动流程

### Step A：启动 Docker 依赖层

```bash
cd /Users/liyi/Code/WrenAI/docker
docker compose --env-file .env up --build -d bootstrap postgres wren-engine ibis-server trino
```

> 默认 **不要** 启动 `wren-ui` 和 `wren-ai-service` 容器。

### Step B：本地启动 AI Service

```bash
cd /Users/liyi/Code/WrenAI/wren-ai-service
DEVELOPMENT=true \
WREN_AI_SERVICE_HOST=127.0.0.1 \
WREN_AI_SERVICE_PORT=5555 \
PG_CONN_STR=postgresql://postgres:postgres@127.0.0.1:9432/wrenai \
poetry run python -m src.__main__
```

说明：
- `DEVELOPMENT=true` 会启用本地开发模式与 reload。
- `5555` 是 UI 默认联调端口。
- `PG_CONN_STR` 不能为空；缺失时 sample KB 的语义索引/部署会失败，页面会表现成“知识库存在但没有可执行 runtime”。

### Step C：本地启动 UI

```bash
cd /Users/liyi/Code/WrenAI/wren-ui

export PG_URL=postgres://postgres:postgres@127.0.0.1:9432/wrenai
export OTHER_SERVICE_USING_DOCKER=true
export WREN_ENGINE_ENDPOINT=http://127.0.0.1:8080
export IBIS_SERVER_ENDPOINT=http://127.0.0.1:8000
export WREN_AI_ENDPOINT=http://127.0.0.1:5555
export TRINO_CATALOG_MANAGEMENT=dynamic
export TRINO_CATALOG_MANAGEMENT_HOST=127.0.0.1
export TRINO_CATALOG_MANAGEMENT_PORT=8081
export TRINO_CATALOG_MANAGEMENT_SSL=false
export TRINO_RUNTIME_HOST=127.0.0.1
export TRINO_RUNTIME_PORT=8081
export TRINO_RUNTIME_USER=wrenai
export TRINO_RUNTIME_SSL=false
export EXPERIMENTAL_ENGINE_RUST_VERSION=false

# 首次启动或 migration 变更后执行
yarn migrate

PORT=3002 yarn dev
```

---

## 5. 启动后的自检

### 5.1 Docker 依赖状态

```bash
cd /Users/liyi/Code/WrenAI/docker
docker compose --env-file .env ps
```

期望至少看到：
- `postgres`
- `wren-engine`
- `ibis-server`
- `trino`

### 5.2 AI Service 健康检查

```bash
curl http://127.0.0.1:5555/health
```

期望返回：

```json
{"status":"ok"}
```

### 5.3 UI 可访问

打开：

```text
http://127.0.0.1:3002
```

### 5.4 最小联调检查

至少确认以下 3 件事：
1. 页面能正常打开
2. 知识库 / 工作空间页面可进入
3. Ask 链路不会直接报 REST runtime scope / ai-service 连接错误

---

## 6. 改动后的标准动作

### 改 `wren-ui`

- 通常直接热更新
- 如果涉及 migration：

```bash
cd /Users/liyi/Code/WrenAI/wren-ui
yarn migrate
```

### 改 `wren-ai-service`

- 开发模式通常会自动 reload
- 如果未自动 reload，手动重启该进程即可

### 改 `wren-engine` / `ibis-server`

```bash
cd /Users/liyi/Code/WrenAI/docker
docker compose --env-file .env up --build -d --force-recreate wren-engine ibis-server
```

> 当前默认模式下，**不要先切源码直跑 engine**；先用容器重建更新本地源码构建版。

### 改 `trino` 相关运行时配置 / catalog

```bash
cd /Users/liyi/Code/WrenAI/docker
docker compose --env-file .env up -d --force-recreate trino
```

---

## 7. 关闭环境

### 关闭本地源码服务

在各自终端中执行：

```bash
Ctrl+C
```

### 关闭 Docker 依赖层

```bash
cd /Users/liyi/Code/WrenAI/docker
docker compose --env-file .env down
```

---

## 8. 常见问题与清理规则

### 8.1 只允许保留一套 WrenAI compose 项目

日常开发时，`docker compose ls` 应只保留：

```text
wrenai-local
```

如果看到以下旧项目残留，先停掉：
- `wrenai`
- `wrenai-federated-smoke`

清理命令：

```bash
cd /Users/liyi/Code/WrenAI/docker
docker compose -p wrenai down --remove-orphans
docker compose -p wrenai-federated-smoke down --remove-orphans
docker compose -p wrenai-local down --remove-orphans
```

然后再按本文第 4 节重新启动。

### 8.2 不要同时运行容器版 UI / AI Service

默认开发模式里：
- `wren-ui` 用本地源码
- `wren-ai-service` 用本地源码

因此不要再同时保留：
- `wren-ui` 容器
- `wren-ai-service` 容器

否则很容易混淆：
- 当前请求究竟打到哪一个服务
- 当前 UI 显示的是源码版本还是容器版本

### 8.3 端口冲突优先排查

如果端口被占用，优先检查是否有旧项目占用了这些标准端口：

| 端口 | 含义 |
|---|---|
| `3002` | 本地 UI |
| `5555` | 本地 AI Service |
| `8000` | Docker ibis-server |
| `8080` | Docker wren-engine |
| `8081` | Docker trino |
| `9432` | Docker postgres |

特别注意：其他项目如果占用了 `8000 / 5432 / 3000`，很容易干扰对 WrenAI 依赖服务的判断。

### 8.4 AI Service 出现两个 Python 进程是正常的

当 `DEVELOPMENT=true` 时，AI Service 会以 reloader + worker 形式运行，因此看到两个 Python 进程监听 `5555` 是正常现象。

---

## 9. 不建议的启动方式

### 不建议把所有服务都切源码直跑

当前阶段不推荐默认采用：
- UI 源码
- AI Service 源码
- Engine 源码
- Ibis 源码

原因：
- 环境复杂度过高
- 联调稳定性下降
- 容易偏离真实运行环境

### 只有在以下情况才考虑临时切 Engine 源码模式

- 连续半天以上都在修改 `wren-engine / ibis-server`
- 需要打断点
- 问题已明确卡在 engine 内部，而不是 UI / AI Service 调用层

否则默认坚持本文的混合模式。

---

## 10. 一句话版

```bash
# 1) 起 Docker 依赖
cd /Users/liyi/Code/WrenAI/docker
docker compose --env-file .env up --build -d bootstrap postgres wren-engine ibis-server trino

# 2) 起 AI Service（本地源码）
cd /Users/liyi/Code/WrenAI/wren-ai-service
DEVELOPMENT=true WREN_AI_SERVICE_HOST=127.0.0.1 WREN_AI_SERVICE_PORT=5555 PG_CONN_STR=postgresql://postgres:postgres@127.0.0.1:9432/wrenai poetry run python -m src.__main__

# 3) 起 UI（本地源码）
cd /Users/liyi/Code/WrenAI/wren-ui
export PG_URL=postgres://postgres:postgres@127.0.0.1:9432/wrenai
export OTHER_SERVICE_USING_DOCKER=true
export WREN_ENGINE_ENDPOINT=http://127.0.0.1:8080
export IBIS_SERVER_ENDPOINT=http://127.0.0.1:8000
export WREN_AI_ENDPOINT=http://127.0.0.1:5555
export TRINO_CATALOG_MANAGEMENT=dynamic
export TRINO_CATALOG_MANAGEMENT_HOST=127.0.0.1
export TRINO_CATALOG_MANAGEMENT_PORT=8081
export TRINO_CATALOG_MANAGEMENT_SSL=false
export TRINO_RUNTIME_HOST=127.0.0.1
export TRINO_RUNTIME_PORT=8081
export TRINO_RUNTIME_USER=wrenai
export TRINO_RUNTIME_SSL=false
export EXPERIMENTAL_ENGINE_RUST_VERSION=false
yarn migrate
PORT=3002 yarn dev
```

改了 engine 后补一条：

```bash
cd /Users/liyi/Code/WrenAI/docker
docker compose --env-file .env up --build -d --force-recreate wren-engine ibis-server
```
