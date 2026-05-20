---
sidebar_label: Windsurf
---

# Install Wren AI with Windsurf

Codeium Windsurf IDE.

## Prerequisites

- [Windsurf](https://windsurf.com) installed and authenticated.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent windsurf
```

## Run onboarding

Open your project folder in Windsurf (`File → Open Folder...`), then open the Cascade panel from the right sidebar (`⌘L` / `Ctrl+L`).

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
