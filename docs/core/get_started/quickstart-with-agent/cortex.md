---
sidebar_label: Cortex Code
---

# Install Wren AI with Cortex Code

Snowflake Cortex coding agent.

## Prerequisites

- [Cortex Code](https://www.snowflake.com/cortex) installed and authenticated.
- A Snowflake account is required.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent cortex
```

## Run onboarding

Open your project in Snowflake's Cortex Code interface, then start a new agent session.

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
