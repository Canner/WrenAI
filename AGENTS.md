# AGENTS.md

## Purpose
This file provides operational guidance for agentic coding agents working in this repository.
It captures project architecture, build/lint/test commands, single-test workflows, and style conventions.
Follow these defaults unless the user explicitly asks for a different approach.

## Repository architecture
- Monorepo root: `/Users/Soumana.Amadou/Desktop/Projects/WrenAI`.
- `wren-ui/`: Next.js + TypeScript service (frontend plus GraphQL/server utilities).
- `wren-ai-service/`: Python service (FastAPI ecosystem, LLM pipelines, eval tooling).
- `wren-launcher/`: Go CLI for launching and dbt-related workflows.
- `wren-mdl/`: model schema artifacts (JSON schema and related metadata).
- `wren-engine/`: engine component (separate service module included in repo).
- `docker/`: docker-compose and config templates for local orchestration.
- `deployment/`: deployment docs/resources.

## Rule files (Cursor/Copilot)
- Cursor rules directory `.cursor/rules/`: not found.
- Cursor root rules file `.cursorrules`: not found.
- Copilot instructions `.github/copilot-instructions.md`: not found.
- If any of these files are later added, read and obey them before making changes.

## Global workflow expectations
- Prefer minimal, targeted edits over broad refactors.
- Keep changes scoped to one subproject unless cross-service work is required.
- Use existing scripts/Make targets/Just recipes rather than ad-hoc commands.
- Run lint/tests for touched components before finalizing when feasible.
- Never hardcode secrets or tokens.

## Build, lint, test commands

### wren-ui (Next.js + TypeScript)
Working dir: `wren-ui/`
- Install dependencies: `yarn`
- Start dev server: `yarn dev`
- Production build: `yarn build`
- Start built app: `yarn start`
- Lint + typecheck: `yarn lint`
- Typecheck only: `yarn check-types`
- Unit/integration tests: `yarn test`
- E2E tests: `yarn test:e2e`
- DB migrate: `yarn migrate`
- DB rollback: `yarn rollback`
- GraphQL codegen: `yarn generate-gql`

Run a single Jest test:
- Single test file: `yarn test path/to/file.test.ts`
- By test name: `yarn test path/to/file.test.ts -t "name fragment"`
- By pattern: `yarn test --testPathPattern=someFeature`

### wren-launcher (Go)
Working dir: `wren-launcher/`
- Build all binaries: `make build`
- Clean artifacts: `make clean`
- Rebuild: `make rebuild`
- Format: `make fmt`
- Import formatting: `make imports`
- Static checks: `make vet`
- Lint: `make lint`
- Lint with fixes: `make lint-fix`
- Combined checks: `make check`
- Run all tests: `make test`

Run a single Go test:
- Single package: `go test ./commands/dbt`
- Single test func regex: `go test -run TestDataSource ./commands/dbt`
- Verbose single package: `go test -v ./path/to/package`

### wren-ai-service (Python)
Working dir: `wren-ai-service/`
- Install deps: `poetry install`
- Initialize local files: `just init`
- Start service: `just start`
- Start dev stack: `just up`
- Stop dev stack: `just down`
- Run tests via Justfile: `just test`
- Run pytest directly: `poetry run pytest`
- Run usecase tests: `just test-usecases usecases='all' lang='en'`

Run a single pytest test:
- Single file: `poetry run pytest tests/path/test_file.py -q`
- Single test node: `poetry run pytest tests/path/test_file.py::test_name -q`
- Keyword match: `poetry run pytest -k "name_fragment" -q`

## Formatting and linting standards

### Shared basics
- Follow `.editorconfig` defaults: UTF-8, spaces, final newline, trim trailing whitespace.
- Markdown files may keep trailing whitespace disabled and no max line length.
- Makefiles require tab indentation.

### TypeScript/JavaScript style (wren-ui)
- Formatter: Prettier (`.prettierrc` sets `singleQuote: true`).
- Linter: ESLint (`next/core-web-vitals`, `@typescript-eslint/recommended`, `prettier`).
- Unused vars: underscore-prefixed names are allowed for intentional non-use.
- `any` is permitted by lint config, but prefer specific types where practical.
- Non-null assertions are allowed but should be rare and justified.
- TypeScript `strict` is currently `false`; still write defensively typed code.

Import conventions:
- Keep imports grouped logically: external packages, aliases/internal modules, relative imports.
- Remove unused imports.
- Prefer stable alias paths (`@/`, `@server`) over deep relative traversal when available.

Naming conventions:
- Variables/functions: `camelCase`.
- React components/types/interfaces/enums: `PascalCase`.
- Constants: `UPPER_SNAKE_CASE` for true constants.
- Test files: align with existing patterns (`*.test.ts`, `*.test.tsx`).

### Go style (wren-launcher)
- Formatting is mandatory through `go fmt`.
- Import order managed by `goimports`.
- Lint policy enforced via `.golangci.yml` with linters including:
  `errcheck`, `govet`, `ineffassign`, `staticcheck`, `unused`, `misspell`,
  `unconvert`, `gosec`, `dupl`, `goconst`, `gocyclo`, `bodyclose`, `whitespace`.
- Keep functions focused; extract helpers when cyclomatic complexity grows.

Naming conventions:
- Exported identifiers: `PascalCase`.
- Unexported identifiers: `camelCase`.
- Package names: short, lowercase, no underscores.

### Python style (wren-ai-service)
- Ruff config in `ruff.toml` controls lint + formatting behavior.
- Line length: 88, spaces for indentation, double quotes preferred by formatter.
- Import sorting rule `I001` is enabled; keep imports sorted and grouped.
- Target version in Ruff is `py38`, while project runtime in Poetry is Python 3.12.
  Keep syntax compatible with the project runtime and existing codebase patterns.

Naming conventions:
- Functions/variables/modules: `snake_case`.
- Classes: `PascalCase`.
- Constants: `UPPER_SNAKE_CASE`.

## Error handling guidelines
- Do not swallow errors silently.
- Add context to errors before returning/raising.
- Prefer explicit, typed/domain exceptions over generic catch-all blocks.
- In Go, check returned `error` immediately and wrap with context.
- In TypeScript/Python, fail fast on invalid external input and surface actionable messages.
- Log useful diagnostic details without leaking secrets.

## Testing guidance
- Add or update tests for behavior changes and bug fixes.
- Keep tests deterministic and isolated; avoid time/network dependence unless intentional.
- Prefer focused single-test runs during iteration, then run broader suites before handoff.
- For wren-ui, include UI behavior assertions rather than implementation details.
- For wren-launcher and Python, verify error-path tests when touching error handling.

## Security and config guidance
- Never commit API keys, passwords, or tokens.
- Use env vars and existing config templates (`docker/.env.example`, `docker/config.example.yaml`).
- Validate and sanitize untrusted input, especially around SQL, shell, and file paths.
- Prefer least-privilege defaults for service integrations.

## Agent delivery checklist
- Confirm changed files belong to the intended subproject(s).
- Run formatter/linter for touched language(s).
- Run at least targeted tests (single test or package) related to the change.
- Summarize what was run and any skipped checks in the final handoff.
- If commands fail due to environment limits, report exact failure and suggested next command.
