# Fork Customizations

> Upstream: [Canner/WrenAI](https://github.com/Canner/WrenAI)
> Fork maintained by: @ashsolei
> Last reviewed: 2026-04-08
> Fork type: **active-dev**
> Sync cadence: **monthly**

## Purpose of Fork

Natural-language-to-SQL platform; iAiFy actively maintains select subprojects.

## Upstream Source

| Property | Value |
|---|---|
| Upstream | [Canner/WrenAI](https://github.com/Canner/WrenAI) |
| Fork org | AiFeatures |
| Fork type | active-dev |
| Sync cadence | monthly |
| Owner | @ashsolei |

## Carried Patches

Local commits ahead of `upstream/main` at last review:

- `fa59cdab chore: sync CLAUDE.md and copilot-instructions docs`
- `abe3d7c5 docs: update FORK-CUSTOMIZATIONS.md with upstream source`
- `968a6c52 docs: add FORK-CUSTOMIZATIONS.md per enterprise fork governance`
- `07044d26 ci: add copilot-setup-steps.yml for Copilot Workspace`
- `1c947d02 chore: add AGENTS.md`
- `2468c54b chore: add CLAUDE.md`
- `aac9e701 chore: add copilot-instructions.md`
- `d47cd4b7 chore: add Copilot Coding Agent setup steps`
- `71ff12ed chore: remove misplaced agent files from .github/copilot/agents/`
- `0100e3bc chore: deploy core custom agents from AgentHub`
- `28649dfa chore: deploy core Copilot agents from AgentHub`
- `49915bfb docs: add FORK-CUSTOMIZATIONS.md`
- `d120affb chore: add dependabot.yml`
- `2f07c399 chore: add CODEOWNERS [governance-orchestrator]`
- `2f16fe94 chore: remove workflow wren-launcher-ci.yaml — enterprise cleanup`
- `75316451 chore: remove workflow ui-test.yaml — enterprise cleanup`
- `221896de chore: remove workflow ui-release-image.yaml — enterprise cleanup`
- `40e5dd05 chore: remove workflow ui-release-image-stable.yaml — enterprise cleanup`
- `d2e30c24 chore: remove workflow ui-lint.yaml — enterprise cleanup`
- `c8d5be15 chore: remove workflow pull-request-title-validator.yaml — enterprise cleanup`
- `b67c3643 chore: remove workflow pr-tagger.yaml — enterprise cleanup`
- `61c50b1a chore: remove workflow create-rc-release.yaml — enterprise cleanup`
- `7cc90f64 chore: remove workflow create-rc-release-pr.yaml — enterprise cleanup`
- `016a975c chore: remove workflow ai-service-test.yaml — enterprise cleanup`
- `a405fda9 chore: remove workflow ai-service-release-stable-image.yaml — enterprise cleanup`
- ... (2 more commits ahead of `upstream/main`)

## Supported Components

- `wren-ai-service/` - active iAiFy scope
- Root governance and CI files

## Out of Support

- `wren-engine/`, `wren-launcher/`, `wren-ui/` - upstream-of-record; iAiFy consumes but does not maintain
- Any component not named above is out of support

## Breaking-Change Policy

1. On upstream sync, classify per `governance/docs/fork-governance.md`.
2. Breaking API/license/security changes auto-classify as `manual-review-required`.
3. Owner triages within 5 business days; conflicts are logged to the `fork-sync-failure` issue label.
4. Revert local customizations only after stakeholder sign-off.

## Sync Strategy

This fork follows the [Fork Governance Policy](https://github.com/Ai-road-4-You/governance/blob/main/docs/fork-governance.md)
and the [Fork Upstream Merge Runbook](https://github.com/Ai-road-4-You/governance/blob/main/docs/runbooks/fork-upstream-merge.md).

- **Sync frequency**: monthly
- **Conflict resolution**: Prefer upstream; reapply iAiFy customizations on a sync branch
- **Automation**: [`Ai-road-4-You/fork-sync`](https://github.com/Ai-road-4-You/fork-sync) workflows
- **Failure handling**: Sync failures create issues tagged `fork-sync-failure`

## Decision: Continue, Rebase, Refresh, or Replace

| Option | Current Assessment |
|---|---|
| Continue maintaining fork | yes - active iAiFy product scope |
| Full rebase onto upstream | feasible on request |
| Fresh fork (discard local changes) | not acceptable without owner review |
| Replace with upstream directly | not possible (local product value) |

## Maintenance

- **Owner**: @ashsolei
- **Last reviewed**: 2026-04-08
- **Reference runbook**: `ai-road-4-you/governance/docs/runbooks/fork-upstream-merge.md`
