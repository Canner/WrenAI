

<p align="center">
  <a href="https://getwren.ai">
    <picture>
      <source media="(prefers-color-scheme: light)" srcset="./misc/wrenai_logo.png">
      <img src="./misc/wrenai_logo.png">
    </picture>
    <h1 align="center">WrenAI</h1>
  </a>
</p>

<p align="center">
  <a aria-label="Canner" href="https://cannerdata.com/">
    <img src="https://img.shields.io/badge/%F0%9F%A7%A1-Made%20by%20Canner-blue?style=for-the-badge">
  </a>
  <a aria-label="Releases" href="https://github.com/canner/WrenAI/releases">
    <img alt="" src="https://img.shields.io/github/v/release/canner/WrenAI?logo=github&label=GitHub%20Release&color=blue&style=for-the-badge">
  </a>
  <a aria-label="License" href="https://github.com/Canner/WrenAI/blob/main/LICENSE">
    <img alt="" src="https://img.shields.io/github/license/canner/WrenAI?color=blue&style=for-the-badge">
  </a>
  <a aria-label="Join the community on GitHub" href="https://discord.gg/5DvshJqG8Z">
    <img alt="" src="https://img.shields.io/badge/-JOIN%20THE%20COMMUNITY-blue?style=for-the-badge&logo=discord&logoColor=white&labelColor=grey&logoWidth=20">
  </a>
  <a aria-label="Follow us" href="https://x.com/getwrenai">
    <img alt="" src="https://img.shields.io/badge/-@getwrenai-blue?style=for-the-badge&logo=x&logoColor=white&labelColor=gray&logoWidth=20">
  </a>
</p>


> WrenAI is ***your AI data assistant*** that helps you get results and insights faster by asking questions without writing SQL.

## ▶️ Video Introduction

[![WrenAI Introduction](https://img.youtube.com/vi/Fw0Wxd2G3jY/maxresdefault.jpg)](https://www.youtube.com/watch?v=Fw0Wxd2G3jY)


## 🎯 Our Mission

WrenAI is reimagining how businesses can interact with and leverage their data through LLM, by bringing comprehension capabilities to small and large data teams.

![wrenai_overview](./misc/wrenai_overview.png)

👉 [Learn more about our mission](https://docs.getwren.ai/overview/introduction)

## 👊 Why WrenAI?

### 1. Reduce Hallucination

> WrenAI offers detailed, explainable responses, ensuring users understand the origins and context of their data, thereby reducing ***hallucinations*** in LLMs.

### 2. Augment Your LLM Knowledge Base

> WrenAI enriches LLMs with your specific business context, with additional metadata for your data schema, such as semantics and relationships.

### 3. Self-Learning Feedback Loop

> WrenAI evolves with every interaction. It learns from user feedback and behavioral patterns, continuously refining its suggestions.

## 🤔 Benefits using WrenAI

WrenAI leverages Large Language Models (LLM) with Retrieval-Augmented Generation (RAG) technology to enhance comprehension of internal data.  Below are the three key benefits:

### 1. Fast Onboarding

> Discover and analyze your data with our user interface. Effortlessly generate results without needing to code.

### 2. Secure By Design

> Your database contents will never be transmitted to the LLM. Only metadata, like schemas, documentation, and queries, will be used in semantic search.

### 3. Open-Source

> Deploy WrenAI anywhere you like on your own data, LLM APIs, and environment, it's free.

## 🤖 WrenAI's Architecture

WrenAI is consist of three core services:

- ***[Wren UI](https://github.com/Canner/WrenAI/tree/main/wren-ui):*** An intuitive user interface for asking questions, defining data relationships, and integrating data sources within WrenAI's framework.

- ***[Wren AI Service](https://github.com/Canner/WrenAI/tree/main/wren-ai-service):*** Processes queries using a vector database for context retrieval, guiding LLMs to produce precise SQL outputs.

- ***[Wren Engine](https://github.com/Canner/wren-engine):*** Serves as the platform's backbone, managing metadata and connecting to data sources, while preparing for future application integrations.

![wrenai_works](./misc/how_wrenai_works.png)

## 🫣 Sneak Peek

|  Data Modeling   | Ask and Follow-up Questions  |
|  ----  | ----  |
| ![preview_model](./misc/preview_model.png)  | ![preview_ask](./misc/preview_ask.png) |

## 🤞 Design Philosophies

We have some core design philosophies that were used when developing WrenAI.

- **Explainability**: WrenAI ensures that every SQL query generated in natural language is accurate, concise, and reliable.
- **Interoperability**: WrenAI enables users to query data from multiple sources without dealing with the complexities of different data formats and dialects, providing a standard interface across different sources.
- **Interactive Experience**: WrenAI is designed to engage users in a dialogue, clarifying their queries and refining results in real time.
- **Continuous Learning**: WrenAI will proactively learn through ongoing query history, feedback, and interactions. Incorporating new patterns, information, and data structures into our LLM knowledge base.

## 🚧 Project Status

WrenAI is currently in ***alpha version***. The project team is actively working on progress and aiming to release new versions at least biweekly.

## 🚀 Getting Started

Using WrenAI is super simple, you can setup within 3 minutes, and start to interact with your own data!

***Start Today And Be 100X More Productive Than Yesterday***

- Visit our [Installation Guide of WrenAI](http://docs.getwren.ai/installation).
- Visit the [Usage Guides](http://docs.getwren.ai/guide/connect/overview) to learn more about how to use WrenAI.

## 📚 Documentation

Visit [WrenAI documentation](https://docs.getwren.ai) to view the full documentation.

## 📶 Telemetry

WrenAI collects anonymous usage statistics for application components. We receive an event each time these components are initialized or used, allowing us to identify which features are most relevant and valued by our community. These statistics help us improve our features and serve as a reference for deciding on our roadmap.

Read more about telemetry or how you can opt out in [WrenAI doc](https://docs.getwren.ai/overview/telemetry).

## ⭐️ Community

- Welcome to our [Discord server](https://discord.gg/5DvshJqG8Z) to give us feedback!
- If there is any issues, please visit [GitHub Issues](https://github.com/Canner/WrenAI/issues).

Do note that our [Code of Conduct](./CODE_OF_CONDUCT.md) applies to all WrenAI community channels. Users are **highly encouraged** to read and adhere to them to avoid repercussions.
