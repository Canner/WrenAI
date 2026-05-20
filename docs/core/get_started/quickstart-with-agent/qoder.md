---
sidebar_label: Qoder
---

# Install Wren AI with Qoder

Qoder coding IDE.

## Prerequisites

- [Qoder](https://qoder.com) installed and authenticated.
- Qoder account login required.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent qoder
```

## Run onboarding

Open your project folder in Qoder IDE, then open the Qoder chat panel.

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
