# AI Service Configuration

The AI service configuration is managed through a combination of environment variables and a configuration file, providing a flexible and secure approach to setting up the service.

1. **Environment Variables**:

   - Used for configuring sensitive information such as vendor API keys
   - Specify the configuration file to use
   - Allow for partial settings to be configured directly, see [Settings Loading Mechanism](#settings-loading-mechanism) for more details
   - Provide a way to override settings in different environments

2. **Configuration File**:
   - Used for detailed configuration of components, pipelines, and other service settings
   - Allows for more complex and structured configuration options

This dual approach ensures that sensitive data can be kept secure (using environment variables) while allowing for more detailed and shareable configuration through the configuration file. It also provides flexibility in deployment across different environments.

## Settings Loading Mechanism

The AI service uses a hierarchical approach to load settings, ensuring flexibility across different environments and deployment scenarios. The settings are loaded in the following order of precedence:

1. **Default Values**: These are defined as class attributes in the `Settings` class within [`config.py`](../src/config.py). They serve as the base configuration.

2. **Environment Variables**: Using [pydantic-settings](https://fastapi.tiangolo.com/advanced/settings/#pydantic-settings), the service checks for environment variables that match the setting names. If found, these override the default values. For example, `WREN_AI_SERVICE_HOST` can override the default `host` value.

3. **.env.dev File**: The service loads additional settings or overrides existing ones from a `.env.dev` file if present. This is particularly useful for development environments.

4. **config.yaml File**: This file provides the highest priority configuration. It can override all previous settings and is used to configure components, pipelines, and other detailed settings. See [Configuration File](#configuration-file) for more details.

This mechanism allows for easy configuration management across different environments, from development to production, while maintaining security for sensitive information like API keys.

## Configuration File

The configuration file (`config.yaml`) is structured into several sections, each defining different aspects of the AI service. Here's a breakdown of its main components:

1. **LLM Configuration**:

   ```yaml
   type: llm
   provider: <provider_name>
   models:
     - model: <model_name>
       kwargs: {}
   api_base: <api_endpoint>
   ```

   This component initializes the LLM provider at runtime. You can specify multiple models with different parameters. The `kwargs` field allows for model-specific configurations. For example:

   ```yaml
   type: llm
   provider: openai_llm
   models:
     - model: gpt-4
       kwargs:
         temperature: 0
         n: 1
         max_tokens: 4096
         response_format:
           type: "json_object"
     - model: gpt-4o-mini
       kwargs: {}
   api_base: https://api.openai.com/v1
   ```

   For detailed parameter options, refer to the implementation of the specific LLM provider.

2. **Embedder Configuration**:

   ```yaml
   type: embedder
   provider: <provider_name>
   models:
     - model: <model_name>
       dimension: <embedding_size>
   api_base: <api_endpoint>
   timeout: <timeout_in_seconds>
   ```

   This component configures the embedder, which converts text into numerical vectors. The `provider` specifies the embedder service (e.g., OpenAI, Ollama). You can define multiple `models` with their parameters. The `dimension` parameter indicates the size of the embedding vector.

3. **Engine Configuration**:

   ```yaml
   type: engine
   provider: <provider_name>
   endpoint: <engine_endpoint>
   ```

   This component configures the engine responsible for generating SQL queries. The `provider` specifies the engine service (e.g., Wren UI).

4. **Document Store Configuration**:

   ```yaml
   type: document_store
   provider: <provider_name>
   ```

   This component configures the document store, which is responsible for storing and retrieving embeddings. The `provider` specifies the document store service (e.g., Qdrant).

5. **Pipeline Configuration**:

   ```yaml
   type: pipeline
   pipes:
     - name: <pipe_name>
       llm: <provider>.<model_name>
       embedder: <provider>.<model_name>
       engine: <provider_name>
       document_store: <provider_name>
   ```

   This component configures each pipeline, specifying different LLM, embedder, engine, and document store combinations. For LLM and embedder, use `<provider>.<model_name>`. For engine and document store, use `<provider_name>`.

   Example:

   ```yaml
   type: pipeline
   pipes:
     - name: sql_generation
       llm: openai_llm.gpt-4o-mini
       engine: wren_ui
   ```

6. **Settings**:

   ```yaml
   settings:
     host: <host_address>
     port: <port_number>
     column_indexing_batch_size: <batch_size>
     table_retrieval_size: <retrieval_size>
     table_column_retrieval_size: <column_retrieval_size>
     query_cache_maxsize: <cache_size>
     query_cache_ttl: <cache_ttl_in_seconds>
     langfuse_host: <langfuse_endpoint>
     langfuse_enable: <true/false>
     logging_level: <log_level>
     development: <true/false>
   ```

   This section defines various service settings including host, port, indexing and retrieval parameters, cache settings, Langfuse configuration, logging level, and development mode.

This configuration file allows for detailed customization of the AI service components, pipelines, and overall behavior. It provides a centralized place to manage complex configurations while keeping sensitive information separate (managed through environment variables). See [Full Configuration File](../tools/config/config.full.yaml) for a complete example.
