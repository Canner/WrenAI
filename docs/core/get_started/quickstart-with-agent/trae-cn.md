---
sidebar_label: Trae CN
---

# Install Wren AI with Trae CN

Trae (China region).

## Prerequisites

- [Trae CN](https://trae.com.cn) installed and authenticated.
- A China-region account is required.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent trae-cn
```

## Run onboarding

Open your project folder in Trae CN IDE (`File → Open Folder...`), then open the chat panel.

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
