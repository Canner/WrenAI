# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Wren AI is an open-source GenBI (Generative Business Intelligence) agent that converts natural language queries into SQL, charts, and insights. The system consists of multiple microservices working together in a distributed architecture.

### Core Services Architecture

- **wren-ui** (Port 3000): Next.js frontend service using TypeScript/React, GraphQL (Apollo), and Ant Design
- **wren-ai-service** (Port 5556): Python backend for LLM-related tasks (Python 3.12, Poetry, FastAPI, Haystack AI)
- **wren-engine** (Port 8080): Core semantic engine for SQL generation (Git submodule - may be empty locally)
- **ibis-server** (Port 8000): Data source connectivity layer
- **qdrant** (Port 6333/6334): Vector database for embeddings

The semantic layer uses MDL (Modeling Definition Language) to encode schema, metrics, and joins ensuring accurate LLM outputs.

## Development Environment Setup

### Prerequisites
- Node.js 18+ with Yarn 4.5.3
- Python 3.12 with Poetry 1.8.3
- Docker and Docker Compose
- Just command runner (for AI service)

### Database Configuration
Based on user preferences, use MySQL instead of SQLite:
- Host: localhost
- Username: root
- Password: root
- Database: regulatory_data_complete

Configure via environment variables:
```bash
DB_TYPE=mysql
MYSQL_URL=mysql://root:root@localhost:3306/regulatory_data_complete
```

### LLM Configuration
User prefers Zhipu GLM4.5 over OpenAI models. Configure in the AI service config.yaml or environment variables.

## Common Development Commands

### Full Stack Development (Docker)
```bash
# Navigate to docker directory
cd docker

# Copy and configure environment
cp .env.example .env.local
# Edit .env.local with your API keys and settings

# Start all services
docker-compose -f docker-compose.yaml --env-file .env.local up

# Development mode (excludes UI service for local development)
docker-compose -f docker-compose-dev.yaml --env-file .env.local up

# Stop services
docker-compose -f docker-compose-dev.yaml --env-file .env.local down
```

### Frontend Development (wren-ui)
```bash
cd wren-ui

# Install dependencies
yarn install

# Database migrations (run once or after schema changes)
yarn migrate

# Development server with hot reload
yarn dev

# Production build
yarn build

# Type checking
yarn check-types

# Linting
yarn lint

# Unit tests
yarn test

# E2E tests (installs Playwright automatically)
yarn test:e2e

# Generate GraphQL types after schema changes
yarn generate-gql
```

### Backend Development (wren-ai-service)
```bash
cd wren-ai-service

# Install dependencies
poetry install

# Initialize configuration files (creates config.yaml and .env.dev)
just init

# Start required containers (qdrant, etc.)
just up

# Start the AI service locally
just start

# Stop containers
just down

# Run unit tests
just test

# Load testing
just load-test
```

### Git Submodule Management
```bash
# Initialize and update submodules (for wren-engine)
git submodule update --init --recursive

# Update submodules to latest
git submodule update --remote
```

## Development Workflow Patterns

### Multi-Service Development
When developing across services simultaneously:
1. Comment out services in `docker/docker-compose-dev.yaml` that you want to run from source
2. Update environment variables in `.env.local` to point to locally running services
3. Start remaining services via docker-compose
4. Run target services from source code directories

### Database Development
The project supports both SQLite (default) and PostgreSQL. For MySQL (user preference):
1. Set up local MySQL with provided credentials
2. Update environment variables accordingly
3. Run migrations via `yarn migrate` in wren-ui

### Adding Data Sources
New data source connectors require coordinated changes:
1. **Engine**: Implement connector and metadata API
2. **UI Backend**: Define connection info types and GraphQL schema in `src/apollo/server/`
3. **UI Frontend**: Create form templates in `src/components/pages/setup/dataSources/` and update `src/utils/dataSourceType.ts`

## Code Architecture

