---
sidebar_label: MCPJam
---

# Install Wren AI with MCPJam

MCPJam development tool.

## Prerequisites

- [MCPJam](https://github.com/vercel-labs/skills) installed and authenticated.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent mcpjam
```

## Run onboarding

Open your project folder in MCPJam, then start a new chat session.

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
