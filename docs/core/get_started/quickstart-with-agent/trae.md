---
sidebar_label: Trae
---

# Install Wren AI with Trae

ByteDance Trae IDE.

## Prerequisites

- [Trae](https://trae.ai) installed and authenticated.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent trae
```

## Run onboarding

Open your project folder in Trae IDE (`File → Open Folder...`), then open the chat panel with `⌘U` / `Ctrl+U`.

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
