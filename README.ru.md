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

### Open-source GenBI: generative BI для AI-агентов

*Ваши агенты генерируют, деплоят и управляют дашбордами из любой базы данных — на context layer, которому можно доверять.*

**Wren AI — open-source generative BI (GenBI) engine: governed text-to-SQL и semantic-layer платформа на open AI context layer, 22+ источников данных.**

[Документация](https://docs.getwren.ai) · [Discord](https://discord.gg/5DvshJqG8Z) · [Vision](https://www.getwren.ai/post/the-missing-context-layer-for-ai-agents-over-business-data) · [Blog](https://www.getwren.ai/blog)

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

> **2026-05-07**: Wren Engine вошёл в этот репозиторий в [`core/`](./core). Старый `Canner/wren-engine` архивирован. Прежний GenBI app (Docker chat-first) — ветка [`legacy/v1`](https://github.com/Canner/WrenAI/tree/legacy/v1) (tag `v1-final`), теперь **Wren GenBI Classic**. [Announcement →](https://github.com/Canner/WrenAI/discussions/2205)

---

## Что такое WrenAI

WrenAI — **open-source generative BI (GenBI) engine**: AI-агенты **генерируют, деплоят и управляют** business intelligence — от governed **text-to-SQL** до shareable dashboard, на 22+ источниках данных.

Доверие даёт слой снизу: open **AI context layer** плюс governed **semantic layer (MDL)** — business semantics, approved definitions, examples, memory, governance и company knowledge из docs, wikis и chat. Generative BI ровно настолько хорош, насколько хорош context; Wren — этот context, reviewable и reusable для любого агента.

![Wren AI generative BI architecture](./misc/wren-ai-architecture.png)

## GenBI в трёх тактах: Generate · Deploy · Know

- **Generate.** Агент превращает бизнес-вопрос в *governed* text-to-SQL и charts. Schema-aware retrieval, MDL planning, dry-plan validation и structured errors держат ответ корректным, а не «уверенно неверным».
- **Deploy.** Любой ответ → shareable browser-side dashboard на [`wren-core-wasm`](https://docs.getwren.ai/oss/sdk/wasm); ship на ваш Vercel или Cloudflare Pages одной командой.
- **Know.** Знание живёт в versionable, evidence-linked files: semantic models (MDL), company definitions (`instructions.md`), memory. Reviewable. Git-friendly. Не залочено в чужом UI.

## Почему agent builders выбирают WrenAI

- **Generative BI end to end.** Governed text-to-SQL и дальше: answer → dashboard → URL, через агентов, которые у вас уже есть.
- **Knowledge management встроено.** Business meaning и approved definitions — reviewable **semantic layer (MDL)**, а не «всё в prompt».
- **Open by default.** Core, SDK и skills — Apache-2.0.
- **Correctness as primitives.** Rich schema retrieval, dry-plan, structured errors, value profiling, eval runner.
- **Governed execution.** Dry-plan, row limits, structured errors; definitions и examples в Git — reviewable, versioned, diff-able.
- **На вашем stack.** Warehouse, pipelines, existing semantic layer — не ещё один tool «вместо всего».

## Как Wren сравнивается

|  | «Сырой» LLM-агент | Классический BI | «Голый» semantic layer | **WrenAI** |
|---|:---:|:---:|:---:|:---:|
| Пишет SQL за вас | ✅ (часто неверно) | ❌ | ❌ | ✅ governed |
| Знает business definitions | ❌ | частично, в tool | ✅ (только schema) | ✅ + non-schema knowledge |
| Генерирует и деплоит dashboards | ❌ | ✅ (вручную) | ❌ | ✅ agent-driven |
| Работает через *ваших* агентов (Claude Code, Cursor, MCP…) | ✅ | ❌ | ❌ | ✅ |
| Open, reviewable, Git-friendly context | ❌ | ❌ | partial | ✅ |
| Governed execution на 22+ sources | ❌ | per-connector | ✅ (только definitions) | ✅ |

## Wren для вас, если…

- Нужны **trustworthy BI**: answers *и* dashboards, не просто «правдоподобный SQL».
- Business logic (definitions, enums, units, joins) живёт **вне БД**, и агенты ошибаются.
- Нужен **AI context layer** и **semantic layer**, которые **open, reviewable, version-controlled**.

**Пропустите Wren**, если нужен one-off chart из одного CSV или вас устраивает SQL без governance.

## Быстрый старт

WrenAI **agent-driven by design**: CLI + discovery stub, дальше ведёт AI-агент. Workflow guides внутри CLI, on demand.

### 1. Установите CLI

```bash
pip install wrenai                      # core (DuckDB included)
pip install "wrenai[postgres,memory]"   # add per-datasource and memory extras as needed
```

> **Совет для пользователей в mainland China:** если `pip install` медленный или падает, используйте зеркало Tsinghua:
> ```bash
> pip install wrenai -i https://pypi.tuna.tsinghua.edu.cn/simple
> ```
> Если HuggingFace model downloads time out: `export HF_ENDPOINT=https://hf-mirror.com` перед CLI.

### 2. Discovery stub для AI-клиента

```bash
npx skills add Canner/WrenAI            # auto-detects Claude Code, Cursor, Cline, Codex, …
```

Stub ~50 строк: учит агента `wren skills get <name>` и `wren ask "<question>" --guided|--direct`.

### 3. Попросите агента настроить

> "Use Wren to set up my Postgres database."

Агент: `wren skills get onboarding` → connection profile, project scaffold, first query.

### 4. (Опционально) Enrich — такт *Know*

> "Enrich my Wren project with the business context in `raw/`."

`wren skills get enrich-context` — grill или auto-pilot; пишет MDL, instructions, queries, memory.

### 5. Вопросы — такт *Generate*

> "Who are our top 10 customers by sales this quarter?"

### 6. Dashboard — такт *Deploy*

> "Turn that into an interactive dashboard I can filter and share, and deploy it to Vercel."

[Build & deploy a GenBI app](https://docs.getwren.ai/oss/guides/genbi). Без своей БД: sample `jaffle_shop`.

## Два такта сначала, потом третий

```bash
# Day 1 (agent-driven)
wren skills get onboarding         # setup + first query  (Generate)
wren skills get enrich-context     # business context       (Know)
wren skills get genbi              # build & deploy dashboard (Deploy)

# Day-to-day
wren query --sql '...'             # query through MDL
wren ask "<question>" --guided
wren ask "<question>" --direct
```

## Semantic layer (MDL)

Wren **и есть** governed semantic layer в **Modeling Definition Language (MDL)** — Git-friendly определение, что данные *значат*, а не только где лежат.

MDL покрывает:

- **Models, columns, relationships, views**
- **Cubes and metrics** — approved reusable definitions
- **Business context beyond schema** — enums, units, joins в `instructions.md` и `queries.yml`

Плюс **AI context layer** — memory, examples, unstructured knowledge — и governed execution engine.

## Что входит

- **MDL — semantic layer**
- **Engine**: Apache DataFusion, 22+ sources (BigQuery, Snowflake, PostgreSQL, ClickHouse, Redshift, Databricks, DuckDB, …)
- **GenBI dashboards**: [`wren-core-wasm`](https://docs.getwren.ai/oss/sdk/wasm), Vercel / Cloudflare Pages
- **Knowledge & memory — AI context layer**: `instructions.md`, `queries.yml`, local LanceDB
- **Agent SDK**: `wren-langchain`, `wren-pydantic`
- **Governed execution primitives**: dry-plan, row limits, structured errors

## Что дальше

- End-to-end correctness primitives
- Agent-native distribution / SDKs — [Discussions](https://github.com/Canner/WrenAI/discussions)

Roadmap: [introduction](https://docs.getwren.ai/oss/introduction).

## FAQ

### Что такое generative BI (GenBI)?

BI, который производят AI-агенты: governed SQL, dashboard, share — на AI context layer, чтобы output был trustworthy.

### Делает ли Wren AI text-to-SQL?

Да — **governed** text-to-SQL против MDL + dry-plan, и дальше dashboards.

### Wren AI — это semantic layer?

Да (MDL) + AI context layer (memory, examples, unstructured knowledge).

### Что такое AI context layer?

Reviewable, version-controlled knowledge, которого нет в schema: semantics, definitions, examples, memory, governance. [Vision](https://www.getwren.ai/post/the-missing-context-layer-for-ai-agents-over-business-data).

### OSS vs Wren AI Cloud / self-hosted?

OSS в этом репо — free forever, Apache-2.0, self-hostable. RLS/CLS, GenBI UI, GenBI Apps, agentic mode, support/SLA — commercial (Cloud / Enterprise Plus). [Open core boundary](https://www.getwren.ai/en/open-core).

### Какие data sources?

22+ через DataFusion: BigQuery, Snowflake, PostgreSQL, ClickHouse, Redshift, Databricks, DuckDB, … [Connect a database](https://docs.getwren.ai/oss/guides/connect).

## Open core: OSS vs Cloud / self-hosted

**Open core.** Context engine (MDL, governed text-to-SQL, MCP, CLI, 22+ connectors) — OSS. Commercial: RLS/CLS, GenBI UI, Scenario AI harnesses, advanced security, support/SLA. [Подробности →](https://www.getwren.ai/en/open-core).

## Заметка про имя «GenBI»

«GenBI» теперь — open-source generative-BI capability. Ранний **Wren AI GenBI** Docker app — **Wren GenBI Classic** на [`legacy/v1`](https://github.com/Canner/WrenAI/tree/legacy/v1).

## Лицензия

Apache-2.0 — см. [LICENSE](./LICENSE).

---

<p align="center"><a href="#top">⬆ наверх</a></p>
