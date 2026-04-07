# WrenAI 本地源码快速恢复

适合场景：
- 你已经有一套可用的 infra 容器
- 想最快恢复本地源码开发环境
- 只需要最短命令顺序

完整说明见：`docs/local-source-acceptance.md`

---

## 1. 保留 infra，停旧应用容器

```bash
docker stop wren-ui wren-ai-service || true
docker rm wren-ui wren-ai-service || true
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

确认至少还有这些 infra 端口：
- PostgreSQL: `127.0.0.1:9432`
- wren-engine: `127.0.0.1:8080`
- ibis-server: `127.0.0.1:18000`

---

## 2. 起 wren-ui

```bash
cd /Users/liyi/Code/WrenAI/wren-ui
yarn
yarn dev -p 3001
```

---

## 3. 起 wren-ai-service

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

---

## 4. 快速健康检查

```bash
python - <<'PY'
import requests
print(requests.get('https://openrouter.ai/api/v1/models', timeout=15).status_code)
PY
```

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
        messages=[{'role':'user','content':'reply ok'}],
        timeout=30,
    )
    print(bool(r))
asyncio.run(main())
PY
```

---

## 5. 快速验收

打开：

```text
http://127.0.0.1:3001/home?runtimeScopeId=4
```

输入：

```text
Show total orders by status as a table
```

预期：
- 跳转到 `/home/<threadId>?runtimeScopeId=4`
- 页面正常显示 answer
- 不出现 `Internal server error`
- 不出现 `list index out of range`

---

## 6. 如需查推荐问题

### thread recommendation

```bash
python - <<'PY'
import requests
url='http://127.0.0.1:3001/api/graphql?runtimeScopeId=4'
q='''query GetThreadRecommendationQuestions($threadId: Int!) {
  getThreadRecommendationQuestions(threadId: $threadId) {
    status
    questions { question category sql }
    error { code message shortMessage }
  }
}'''
print(requests.post(url, json={'query': q, 'variables': {'threadId': 22}}).text)
PY
```

### project recommendation

```bash
python - <<'PY'
import requests
url='http://127.0.0.1:3001/api/graphql?runtimeScopeId=4'
q='''query GetProjectRecommendationQuestions {
  getProjectRecommendationQuestions {
    status
    questions { question category sql }
    error { code message shortMessage }
  }
}'''
print(requests.post(url, json={'query': q, 'variables': {}}).text)
PY
```
