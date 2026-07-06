---
sidebar_label: Open source vs Commercial
---

# Open source vs Commercial

Wren AI open source is the full engine: free, self-hosted, and driven by one engineer or agent through the CLI and SDK.

Wren AI Commercial is the same engine built for a team. It runs as a hosted cloud service or as a self-hosted enterprise deployment, and it adds a web UI, accounts, managed access control, integrations, and support. Full overview: [Wren AI Commercial](/cp/overview).

## Which one fits

**Solo, in the terminal.** One engineer or an AI agent, working through the CLI, SDK, and Git. Open source is all you need.

**A data team.** Several people need governed access with roles and SSO, and non-technical teammates want to ask questions in a browser, Slack, or Teams. This is where Commercial earns its place.

**Analytics for your customers.** You put analytics inside your own product, and each customer must see only their own data. Commercial enterprise gives you per-user RLS/CLS and multi-tenant isolation.

## Feature comparison

| Capability | Open source | Commercial |
| --- | :---: | :---: |
| Fully managed cloud | ❌ | ✅ |
| CLI and SDK for your own agents | ✅ | ✅ |
| MCP server and hosted REST API | ❌ | ✅ |
| Access control defined in MDL (RLAC/CLAC) | ✅ | ✅ |
| GenBI dashboards | ✅ | ✅ |
| Web UI for non-technical users | ❌ | ✅ |
| Slack and Microsoft Teams | ❌ | ✅ |
| Agentic and interactive answer modes (web UI, sandboxed) | ❌ | ✅ |
| Accounts, roles, multi-user | ❌ | ✅ |
| SSO, LDAP, SCIM provisioning | ❌ | ✅ |
| RLS/CLS per user, session properties, audit log | ❌ | ✅ |
| Evaluation, AI Advisor, feedback tracing | ❌ | ✅ |
| Vendor support | ❌ | ✅ |

## What Commercial adds

Open source is the full engine. Commercial adds the team layer on top:

- **Runs itself.** Hosted cloud, or self-hosted enterprise, so no one has to operate the stack.
- **Built for people, not just agents.** A web UI plus Slack and Teams, so non-technical teammates can ask questions.
- **Real identity and access.** Accounts, roles, SSO, LDAP, and SCIM, with access control tied to actual users.
- **More ways in.** A hosted API and MCP server, and dashboards that refresh on their own.
- **Confidence.** Accuracy tracking, feedback tracing, and a team to call when something breaks.
- **No rebuild.** Your MDL and context carry over unchanged.

## Talk to us

See [Wren AI Commercial](/cp/overview) for details and to reach the team. Open source stays first-class either way.
