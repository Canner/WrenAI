# Wren Engine — Agent Skills

The actual workflow guides, reference docs, and prompt helpers live **inside
the `wren` CLI itself**, so they always match the installed wren-engine
version (no skill cache, no version drift).

This directory ships a single discovery stub ([`wren/SKILL.md`](wren/SKILL.md))
that an AI client can install. Once the agent reads the stub, it learns to
fetch everything else from the CLI on demand:

```bash
wren skills list                        # all available workflow guides
wren skills get <name>                  # fetch a guide
wren skills get <name> --full           # include the guide's reference docs
wren skills get <name> --script <s>     # fetch a bundled script

wren docs list                          # all available reference docs
wren docs get <reference>               # fetch a reference doc

wren ask "<question>" --guided          # wrap a question for a weaker LLM
wren ask "<question>" --direct          # wrap a question for a stronger LLM
```

## Install

```bash
pip install wrenai                 # the CLI (everything is here)
npx skills add Canner/WrenAI            # install the discovery stub for AI clients
```

Or via Claude Code's plugin marketplace:

```text
/plugin marketplace add Canner/WrenAI --path skills
/plugin install wren@wren
```

## Deprecation window (legacy `wren-onboarding` / `wren-usage` / …)

The five previously-shipped fat skills (`wren-onboarding`, `wren-usage`,
`wren-generate-mdl`, `wren-dlt-connector`, `wren-enrich-context`) are kept
as **redirect stubs** for one release so anyone who previously ran
`npx skills add Canner/WrenAI --skill '*'` still sees them — the stubs just
tell the agent to run `wren skills get <name>` instead. They will be removed
in the release after that.

## Writing a new skill

New skill guides ship as Python package data in
[`core/wren/src/wren/skills_content/<name>/`](../core/wren/src/wren/skills_content/),
not as a new directory under this `skills/` tree. See
[`AUTHORING.md`](AUTHORING.md).
