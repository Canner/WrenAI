
<p align="center" id="top">
  <a href="https://getwren.ai/?utm_source=github&utm_medium=title&utm_campaign=readme">
    <picture>
      <source media="(prefers-color-scheme: light)" srcset="./misc/wrenai_logo.png">
      <img src="./misc/wrenai_logo_white.png" width="300px">
    </picture>
    <h1 align="center">Wren AI - Open-Source GenBI Agent</h1>
  </a>
</p>

<p align="center">
  <a aria-label="Follow us on X" href="https://x.com/getwrenai">
    <img alt="" src="https://img.shields.io/badge/-@getwrenai-blue?style=for-the-badge&logo=x&logoColor=white&labelColor=gray&logoWidth=20">
  </a>
  <a aria-label="Releases" href="https://github.com/canner/WrenAI/releases">
    <img alt="" src="https://img.shields.io/github/v/release/canner/WrenAI?logo=github&label=GitHub%20Release&color=blue&style=for-the-badge">
  </a>
  <a aria-label="License" href="https://github.com/Canner/WrenAI/blob/main/LICENSE">
    <img alt="" src="https://img.shields.io/github/license/canner/WrenAI?color=blue&style=for-the-badge">
  </a>
  <a aria-label="GitHub Stars" href="https://github.com/Canner/WrenAI/stargazers">
    <img alt="" src="https://img.shields.io/github/stars/canner/WrenAI?style=for-the-badge&logo=github&color=blue&label=Stars">
  </a>
  <a href="https://docs.getwren.ai">
    <img src="https://img.shields.io/badge/docs-online-brightgreen?style=for-the-badge" alt="Docs">
  </a>
  <a aria-label="Join the community on GitHub" href="https://discord.gg/5DvshJqG8Z">
    <img alt="" src="https://img.shields.io/badge/-JOIN%20THE%20COMMUNITY-blue?style=for-the-badge&logo=discord&logoColor=white&labelColor=grey&logoWidth=20">
  </a>
  <a aria-label="Canner" href="https://cannerdata.com/?utm_source=github&utm_medium=badge&utm_campaign=readme">
    <img src="https://img.shields.io/badge/%F0%9F%A7%A1-Made%20by%20Canner-blue?style=for-the-badge">
  </a>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/9263" target="_blank"><img src="https://trendshift.io/api/badge/repositories/9263" alt="Canner%2FWrenAI | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

> Ask your database anything in plain English. Wren AI generates accurate SQL, charts, and BI insights — backed by a semantic layer that keeps LLM outputs grounded and trustworthy.

<p align="center">
  <img width="1920" height="1080" alt="1" src="https://github.com/user-attachments/assets/bba9d37a-33e3-49ab-b7cb-32fd6dddc8d1" />
</p>

## 😍 Demos

https://github.com/user-attachments/assets/f9c1cb34-5a95-4580-8890-ec9644da4160

