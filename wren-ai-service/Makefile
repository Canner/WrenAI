.PHONY: demo

## wrenai related ##
dev-up:
	make prepare-wren-engine
	docker compose -f ./tools/dev/docker-compose-dev.yaml --env-file ./tools/dev/.env.example up -d

dev-down:
	docker compose -f ./tools/dev/docker-compose-dev.yaml --env-file ./tools/dev/.env.example down
## wrenai related ##


## wren-ai-service related ##
start:
	poetry run python -m src.__main__
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

data_curation_app:
	cd eval; poetry run streamlit run data_curation/app.py
## utilities related ##


## wren-engine related ##
prepare-wren-engine:
	rm -rf tools/dev/etc
	mkdir -p tools/dev/etc
	cp tools/dev/config.properties.example tools/dev/etc/config.properties
	mkdir -p tools/dev/etc/mdl
	echo "{\"catalog\": \"test_catalog\", \"schema\": \"test_schema\", \"models\": []}" \\
		> tools/dev/etc/mdl/sample.json
## wren-engine related ##


## test related ##
test:
	make dev-up
	poetry run pytest -s $(args)
	make dev-down

load-test:
	poetry run python -m tests.locust.locust_script
## test related ##
