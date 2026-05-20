---
sidebar_label: Deep Agents
---

# Install Wren AI with Deep Agents

LangChain Deep Agents framework.

## Prerequisites

- [Deep Agents](https://github.com/langchain-ai/deepagents) installed and authenticated.
- Python environment setup required.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent deepagents
```

## Run onboarding

```bash
dcode
```

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
