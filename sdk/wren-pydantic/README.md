# wren-pydantic

Pydantic AI integration for [Wren AI Core](https://github.com/Canner/WrenAI).

Attach a CLI-prepared Wren project to a Pydantic AI agent in three lines:

```python
from wren_pydantic import WrenToolkit
from pydantic_ai import Agent

toolkit = WrenToolkit.from_project("./analytics_db")
agent = Agent(
    "openai:gpt-4o",
    instructions=toolkit.instructions(),
    toolsets=[toolkit.toolset()],
)
result = agent.run_sync("How many enterprise customers do we have?")
print(result.output)
```

> ⚠️ **Wren CLI required first.** This SDK is a thin adapter over a Wren
> project that the `wren` CLI has already prepared (profile + MDL + optional
> memory index). Follow the [install guide](https://docs.getwren.ai/oss/get_started/installation)
> before installing this package.

Full documentation: [docs/core/sdk/pydantic.md](https://github.com/Canner/WrenAI/blob/main/docs/core/sdk/pydantic.md)
