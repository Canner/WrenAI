---
sidebar_label: Gemini CLI
---

# Install Wren AI with Gemini CLI

Google's official Gemini CLI.

## Prerequisites

- [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed and authenticated.
- Google authentication is required.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent gemini-cli
```

## Run onboarding

```bash
gemini
```

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
