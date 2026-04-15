## Service

- `wren-engine`: the engine service. It is now built from the vendored
  `../wren-engine` source in this repo.
- `ibis-server`: the engine gateway service. It is also built from the vendored
  `../wren-engine` source in this repo.
- `wren-ai-service`: the AI service.
- `postgres`: the relational database and pgvector-backed vector store used by ai service.
- `wren-ui`: the UI service.
- `bootstrap`: put required files to volume for engine service.

## Volume

Shared data using `data` volume.

Path structure as following:

- `/mdl`
  - `*.json` (will put `sample.json` during bootstrap)
- `accounts`
- `config.properties`

## Network

- Check out [Network drivers overview](https://docs.docker.com/engine/network/drivers/) to learn more about `bridge` network driver.

## 单一本地环境

Docker 目录现在只保留 **一套** 本地环境：

- `docker-compose.yaml`：本地开发 / 测试 / 回归统一入口
- `.env`：本地实际配置
- `.env.example`：配置模板

不再保留单独的 `docker-compose-dev.yaml`。

## How to start with OpenAI

1. copy `.env.example` to `.env` and modify the OpenAI API key.
2. copy `config.example.yaml` to `config.yaml` for AI service configuration.
3. start all services: `docker compose --env-file .env up --build -d`.
4. stop all services: `docker compose --env-file .env down`.

### Optional

- If your port 3000 is occupied, you can modify the `HOST_PORT` in `.env`.
- If you want a different local image name, change
  `WREN_ENGINE_IMAGE_REPO` / `IBIS_SERVER_IMAGE_REPO` and the matching tags in
  `.env`.

## Local source development with the same stack

If you want to run one service from source, still use the same
`docker-compose.yaml`, but only start the dependency services you need.

### Run `wren-ui` from source

```sh
docker compose --env-file .env up --build -d bootstrap postgres wren-engine ibis-server trino wren-ai-service
```

### Run `wren-ai-service` from source

```sh
docker compose --env-file .env up --build -d bootstrap postgres wren-engine ibis-server trino wren-ui
```

## Prebuild engine images for local Kubernetes / CI

If you want reusable local images outside Compose, run:

```sh
./build-local-engine-images.sh
```

## How to start with custom LLM

To start with a custom LLM, the process is similar to starting with OpenAI. The main difference is that you need to modify the `config.yaml` file
that we created on the previous step. After modifying the file, you can restart the services by running `docker compose --env-file .env up --build -d --force-recreate wren-ai-service`.

For detailed information on how to modify the configuration for different LLM providers and models, please refer to the [AI Service Configuration](../wren-ai-service/docs/configuration.md).
This guide provides comprehensive instructions on setting up various LLM providers, embedders, and other components of the AI service.
