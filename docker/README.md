## Service
* `wren-engine`: the engine service. check out example here: [wren-engine
/example](https://github.com/Canner/wren-engine/tree/main/example)
* `wren-ai-service`: the AI service. check out example here: [wren-ai-service docker-compose example](https://github.com/Canner/WrenAI/blob/main/wren-ai-service/docker/docker-compose.yml)
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
