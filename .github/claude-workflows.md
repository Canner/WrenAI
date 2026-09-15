# Claude GitHub workflows

How Claude is wired into this repo's pull requests and which knobs exist.
Two workflows, one trigger each.

| Workflow | Trigger | What it does | Writes to repo |
|---|---|---|---|
| `claude-code-review.yml` | PR comment starting with `/review` or containing `@claude review` | Structured review via the `code-review` plugin: parallel reviewer agents, each finding re-verified, inline comments on the diff | No (tool allowlist is `gh pr/issue` reads, `gh pr comment`, inline-comment tool only) |
| `claude.yml` | `@claude <anything else>` in an issue/PR comment, an inline review comment, a review body, or an issue body/title | Free-form: answer, investigate, fix code, open a branch | Yes, when asked |

Both run only from the default branch, as GitHub requires for `issue_comment`
events. Copies on other branches are inert.

## Model and effort

Fixed at **Opus 5 / effort `high`** for both workflows. Nothing in the
comment changes it. The plugin pins its own reviewer subagents by tier alias,
so every review run uses all three tiers:

| Role | Model alias |
|---|---|
| Skip check (closed / draft / trivial), CLAUDE.md file discovery | haiku |
| PR summary, CLAUDE.md compliance agents and their verification | sonnet |
| Two bug-hunting agents and bug verification | opus |

Aliases resolve to the latest model of each tier. Pin a tier with the
`ANTHROPIC_DEFAULT_OPUS_MODEL` / `_SONNET_MODEL` / `_HAIKU_MODEL` env vars on
the action step; changing the role split itself means carrying a copy of the
plugin's command file in this repo.

## Guard rails

- **Read-only review.** `claude-code-review.yml` sets `--allowedTools` to the
  plugin's own `gh` reads, `gh pr comment` and the inline-comment tool; nothing
  else is available, so no file edits and no git writes.
- **Clean slate per run.** Before each review the workflow deletes claude[bot]
  inline comments from earlier runs, keeping any root a human replied under.
  The prompt also tells the plugin not to skip a PR Claude already commented
  on, so a repeat review covers commits pushed since the last one.
- **Concurrency.** Job-level groups keyed by PR/issue number. A new review
  request cancels the review still running for that PR. Free-form runs queue
  instead of cancelling, so a run that is pushing commits is never interrupted.
- **Timeouts.** Review 20 min, free-form 45 min. These are the cost ceiling
  per run; `--max-turns` is intentionally not set because the plugin's
  subagent fan-out makes turn counts a poor proxy for cost.
- **Report.** `display_report` puts model, token usage and cost into the job's
  Step Summary.

## Auth and billing

Both workflows use `CLAUDE_CODE_OAUTH_TOKEN`, which bills the Claude account
that generated it and inherits that plan's model access and usage quota. With
Opus fixed as the orchestrator on top of the plugin's Opus reviewer agents,
Opus usage per review is the number to watch. Switching to
`anthropic_api_key` moves CI to API billing with no per-account quota; that is
a separate decision.

## Routing rules worth knowing

- `@claude review` in a **top-level** PR comment goes to the review workflow.
  The same phrase in an **inline** review comment goes to free-form, so
  "review this line" style requests keep their line context.
- One trigger per comment. A comment containing both `@claude do X` and
  `/review` starts both workflows.
- `/review` must be at the start of the comment; `@claude review` can be
  anywhere in it.

## Rollout

Same files across WrenAI-saas, wren-agent-stack, wren-ai-service-saas, Warble,
WrenAI-self-hosted and WrenAI. Only WrenAI-saas additionally runs auto-review
on a path filter; every other repo is comment-triggered only. Repos without a
`CLAUDE_CODE_OAUTH_TOKEN` secret need one added first.

## Follow-ups (not in this change)

- Share the two workflows as a `workflow_call` reusable workflow so defaults
  live in one place.
- Auto-review on `pull_request` events with a repo-specific `paths` filter,
  as WrenAI-saas does.
- `label_trigger` (`claude-review` label) and `allowed_bots` for Dependabot /
  Renovate PRs.
