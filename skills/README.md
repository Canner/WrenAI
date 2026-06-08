# Wren Engine — Agent Skill Distribution

The actual skill content (workflow guides, reference docs, prompt helpers)
**lives inside the `wren` CLI**. This directory ships a single discovery stub
that an AI client installs once; the stub then tells the agent to fetch
everything else from the CLI at runtime (so content always matches the
installed wren-engine version).

See [`SKILLS.md`](SKILLS.md) for the full design and command surface.

## Install

### The CLI itself (where all skill content lives)

```bash
pip install wrenai
```

### The discovery stub (so an AI client knows the CLI exists)

#### Option 1 — Claude Code plugin

```text
/plugin marketplace add Canner/WrenAI --path skills
/plugin install wren@wren
```

#### Option 2 — `npx skills`

```bash
npx skills add Canner/WrenAI
```

The installer auto-detects your AI client. To target a specific one, add
`--agent <name>` (e.g. `claude-code`, `cursor`, `windsurf`, `cline`).

#### Option 3 — local install script

```bash
bash skills/install.sh                 # install the discovery stub
bash skills/install.sh --force         # overwrite existing
```

## What the agent does with the stub

Once installed, the agent reads `wren/SKILL.md` and learns to call:

```bash
wren skills list                        # discover workflow guides
wren skills get onboarding              # fetch a guide (one of 5 names)
wren docs connection-info <ds>          # connection fields for a data source
wren ask "<question>" --guided|--direct # wrap a prompt for an agent
```

## Requirements

- `wren` CLI installed (`pip install wrenai` or `pip install "wrenai[<extras>]"`)
- A database connection (configured via `wren profile add`)
- An AI client that supports skills (Claude Code, Cursor, Cline, etc.)
