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

To create a new data source connector, please follow the guide outlined below.

### Wren UI Guide

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

For a quick example of creating a data source connector, refer to [this issue](https://github.com/Canner/WrenAI/issues/492).

### Wren Engine
Please see [How to Add a New Data Source](https://github.com/Canner/wren-engine/blob/main/ibis-server/docs/how-to-add-data-source.md) for more information.