### Frontend (wren-ui)
```
src/
├── apollo/server/          # GraphQL server, resolvers, and adaptors
├── components/             # React components
│   └── pages/setup/dataSources/  # Data source connection forms
├── hooks/                  # Custom React hooks
├── pages/                  # Next.js pages
├── styles/                 # LESS stylesheets and Ant Design theming
└── utils/                  # Utility functions and configurations
```

Key files:
- `src/apollo/server/adaptors/` - Service communication adapters
- `src/utils/dataSourceType.ts` - Data source configurations
- `src/apollo/server/` - GraphQL schema and resolvers

### Backend (wren-ai-service)
```
src/
├── core/                   # Core business logic
├── pipelines/              # Haystack AI pipelines for LLM processing
├── providers/              # External service providers (OpenAI, etc.)
└── web/                    # FastAPI web layer
```

Uses Poetry for dependency management, FastAPI for HTTP APIs, and Haystack AI for LLM pipeline orchestration.

## Testing Strategy

### Frontend Testing
- **Unit tests**: Jest with `yarn test`
- **E2E tests**: Playwright with `yarn test:e2e`
- **Type checking**: TypeScript with `yarn check-types`

### Backend Testing
- **Unit tests**: pytest with `just test`
- **Load testing**: Locust with `just load-test`
- **Integration tests**: Docker-based with `just up && just test && just down`

### Test File Patterns
- Frontend: `*.test.ts`, `*.test.tsx` alongside source files
- Backend: `tests/` directory with pytest structure
- E2E: `wren-ui/e2e/` directory with Playwright tests

## Environment Configuration

### Required Environment Variables
```bash
# LLM API Keys (user prefers Zhipu GLM4.5)
OPENAI_API_KEY=             # Optional, for OpenAI models
GOOGLE_API_KEY=             # For Google Gemini models
# ... other LLM provider keys as needed

# Service Endpoints
WREN_ENGINE_ENDPOINT=http://localhost:8080
WREN_AI_ENDPOINT=http://localhost:5556
IBIS_SERVER_ENDPOINT=http://localhost:8000

# Database (user prefers MySQL)
DB_TYPE=mysql
MYSQL_URL=mysql://root:root@localhost:3306/regulatory_data_complete

# Optional: Development flags
TELEMETRY_ENABLED=false
```

### Service Port Mappings
- UI: 3000
- AI Service: 5556  
- Engine: 8080
- Ibis Server: 8000
- Qdrant: 6333/6334

## Financial Regulatory Database Extension

This repository includes a custom `financial-regulatory-db/` directory for Chinese financial regulatory database setup:
- Contains SQL scripts for 90+ financial data tables
- Follows Chinese banking regulatory standards ("一表通" interface specification)
- Uses professional English naming with Chinese comments
- Execute in order: tables → indexes → views

## Build and Deployment

### Production Builds
```bash
# Frontend production build
cd wren-ui && yarn build

# Backend uses Docker for production deployment
# See docker/docker-compose.yaml for production configuration
```

### Docker Configuration
- Development: `docker-compose-dev.yaml` (excludes UI for local development)
- Production: `docker-compose.yaml` (full stack)
- All services are containerized with specific version tags

## Contributing Guidelines

### Code Style
- **Frontend**: ESLint + Prettier, TypeScript strict mode
- **Backend**: Poetry with dev dependencies for formatting
- **Commits**: Use conventional commit prefixes (`feat:`, `fix:`, `chore:`)

### Pull Request Workflow
- UI changes require GraphQL schema updates and frontend implementation
- LLM-related changes primarily affect the AI service
- Data source changes require updates to both UI and Engine services
- CI/CD runs tests automatically on labeled PRs (`ci/ai-service`, etc.)

### Local Development Tips
- Use `yarn generate-gql` after GraphQL schema changes
- Run `just init` after pulling backend changes
- Check Docker container logs when services fail to communicate
- Use bundle analyzer with `ANALYZE=true yarn build` for frontend optimization