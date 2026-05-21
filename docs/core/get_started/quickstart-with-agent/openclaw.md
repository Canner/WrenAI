---
sidebar_label: OpenClaw
---

# Install Wren AI with OpenClaw

OpenClaw coding agent.

## Prerequisites

- [OpenClaw](https://openclaw.ai) installed and authenticated.
- Project-scope skills are installed under repo-root `skills/`, **not** under a hidden `.openclaw/` directory.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent openclaw
```

## Run onboarding

```bash
openclaw
```

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
