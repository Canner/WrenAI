---
sidebar_label: Warp
---

# Install Wren AI with Warp

Warp terminal coding agent. Uses the shared `.agents/skills/` directory.

## Prerequisites

- [Warp](https://warp.dev) installed and authenticated.
- Warp app installed; the skills feature must be enabled.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent warp
```

## Run onboarding

Open Warp, then press `⌘I` / `Ctrl+I` to enter Agent Mode.

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
