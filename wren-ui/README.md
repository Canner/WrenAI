This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Start wren-ui from source code

Step 1. Make sure your node version is 18

```bash
node -v
```

Step 2. Install dependencies:

```bash
yarn
```

Step 3(Optional). Configure PostgreSQL

Wren-ui now uses PostgreSQL by default. When developing against the bundled docker compose stack, the default local connection is:

```bash
export PG_URL=postgres://postgres:postgres@127.0.0.1:9432/wrenai
```

If you want to point at another PostgreSQL instance, set `PG_URL` accordingly.

```bash
# windows
SET PG_URL=postgres://user:password@localhost:5432/dbname

# linux or mac
export PG_URL=postgres://user:password@localhost:5432/dbname
```

- `PG_URL` is the connection string of your postgres database.

Step 4. Run migrations:

```bash
yarn migrate
# or
npm run migrate
```

Step 5. Run the development server:

```bash
# Execute this if you start wren-engine and ibis-server via docker
# Linux or MacOS
export OTHER_SERVICE_USING_DOCKER=true
export EXPERIMENTAL_ENGINE_RUST_VERSION=false # set to true if you want to use the experimental Rust version of the Wren Engine
# Windows
SET OTHER_SERVICE_USING_DOCKER=true
SET EXPERIMENTAL_ENGINE_RUST_VERSION=false # set to true if you want to use the experimental Rust version of the Wren Engine

# Run the development server
yarn dev
# or
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Development wren-ui module on local

There are many modules in Wren AI, to develop wren-ui, you can start other modules(services) via docker-compose.
In the [Start wren-ui from source code](#Start-wren-ui-from-source-code) section, you've know how to start wren-ui from the source code to develop.
To start other modules via docker-compose, you can follow the steps below.

Step 1. Prepare you .env file
In the WrenAI/docker folder, you can find the .env.example file. You can copy this file to .env.

```bash
# assume current directory is wren-ui
cd ../docker
cp .env.example .env
```

Step 2. Modify your .env file
You need to fill the `OPENAI_API_KEY` with your OPENAI api key before starting.

`wren-engine` / `ibis-server` are now built from the vendored `../wren-engine`
source tree by default. You usually do not need to change their version vars
unless you want a different telemetry label.

Step 3. Start the services via docker-compose

```bash
# current directory is WrenAI/docker
docker compose --env-file .env up --build -d bootstrap postgres wren-engine ibis-server trino wren-ai-service

# for a full local test stack
docker compose --env-file .env up --build -d

# then stop the stack via
docker compose --env-file .env down
```

Step 4. Start wren-ui from source code
refer to [Start wren-ui from source code](#Start-wren-ui-from-source-code) section to start wren-ui from source code.

Step 5. (Optional) Develop other modules along with wren-ui

As mentioned above, you can use docker-compose to start other modules. The same applies when developing other modules.
From the perspective of wren-ui, if you want to develop other modules at the same time, you can stop the container then spin up the module from the source code.

eg: If you want to develop ai-service module, you can stop the ai-service container then start the ai-service from the source code.

```yaml
# docker/docker-compose.yaml
wren-engine:
    image: ${WREN_ENGINE_IMAGE_REPO:-wren-engine}:${WREN_ENGINE_IMAGE_TAG:-local}
    build:
      context: ../wren-engine
      dockerfile: docker/wren-engine.Dockerfile
    platform: ${PLATFORM}
    expose:
      - ${WREN_ENGINE_SQL_PORT}
    ports:
      - ${WREN_ENGINE_PORT}:${WREN_ENGINE_PORT}
    volumes:
      - data:/usr/src/app/etc
    networks:
      - wren
    depends_on:
      - bootstrap
    ...
# comment out the ai-service service
wren-ai-service:
    image: ghcr.io/canner/wren-ai-service:${WREN_AI_SERVICE_VERSION}
    pull_policy: always
    platform: ${PLATFORM}
    ports:
      - ${AI_SERVICE_FORWARD_PORT}:${WREN_AI_SERVICE_PORT}
    environment:
      WREN_UI_ENDPOINT: http://host.docker.internal:${WREN_UI_PORT}
      # sometimes the console won't show print messages,
      # using PYTHONUNBUFFERED: 1 can fix this
      PYTHONUNBUFFERED: 1
      CONFIG_PATH: /app/data/config.yaml
    env_file:
      - ${PROJECT_DIR}/.env
    volumes:
      - ${PROJECT_DIR}/config.yaml:/app/data/config.yaml
    networks:
      - wren
    depends_on:
      - postgres

ibis-server:
    image: ${IBIS_SERVER_IMAGE_REPO:-wren-engine-ibis}:${IBIS_SERVER_IMAGE_TAG:-local}
    build:
      context: ../wren-engine
      dockerfile: docker/ibis-server.Dockerfile
    ...
```

Then refer to the README.md or CONTRIBUTION.md file the module for starting the module from the source code.

eg: refer to the [ai-service README](https://github.com/Canner/WrenAI/blob/main/wren-ai-service/README.md#start-the-service-for-development) to start the ai-service from the source code.

## FAQ

### Can I have multiple project at the same time in Wren AI?

We currently do not support multiple projects in Wren AI. You can only have one project at a time.
But there is a workaround for this. Since Wren Engine is stateless and we store your semantic model in PostgreSQL,
you can switch between projects by switching the target database and make sure you deploy after the server starts.

> Tip: Point `PG_URL` at the PostgreSQL database you want to use.

eg:

```bash
# start your first project using one PostgreSQL database
createdb -h 127.0.0.1 -p 9432 -U postgres wrenai_project_a
export PG_URL=postgres://postgres:postgres@127.0.0.1:9432/wrenai_project_a
yarn migrate
yarn dev

# ... after onboarding and lots of hard work, you want to switch to another project
# stop the server

# point to another PostgreSQL database
createdb -h 127.0.0.1 -p 9432 -U postgres wrenai_project_b
export PG_URL=postgres://postgres:postgres@127.0.0.1:9432/wrenai_project_b
yarn migrate
yarn dev

# In the Browser, ... after another onboarding process and hard work
# you can switch back to the first project by restoring the first PG_URL
export PG_URL=postgres://postgres:postgres@127.0.0.1:9432/wrenai_project_a

yarn dev  # no need to do migration again

# in the modeling page, click the deploy button to deploy the project to the wren-ai-service.
# your Wren AI is ready to answer your question.
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!
