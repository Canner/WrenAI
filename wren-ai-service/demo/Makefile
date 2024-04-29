prepare:
	cd ../../docker; docker compose --env-file .env.local -f docker-compose-dev.yaml up -d

stop:
	cd ../../docker; docker compose --env-file .env.local -f docker-compose-dev.yaml down

ui:
	cd ../../wren-ui; export DB_TYPE=sqlite export SQLITE_FILE=db.sqlite3 export WREN_AI_ENDPOINT=http://localhost:5556 && \
	yarn install && yarn rollback --all && yarn migrate && yarn dev

ai:
	cd ..; make start

run:
	poetry run streamlit run app.py