▶️ [Watch the full GenBI walkthrough](https://github.com/user-attachments/assets/90ad1d35-bb1e-490b-9676-b29863ff090b) — end-to-end from question to chart

## 💡 Why a Semantic Layer?

Feeding raw DDL to an LLM gets you SQL that looks right but means the wrong thing — "revenue" joins the wrong tables, "active user" uses the wrong filter. Wren AI's semantic layer (MDL) encodes your business definitions once, then every generated query is grounded in that shared understanding. The LLM doesn't guess what your metrics mean; the semantic layer tells it.

## 🤖 Features

|                    | What you get | Why it matters |
|--------------------|--------------|----------------|
| **Talk to Your Data** | Ask in any language → precise SQL & answers | Slash the SQL learning curve﻿ |
| **GenBI Insights** | AI-written summaries, charts & reports | Decision-ready context in one click﻿ |
| **Semantic Layer** | MDL models encode schema, metrics, joins | Keeps LLM outputs accurate & governed﻿ |
| **Embed via API**  | Generate queries & charts inside your apps ([API Docs](https://wrenai.readme.io/reference/cloud-getting-started)) | Build custom agents, SaaS features, chatbots﻿ ([Streamlit Live Demo](https://huggingface.co/spaces/getWrenAI/wrenai-cloud-api-demo)) |

🤩 [Learn more about GenBI](https://getwren.ai/genbi?utm_source=github&utm_medium=content&utm_campaign=readme)

## 🔌 Data Sources

| Cloud Warehouses | Databases | Query Engines |
|-----------------|-----------|---------------|
| BigQuery | PostgreSQL | Trino |
| Snowflake | MySQL | Athena (Trino) |
| Redshift | Microsoft SQL Server | DuckDB |
| Databricks | ClickHouse | |
| | Oracle | |

Don't see yours? [Vote for it](https://github.com/Canner/WrenAI/discussions/327) — community votes drive our connector roadmap.

## 🧠 LLM Models

Wren AI works with any LLM provider you're already using:

| Cloud APIs | Platform Services | Self-hosted |
|-----------|-------------------|-------------|
| OpenAI | Azure OpenAI | Ollama |
| Anthropic | Google AI Studio (Gemini) | |
| DeepSeek | Vertex AI (Gemini + Anthropic) | |
| Groq | AWS Bedrock | |
| | Databricks | |

> [!TIP]
> For best results, use a frontier model (GPT-4o, Claude Sonnet, Gemini Pro). Wren AI works with smaller and local models too — accuracy scales with model capability. See [configuration examples](https://github.com/Canner/WrenAI/tree/main/wren-ai-service/docs/config_examples) for setup guides.

## 🚀 Getting Started

Three ways to get started — pick what fits:

| Option | Best for | Link |
|--------|----------|------|
| **Self-hosted (Docker)** | Full control, local data | [Installation guide](http://docs.getwren.ai/oss/installation?utm_source=github&utm_medium=content&utm_campaign=readme) |
| **Wren AI Cloud** | Try it without setup | [getwren.ai](https://getwren.ai/?utm_source=github&utm_medium=content&utm_campaign=readme) |

Compare [OSS vs. Cloud plans](https://docs.getwren.ai/oss/overview/cloud_vs_self_host). Full documentation at [docs.getwren.ai](https://docs.getwren.ai/oss/overview/introduction?utm_source=github&utm_medium=content&utm_campaign=readme).

<p align="center">
  <img width="1920" height="1080" alt="2" src="https://github.com/user-attachments/assets/6555f539-9ef2-485d-9135-0071741fda96" />
</p>

## 🏗️ Architecture

<p align="center">
  <img width="1011" height="682" alt="wrenai-architecture" src="https://github.com/user-attachments/assets/e99b999f-9912-4fa7-921a-9c86b6b83354" />
</p>

User questions flow from the Next.js UI → Apollo GraphQL → AI Service (RAG + LLM) → Wren Engine (semantic query execution) → your database. The semantic layer (MDL) sits at the center, making sure the LLM's SQL reflects your actual business definitions.

👉 [Deep dive into the design](https://getwren.ai/post/how-we-design-our-semantic-engine-for-llms-the-backbone-of-the-semantic-layer-for-llm-architecture?utm_source=github&utm_medium=content&utm_campaign=readme)

## 🧑‍💻 For Developers

WrenAI is a full-stack AI system with interesting problems at every layer — semantic modeling, RAG retrieval, LLM-driven SQL generation, and query execution across heterogeneous data sources. Here's what the stack actually looks like under the hood:

| Layer | What it does |
|-------|-------------|
| **wren-ui** | Next.js + Apollo GraphQL — semantic modeling UI and the BFF that wires everything together |
| **wren-ai-service** | Python/FastAPI pipeline — intent classification, vector retrieval from Qdrant, LLM prompting, and SQL correction loops |
| **[wren-engine](https://github.com/Canner/wren-engine)** | Rust + Apache DataFusion — the query execution core that resolves MDL semantics (metrics, joins, access controls) before SQL reaches the database |

**[wren-engine](https://github.com/Canner/wren-engine)** is a separate open-source project and the part of the stack closest to the metal. It's where MDL definitions get translated into actual query plans across 15+ data sources. If you work with Rust, DataFusion, or database connectors, it's worth a look — the codebase is approachable and there are real unsolved problems around query planning, semantic resolution, and MCP (Model Context Protocol) agent integration.

Some areas where contributions tend to have the most impact across both repos:

- **Data source connectors** — wren-engine supports 15+ sources; new connectors are always useful
- **MCP integration** — wren-engine exposes an MCP server; agent-native workflows are still early and evolving
- **SQL generation quality** — prompt engineering, correction loop heuristics, and eval harnesses in wren-ai-service
- **Semantic layer tooling** — MDL schema inference, validation, and developer ergonomics in wren-ui

## 🛠️ Contribution

1.	Read [Contribution Guidelines](https://github.com/Canner/WrenAI/blob/main/CONTRIBUTING.md) for setup & PR guidelines.
2.	Open an issue for bugs, feature requests, or discussion.
3.	If Wren AI is useful to you, a ⭐ goes a long way — it helps more people find the project.

## ⭐️ Community

- Join 1.7k+ developers in our [Discord](https://discord.gg/5DvshJqG8Z) for real-time help and roadmap previews.
- Visit [GitHub Issues](https://github.com/Canner/WrenAI/issues) for bugs and feature requests.
- Explore our [public roadmap](https://wrenai.notion.site/) to see what's coming next.
- [Subscribe to our blog](https://www.getwren.ai/blog/?utm_source=github&utm_medium=content&utm_campaign=readme) · [Follow us on LinkedIn](https://www.linkedin.com/company/wrenai)

We follow a [Code of Conduct](./CODE_OF_CONDUCT.md) to keep the community welcoming for everyone.

## 🎉 Our Contributors
<a href="https://github.com/canner/wrenAI/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Canner/WrenAI" />
</a>

<p align="right">
  <a href="#top">⬆️ Back to Top</a>
</p>
