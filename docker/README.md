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

## Network

- Check out [Network drivers overview](https://docs.docker.com/engine/network/drivers/) to learn more about `bridge` network driver.

## How to start with OpenAI

1. copy `.env.example` to `.env` and modify the OpenAI API key.
2. copy `config.example.yaml` to `config.yaml` for AI service configuration.
3. start all services: `docker-compose --env-file .env up -d`.
4. stop all services: `docker-compose --env-file .env down`.

### Optional

- If your port 3000 is occupied, you can modify the `HOST_PORT` in `.env`.

## How to start with custom LLM

To start with a custom LLM, the process is similar to starting with OpenAI. The main difference is that you need to modify the `config.yaml` file
that we created on the previous step. After modifying the file, you can restart the services by running `docker-compose --env-file .env up -d --force-recreate wren-ai-service`.

For detailed information on how to modify the configuration for different LLM providers and models, please refer to the [AI Service Configuration](../wren-ai-service/docs/configuration.md).
This guide provides comprehensive instructions on setting up various LLM providers, embedders, and other components of the AI service.

## How to start with Ollama

Wren AI supports Ollama-hosted LLM models (e.g. `gpt-oss`, `nemotron`) through the OpenAI-compatible API at `https://ollama.com/v1`.

1. Copy `.env.example` to `.env` and set your `OLLAMA_API_KEY`.
   ```env
   OLLAMA_API_KEY=your_ollama_api_key
   ```
2. Copy `config.example.yaml` to `config.yaml` and configure the LLM to use Ollama:
   ```yaml
   type: llm
   provider: litellm_llm
   timeout: 120
   models:
     - alias: default
       model: openai/gpt-oss:120b-cloud
       api_base: https://ollama.com/v1
       api_key_name: OLLAMA_API_KEY
       context_window_size: 131072
       kwargs:
         max_completion_tokens: 32768
         n: 1
         temperature: 0.0
   ```
   Note: Ollama does not provide an `/v1/embeddings` endpoint, so you must use a separate embedder (e.g. Gemini).
   Configure the embedder in the same `config.yaml`:
   ```yaml
   type: embedder
   provider: litellm_embedder
   models:
     - model: gemini/gemini-embedding-001
       alias: default
       timeout: 120
   ```
   And set `GEMINI_API_KEY` in `.env`.
3. Update `GENERATION_MODEL` in `.env` to match your model name (e.g. `gpt-oss:120b-cloud`).
4. Update `embedding_model_dim` in `config.yaml` to match your embedder's output dimension (e.g. `3072` for Gemini).
5. Start all services: `docker-compose --env-file .env up -d`.

### Notes on Ollama reasoning models

- Ollama reasoning models do not support OpenAI's `response_format: json_schema` structured output. Wren AI automatically strips this parameter when an Ollama API base is detected and retries the request if the model returns invalid JSON.
- Reasoning models may occasionally return error messages (e.g. `{"error": "Insufficient information..."}`) instead of the expected JSON. Wren AI retries up to 3 times in such cases.
- `max_completion_tokens` should be set high enough (e.g. `32768`) to accommodate the reasoning tokens.
