# Variables
WREN_AI_SERVICE_PORT=5556

# ANSI color codes
GREEN=\033[0;32m
YELLOW=\033[0;33m
RED=\033[0;31m
BLUE=\033[0;34m
RESET=\033[0m

setup:
	@echo "$(YELLOW)Setting up development environment...$(RESET)"
	@$(MAKE) check-python
	@$(MAKE) check-poetry
	@$(MAKE) install-python-dependencies
	@$(MAKE) install-precommit-hooks
	@$(MAKE) setup-envfile
	@echo "$(GREEN)Development environment setup complete!$(RESET)"

check-python:
	@echo "$(YELLOW)Checking Python installation...$(RESET)"
	@if command -v python3 > /dev/null; then \
		echo "$(BLUE)$(shell python3 --version) is already installed.$(RESET)"; \
	else \
		echo "$(RED)Python 3 is not installed. Please install Python 3 to continue.$(RESET)"; \
		exit 1; \
	fi

check-poetry:
	@echo "$(YELLOW)Checking Poetry installation...$(RESET)"
	@if command -v poetry > /dev/null; then \
		echo "$(BLUE)$(shell poetry --version) is already installed.$(RESET)"; \
	else \
		echo "$(RED)Poetry is not installed. You can install poetry by running the following command," \
					" then adding Poetry to your PATH:"; \
		echo "$(RED) curl -sSL https://install.python-poetry.org | python3 - --version 1.7.1$(RESET)"; \
		echo "$(RED)More detail here: https://python-poetry.org/docs/#installing-with-the-official-installer$(RESET)"; \
		exit 1; \
	fi

install-python-dependencies:
	@echo "$(YELLOW)Installing dependencies...$(RESET)"
	@poetry install
	@echo "$(GREEN)Dependencies installed!$(RESET)"

install-precommit-hooks:
	@echo "$(YELLOW)Installing pre-commit hooks...$(RESET)"
	@poetry run pre-commit install
	@poetry run pre-commit run --all-files
	@echo "$(GREEN)Pre-commit hooks installed!$(RESET)"

setup-envfile:
	@echo "$(YELLOW)Setting up environment...$(RESET)"
	@if [ -f ".env" ]; then \
		echo "$(BLUE)environment file already exists.$(RESET)"; \
	else \
		echo "$(YELLOW)Creating .env file...$(RESET)"; \
		cp .env.example .env; \
		cp .env.dev.example .env.dev; \
	fi

start:
	@echo "$(YELLOW)Starting all services...$(RESET)"
	@poetry run python -m src.prepare_mdl_json
	@$(MAKE) start-qdrant
	@$(MAKE) start-wren-engine
	@$(MAKE) start-ai
	@echo "$(GREEN)All services started!$(RESET)"

stop:
	@echo "$(YELLOW)Stopping all services...$(RESET)"
	@$(MAKE) stop-qdrant
	@$(MAKE) stop-wren-engine
	@$(MAKE) stop-ai
	@echo "$(GREEN)All services stopped!$(RESET)"

start-qdrant:
	@echo "$(YELLOW)Starting Qdrant...$(RESET)"
	@if docker ps --format '{{.Names}}' | grep 'qdrant' 1> /dev/null; then \
		echo "$(BLUE)Qdrant is already running.$(RESET)"; \
	else \
		docker start qdrant > /dev/null 2>&1 || \
		docker run -p 6333:6333 -p 6334:6334 -d --name qdrant qdrant/qdrant:v1.7.4; \
	fi
	@echo "$(GREEN)Qdrant started!$(RESET)"

stop-qdrant:
	@echo "$(YELLOW)Stopping Qdrant...$(RESET)"
	@if docker ps --format '{{.Names}}' | grep 'qdrant' 1> /dev/null; then \
		docker stop qdrant > /dev/null; \
		echo "$(GREEN)Qdrant stopped!$(RESET)"; \
	else \
		echo "$(BLUE)Qdrant is not running.$(RESET)"; \
	fi
	@echo "$(YELLOW)Removing Qdrant...$(RESET)"
	@if docker container ls -a --format '{{.Names}}' | grep 'qdrant' 1> /dev/null; then \
		docker rm qdrant > /dev/null; \
		echo "$(GREEN)Qdrant container removed!$(RESET)"; \
	else \
		echo "$(BLUE)Qdrant container does not exist.$(RESET)"; \
	fi

start-wren-engine:
	@echo "$(YELLOW)Starting Wren Engine...$(RESET)"
	@docker-compose -f ./src/eval/wren-engine/docker-compose.yml --env-file ./src/eval/wren-engine/.env up -d
	@until curl -L 127.0.0.1:8080 > /dev/null 2>&1; do \
		echo "$(YELLOW)Waiting for Wren Engine to start...$(RESET)"; \
		sleep 10; \
	done
	@echo "$(GREEN)Wren Engine started!$(RESET)"

stop-wren-engine:
	@echo "$(YELLOW)Stopping Wren Engine...$(RESET)"
	@docker-compose -f ./src/eval/wren-engine/docker-compose.yml --env-file ./src/eval/wren-engine/.env down

start-ai:
	@echo "$(YELLOW)Starting Wren AI service...$(RESET)"
	@poetry run python -m src.__main__ &
	@echo "$(YELLOW)Waiting for Wren AI service to start...$(RESET)"
	@until nc -z localhost $(WREN_AI_SERVICE_PORT); do sleep 1; done
	@echo "$(GREEN)Wren AI service started!$(RESET)"

stop-ai:
	@echo "$(YELLOW)Stopping Wren AI service...$(RESET)"
	@if pgrep -f "python.* src.__main__" 1> /dev/null; then \
		pkill -f "python.* src.__main__"; \
		echo "$(GREEN)Wren AI service stopped!$(RESET)"; \
	else \
		echo "$(BLUE)Wren AI service is not running.$(RESET)"; \
	fi

psql:
	@echo "$(YELLOW)Connecting to Wren Engine via psql...$(RESET)"
	@docker exec -it wren-wren-engine-1 bash launch-cli.sh

eval:
	@$(MAKE) start-qdrant
	@$(MAKE) start-wren-engine
	@echo "$(YELLOW)Running evaluation for ${pipeline}...$(RESET)"
	@poetry run python -m src.eval.${pipeline} ${args}
	@$(MAKE) stop-qdrant
	@$(MAKE) stop-wren-engine

streamlit:
	@echo "$(YELLOW)Starting Streamlit app for ${pipeline}...$(RESET)"
	@poetry run streamlit run src/eval/${pipeline}/streamlit_app.py

test:
	@poetry run python -m src.prepare_mdl_json --dataset_name book_2
	@$(MAKE) start-qdrant
	@$(MAKE) start-wren-engine
	@poetry run pytest -s $(args)
	@$(MAKE) stop-qdrant
	@$(MAKE) stop-wren-engine

build:
	@echo "$(YELLOW)Building Docker images...$(RESET)"
	@docker-compose -f docker/docker-compose.yml --env-file .env.prod build
	@echo "$(GREEN)Docker images built!$(RESET)"

up:
	@echo "$(YELLOW)Starting all services...$(RESET)"
	@$(MAKE) start-wren-engine
	@docker-compose -f docker/docker-compose.yml --env-file .env.prod up -d
	@echo "$(GREEN)All services started!$(RESET)"

down:
	@echo "$(YELLOW)Stopping all services...$(RESET)"
	@$(MAKE) stop-wren-engine
	@docker-compose -f docker/docker-compose.yml --env-file .env.prod down
	@echo "$(GREEN)All services stopped!$(RESET)"

### Wren AI Service Demo ###
start-demo:
	@echo "$(YELLOW)Preparing demo data...$(RESET)"
	@cd ../docker; docker-compose --env-file .env.local -f docker-compose-dev.yaml up -d
	@echo "$(GREEN)Demo services started!$(RESET)"

stop-demo:
	@echo "$(YELLOW)Stopping demo services...$(RESET)"
	@cd ../docker; docker-compose --env-file .env.local -f docker-compose-dev.yaml down
	@echo "$(GREEN)Demo services stopped!$(RESET)"

start-ui:
	@echo "$(YELLOW)Starting Wren UI...$(RESET)"
	@cd ../wren-ui; export DB_TYPE=sqlite; export SQLITE_FILE=db.sqlite3;
	@cd ../wren-ui; yarn && yarn rollback --all && yarn migrate && yarn dev

start-app:
	@echo "$(YELLOW)Running Wren AI service demo...$(RESET)"
	@cd demo && poetry run streamlit run app.py

help:
	@echo "$(BLUE)Usage: make [target]$(RESET)"
	@echo "Targets:"
	@echo "  $(GREEN)setup$(RESET)             - Setup development environment"
	@echo "  $(GREEN)start$(RESET)             - Start all services"
	@echo "  $(GREEN)stop$(RESET)              - Stop all services"
	@echo "  $(GREEN)start-qdrant$(RESET)      - Start Qdrant"
	@echo "  $(GREEN)stop-qdrant$(RESET)       - Stop Qdrant"
	@echo "  $(GREEN)start-wren-engine$(RESET) - Start Wren Engine"
	@echo "  $(GREEN)stop-wren-engine$(RESET)  - Stop Wren Engine"
	@echo "  $(GREEN)start-ai$(RESET)          - Start Wren AI service"
	@echo "  $(GREEN)stop-ai$(RESET)           - Stop Wren AI service"
	@echo "  $(GREEN)psql$(RESET)              - Connect to Wren Engine via psql"
	@echo "  $(GREEN)eval$(RESET)              - Run evaluation pipeline. more available arguments can be found in each pipeline"
	@echo "                      Example: make eval pipeline=ask args='--help'"
	@echo "  $(GREEN)streamlit$(RESET)         - Start Streamlit app for each evaluation pipeline"
	@echo "                      Example: make streamlit pipeline=ask"
	@echo "  $(GREEN)test$(RESET)              - Run tests"
	@echo "  $(GREEN)build$(RESET)             - Build Docker images(might be deprecated)"
	@echo "  $(GREEN)up$(RESET)                - Start all services using Docker Compose(might be deprecated)"
	@echo "  $(GREEN)down$(RESET)              - Stop all services using Docker Compose(might be deprecated)"
	@echo "  $(GREEN)start-demo$(RESET)        - Start demo services"
	@echo "  $(GREEN)stop-demo$(RESET)         - Stop demo services"
	@echo "  $(GREEN)start-ui$(RESET)          - Start Wren UI"
	@echo "  $(GREEN)start-app$(RESET)         - Start Wren AI demo streamlit app"

.PHONY: test clean all
