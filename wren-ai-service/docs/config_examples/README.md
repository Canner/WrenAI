# MUST READ!!!

Since these config files are examples, so **please carefully read the file and comments inside**. Try to understand the purpose of each section and parameter, **don't simply copy and paste the content of these config files into your own config file. It will not work.** For more detailed information to the configurations, please [read this file](../configuration.md).

We also definitely welcome your contribution to add config files for other LLM providers.

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

## MiniMax Configuration

The `config.minimax.yaml` file provides an example configuration for using [MiniMax](https://www.minimax.io/) models via the dedicated `minimax_llm` provider. This provider talks directly to the MiniMax OpenAI-compatible API with built-in temperature clamping and automatic `response_format` removal.

### Available Models

| Model | Context Window | Description |
|-------|---------------|-------------|
| `MiniMax-M2.7` (default) | 204,800 tokens | Latest flagship model with enhanced reasoning and coding |
| `MiniMax-M2.7-highspeed` | 204,800 tokens | High-speed version of M2.7 for low-latency scenarios |
| `MiniMax-M2.5` | 204,800 tokens | Peak Performance. Ultimate Value. Master the Complex |
| `MiniMax-M2.5-highspeed` | 204,800 tokens | Same performance, faster and more agile |

### Key Notes

- **Temperature**: MiniMax requires temperature in the range `(0, 1.0]`. The provider automatically clamps values — `0` becomes `0.01`.
- **`response_format`**: Not supported by MiniMax. The provider strips it automatically.
- **API endpoints**: International `https://api.minimax.io/v1` (default), China mainland `https://api.minimaxi.com/v1`.
- Set `MINIMAX_API_KEY=<your_api_key>` in your `~/.wrenai/.env` file.
