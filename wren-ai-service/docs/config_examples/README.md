# MUST READ!!!

Since these config files are examples, so **please carefully read the file and comments inside**. Try to understand the purpose of each section and parameter, **don't simply copy and paste the content of these config files into your own config file. It will not work.** For more detailed information to the configurations, please [read this file](../configuration.md).

We also definitely welcome your contribution to add config files for other LLM providers.

## Eval / benchmark note

If you are configuring Spider/BIRD eval runs with PostgreSQL-backed benchmark loading:

- prefer the explicit `spider_benchmark_db_target` form when you want one isolated PostgreSQL database per benchmark catalog via `{db_name}`
- use `postgres_host` / `postgres_port` (or the DSN target itself) for the **host-side published PostgreSQL address** seen by `just predict` / `just eval`
- do not blindly reuse container-internal addresses like `postgres:5432` for host-run eval commands unless the component that consumes the setting is also running inside the Docker network

The full benchmark-setting details now live in [`../configuration.md`](../configuration.md) and [`../../eval/README.md`](../../eval/README.md).

## Qwen3 Think and No_Think Configuration

The `config.qwen3.yaml` file provides an example configuration for using Qwen3 models with their unique thinking and non-thinking capabilities. Qwen3 models support two modes:

### Thinking Mode
- Use `/think` in your prompts to enable step-by-step reasoning
- Optimized with `temperature=0.6`, `top_p=0.95`, `top_k=20`
- Best for complex problems requiring detailed reasoning
- Uses the `qwen3-thinking` alias in the pipeline configuration

### Non-Thinking Mode  
- Use `/no_think` in your prompts for direct, fast responses
- Optimized with `temperature=0.7`, `top_p=0.8`, `top_k=20`
- Best for simple queries and general conversation
- Uses the `qwen3-fast` alias in the pipeline configuration

### Available Models
- `qwen/qwen3-30b-a3b`: 30B parameter MoE model (3.3B activated)
- `qwen/qwen3-32b`: 32B parameter dense model
- `qwen/qwen3-8b`: 8B parameter dense model
- `qwen/qwen3-14b`: 14B parameter dense model

### Usage Examples
```
# Enable thinking for complex reasoning
"Explain the mathematical proof for the Pythagorean theorem /think"

# Use fast mode for simple queries  
"What is the capital of France? /no_think"
```

**Note**: You need to set `OPENROUTER_API_KEY` in your `~/.wrenai/.env` file to use OpenRouter as the provider for Qwen3 models.
