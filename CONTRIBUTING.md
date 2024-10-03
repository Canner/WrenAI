# Contributing Guidelines

*Pull requests, bug reports, and all other forms of contribution are welcomed and highly encouraged!* :octocat:

### Contents

- [Code of Conduct](#book-code-of-conduct)
- [Overview](#mag-overview)
- [Contribution Guide of Different Services](#love_letter-contribution-guide-of-different-services)
- [Creating a New Data Source Connector](#electric_plug-creating-a-new-data-source-connector)

> **This guide serves to set clear expectations for everyone involved with the project so that we can improve it together while also creating a welcoming space for everyone to participate. Following these guidelines will help ensure a positive experience for contributors and maintainers.**

## :book: Code of Conduct

Please review our [Code of Conduct](https://github.com/Canner/WrenAI/blob/main/CODE_OF_CONDUCT.md). It is in effect at all times. We expect it to be honored by everyone who contributes to this project. Acting like an asshole will not be tolerated.

## :mag: Overview

- including architecture diagram
- including responsibilities of different services

## :love_letter: Contribution Guide of Different Services

### Wren AI Service

Wren AI Service is responsible for LLM-related tasks like converting natural language questions into SQL queries and providing step-by-step SQL breakdowns.

To contribute to Wren AI Service, please refer to the [Wren AI Service Contributing Guide](https://github.com/Canner/WrenAI/blob/main/wren-ai-service/CONTRIBUTING.md)


### Wren UI Service

Wren UI is the client service of WrenAI. It is built with Next.js and TypeScript. 
To contribute to Wren UI, you can refer to the [WrenAI/wren-ui/README.md](https://github.com/Canner/WrenAI/blob/main/wren-ui/README.md) file for instructions on how to set up the development environment and run the development server.


### Wren Engine Service
Wren Engine is the backbone of the Wren AI project. The semantic engine for LLMs, bringing business context to AI agents.

To contribute, please refer to [Wren Engine Contributing Guide](https://github.com/Canner/wren-engine/blob/main/ibis-server/docs/CONTRIBUTING.md)

### Other Services

- directions on how to modify docker-compose file
- ask users to check readme of services to start services
- let users know should be aware of env related to endpoints, url need to point to service they started by themselves

## :electric_plug: Creating a New Data Source Connector

To create a new data source connector, you'll need to make changes in `Wren UI`(FE plus BE) and `Wren Engine`.

Here is a brief overview of an data source connector:

<img src="./misc/data_source.png" width="400">

UI is mainly responsible for storing database connection settings, providing an interface for users to fill in database connection settings, and submitting the database connection settings to the Engine so that the Engine can connect to the database.

UI will need to know the connection info it needs to store, which is decided by Engine. So the implementation sequence would be like:


- Engine:
  - implement a new data source(you'll know what and how connection info you need to passed from UI)
  - implement the metadata API for UI to use
- UI:
  - implement the BE 
    - store the connection info safely
    - provide the connection info to Engine
  - implement the FE
    - prepare the icon for the data source
    - set up the form template for users to fill in the connection info
    - update the data source list

### Wren Engine

- To implement a new data source, please refer to [How to Add a New Data Source](https://github.com/Canner/wren-engine/blob/main/ibis-server/docs/how-to-add-data-source.md) .
- After adding a new data source, you can continue to implement the metadata API for UI to use. 
  Here are some prior PRs that added new data sources:
    - [Add MSSQL data source](https://github.com/Canner/wren-engine/pull/631)
    - [Add MySQL data source](https://github.com/Canner/wren-engine/pull/618)
    - [Add ClickHouse data source](https://github.com/Canner/wren-engine/pull/648)

### Wren UI Guide

We'll describe what should be done in the UI for each new data source. 

If you prefer to learn by example, you can refer to this Trino [issue](https://github.com/Canner/WrenAI/issues/492) and [PR](https://github.com/Canner/WrenAI/pull/535).


#### BE
1. Define the data source in `wren-ui/src/apollo/server/dataSource.ts`
  - define the `toIbisConnectionInfo` and `sensitiveProps` methods

2. Modify the ibis adaptor in `wren-ui/src/apollo/server/adaptors/ibisAdaptor.ts`
  - define a ibis connection info type for the new data source
  - set up the `dataSourceUrlMap` for the new data source

3. Modify the repository in `wren-ui/src/apollo/server/repositories/projectRepository.ts`
  - define the wren ui connection info type for the new data source 

4. Update the graphql schema in `wren-ui/src/apollo/server/schema.ts` so that the new data source can be used in the UI 
  - add the new data source to the `DataSource` enum

5. Update the type definition in `wren-ui/src/apollo/server/types/dataSource.ts`
  - add the new data source to the `DataSourceName` enum

#### FE
1. Prepare the data source's logo:
   - Image size should be `40 x 40` px
   - Preferably use SVG format
   - Ensure the logo is centered within a `30px` container for consistent formatting

   Example:

   <img src="./misc/logo_template.jpg" width="120">

2. Create the data source form template:
   - In `wren-ui/src/components/pages/setup/dataSources`, add a new file named `${dataSource}Properties.tsx`
   - Implement the data source form template in this file

3. Set up the data source template:
   - Navigate to `wren-ui/src/components/pages/setup/utils` > `DATA_SOURCE_FORM`
   - Update the necessary files to include the new data source template settings

4. Update the data source list:
   - Add the new data source to the `DATA_SOURCES` enum in `wren-ui/src/utils/enum/dataSources.ts`
   - Update relevant files in `wren-ui/src/components/pages/setup/` to include the new data source
   - Ensure `wren-ui/src/apollo/server/adaptors/ibisAdaptor.ts` handles the new data source

5. Test the new connector:
   - Ensure the new data source appears in the UI
   - Verify that the form works correctly
   - Test the connection to the new data source
