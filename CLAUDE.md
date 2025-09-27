# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Wren AI is an open-source GenBI (Generative Business Intelligence) agent that converts natural language queries into SQL, charts, and insights. The system consists of multiple services working together:

- **wren-ui**: Next.js frontend service (TypeScript/React)
- **wren-ai-service**: Python backend for LLM-related tasks (Python 3.12, Poetry, FastAPI)
- **wren-engine**: Core semantic engine for SQL generation
- **ibis-server**: Data source connectivity layer

## Architecture

The system follows a microservices architecture with services communicating via HTTP APIs. The semantic layer (MDL - Modeling Definition Language) encodes schema, metrics, and joins to ensure accurate LLM outputs.

## Development Commands

### Wren UI (Frontend)
```bash
# Navigate to wren-ui directory
cd wren-ui

# Install dependencies (requires Node.js 18)
yarn install

# Database migrations
yarn migrate

# Development server
yarn dev

# Build for production
yarn build

# Run tests
yarn test
yarn test:e2e

# Linting and type checking
yarn lint
yarn check-types

# Generate GraphQL types
yarn generate-gql
```

### Wren AI Service (Backend)
```bash
# Navigate to wren-ai-service directory
cd wren-ai-service

# Install dependencies (requires Python 3.12 and Poetry 1.8.3)
poetry install

# Generate configuration files
just init

# Start required containers
just up

# Start the AI service
just start

# Stop containers
just down

# Run tests
just test

# Load testing
just load-test
```

### Docker Compose (Full Stack)
```bash
# Navigate to docker directory
cd docker

# Copy environment template
cp .env.example .env.local

# Start all services
docker-compose -f docker-compose.yaml --env-file .env.local up

# Development mode (excludes UI service)
docker-compose -f docker-compose-dev.yaml --env-file .env.local up

# Stop services
docker-compose -f docker-compose-dev.yaml --env-file .env.local down
```

## Key Development Workflows

### Multi-Service Development
When developing multiple services simultaneously:
1. Comment out services in `docker/docker-compose-dev.yaml` that you want to run from source
2. Update environment variables in `.env.local` to point to locally running services
3. Start remaining services via docker-compose
4. Run target services from source code

### Database Switching
Wren UI supports both SQLite (default) and PostgreSQL:
```bash
# PostgreSQL
export DB_TYPE=pg
export PG_URL=postgres://user:password@localhost:5432/dbname

# SQLite
export DB_TYPE=sqlite
export SQLITE_FILE=./db.sqlite3
```

### Adding Data Sources
New data source connectors require changes to both UI and Engine:
1. **Engine**: Implement connector and metadata API
2. **UI Backend**: Define connection info types and GraphQL schema
3. **UI Frontend**: Create form templates and update data source lists

## Code Structure

### Frontend (wren-ui)
- `/src/components/pages/setup/dataSources/` - Data source connection forms
- `/src/apollo/server/` - GraphQL server and resolvers
- `/src/apollo/server/adaptors/` - Service adapters
- `/src/utils/dataSourceType.ts` - Data source configurations

### Backend (wren-ai-service)
- Uses Poetry for dependency management
- FastAPI for API framework
- Haystack AI for LLM pipelines
- Configuration via YAML files and environment variables

## Environment Configuration

### Required Environment Variables
- `OPENAI_API_KEY` - OpenAI API key for LLM functionality
- `WREN_ENGINE_ENDPOINT` - Engine service URL
- `WREN_AI_ENDPOINT` - AI service URL
- `IBIS_SERVER_ENDPOINT` - Ibis server URL

### Service Ports (default)
- UI: 3000
- AI Service: 5556
- Engine: 8080
- Ibis Server: 8000

## Testing

### UI Testing
- Unit tests: `yarn test`
- E2E tests: `yarn test:e2e` (uses Playwright)

### AI Service Testing
- Unit tests: `just test`
- Load testing: `just load-test`

## Contributing Guidelines
- Follow existing code patterns and conventions
- UI changes require both backend schema updates and frontend implementation
- LLM-related changes primarily affect the AI service
- Data source changes require updates to both UI and Engine services
- Use appropriate PR title prefixes: `feat()`, `fix()`, `chore()`