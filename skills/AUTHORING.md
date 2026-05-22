# Skill Authoring Guide

Skills in this project follow the [Agent Skills](https://agentskills.io/) open format.
Full specification: https://agentskills.io/specification

---

## Directory Structure

Each skill is a subdirectory containing a required `SKILL.md` and optional supporting directories:

```text
skill-name/
├── SKILL.md              # Required — frontmatter + workflow instructions
├── references/           # Optional — detail files loaded on demand
│   ├── some-topic.md
│   └── another-topic.md
└── scripts/              # Optional — executable scripts the agent can run
```

---

## Frontmatter

Every `SKILL.md` must open with YAML frontmatter:

```yaml
---
name: skill-name
description: "What this skill does and when to trigger it. Include specific
  trigger keywords. This field is loaded at startup for every conversation."
license: Apache-2.0
metadata:
  author: wrenai
  version: "1.0"
---
```

**Rules:**
- `name` must exactly match the parent directory name (lowercase, hyphens only)
- `description` is always loaded — keep it concise and keyword-rich so the agent can match it to user intent

---

## Progressive Disclosure

Skills load in three tiers. Design content for the tier where it is actually needed:

| Tier | Content | When loaded |
|------|---------|-------------|
| 1 — Metadata | `name` + `description` (~100 tokens) | Always, at every startup |
| 2 — Instructions | Full `SKILL.md` body | When the skill is activated |
| 3 — Resources | Files in `references/` or `scripts/` | Only when the agent explicitly reads them |

**Keep `SKILL.md` under 500 lines.** If the body is growing, move reference-only content to `references/`.

---

## What Goes Where

### Keep in `SKILL.md`
- Step-by-step workflow the agent follows
- Decision criteria and branching logic
- Short commands or invocations the agent needs immediately
- Quick reference tables (file paths, phase mappings, etc.)

### Move to `references/`
Content that is only needed in certain code paths:
- Output templates (report formats, plan file formats)
- Per-case investigation details (e.g. per-stage debug steps)
- Large lookup tables (connection info examples, error pattern catalogs)
- Anything that would make `SKILL.md` exceed 300 lines

Link to reference files from `SKILL.md` using paths relative to the skill root:
```markdown
Follow [references/diagnose.md](references/diagnose.md) for per-stage investigation steps.
```

---

## Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Skill directory | `kebab-case` | `wren-generate-mdl/` |
| `name` field | same as directory | `wren-generate-mdl` |
| Reference files | descriptive `kebab-case` | `memory.md`, `wren-sql.md` |

---

## Registration

After creating a new skill:

1. Add a section to [SKILLS.md](SKILLS.md) describing the skill, its trigger conditions, and reference files.
2. Add a row to the skills table in [README.md](README.md).
3. Add the skill name and version to [versions.json](versions.json).
4. Add an entry to [index.json](index.json) with `name`, `version`, `description`, `tags`, `dependencies` (if any), and `repository`.
5. Add the skill to the `ALL_SKILLS` array in [install.sh](install.sh).

Both `versions.json` and `index.json` must stay in sync with the `version` field in the skill's `SKILL.md` frontmatter. Run `bash skills/check-versions.sh` to verify parity before merging.

---

## Releasing a skill update

1. Bump `version` in the skill's `SKILL.md` frontmatter.
2. Update the matching version in `versions.json`.
3. Update the matching version in `index.json`.
4. Run `bash skills/check-versions.sh` — must pass before merging.
