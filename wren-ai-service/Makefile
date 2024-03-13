args ?=

start:
	poetry run python -m src.__main__

build:
	docker compose -f docker/docker-compose.yml build

up:
	docker compose -f docker/docker-compose.yml --env-file .env.prod up -d

down:
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

# evaluation related
streamlit:
	poetry run streamlit run src/eval/streamlit_app.py

eval:
	poetry run python -m src.eval.ask $(args)

run-vulcansql-core-server:
	docker compose -f ./src/eval/vulcansql-core-server/docker-compose.yml --env-file .env.dev --env-file ./src/eval/vulcansql-core-server/.env up -d

stop-vulcansql-core-server:
	docker compose -f ./src/eval/vulcansql-core-server/docker-compose.yml --env-file .env.dev --env-file ./src/eval/vulcansql-core-server/.env down

psql:
	docker exec -it vulcansql-engine-1 bash launch-cli.sh

run-all:
	make run-qdrant && \
	make run-vulcansql-core-server

stop-all:
	make stop-qdrant && \
	make stop-vulcansql-core-server