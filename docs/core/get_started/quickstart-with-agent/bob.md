---
sidebar_label: IBM Bob
---

# Install Wren AI with IBM Bob

IBM watsonx coding agent.

## Prerequisites

- [IBM Bob](https://www.ibm.com/watsonx) installed and authenticated.
- IBM Cloud account required.

## Install Wren skills

```bash
npx skills add Canner/WrenAI --skill '*' --agent bob
```

## Run onboarding

Open your project folder in IBM Bob (watsonx Code Assistant), then start a new chat.

Then ask:

```text
Use the /wren-onboarding skill to install and set up Wren AI.
```

The skill walks the agent through environment checks, profile creation, project scaffolding, and a first query.

## Next step

- [Quickstart with sample data](../quickstart) — walk through `jaffle_shop` end-to-end
- [Connect your data](/oss/guides/connect) — point Wren AI at a real database
