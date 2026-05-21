---
sidebar_label: Cursor
---

# Install Wren AI with Cursor

The Cursor IDE.

## Prerequisites

- [Cursor](https://cursor.com) installed and authenticated.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent cursor
```

## Run onboarding

Open your project folder in Cursor (`File → Open Folder...` or `⌘O` / `Ctrl+O`), then open the chat panel with `⌘L` / `Ctrl+L`.

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
