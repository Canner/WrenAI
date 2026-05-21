---
sidebar_label: CodeArts Agent
---

# Install Wren AI with CodeArts Agent

Huawei Cloud CodeArts Doer.

## Prerequisites

- [CodeArts Agent](https://www.huaweicloud.com/product/codeartsdoer.html) installed and authenticated.
- Huawei Cloud account required.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent codearts-agent
```

## Run onboarding

Open your project in CodeArts IDE, then open the CodeArts Agent panel.

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
