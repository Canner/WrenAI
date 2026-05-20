---
sidebar_label: Kode
---

# Install Wren AI with Kode

shareAI Kode coding agent.

## Prerequisites

- [Kode](https://github.com/shareAI-lab/kode) installed and authenticated.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent kode
```

## Run onboarding

```bash
kode
```

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
