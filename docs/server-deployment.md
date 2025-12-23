# WrenAI: Развертывание на сервере (Docker)

Это руководство описывает развертывание WrenAI на сервере без использования CLI-утилиты `wren-launcher`.

## Архитектура

WrenAI состоит из 6 сервисов:

```
┌─────────────────────────────────────────────────────────────┐
│                      Ваш сервер                             │
│                                                             │
│   :3000 (UI)  ←───── внешний доступ                        │
│   :5555 (API) ←───── опционально                           │
└───────┬─────────────────────────────────┬───────────────────┘
        │                                 │
   ┌────▼────────────┐            ┌───────▼──────────┐
   │    wren-ui      │◄───────────│  wren-ai-service │
   │  (Next.js)      │            │    (Python)      │
   │   порт 3000     │            │    порт 5555     │
   └────┬────────────┘            └────────┬─────────┘
        │                                  │
   ┌────▼────────────┐            ┌────────▼─────────┐
   │   wren-engine   │            │      qdrant      │
   │   (SQL Engine)  │            │ (Vector DB)      │
   │   порт 8080     │            │   порт 6333      │
   └────┬────────────┘            └──────────────────┘
        │
   ┌────▼────────────┐
   │   ibis-server   │
   │   порт 8000     │
   └────┬────────────┘
        │
   ┌────▼────────────┐
   │    bootstrap    │
   │  (init-контейнер)│
   └──────────────────┘
```

## Требования

- Docker 20.10+
- Docker Compose v2
- 4 GB RAM минимум (рекомендуется 8 GB)
- OpenAI API ключ (или совместимый API)

## Быстрый старт

### 1. Создайте директорию проекта

```bash
mkdir -p /opt/wrenai
cd /opt/wrenai
```

### 2. Скачайте конфигурационные файлы

```bash
# Docker Compose
curl -o docker-compose.yaml \
  https://raw.githubusercontent.com/Canner/WrenAI/0.29.1/docker/docker-compose.yaml

# Шаблон переменных окружения
curl -o .env \
  https://raw.githubusercontent.com/Canner/WrenAI/0.29.1/docker/.env.example

# Конфигурация AI-сервиса
curl -o config.yaml \
  https://raw.githubusercontent.com/Canner/WrenAI/0.29.1/docker/config.example.yaml
```

### 3. Настройте переменные окружения

Отредактируйте файл `.env`:

```bash
nano .env
```

**Минимальные обязательные изменения:**

```env
# Ваш API ключ OpenAI
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx

# Уникальный UUID пользователя (сгенерируйте свой)
USER_UUID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Путь к проекту (оставьте точку для текущей директории)
PROJECT_DIR=.

# Платформа (для большинства серверов)
PLATFORM=linux/amd64
```

Для генерации UUID:
```bash
cat /proc/sys/kernel/random/uuid
```

### 4. Создайте директорию для данных

```bash
mkdir -p data
```

### 5. Запустите WrenAI

```bash
docker compose up -d
```

### 6. Проверьте статус

```bash
docker compose ps
```

Все сервисы должны быть в статусе `running`.

### 7. Откройте веб-интерфейс

Перейдите по адресу: `http://ваш-сервер:3000`

---

## Полная конфигурация

### Файл `.env` - все параметры

```env
# ============================================
# ОСНОВНЫЕ НАСТРОЙКИ
# ============================================

# Название проекта Docker Compose
COMPOSE_PROJECT_NAME=wrenai

# Платформа: linux/amd64 или linux/arm64
PLATFORM=linux/amd64

# Рабочая директория (. = текущая)
PROJECT_DIR=.

# ============================================
# ПОРТЫ СЕРВИСОВ (внутренние)
# ============================================

WREN_ENGINE_PORT=8080
WREN_ENGINE_SQL_PORT=7432
WREN_AI_SERVICE_PORT=5555
WREN_UI_PORT=3000
IBIS_SERVER_PORT=8000
WREN_UI_ENDPOINT=http://wren-ui:${WREN_UI_PORT}

# ============================================
# AI СЕРВИС
# ============================================

# Хост Qdrant (не менять при использовании docker-compose)
QDRANT_HOST=qdrant

# Автоматический деплой моделей при старте
SHOULD_FORCE_DEPLOY=1

# ============================================
# API КЛЮЧИ (ОБЯЗАТЕЛЬНО)
# ============================================

# OpenAI API ключ
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx

# ============================================
# ВЕРСИИ ОБРАЗОВ
# ============================================

WREN_PRODUCT_VERSION=0.29.1
WREN_ENGINE_VERSION=0.22.0
WREN_AI_SERVICE_VERSION=0.29.0
IBIS_SERVER_VERSION=0.22.0
WREN_UI_VERSION=0.32.2
WREN_BOOTSTRAP_VERSION=0.1.5

# ============================================
# ИДЕНТИФИКАЦИЯ
# ============================================

# Уникальный UUID (обязательно сгенерировать)
USER_UUID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# ============================================
# ТЕЛЕМЕТРИЯ (опционально)
# ============================================

# Отключить телеметрию: false
TELEMETRY_ENABLED=true
POSTHOG_API_KEY=phc_nhF32aj4xHXOZb0oqr2cn4Oy9uiWzz6CCP4KZmRq9aE
POSTHOG_HOST=https://app.posthog.com

# Модель для отображения в UI
GENERATION_MODEL=gpt-4o-mini

# Langfuse (опционально, для мониторинга LLM)
LANGFUSE_SECRET_KEY=
LANGFUSE_PUBLIC_KEY=

# ============================================
# ВНЕШНИЕ ПОРТЫ
# ============================================

# Порт UI (доступ к веб-интерфейсу)
HOST_PORT=3000

# Порт AI API (опционально, для внешнего доступа к API)
AI_SERVICE_FORWARD_PORT=5555

# ============================================
# ЭКСПЕРИМЕНТАЛЬНОЕ
# ============================================

EXPERIMENTAL_ENGINE_RUST_VERSION=false

# Локальное хранилище для Wren Engine
LOCAL_STORAGE=.
```

