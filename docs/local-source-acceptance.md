# WrenAI 本地源码启动与验收手册

适用目标：
- 保留本地源码开发能力
- 只启动必要 infra 容器
- 用本地源码进程运行 `wren-ui` / `wren-ai-service`
- 验收 `runtimeScopeId=4` 的 Home Ask 主链路

---

## 1. 最小运行形态

建议拆成两层：

### A. docker 只跑 infra
- PostgreSQL / pgvector
- wren-engine
- ibis-server

### B. 本地源码跑应用
- `wren-ui`
- `wren-ai-service`

这样排查最方便，改代码后也不用反复重建整个应用容器。

---

## 2. 先停旧应用容器

如果本地之前起过旧版全量 docker 应用，先停掉应用层，避免端口和数据链路混用。

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

如果看到旧的应用容器，停掉它们；保留 infra 容器即可。

例如：

```bash
docker stop wren-ui wren-ai-service || true
docker rm wren-ui wren-ai-service || true
```

---

## 3. 启 infra

按你本地实际 compose 文件为准；目标端口应至少满足：

- PostgreSQL: `127.0.0.1:9432`
- wren-engine: `127.0.0.1:8080`
- ibis-server: `127.0.0.1:18000`

可用以下命令确认：

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

---

## 4. 启动 wren-ui

在仓库根目录下：

```bash
cd /Users/liyi/Code/WrenAI/wren-ui
yarn
yarn dev -p 3001
```

启动后访问：

```text
http://127.0.0.1:3001
```

---

## 5. 启动 wren-ai-service

先确认：
- 已有 `wren-ai-service/.venv`
- `wren-ai-service/config.local.yaml` 已配置好 OpenRouter 模型
- 已设置 `OPENROUTER_API_KEY`

启动命令：

```bash
cd /Users/liyi/Code/WrenAI/wren-ai-service
env \
  WREN_AI_SERVICE_PORT=5555 \
  WREN_AI_SERVICE_HOST=127.0.0.1 \
  PG_CONN_STR='postgresql://postgres:postgres@127.0.0.1:9432/wrenai_acceptance' \
  CONFIG_PATH=./config.local.yaml \
  GENERATION_MODEL='openrouter/google/gemini-3.1-flash-lite-preview' \
  OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
  ASK_RUNTIME_MODE=deepagents \
  SHOULD_FORCE_DEPLOY=1 \
  WREN_ENGINE_PORT=8080 \
  .venv/bin/python -m src.__main__
```

成功标志：

```text
Uvicorn running on http://127.0.0.1:5555
Application startup complete.
```

---

## 6. 最小健康检查

### OpenRouter 连通性

```bash
python - <<'PY'
import requests
r = requests.get('https://openrouter.ai/api/v1/models', timeout=15)
print(r.status_code)
PY
```

### LiteLLM 直接请求测试

```bash
cd /Users/liyi/Code/WrenAI/wren-ai-service
.venv/bin/python - <<'PY'
import asyncio, os
from litellm import acompletion

async def main():
    r = await acompletion(
        model='openrouter/google/gemini-3.1-flash-lite-preview',
        api_base='https://openrouter.ai/api/v1',
        api_key=os.environ['OPENROUTER_API_KEY'],
        messages=[{'role': 'user', 'content': 'reply ok'}],
        timeout=30,
    )
    print(bool(r))

asyncio.run(main())
PY
```

---

## 7. 主链路验收：Home Ask

使用下面的 runtime scope：

```text
runtimeScopeId=4
```

打开：

```text
http://127.0.0.1:3001/home?runtimeScopeId=4
```

输入问题：

```text
Show total orders by status as a table
```

预期结果：
- 跳转到 `/home/<threadId>?runtimeScopeId=4`
- `askingTask.status = FINISHED`
- 页面正常展示答案
- 不出现：
  - `Internal server error`
  - `list index out of range`

---

## 8. REST 验证脚本

### 查看 thread 结果

```bash
curl 'http://127.0.0.1:3001/api/v1/threads/22?runtimeScopeId=4'
```

### 查看 thread recommendation

```bash
curl 'http://127.0.0.1:3001/api/v1/thread-recommendation-questions/22?runtimeScopeId=4'
```

### 查看 project recommendation

```bash
curl 'http://127.0.0.1:3001/api/v1/project-recommendation-questions?runtimeScopeId=4'
```

---

## 9. 关键通过标准

### Ask 主链路
- `wren-ui -> /api/v1/* REST route -> controller/service -> ai-service`
- ai-service 日志能看到：

```text
Runtime scope: 4
```

### Thread recommendation
- `getThreadRecommendationQuestions.status = FINISHED`
- 页面 thread 详情出现 `Recommended questions`

### Project recommendation
- `getProjectRecommendationQuestions.status = FINISHED`
- 注意：如果当前是 sample dataset 首页，UI 仍可能优先显示 demo prompt，这是产品逻辑，不代表失败

---

## 10. 常见问题

### 1) recommendation 请求报代理/8234 连接错误

症状类似：

```text
Cannot connect to host 127.0.0.1:8234
```

处理方式：
- 重新启动 `wren-ai-service`
- 确认当前 shell 没有残留代理配置
- 再做一次 OpenRouter 直连测试

### 2) Ask 页报 `list index out of range`

优先检查：
- `runtime_scope_id` 是否真的传到 ai-service
- ai-service 日志里 `Runtime scope:` 是否为 `4`
- 而不是错误回退为 deploy hash 或 `None`

### 3) 首页没有显示 project recommendation prompt

如果当前是 sample dataset，首页会优先显示 `Try asking...` 的 demo prompt。
这属于当前 UI 逻辑，不代表 project recommendation 失败。

---

## 11. 推荐回归命令

```bash
cd /Users/liyi/Code/WrenAI/wren-ui
yarn test --runInBand \
  src/server/adaptors/tests/wrenAIAdaptor.test.ts \
  src/server/services/tests/askingService.test.ts \
  src/server/controllers/tests/askingController.test.ts \
  src/server/controllers/tests/projectController.test.ts \
  src/server/context/tests/runtimeScope.test.ts \
  src/pages/api/tests/thread_by_id_api.test.ts \
  src/pages/api/tests/thread_recommendation_questions_api.test.ts

yarn check-types
```

---

## 12. 本轮已确认可用的验收结论

- `runtimeScopeId=4` 的 Home Ask 主链路可用
- thread answer 可正常生成
- thread recommendation 可正常生成
- project recommendation 可正常生成
- 当前 sample dataset 首页不展示 project recommendation prompt，属预期行为
