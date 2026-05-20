---
sidebar_label: CodeBuddy
---

# Install Wren AI with CodeBuddy

Tencent CodeBuddy coding agent.

## Prerequisites

- [CodeBuddy](https://www.codebuddy.ai) installed and authenticated.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent codebuddy
```

## Run onboarding

Open your project in CodeBuddy IDE (or the VS Code extension), then open the CodeBuddy chat panel.

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
