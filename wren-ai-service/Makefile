# Variables
AI_PORT=5555

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
	fi

# Start all services
start:
	@echo "$(YELLOW)Starting all services...$(RESET)"
	@poetry run python -m src.prepare_mdl_json
	@$(MAKE) start-qdrant
	@$(MAKE) start-wren-engine
	@$(MAKE) start-ai
	@echo "$(GREEN)All services started!$(RESET)"

start-qdrant:
	@echo "$(YELLOW)Starting Qdrant...$(RESET)"
	@if docker ps --format '{{.Names}}' | grep 'qdrant' 1> /dev/null; then \
		echo "$(BLUE)Qdrant is already running.$(RESET)"; \
	else \
		docker start qdrant > /dev/null 2>&1 || \
		docker run -p 6333:6333 -p 6334:6334 -d --name qdrant qdrant/qdrant:v1.7.4; \
	fi
	@echo "$(GREEN)Qdrant started!$(RESET)"

start-wren-engine:
	@echo "$(YELLOW)Starting Wren Engine...$(RESET)"
	@docker-compose -f ./src/eval/wren-engine/docker-compose.yml --env-file ./src/eval/wren-engine/.env up -d
	@echo "$(GREEN)Wren Engine started!$(RESET)"

start-ai:
	@echo "$(YELLOW)Starting Wren AI service...$(RESET)"
	@poetry run python -m src.__main__ &
	@echo "$(YELLOW)Waiting for Wren AI service to start...$(RESET)"
	@until nc -z localhost $(AI_PORT); do sleep 1; done
	@echo "$(GREEN)Wren AI service started!$(RESET)"

# Stop all services
stop:
	@echo "$(YELLOW)Stopping all services...$(RESET)"
	@$(MAKE) stop-qdrant
	@$(MAKE) stop-wren-engine
	@$(MAKE) stop-ai
	@echo "$(GREEN)All services stopped!$(RESET)"

stop-qdrant:
	@echo "$(YELLOW)Stopping Qdrant...$(RESET)"
	@docker stop qdrant > /dev/null
	@echo "$(YELLOW)Removing Qdrant...$(RESET)"
	@docker rm qdrant > /dev/null

stop-wren-engine:
	@echo "$(YELLOW)Stopping Wren Engine...$(RESET)"
	@docker-compose -f ./src/eval/wren-engine/docker-compose.yml --env-file ./src/eval/wren-engine/.env down

stop-ai:
	@echo "$(YELLOW)Stopping Wren AI service...$(RESET)"
	@pkill -f "python.* src.__main__"
	@echo "$(GREEN)Wren AI service stopped!$(RESET)"

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
	@echo "                                    - 		Example: make eval pipeline=ask args='--help'"
	@echo "  $(GREEN)streamlit$(RESET)         - Start Streamlit app for each evaluation pipeline"
	@echo "                                    - 		Example: make streamlit pipeline=ask"

# deprecated?
build:
	docker compose -f docker/docker-compose.yml --env-file .env.prod build

# deprecated?
up:
	make run-wren-engine && \
	docker compose -f docker/docker-compose.yml --env-file .env.prod up -d

# deprecated?
down:
	make stop-wren-engine && \
	docker compose -f docker/docker-compose.yml --env-file .env.prod down

.PHONY: test clean all
