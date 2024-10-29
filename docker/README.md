## Service

- `wren-engine`: the engine service. check out example here: [wren-engine
  /example](https://github.com/Canner/wren-engine/tree/main/example)
- `wren-ai-service`: the AI service.
- `qdrant`: the vector store ai service is using.
- `wren-ui`: the UI service.
- `bootstrap`: put required files to volume for engine service.

## Volume

Shared data using `data` volume.

Path structure as following:

- `/mdl`
  - `*.json` (will put `sample.json` during bootstrap)
- `accounts`
- `config.properties`
- `config.yaml`

## Network

- Check out [Network drivers overview](https://docs.docker.com/engine/network/drivers/) to learn more about `bridge` network driver.

## How to start with OpenAI

1. copy `.env.example` to `.env.local` and modify the OpenAI API key.
2. (optional) if your port 3000 is occupied, you can modify the `HOST_PORT` in `.env.local`.
3. start all services: `docker-compose --env-file .env.local up -d`.
4. stop all services: `docker-compose --env-file .env.local down`.

## How to start with custom LLM

To start with a custom LLM, the process is similar to starting with OpenAI. The main difference is that you need to modify the `config.yaml` file to configure your custom LLM instead of using the default OpenAI settings. You can find this file inside the `wrenai_data` volume. After modifying the file, you can restart the services by running `docker-compose --env-file .env.local up -d`.

For detailed information on how to modify the configuration for different LLM providers and models, please refer to the [AI Service Configuration](../wren-ai-service/docs/configuration.md). This guide provides comprehensive instructions on setting up various LLM providers, embedders, and other components of the AI service.

> Note: If your port 3000 is occupied, you can modify the `HOST_PORT` in `.env.local`.
