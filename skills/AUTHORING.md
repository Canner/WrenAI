# Skill Authoring Guide

> **Where to author new skill content:**
> **NOT here under `skills/`.** New skill guides ship as Python package data
> in [`core/wren/src/wren/skills_content/<name>/`](../core/wren/src/wren/skills_content/),
> served at runtime by `wren skills get <name>`. That keeps the content
> version-aligned with the installed `wren` CLI — no skill cache, no
> `versions.json` drift hack.
>
> This `skills/` tree only contains the **distribution stubs** that AI clients
> install (one new discovery stub `wren/`, plus five deprecated redirect
> stubs kept for one release).

The skill content format below still follows the
[Agent Skills](https://agentskills.io/) open spec — the only thing that
changed is where the files live and how they reach the agent.

---

## Directory layout (under `core/wren/src/wren/skills_content/`)

```text
<name>/
├── SKILL.md              # Required — frontmatter + workflow instructions
├── references/           # Optional — reference docs, served by `wren skills get <name> --full`
│   ├── some-topic.md
│   └── another-topic.md
└── scripts/              # Optional — bundled scripts, served by `wren skills get <name> --script <s>`
```

---

## Frontmatter

```yaml
---
name: <name>              # matches the parent directory; lowercase, hyphens
description: "What this skill does and when to trigger it. Include trigger
  keywords so an AI client can match it to user intent."
license: Apache-2.0
metadata:
  author: wrenai
---
```

**Drop the `version:` field.** Content version = the installed wren-engine
version, since the SKILL.md ships inside the wheel.

---

## Progressive disclosure

| Tier | Content | Loaded when |
|------|---------|-------------|
| 1 — Discovery stub | `skills/wren/SKILL.md` frontmatter description (~few hundred tokens) | At every AI-client session start |
| 2 — Main guide | `wren skills get <name>` | The agent runs the command when the user's task matches |
| 3 — References | `wren skills get <name> --full` | The agent opts in when it needs depth |
| 3 — Scripts | `wren skills get <name> --script <s>` | Same |

Keep `SKILL.md` under ~500 lines. Move reference-only content into `references/`.

---

## What goes where

### Keep in `SKILL.md`
- Step-by-step workflow the agent follows
- Decision criteria and branching logic
- Short commands the agent needs immediately
- Quick reference tables (file paths, phase mappings, etc.)

### Move to `references/`
- Output templates (report formats, plan file formats)
- Per-case investigation details
- Large lookup tables
- Anything that would push `SKILL.md` past ~500 lines

Cross-link inside the same skill by reference name (delivered via `--full`):
```markdown
For the CTE rewrite pipeline, see the `wren-sql` reference (run
`wren skills get usage --full`).
```

Cross-link to another skill via its CLI command:
```markdown
For day-to-day querying after setup, run `wren skills get usage`.
```

Cross-link to a general doc:
```markdown
For troubleshooting, see the `connect` reference (`wren docs get connect`).
```

---

## Naming

| Item | Convention | Example |
|------|------------|---------|
| Skill directory | `kebab-case` | `generate-mdl/` |
| `name` field | same as directory | `generate-mdl` |
| Reference files | descriptive `kebab-case` | `memory.md`, `wren-sql.md` |
| Script files | descriptive `kebab-case` | `introspect_dlt.py` |

---

## Registering a new skill

1. Create the directory under `core/wren/src/wren/skills_content/<name>/` with `SKILL.md` (and optional `references/`, `scripts/`).
2. Author the content following the format above.
3. Add a test to `core/wren/tests/unit/test_skills_cli.py` verifying `wren skills get <name>` returns the guide and `--full` inlines its references (if any).
4. Done — there is no separate `versions.json` / `index.json` to update; the package-data ships with the wheel and `wren skills list` enumerates it automatically.

No `bash skills/check-versions.sh` step — version drift is impossible by
construction (content travels with the binary).
