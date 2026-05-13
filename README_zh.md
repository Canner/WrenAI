<p align="center" id="top">
  <a href="https://getwren.ai/?utm_source=github&utm_medium=title&utm_campaign=readme">
    <picture>
      <source media="(prefers-color-scheme: light)" srcset="./misc/wrenai_logo.png">
      <img src="./misc/wrenai_logo_white.png" width="300px" alt="WrenAI logo">
    </picture>
    <h1 align="center">WrenAI — AI 智能体的开放上下文层</h1>
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
  <a aria-label="Join the community on Discord" href="https://discord.gg/5DvshJqG8Z">
    <img alt="" src="https://img.shields.io/badge/-JOIN%20THE%20COMMUNITY-blue?style=for-the-badge&logo=discord&logoColor=white&labelColor=grey&logoWidth=20">
  </a>
  <a aria-label="Canner" href="https://cannerdata.com/?utm_source=github&utm_medium=badge&utm_campaign=readme">
    <img src="https://img.shields.io/badge/%F0%9F%A7%A1-Made%20by%20Canner-blue?style=for-the-badge" alt="Made by Canner">
  </a>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/9263" target="_blank"><img src="https://trendshift.io/api/badge/repositories/9263" alt="Canner%2FWrenAI | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

> 📣 **2026-05-07** — Wren Engine 已合并至本仓库的 [`core/`](./core) 目录下。之前的 `Canner/wren-engine` 仓库已归档。之前的 WrenAI GenBI 应用保留在 [`legacy/v1`](https://github.com/Canner/WrenAI/tree/legacy/v1) 分支（标签 `v1-final`）。[阅读公告 →](https://github.com/Canner/WrenAI/discussions/2205)
---

[English](./README.md) | 中文

## 为什么选择 WrenAI？

AI 智能体在处理业务数据时失败，不是因为它们不会写 SQL——而是因为它们不理解你的数据仓库意味着什么。重叠的表、不一致的命名、分散在仪表盘和 SQL 文件中的指标定义：一个拥有原始数据库访问权限的 LLM 就像入职第一天的新员工一样靠猜测行事。

WrenAI 是填补这一空白的开放上下文层。你使用 **[MDL](./core/wren-mdl/)**（建模定义语言）来建模你的业务——实体、关系、计算、受控访问模式——然后任何智能体（Claude、Cursor、ChatGPT、内部助手、面向客户的应用）都通过你的分析师已经使用的同一层进行查询。

一个由 [Apache DataFusion](https://datafusion.apache.org/) 驱动的 Rust 引擎将建模后的 SQL 翻译并运行在 20 多个数据源上（PostgreSQL、BigQuery、Snowflake、Spark 等）。可以作为 Python SDK、CLI、浏览器中的 WASM 模块使用，也可以作为智能体技能的构建模块。

## 快速开始

最快的方式是让 AI 编程助手（Claude Code、Cursor、Aider 等）来驱动安装：

```bash
# 将 WrenAI 技能安装到你的 AI 智能体中
npx skills add Canner/WrenAI --skill '*'
```

开启一个新的智能体会话并询问：

> 使用 `wren-onboarding` 技能安装并设置 Wren AI Core。

`wren-onboarding` 技能将引导智能体完成环境检查、包安装、项目脚手架搭建、首次数据源连接和首次查询。

完整的 CLI 指南和手动安装步骤请参阅：[`core/wren/README.md`](./core/wren/README.md)。每个连接器的可安装扩展包在那里列出。

## 文档

[Wren AI 开源文档](https://docs.getwren.ai/oss/introduction)

## 支持的数据源

Wren Engine 专为现代数据栈而构建，包括数据仓库、数据库和基于文件的数据源。

当前开源版本支持的连接器包括：

- Amazon S3
- Apache Spark
- Apache Doris
- Athena
- BigQuery
- ClickHouse
- Databricks
- DuckDB
- Google Cloud Storage
- 本地文件
- MinIO
- MySQL
- Oracle
- PostgreSQL
- Redshift
- SQL Server
- Snowflake
- Trino

有关最新的连接模式和功能，请参阅项目文档中的连接器 API 文档。

## 仓库结构

| 路径 | 说明 |
|---|---|
| [`core/`](./core) | Rust 引擎 + Python/WASM 绑定 + CLI。上下文层的核心组件。 |
| &nbsp;&nbsp;[`core/wren-core/`](./core/wren-core) | Rust 语义引擎（Cargo 工作空间）。 |
| &nbsp;&nbsp;[`core/wren-core-base/`](./core/wren-core-base) | 清单类型（`Model`、`Column`、`Cube`、`Relationship`、`View`）。 |
| &nbsp;&nbsp;[`core/wren-core-py/`](./core/wren-core-py) | PyO3 绑定（PyPI: `wren-core`）。 |
| &nbsp;&nbsp;[`core/wren-core-wasm/`](./core/wren-core-wasm) | 用于浏览器端语义 SQL 的 WebAssembly 构建（npm: `wren-core-wasm`）。 |
| &nbsp;&nbsp;[`core/wren/`](./core/wren) | Python SDK + `wren` CLI（PyPI: `wren-engine`）。 |
| &nbsp;&nbsp;[`core/wren-mdl/`](./core/wren-mdl) | MDL JSON 模式。 |
| [`skills/`](./skills) | 基于 CLI 的智能体技能（`wren-generate-mdl`、`wren-usage`、`wren-dlt-connector`、`wren-onboarding`）。 |
| [`sdk/`](./sdk) | 框架集成。[`sdk/wren-langchain/`](./sdk/wren-langchain)（PyPI: `wren-langchain`）已发布；CrewAI / Pydantic-AI / Goose / LlamaIndex / Mastra _即将推出_。 |
| [`examples/`](./examples) | 端到端示例项目——_即将推出_。 |
| [`docs/core/`](./docs/core) | 模块文档。 |

## 社区

- **Discord**：[discord.gg/canner](https://discord.gg/canner)
- **讨论区**：[github.com/Canner/WrenAI/discussions](https://github.com/Canner/WrenAI/discussions)
- **问题反馈**：[github.com/Canner/WrenAI/issues](https://github.com/Canner/WrenAI/issues)

## 许可证

WrenAI 采用多重许可：

- **`core/**`、`sdk/**`、`skills/**`、`examples/**`、根目录文件** — [Apache License 2.0](LICENSE-APACHE-2.0)
- **`docs/**`** — [Creative Commons Attribution 4.0 International (CC BY 4.0)](LICENSE-CC-BY-4.0)

未来的模块可能会在 [GNU Affero General Public License v3.0](LICENSE-AGPL-3.0) 下引入；完整文本已预先提交于此。请参阅 [LICENSE](LICENSE) 了解权威的许可证路径映射。

发布的包在其包清单（`Cargo.toml`、`pyproject.toml`、`package.json`）中声明其有效许可证。

## 我们的贡献者
<a href="https://github.com/canner/wrenAI/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Canner/WrenAI" />
</a>

<p align="right">
  <a href="#top">⬆️ 回到顶部</a>
</p>
