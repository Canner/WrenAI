start:
	poetry run python -m src.pre_run && poetry run python -m src.__main__

build:
	docker compose -f docker/docker-compose.yaml --env-file .env.prod build

up:
	make run-wren-engine && \
	docker compose -f docker/docker-compose.yaml --env-file .env.prod up -d

down:
	make stop-wren-engine && \
	docker compose -f docker/docker-compose.yaml --env-file .env.prod down

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
	docker compose -f ./src/eval/wren-engine/docker-compose.yaml --env-file ./src/eval/wren-engine/.env up -d

stop-wren-engine:
	docker compose -f ./src/eval/wren-engine/docker-compose.yaml --env-file ./src/eval/wren-engine/.env down

psql:
	docker exec -it wren-wren-engine-1 bash launch-cli.sh

run-redis:
	docker run -d -p 6379:6379 --name redis redis:7.0.15-alpine

stop-redis:
	docker stop redis && docker rm redis

run-all:
	poetry run python -m src.prepare_mdl_json && \
	make run-qdrant && \
	make run-wren-engine && \
	make run-redis

stop-all:
	make stop-qdrant && \
	make stop-wren-engine && \
	make stop-redis

ui:
	cd ../wren-ui; export DB_TYPE=sqlite export SQLITE_FILE=db.sqlite3 export WREN_AI_ENDPOINT=http://localhost:5556 && \
	yarn install && yarn rollback --all && yarn migrate && yarn dev

demo:
	cd demo; poetry run streamlit run app.py

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
	mkdir -p tools/dev/etc && cp tools/dev/config.properties.example tools/dev/etc/config.properties
	poetry run python -m src.prepare_mdl_json --dataset_name book_2
	make dev-up
	poetry run pytest -s $(args)
	make dev-down

# poetry run python -m src.prepare_mdl_json --dataset_name book_2 && \
# make run-qdrant && \
# make run-wren-engine && \
# poetry run pytest -s $(args) && \
# make stop-all

load-test:
	poetry run python -m tests.locust.locust_script

dev-up:
	docker compose -f ./tools/dev/docker-compose-dev.yaml --env-file ./tools/dev/.env.example up -d

dev-down:
	docker compose -f ./tools/dev/docker-compose-dev.yaml --env-file ./tools/dev/.env.example down

.PHONY: demo
