# Contributing Guidelines

*Pull requests, bug reports, and all other forms of contribution are welcome and highly encouraged!* :octocat:

### Contents

- [Code of Conduct](#book-code-of-conduct)
- [Overview](#mag-overview)
- [Contribution Guide for Different Services](#love_letter-contribution-guide-for-different-services)
- [Creating a New Data Source Connector](#electric_plug-creating-a-new-data-source-connector)

> **This guide serves to set clear expectations for everyone involved with the project so that we can improve it together while creating a welcoming space for all participants. Following these guidelines will help ensure a positive experience for contributors and maintainers.**

## :book: Code of Conduct

Please review our [Code of Conduct](https://github.com/Canner/WrenAI/blob/main/CODE_OF_CONDUCT.md). It is in effect at all times, and we expect everyone contributing to this project to follow it. Acting disrespectfully will not be tolerated.

## :rocket: Get Started
1. Visit [How Wren AI works](https://docs.getwren.ai/oss/overview/how_wrenai_works) to understand the architecture of Wren AI.
2. Once you understand the architecture, focus on the scope of the services you want to contribute to. 
   Check each service's section under [Contribution Guide for Different Services](#love_letter-contribution-guide-for-different-services) to learn how to contribute to specific services:
    1. If you're working on UI-related tasks (e.g., adding a dark mode), contribute to the [Wren UI Service](#wren-ui-service).
    2. If you're working on LLM-related tasks (e.g., enhancing prompts for LLM pipelines), contribute to the [Wren AI Service](#wren-ai-service).
    3. If you're working on data-source-related tasks (e.g., fixing a bug in the SQL server connector), contribute to the [Wren Engine Service](#wren-engine-service).
3. If you’re unsure which service to contribute to, please reach out to us on [Discord](https://discord.gg/canner) or [GitHub Issues](https://github.com/Canner/WrenAI/issues).
4. In some cases, you may need to contribute to multiple services. For example, if you're adding a new data source, you'll need to contribute to both the [Wren UI Service](#wren-ui-service) and [Wren Engine Service](#wren-engine-service). Follow the [Guide for Contributing to Multiple Services](#guide-for-contributing-to-multiple-services) for instructions.

## :love_letter: Contribution Guide for Different Services

### Wren AI Service

The Wren AI Service handles LLM-related tasks, such as converting natural language questions into SQL queries and providing step-by-step SQL breakdowns.

To contribute, refer to the [Wren AI Service Contributing Guide](https://github.com/Canner/WrenAI/blob/main/wren-ai-service/CONTRIBUTING.md).

### Wren UI Service

The Wren UI Service is the client-side service for WrenAI, built with Next.js and TypeScript.  
To contribute, refer to the [WrenAI/wren-ui/README.md](https://github.com/Canner/WrenAI/blob/main/wren-ui/README.md) for instructions on setting up the development environment and running the development server.

### Wren Engine Service

The Wren Engine is the core of the Wren AI project, serving as the semantic engine for LLMs, adding business context to AI agents.

To contribute, refer to the [Wren Engine Contributing Guide](https://github.com/Canner/wren-engine/blob/main/ibis-server/docs/CONTRIBUTING.md).

## Guide for Contributing to Multiple Services

We use Docker Compose to start all services. If you're contributing to multiple services, you can comment out the services you'd like to start from the source code and update the `env` variables to point to the services you're running locally.

### Example: Contributing to the [Wren UI Service](#wren-ui-service) and [Wren Engine Service](#wren-engine-service)

If you're contributing to both the [Wren UI Service](#wren-ui-service) and [Wren Engine Service](#wren-engine-service), comment out the `wren-engine` service in the `docker/docker-compose-dev.yml` file (the UI service is already excluded from this file). Then, adjust the environment variables in your `.env` file to point to the services you've started manually. 

1. Prepare your `.env` file: In the `WrenAI/docker` folder, use the `.env.example` file as a template to create a `.env.local` file:
    ```sh
    # Assuming the current directory is wren-ui
    cd ../docker
    cp .env.example .env.local
    ```
2. Modify your `.env.local` file: Add your OpenAI API keys by filling in `LLM_OPENAI_API_KEY` and `EMBEDDER_OPENAI_API_KEY` before starting.
3. Start the UI and Engine services from the source code.
4. Update the `env` variables in your `.env.local` file to point to the services you started manually.
5. Start the remaining services using Docker Compose:
    ```sh
    # Current directory is WrenAI/docker
    docker-compose -f docker-compose-dev.yaml --env-file .env.example up

    # You can add the -d flag to run the services in the background
    docker-compose -f docker-compose-dev.yaml --env-file .env.example up -d

    # To stop the services, use:
    docker-compose -f docker-compose-dev.yaml --env-file .env.example down
    ```
6. Happy coding!

## :electric_plug: Creating a New Data Source Connector

To develop a new data source connector, you'll need to make changes to both the front-end and back-end of the Wren UI, as well as the Wren Engine.

Below is a brief overview of how a data source connector works:

<img src="./misc/data_source.png" width="400">

The UI stores database connection settings, provides an interface for users to input these settings, and sends them to the Engine, which connects to the database.

The UI must know the connection details it needs to store, as specified by the Engine. The general implementation flow is:

- **Engine**:
  - Implement the new data source (determine the required connection information and how it should be passed from the UI).
  - Implement the metadata API for the UI to access.
- **UI**:
  - **Back-End**:
    - Store the connection information securely.
    - Provide the connection information to the Engine.
  - **Front-End**:
    - Add an icon for the data source.
    - Create a form template for users to input the connection information.
    - Update the data source list.

### Wren Engine

To implement a new data source, refer to [How to Add a New Data Source](https://github.com/Canner/wren-engine/blob/main/ibis-server/docs/how-to-add-data-source.md).  
After adding a new data source, proceed with implementing the metadata API for the UI.

Here are some previous PRs that introduced new data sources:
- [Add MSSQL data source](https://github.com/Canner/wren-engine/pull/631)
- [Add MySQL data source](https://github.com/Canner/wren-engine/pull/618)
- [Add ClickHouse data source](https://github.com/Canner/wren-engine/pull/648)

### Wren UI Guide

For each new data source, here’s what needs to be done in the UI:

If you'd prefer to learn by example, refer to this Trino [issue](https://github.com/Canner/WrenAI/issues/492) and [PR](https://github.com/Canner/WrenAI/pull/535).

#### Back-End
1. Define the data source in `wren-ui/src/apollo/server/dataSource.ts`:
   - Define the `toIbisConnectionInfo` and `sensitiveProps` methods.

2. Modify the Ibis adaptor in `wren-ui/src/apollo/server/adaptors/ibisAdaptor.ts`:
   - Define an Ibis connection info type for the new data source.
   - Set up the `dataSourceUrlMap` for the new data source.

3. Modify the repository in `wren-ui/src/apollo/server/repositories/projectRepository.ts`:
   - Define the Wren UI connection info type for the new data source.

4. Update the GraphQL schema in `wren-ui/src/apollo/server/schema.ts` to enable the new data source in the UI:
   - Add the new data source to the `DataSource` enum.

5. Update the type definition in `wren-ui/src/apollo/server/types/dataSource.ts`:
   - Add the new data source to the `DataSourceName` enum.

#### Front-End
1. Prepare the data source’s logo:
   - Image size should be `40 x 40` px.
   - Preferably use SVG format.
   - Ensure the logo is centered within a `30px` container for consistency.

2. Create the data source form template:
   - In `wren-ui/src/components/pages/setup/dataSources`, add a new file named `${dataSource}Properties.tsx`.
   - Implement the form template for the new data source.

3. Set up the data source template:
   - Navigate to `wren-ui/src/components/pages/setup/utils` and update the `DATA_SOURCE_FORM` settings for the new data source

.

4. Update the data source list:
   - Add the new data source to the `DATA_SOURCES` enum in `wren-ui/src/utils/enum/dataSources.ts`.
   - Update relevant files in `wren-ui/src/components/pages/setup/` to include the new data source.
   - Ensure `wren-ui/src/apollo/server/adaptors/ibisAdaptor.ts` supports the new data source.

5. Test the new connector:
   - Ensure the new data source appears in the UI.
   - Verify that the form works correctly.
   - Test the connection to the new data source.
