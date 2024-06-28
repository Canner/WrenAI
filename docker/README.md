## Service
* `wren-engine`: the engine service. check out example here: [wren-engine
/example](https://github.com/Canner/wren-engine/tree/main/example)
* `wren-ai-service`: the AI service. check out example here: [wren-ai-service docker-compose example](https://github.com/Canner/WrenAI/blob/main/wren-ai-service/docker/docker-compose.yaml)
* `qdrant`: the vector store ai service is using.
* `wren-ui`: the UI service.
* `bootstrap`: put required files to volume for engine service.

## Volume
Shared data using `data` volume.

Path structure as following:
* `/mdl`
    * `*.json` (will put `sample.json` during bootstrap)
* `accounts`
* `config.properties`

## Network
* Check out [Network drivers overview](https://docs.docker.com/network/drivers/) to learn more about `bridge` network driver.

## How to start
1. copy `.env.example` to `.env.local` and modify the OpenAI API key.
2. (optional) copy `.env.ai.example` to `.env.ai` and fill in necessary information if you would like to use custom LLM.
3. (optional) if your port 3000 is occupied, you can modify the `HOST_PORT` in `.env.example`.

If you would like to start with **custom LLM**, please jump to the step 6.
4. start all services(with OpenAI): `docker-compose --env-file .env.local up -d`
5. stop all services(with OpenAI): `docker-compose --env-file .env.local down`

6. start all services(with custom LLM): `docker-compose -f docker-compose.yaml -f docker-compose.llm.yaml --env-file .env.local up -d`
7. start all services(with custom LLM): `docker-compose -f docker-compose.yaml -f docker-compose.llm.yaml --env-file .env.local up -d`
