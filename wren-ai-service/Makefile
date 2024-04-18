
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

help:
	@echo "$(BLUE)Usage: make [target]$(RESET)"
	@echo "Targets:"
	@echo "  $(GREEN)setup$(RESET): Setup development environment"

start:
	poetry run python -m src.__main__

build:
	docker compose -f docker/docker-compose.yml --env-file .env.prod build

up:
	make run-wren-engine && \
	docker compose -f docker/docker-compose.yml --env-file .env.prod up -d

down:
	make stop-wren-engine && \
	docker compose -f docker/docker-compose.yml --env-file .env.prod down

run-qdrant:
	docker run \
	-p 6333:6333 \
	-p 6334:6334 \
	-d \
	--name qdrant \
	qdrant/qdrant:v1.7.4

stop-qdrant:
	docker stop qdrant && docker rm qdrant

run-wren-engine:
	docker compose -f ./src/eval/wren-engine/docker-compose.yml --env-file ./src/eval/wren-engine/.env up -d

stop-wren-engine:
	docker compose -f ./src/eval/wren-engine/docker-compose.yml --env-file ./src/eval/wren-engine/.env down

psql:
	docker exec -it wren-wren-engine-1 bash launch-cli.sh

run-all:
	poetry run python -m src.prepare_mdl_json && \
	make run-qdrant && \
	make run-wren-engine

stop-all:
	make stop-qdrant && \
	make stop-wren-engine

# present the evaluation result on the streamlit app
# example: make streamlit pipeline=ask_details
streamlit:
	poetry run streamlit run src/eval/${pipeline}/streamlit_app.py

# example: make eval pipeline=ask_details
# example: make eval pipeline=ask args="--help" to check all available arguments
eval:
	make run-all && \
	poetry run python -m src.eval.$(pipeline) $(args)
	make stop-all

test:
	poetry run python -m src.prepare_mdl_json --dataset_name book_2 && \
	make run-qdrant && \
	make run-wren-engine && \
	poetry run pytest -s $(args) && \
	make stop-all

.PHONY: test clean all
