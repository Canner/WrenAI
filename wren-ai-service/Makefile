start:
	poetry run python -m src.__main__

build:
	docker compose -f docker/docker-compose.yml build

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

# present the evaluation result on the streamlit app
# example: make streamlit pipeline=src/eval/streamlit_app.py
streamlit:
	poetry run streamlit run $(pipeline)

# example: make eval pipeline=src.eval.ask
eval:
	poetry run python -m $(pipeline) $(args)

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

eval-ask:
	make run-all && \
	poetry run python -m src.eval.ask --eval-from-scratch --eval-after-prediction && \
	make stop-all

test:
	poetry run python -m src.prepare_mdl_json --dataset_name book_2 && \
	make run-qdrant && \
	make run-wren-engine && \
	poetry run pytest -s && \
	make stop-all