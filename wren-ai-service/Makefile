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
