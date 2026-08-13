<div align="center" id="top">
<a href="https://getwren.ai">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./misc/wrenai_logo_white.png">
    <img src="./misc/wrenai_logo.png" width="300px" alt="WrenAI">
  </picture>
</a>

<p>
  <a href="README.md">English</a> ·
  <a href="README.ru.md"><strong>Русский</strong></a>
</p>

### Open-source GenBI: generative BI для AI-агентов.

*Ваши агенты генерируют, деплоят и управляют дашбордами из любой БД — на context layer, которому можно доверять.*

**Wren AI — open-source generative BI (GenBI) engine: governed text-to-SQL и semantic-layer платформа на open AI context layer, 22+ источников данных.**

[Docs](https://docs.getwren.ai) · [Discord](https://discord.gg/5DvshJqG8Z) · [Vision](https://www.getwren.ai/post/the-missing-context-layer-for-ai-agents-over-business-data) · [Blog](https://www.getwren.ai/blog)

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://github.com/Canner/WrenAI/blob/main/LICENSE)
[![PyPI](https://img.shields.io/pypi/v/wrenai?label=wrenai)](https://pypi.org/project/wrenai/)
[![GitHub Release](https://img.shields.io/github/v/release/Canner/WrenAI?logo=github&label=release)](https://github.com/Canner/WrenAI/releases)
[![Discord](https://img.shields.io/discord/1227143286951514152?logo=discord&label=Discord)](https://discord.gg/5DvshJqG8Z)
[![Last commit](https://img.shields.io/github/last-commit/Canner/WrenAI)](https://github.com/Canner/WrenAI/commits/main)
[![Follow on X](https://img.shields.io/badge/follow-@getwrenai-blue?logo=x&logoColor=white)](https://x.com/getwrenai)
[![Made by Canner](https://img.shields.io/badge/made_by-Canner-blue)](https://cannerdata.com)
![Stars](https://img.shields.io/github/stars/Canner/WrenAI?style=social)

<a href="https://trendshift.io/repositories/9263" target="_blank"><img src="https://trendshift.io/api/badge/repositories/9263" alt="Canner/WrenAI | Trendshift" width="250" height="55" /></a>

</div>

> **2026-05-07**: Wren Engine вошёл в этот репо в [`core/`](./core). Старый `Canner/wren-engine` архивирован. Прежний GenBI app — ветка [`legacy/v1`](https://github.com/Canner/WrenAI/tree/legacy/v1) (**Wren GenBI Classic**). [Announcement →](https://github.com/Canner/WrenAI/discussions/2205)

---

## Что такое WrenAI

WrenAI — **open-source generative BI (GenBI) engine**: AI-агенты **generate, deploy, govern** BI — от governed **text-to-SQL** до shareable dashboard, 22+ data sources.

Доверие даёт open **AI context layer** + governed **semantic layer (MDL)** — business semantics, definitions, examples, memory, governance + knowledge из docs/wikis/chat.

![Wren AI generative BI architecture](./misc/wren-ai-architecture.png)

## GenBI в трёх битах: Generate · Deploy · Know

- **Generate.** Бизнес-вопрос → *governed* text-to-SQL и charts.
- **Deploy.** Dashboard на [`wren-core-wasm`](https://docs.getwren.ai/oss/sdk/wasm); ship на Vercel / Cloudflare Pages.
- **Know.** MDL, `instructions.md`, memory — reviewable, Git-friendly.

## Почему agent builders выбирают WrenAI

- GenBI end to end (answer → dashboard → URL)
- Knowledge as semantic layer (MDL), не «всё в prompt»
- Open by default (Apache-2.0)
- Correctness primitives: retrieval, dry-plan, structured errors
- Governed execution + context in Git
- На вашем warehouse / pipelines / semantic stack

## Сравнение

|  | Raw LLM | Traditional BI | Bare semantic | **WrenAI** |
|---|:---:|:---:|:---:|:---:|
| Writes SQL | ✅ often wrong | ❌ | ❌ | ✅ governed |
| Business definitions | ❌ | partial | schema only | ✅ + non-schema |
| Dashboards | ❌ | ✅ manual | ❌ | ✅ agent-driven |
| Your agents | ✅ | ❌ | ❌ | ✅ |
| Open Git-friendly context | ❌ | ❌ | partial | ✅ |
| Governed 22+ sources | ❌ | per-connector | definitions only | ✅ |

## Quickstart

### 1. Install CLI

```bash
pip install wrenai
pip install "wrenai[postgres,memory]"
```

Mainland China tip: `pip install wrenai -i https://pypi.tuna.tsinghua.edu.cn/simple`  
HF: `export HF_ENDPOINT=https://hf-mirror.com`

### 2. Discovery stub

```bash
npx skills add Canner/WrenAI
```

### 3–6. Через агента

1. Setup DB: *"Use Wren to set up my Postgres database."*
2. Enrich: *"Enrich my Wren project with the business context in `raw/`."*
3. Ask: *"Who are our top 10 customers by sales this quarter?"*
4. Deploy: *"Turn that into an interactive dashboard ... deploy it to Vercel."*

Guides: [docs.getwren.ai](https://docs.getwren.ai) · sample `jaffle_shop`.

```bash
wren skills get onboarding
wren skills get enrich-context
wren skills get genbi
wren query --sql '...'
wren ask "<question>" --guided
wren ask "<question>" --direct
```

## Semantic layer (MDL)

Git-friendly definition of what data *means*: models, columns, relationships, views, cubes, metrics + `instructions.md` / `queries.yml`.

## What's Included

- MDL semantic layer
- Apache DataFusion engine, 22+ sources
- GenBI dashboards (`wren-core-wasm`)
- Knowledge & memory (LanceDB hybrid retrieval)
- SDKs: `wren-langchain`, `wren-pydantic`
- Governed execution primitives

## FAQ (кратко)

- **GenBI** — BI от AI-агентов: governed SQL + dashboards + context.
- **text-to-SQL** — да, governed; дальше dashboards.
- **semantic layer** — да (MDL) + AI context layer.
- **OSS vs Cloud** — OSS free (Apache-2.0); RLS/CLS, GenBI UI — commercial. [Open core](https://www.getwren.ai/en/open-core).
- **Sources** — BigQuery, Snowflake, PostgreSQL, ClickHouse, Redshift, Databricks, DuckDB, … [Connect](https://docs.getwren.ai/oss/guides/connect).

## License

Apache-2.0 — see [LICENSE](./LICENSE).

---

<p align="center"><a href="#top">⬆ back to top</a></p>
