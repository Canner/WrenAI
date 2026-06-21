---
sidebar_label: Open source vs Commercial
---

# Open source vs Commercial

Wren AI open source is the full engine: free, self-hosted, and driven by one engineer or agent through the CLI and SDK.

Wren AI Commercial is the same engine built for a team. It adds a web UI, accounts, managed access control, chat and API integrations, and support. Full overview: [Wren AI Commercial](/cp/overview).

:::info Two ways to run Commercial
Commercial runs as a hosted cloud service, or as a self-hosted enterprise deployment. Identity features like SSO, LDAP, and SCIM are part of the enterprise tier.
:::

The tables below group the differences so you can jump to the part you care about.

## How you run it

Open source is yours to run end to end. Commercial can be fully hosted, or self-hosted on enterprise.

| Capability | Open source | Commercial |
| --- | :---: | :---: |
| Free and fully self-hosted | ✅ | ✅ |
| Fully managed cloud | ❌ | ✅ |
| CLI and SDK for your own agents | ✅ | ✅ |

## Access for your team

Open source is a single operator. Commercial brings accounts, identity, and the places your team already works.

| Capability | Open source | Commercial |
| --- | :---: | :---: |
| Web UI for non-technical users | ❌ | ✅ |
| Accounts, roles, multi-user | ❌ | ✅ |
| SSO, LDAP, SCIM provisioning | ❌ | ✅ |
| Slack and Microsoft Teams | ❌ | ✅ |

## Security and governance

Both define access control in MDL. Commercial binds it to real users and keeps an audit trail.

| Capability | Open source | Commercial |
| --- | :---: | :---: |
| Access control defined in MDL (RLAC/CLAC) | ✅ | ✅ |
| RLS/CLS per user, session properties, audit log | ❌ | ✅ |

## Build, query, and support

Both query through the engine and ship GenBI dashboards. Commercial adds hosted access, agent modes, quality tooling, and support.

| Capability | Open source | Commercial |
| --- | :---: | :---: |
| GenBI dashboards | ✅ | ✅ |
| MCP server and hosted REST API | ❌ | ✅ |
| Agentic and interactive answer modes (web UI, sandboxed) | ❌ | ✅ |
| Evaluation, AI Advisor, feedback tracing | ❌ | ✅ |
| Vendor support | ❌ | ✅ |

:::tip Consider Commercial when
- A team needs accounts, roles, and SSO, or LDAP/SCIM from your identity provider.
- Non-technical users want to ask in a browser, Slack, or Teams.
- You need RLS/CLS enforced per real user, or multi-tenant isolation for your own customers.
- You want a managed cloud, scheduled dashboards, or vendor support.
:::

:::note Stay on open source when
- You are one developer or an agent in a CLI/SDK and Git workflow.
- You want to own everything, self-hosted, with your context in your repo.
- Definition-level RLAC/CLAC is enough and you have no identity or team needs.
:::

## Talk to us

See [Wren AI Commercial](/cp/overview) for details and to reach the team. Open source stays first-class either way.
