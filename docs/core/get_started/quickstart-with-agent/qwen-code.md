---
sidebar_label: Qwen Code
---

# Install Wren AI with Qwen Code

Alibaba Qwen Code CLI.

## Prerequisites

- [Qwen Code](https://qwenlm.github.io/qwen-code-docs) installed and authenticated.
- Qwen API access required.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent qwen-code
```

## Run onboarding

```bash
qwen
```

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
