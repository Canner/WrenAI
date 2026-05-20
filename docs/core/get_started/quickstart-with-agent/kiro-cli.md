---
sidebar_label: Kiro CLI
---

# Install Wren AI with Kiro CLI

AWS Kiro CLI.

## Prerequisites

- [Kiro CLI](https://kiro.dev) installed and authenticated.
- If you use a custom agent, add `resources: ["skill://.kiro/skills/**/SKILL.md"]` to your `.kiro/agents/<agent>.json`. The default agent loads skills automatically.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent kiro-cli
```

## Run onboarding

```bash
kiro
```

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
