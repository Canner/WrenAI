---
sidebar_label: Why Wren? (and how it compares)
---

# Why Wren? (and how it compares)

Wren AI is the **open-source GenBI engine**: it lets AI agents generate, deploy,
and govern business intelligence on top of a context layer they can trust. This
page is the honest version — what Wren is for, what it is *not*, and how it
differs from the tools it sits near.

## The problem Wren solves

Agents are everywhere — Claude Code, Cursor, ChatGPT, Aider, LangChain
pipelines, in-house copilots. None of them know what your data *means*. Point one
at a warehouse and it writes confident, plausible, wrong SQL, because the meaning
it needs (canonical tables, approved definitions, units, join paths) lives
outside the schema. Build a dashboard on top of that and you've shipped a
trustworthy-looking lie.

Wren gives every agent the same governed context, then lets them turn questions
into answers and dashboards that are actually correct.

## How Wren compares

|  | A raw LLM agent | A traditional BI tool | A bare semantic layer | **Wren AI** |
| --- | :---: | :---: | :---: | :---: |
| Writes SQL for you | ✅ (often wrong) | ❌ | ❌ | ✅ governed |
| Knows your business definitions | ❌ | partial, in-tool | ✅ (schema-derived) | ✅ + non-schema knowledge |
| Generates **and** deploys dashboards | ❌ | ✅ (manual, in-tool) | ❌ | ✅ agent-driven |
| Works through *your* agents (Claude Code, Cursor, MCP…) | ✅ | ❌ | ❌ | ✅ |
| Open, reviewable, Git-friendly context | ❌ | ❌ | partial | ✅ |
| Governed execution across 22+ sources | ❌ | per-connector | ✅ (definitions only) | ✅ |

A few distinctions worth being precise about:

- **vs. a raw LLM agent** — Wren is the governance and knowledge the agent is
  missing. Same agent, correct answers.
- **vs. a traditional BI tool** — BI tools render dashboards a human builds by
  hand, in their UI. Wren has agents *generate* them from your context and
  deploy them to your own hosting.
- **vs. a bare semantic layer** (dbt Semantic Layer, Cube) — those define metrics
  from the schema. Wren adds the company knowledge that isn't in the schema
  (enum meanings, units, policy, proven examples) and a generative-BI output on
  top. See [How Wren manages your business knowledge](/oss/concepts/knowledge_management).

## Wren is for you if…

- You want **AI agents to produce trustworthy BI** — answers *and* dashboards —
  not just plausible SQL.
- Your business logic lives **outside the database** and your agents keep
  getting it wrong.
- You want context that's **open, reviewable, and version-controlled**, usable
  by every agent and person, not gated behind one vendor's UI.
- You query **many sources** (Postgres, BigQuery, Snowflake, DuckDB, and 18+
  more) and want one governed surface across them.

## Skip Wren if…

- You only need a one-off chart from a single CSV.
- You're happy letting an agent guess at SQL with no governance.
- You want a fully hosted, click-to-build BI product with no setup — in that
  case look at [Wren AI Commercial](https://getwren.ai).

## Where to go next

- [Install](/oss/get_started/installation) and the [Quickstart](/oss/get_started/quickstart)
- [What does Wren AI mean by context?](/oss/concepts/what_is_context) — the idea underneath GenBI
- [Build & deploy a GenBI app](/oss/guides/genbi) — see the payoff