---

## Использование других LLM провайдеров

WrenAI использует LiteLLM, что позволяет использовать различных провайдеров.

### Azure OpenAI

Добавьте в `.env`:
```env
AZURE_API_KEY=your-azure-api-key
AZURE_API_BASE=https://your-resource.openai.azure.com/
AZURE_API_VERSION=2024-02-15-preview
```

Измените `config.yaml`:
```yaml
type: llm
provider: litellm_llm
timeout: 120
models:
  - alias: default
    model: azure/your-deployment-name
    context_window_size: 128000
    kwargs:
      max_tokens: 4096
      temperature: 0
```

### Anthropic Claude

Добавьте в `.env`:
```env
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
```

Измените `config.yaml`:
```yaml
type: llm
provider: litellm_llm
timeout: 120
models:
  - alias: default
    model: claude-3-5-sonnet-20241022
    context_window_size: 200000
    kwargs:
      max_tokens: 4096
      temperature: 0
```

### Локальная модель (Ollama)

Добавьте в `.env`:
```env
OLLAMA_API_BASE=http://host.docker.internal:11434
```

Измените `config.yaml`:
```yaml
type: llm
provider: litellm_llm
timeout: 120
models:
  - alias: default
    model: ollama/llama3.1:70b
    context_window_size: 128000
    kwargs:
      max_tokens: 4096
      temperature: 0
```

> **Важно:** При использовании локальных моделей также нужно заменить embedder на локальный.

---

## Настройка reverse proxy (Nginx)

Для продакшен-развертывания рекомендуется использовать Nginx:

```nginx
server {
    listen 80;
    server_name wrenai.example.com;

    # Редирект на HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name wrenai.example.com;

    ssl_certificate /etc/letsencrypt/live/wrenai.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/wrenai.example.com/privkey.pem;

    # Основное приложение
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Таймауты для длительных запросов к LLM
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
    }
}
```

---

## Отключение телеметрии

Если вы не хотите отправлять данные телеметрии:

```env
TELEMETRY_ENABLED=false
```

---

## Управление контейнерами

### Просмотр логов

```bash
# Все сервисы
docker compose logs -f

# Конкретный сервис
docker compose logs -f wren-ui
docker compose logs -f wren-ai-service
docker compose logs -f wren-engine
```

### Перезапуск сервисов

```bash
# Перезапуск всех сервисов
docker compose restart

# Перезапуск конкретного сервиса
docker compose restart wren-ai-service
```

### Остановка

```bash
docker compose down
```

### Полная очистка (включая данные)

```bash
docker compose down -v
```

---

## Обновление

### 1. Остановите сервисы

```bash
docker compose down
```

### 2. Обновите версии в `.env`

```env
WREN_PRODUCT_VERSION=X.Y.Z
WREN_ENGINE_VERSION=X.Y.Z
WREN_AI_SERVICE_VERSION=X.Y.Z
IBIS_SERVER_VERSION=X.Y.Z
WREN_UI_VERSION=X.Y.Z
WREN_BOOTSTRAP_VERSION=X.Y.Z
```

### 3. Скачайте новые образы и запустите

```bash
docker compose pull
docker compose up -d
```

---

## Бэкап и восстановление

### Бэкап данных

```bash
# Остановите сервисы
docker compose down

# Создайте бэкап
tar -czvf wrenai-backup-$(date +%Y%m%d).tar.gz data/

# Запустите сервисы
docker compose up -d
```

### Восстановление

```bash
# Остановите сервисы
docker compose down

# Восстановите данные
tar -xzvf wrenai-backup-YYYYMMDD.tar.gz

# Запустите сервисы
docker compose up -d
```

---

## Решение проблем

### Сервис не запускается

Проверьте логи:
```bash
docker compose logs wren-ai-service
```

### Ошибка подключения к OpenAI

1. Проверьте API ключ в `.env`
2. Убедитесь, что ключ активен и имеет достаточный баланс
3. Проверьте сетевой доступ к api.openai.com

### Порт занят

Измените порт в `.env`:
```env
HOST_PORT=8080
```

### Недостаточно памяти

Увеличьте лимиты Docker или уменьшите размер модели в `config.yaml`.

---

## Структура файлов

После развертывания структура будет следующей:

```
/opt/wrenai/
├── docker-compose.yaml    # Docker Compose конфигурация
├── .env                   # Переменные окружения
├── config.yaml           # Конфигурация AI-сервиса
└── data/                 # Данные приложения
    ├── db.sqlite3        # База данных UI
    └── ...
```

---

## Дополнительные ресурсы

- [Официальная документация WrenAI](https://docs.getwren.ai)
- [GitHub репозиторий](https://github.com/Canner/WrenAI)
- [LiteLLM провайдеры](https://docs.litellm.ai/docs/providers)
