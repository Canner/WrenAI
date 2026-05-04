# CLAUDE.md

WrenAI is an open-source GenBI (Generative BI) agent that converts natural language questions into SQL queries and charts. It uses a semantic layer (MDL - Metadata Definition Language) to guide LLM-powered text-to-SQL generation via retrieval-augmented generation (RAG).

## Repository Structure

This is a monorepo with three main services:

- **wren-ui/** — Next.js 14 frontend + Apollo GraphQL backend (TypeScript, Yarn 4.5.3)
- **wren-ai-service/** — AI/LLM service (Python 3.12, FastAPI, Poetry, Just command runner)
- **wren-launcher/** — CLI deployment tool (Go 1.18+, Make)
- **docker/** — Docker Compose configs for running all services together
- **deployment/** — Kubernetes/Kustomize manifests
- **wren-engine/** — SQL engine (git submodule, not developed here)
- **wren-mdl/** — MDL JSON schema definitions

## Build, Test, and Lint Commands

### wren-ui (TypeScript/Next.js)

```bash
cd wren-ui
yarn install
yarn dev                # Dev server on port 3000 (TZ=UTC)
yarn build              # Production build (max-old-space-size=8192)
yarn lint               # TypeScript type check + ESLint
yarn check-types        # tsc --noEmit
yarn test               # Jest unit tests
yarn test:e2e           # Playwright E2E tests (installs chromium)
yarn migrate            # Knex database migrations
yarn rollback           # Knex migration rollback
yarn generate-gql       # GraphQL codegen from codegen.yaml
```

Environment: set `DB_TYPE=sqlite` (default) or `DB_TYPE=pg` with PostgreSQL connection vars. The UI needs `WREN_ENGINE_ENDPOINT`, `WREN_AI_ENDPOINT`, and `IBIS_SERVER_ENDPOINT` to connect to backend services.

### wren-ai-service (Python/FastAPI)

```bash
cd wren-ai-service
poetry install
just init               # Creates config.yaml and .env.dev from examples
just up                 # Start dev Docker services (Qdrant, engine, etc.)
just start              # Run AI service (poetry run python -m src.__main__)
just test               # pytest (spins up Docker deps, ignores usecases)
just test [test_args]   # e.g., just test tests/pytest/pipelines/
just test-usecases      # Run use-case integration tests
just down               # Stop Docker services
just load-test          # Locust load tests
```

Configuration is via `config.yaml` (multi-document YAML with sections for LLM, embedder, engine, document_store, pipeline, and settings). Environment variables in `.env.dev` (API keys). Settings load order: defaults → env vars → .env.dev → config.yaml.

Pre-commit hooks: `poetry run pre-commit install` then `poetry run pre-commit run --all-files`

### wren-launcher (Go)

```bash
cd wren-launcher
make build              # Cross-compile for macOS/Linux/Windows
make test               # go test ./...
make check              # fmt + vet + lint (golangci-lint)
make lint-fix           # Auto-fix lint issues
```

## Architecture

### Service Communication Flow

```
User → Wren UI (Next.js :3000)
         ↓ GraphQL (Apollo Server embedded in Next.js API routes)
       Apollo Server → Wren AI Service (FastAPI :5556) [HTTP REST]
                     → Wren Engine (:8080) [SQL validation/execution]
                     → Ibis Server (:8000) [SQL abstraction for data sources]
       Wren AI Service → Qdrant (:6333) [vector search for RAG]
                       → LLM Provider (OpenAI/Azure/etc.) [text-to-SQL generation]
```

### Wren UI Internal Architecture

The Next.js app embeds an Apollo GraphQL server in its API routes (`src/apollo/`):

- **`src/apollo/server/resolvers/`** — GraphQL resolvers (asking, model, project, dashboard, etc.)
- **`src/apollo/server/services/`** — Business logic layer (askingService, deployService, mdlService, queryService, etc.)
- **`src/apollo/server/repositories/`** — Data access layer using Knex (SQLite or PostgreSQL)
- **`src/apollo/server/adaptors/`** — External service adapters (AI service, engine)
- **`src/apollo/client/`** — Frontend GraphQL operations
- **`src/components/`** — React components organized by page (home, setup, modeling, knowledge)
- **`src/pages/`** — Next.js page routes

Path aliases: `@/*` → `./src/*`, `@server/*` → `./src/apollo/server/*`

### Wren AI Service Internal Architecture

The Python service uses a pipeline-based architecture:

- **`src/pipelines/`** — RAG pipeline implementations:
  - `indexing/` — MDL schema, table descriptions, historical questions, SQL pairs → Qdrant
  - `retrieval/` — Semantic search for relevant context from Qdrant
  - `generation/` — SQL generation, chart generation, intent classification
  - `ask/` — Orchestrates retrieval + generation for text-to-SQL
  - `ask_details/` — SQL breakdown and explanation
  - `semantics/` — Semantic processing helpers
- **`src/web/v1/services/`** — Service layer (AskService, SemanticsPreparationService, ChartService, SqlPairsService, etc.)
- **`src/web/v1/routers/`** — FastAPI route handlers
- **`src/core/`** — Base abstractions (pipeline, provider, engine interfaces)
- **`src/globals.py`** — ServiceContainer wiring all services and pipelines together
- **`src/config.py`** — Pydantic Settings with all configuration knobs

Pipelines are configured declaratively in `config.yaml`, wiring LLM providers, embedders, document stores, and engines to named pipeline components.

### Data Flow for "Ask" (Text-to-SQL)

1. User submits natural language question in UI
2. UI sends GraphQL mutation to Apollo Server
3. Apollo Server calls AI Service REST API
4. AI Service runs intent classification → retrieves relevant schema/context from Qdrant → generates SQL via LLM
5. Generated SQL is validated against Wren Engine
6. SQL corrections are attempted if validation fails (up to `max_sql_correction_retries`)
7. Results returned through the chain back to UI

### MDL (Metadata Definition Language)

The semantic layer that maps business concepts to database schema. Defines models, columns, relationships, metrics, and calculated fields. MDL is indexed into Qdrant as vector embeddings to provide context for LLM SQL generation. Schema defined in `wren-mdl/mdl.schema.json`.

## Docker Development

To run the full stack locally:
```bash
cd docker
cp .env.example .env.local    # Configure API keys and ports
cp config.example.yaml config.yaml
docker compose --env-file .env.local up -d
```

For developing a single service while others run in Docker, use `docker-compose-dev.yaml` in the AI service's `tools/dev/` directory.

## Commit Convention

Follows conventional commits: `type(scope): description`
- Scopes: `wren-ui`, `wren-ai-service`, `wren-launcher`
- Types: `feat`, `fix`, `chore`, `refactor`
- Examples: `feat(wren-ui): add dashboard widget`, `fix(wren-ai-service): handle empty MDL`

## CI/CD

- PR labels trigger service-specific CI: `ci/ui` for UI tests/lint, `ci/ai-service` for AI service tests
- Docker images published to `ghcr.io/canner/`
