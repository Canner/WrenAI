---
sidebar_label: Zencoder
---

# Install Wren AI with Zencoder

Zencoder coding agent.

## Prerequisites

- [Zencoder](https://zencoder.ai) installed and authenticated.
- Zencoder has limited skill features — `allowed-tools` frontmatter is not honored.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent zencoder
```

## Run onboarding

Open your project folder in VS Code or a JetBrains IDE with the Zencoder extension/plugin installed, then open the Zencoder chat panel.

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
