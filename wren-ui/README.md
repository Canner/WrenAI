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

Step 3(Optional). Switching database
Wren-ui use sqlite as our default database. To use Postgres as the database of wren-ui, you need to set the two environment variable below.

```bash
# windows
SET DB_TYPE=pg
SET PG_URL=postgres://user:password@localhost:5432/dbname 

# linux or mac
export DB_TYPE=pg
export PG_URL=postgres://user:password@localhost:5432/dbname
```
-  PG_URL is the connection string of your postgres database.

To set back to sqlite, you can remove the two environment variables above.
```
# windows
SET DB_TYPE=sqlite
SET SQLITE_FILE={your_sqlite_file_path}

# linux or mac
export DB_TYPE=sqlite
export SQLITE_FILE={your_sqlite_file_path}
```

Step 4. Run migrations:

```bash
yarn migrate
# or
npm run migrate
```


Step 4. Run the development server:

```bash
# Execute this if you start wren-engine and ibis-server via docker
# Linux or MacOS
export OTHER_SERVICE_USING_DOCKER=true
# Windows
SET OTHER_SERVICE_USING_DOCKER=true


# Run the development server
yarn dev
# or
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/basic-features/font-optimization) to automatically optimize and load Inter, a custom Google Font.

## Development wren-ui module on local
There are many modules in Wren AI, to develop wren-ui, you can start other modules(services) via docker-compose.
In the [Start wren-ui from source code](#Start-wren-ui-from-source-code) section, you've know how to start wren-ui from the source code to develop.
To start other modules via docker-compose, you can follow the steps below.

Step 1. Prepare you .env file
In the WrenAI/docker folder, you can find the .env.example file. You can copy this file to .env.local file.

```
# assume current directory is wren-ui
cd ../docker
cp .env.example .env.local
```
Step 2. Modify your .env.local file
You need to change the value of the environment variables in the .env.local file like `LLM_OPENAI_API_KEY`, `EMBEDDER_OPENAI_API_KEY` and the service version(eg. `WREN_AI_SERVICE_VERSION`) before starting.

Step 3. Start the services via docker-compose
```
# current directory is WrenAI/docker
docker-compose -f docker-compose-dev.yaml --env-file .env.example up

# you can add a -d flag to run the services in the background
docker-compose -f docker-compose-dev.yaml --env-file .env.example up -d
# then stop the services via
docker-compose -f docker-compose-dev.yaml --env-file .env.example down
```

Step 4. Start wren-ui from source code
refer to [Start wren-ui from source code](#Start-wren-ui-from-source-code) section to start wren-ui from source code.

## FAQ
### Can I have multiple project at the same time in Wren AI?
We currently do not support multiple projects in Wren AI. You can only have one project at a time.
But there is a workaround for this. Since Wren Engine is stateless and we store your semantic model in the database(Sqlite or Postgres), 
you can switch between projects by switching the database and make sure you deploying after server started.

eg: 
```
# start your first project using default database(sqlite by defulat)
yarn migrate
yarn dev

# ... after onboarding and lots of hard work, you want to switch to another project 
# stop the server

# set another sqlite file
export SQLITE_FILE=./new_project.sqlite
yarn migrate
yarn dev

# In the Browser, ... after another onboarding process and hard work
# you can switch back to the first project by setting the first sqlite file
export SQLITE_FILE=./first_project.sqlite

yarn dev  # no need to do migration again

# in the modeling page, click the deploy button to deploy the project to the wren-ai-service.
# your Wren AI is ready to answer your question.
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.
