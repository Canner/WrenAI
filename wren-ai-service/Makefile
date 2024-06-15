.PHONY: demo

## wrenai related ##
dev-up:
	docker compose -f ./tools/dev/docker-compose-dev.yaml --env-file ./tools/dev/.env.example up -d

dev-down:
	docker compose -f ./tools/dev/docker-compose-dev.yaml --env-file ./tools/dev/.env.example down
## wrenai related ##


## wren-ai-service related ##
start:
	poetry run python -m src.pre_run && poetry run python -m src.__main__

build:
	docker compose -f docker/docker-compose.yaml --env-file .env.prod build

up:
	make dev-up
	docker compose -f docker/docker-compose.yaml --env-file .env.prod up -d

down:
	make dev-down
	docker compose -f docker/docker-compose.yaml --env-file .env.prod down
## wren-ai-service related ##


## utilities related ##
# present the evaluation result on the streamlit app
# example: make streamlit pipeline=ask_details
eval_visualzation:
	poetry run streamlit run src/eval/${pipeline}/streamlit_app.py

# example: make eval pipeline=ask_details
# example: make eval pipeline=ask args="--help" to check all available arguments
eval:
	make dev-up
	poetry run python -m src.eval.$(pipeline) $(args)
	make dev-down

demo:
	cd demo; poetry run streamlit run app.py
## utilities related ##


## wren-engine related ##
psql:
	docker exec -it wren-wren-engine-1 bash launch-cli.sh
## wren-engine related ##


## test related ##
test:
	mkdir -p tools/dev/etc && cp tools/dev/config.properties.example tools/dev/etc/config.properties
	poetry run python -m src.prepare_mdl_json --dataset_name book_2
	make dev-up
	poetry run pytest -s $(args)
	make dev-down

load-test:
	poetry run python -m tests.locust.locust_script
## test related ##
