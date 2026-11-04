# Profile-bound Wren agent over local MCP

This example serves one Warble profile against one synthetic Wren project. The private pi runtime executes the profile's components; an independent planner connects over MCP. The service does not need the planner's model key.

The service captures the project's context snapshot and resolved connection at startup. Everything the agent knows about the data comes from the Wren project itself, read through the Rust `wren-context-loader`; `service.yml` carries the model, policy and execution limits, plus an optional explicit connection.

Requirements: Python 3.11+, Node 22.19+, a compatible Warble 0.19.0 compiler, the matching `@warble/pi` package containing `dist/service.js` (`warble-private-service/1`), and the context loader binary (below). This service uses POSIX process groups; Windows is not supported. The compiler/runtime pair must include this service contract; matching version numbers alone are not sufficient.

## Install and prepare

Use a source checkout containing this example and the serve-agent implementation. Install a wheel built from that source with its MCP extra and a compatible Warble runtime tarball into isolated directories; the commands below require those build artifacts to exist. The example files and context-loader binary come from the source checkout, not the Wren wheel. This service is not advertised as an already released package. Obtain a compatible runtime artifact from its maintainer; public registry availability is not assumed by this setup.

```sh
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python './wrenai-<version>-py3-none-any.whl[mcp]'
npm install ./warble-pi-0.19.0.tgz
```

Build the context loader once, or point `WREN_CONTEXT_LOADER_BIN` at a built binary. The service looks there first, then at `core/wren-context-loader/target/{release,debug}` of the repository the `wren` package sits in, and otherwise refuses to start (`context_loader_unavailable`); it never falls back to a hand-written metadata copy.

```sh
cargo build --release --manifest-path core/wren-context-loader/Cargo.toml
```

Use an absolute `EXAMPLE` path to this directory and an unused `DEMO` destination. Preparation creates a synthetic DuckDB database, a standard Wren project (`wren_project.yml`, `models/orders`, `models/customers`, `relationships.yml`, `knowledge/rules/conventions.md`, a built `target/mdl.json`) and a v2 `service.yml`; it refuses an existing destination and does not modify global Wren settings.

```sh
.venv/bin/python "$EXAMPLE/setup.py" "$DEMO"
```

The fixture contains 12 orders in three Monday-start UTC weeks (counts 3, 4 and 5), three customers, five invoices in USD, EUR and GBP and an `fx_rates` table that holds EUR and GBP only (no USD row). The rule file declares three defaults, a project-level denylist, `denied_columns: [customers.email]`, and two `semantics` entries in its front-matter: `exclude-test-orders` (rows where `orders.is_test` is true are not business orders), `convert-invoices-to-usd` (a `require_rate_join` with `base_currency: USD` and `match: single`) and `count-paid-and-shipped` (a `sale_statuses` rule over `orders.status`, whose domain comes from the column's `enum_values`). The project also has one view, `usd_line_value`, whose `guarantees` list names `convert-invoices-to-usd`. Every aggregate over `orders` must therefore exclude test orders and keep exactly the paid and shipped orders, and every aggregate over `invoices.amount` must convert through `fx_rates` the way the rule describes (see [Declared default rules](#declared-default-rules)). The default external metadata selection is empty; the private worker can still read the project's context and return permitted results. `setup.py` also writes the four policy presets described under [Named policy presets](#named-policy-presets) next to `policy.cedar` and makes `hidden` the default, so a service started from the fixture shows the planner no metadata and the narrowest evidence unless it is started with another `--policy-preset`.

Editing a model file or a rule file changes the loader's content digest. A running service then refuses its old sessions (`context_changed`); restart it and the structure and rules documents, the worker's context index and the `context_loaded` audit event all follow the project, with no change to `service.yml`.

## Start the service

Provide `NVIDIA_INFERENCE_API_KEY` through the launching terminal or the client's credential handling. The default example uses NVIDIA's hosted Nemotron endpoint; this is a private worker role, not a private-network deployment. Edit `service.yml` to bind another compatible private endpoint. Do not put keys in YAML or profile prompts.

```sh
.venv/bin/wren serve agent \
  --agent-profile "$EXAMPLE/profiles/analysis" \
  --project "$DEMO/project" \
  --service-config "$DEMO/project/service.yml" \
  --runtime "$RUNTIME/node_modules/@warble/pi/dist/service.js" \
  --warble "$WARBLE"
```

This command waits for MCP on stdin; stdout contains protocol messages, not an interactive chat. Configure these executable and argument values in a coding agent's stdio MCP configuration. The client must pass the private credential environment variable when it starts the service. Use an absolute compiler/runtime path.

Omitting `--project` searches upward from the launch directory for `wren_project.yml`. It deliberately ignores `WREN_PROJECT_HOME` and the global default project. `--profile` retains its existing meaning as a data connection profile; `--agent-profile` selects agent behavior. Connection precedence is explicit `--profile`, then `service.yml`'s `connection`, then the profile pinned by the project's `wren_project.yml`. Without either explicit connection form, an unpinned project is refused; the machine-wide active profile is never a fallback. Model endpoint, project, profile and policy cannot be overridden by a model request.

For direct tools with the same boundary, replace `serve agent` with `serve mcp`, retaining `--service-config`, `--agent-profile`, `--runtime`, `--warble` and the project. Controlled mode supports stdio only and refuses writes and `--no-connect`. Legacy `serve mcp` without `--service-config` remains a separate, ungoverned mode.

The context loader refuses symlinks for source-directory roots (`models`, `cubes`, `views`, `knowledge`) and nested directory or unresolved symlinks. This prevents cycles and keeps its readers and the host's change digest consistent. Valid file symlinks remain supported: their relative path and target bytes contribute to the digest, and edits to the target invalidate context. Managed source names must be valid UTF-8; other names are refused with `non_utf8_source_name`. Dot-hidden entries remain ignored.

The loader reads managed source files, including supported regular-file symlink targets,
in full. There is no per-file or aggregate memory cap for project loading. A subprocess
timeout bounds elapsed time, not memory; streaming a change digest does not make loading
memory-bounded. The project root and its source files are administered by a trusted author.
Avoid placing very large data files in metadata sources, or apply external OS resource
limits when operating the service.

Saved-query consumer lineage is a structural extraction using sqlparser's `GenericDialect`. CTE shadowing currently uses case folding; it does not guarantee execution-equivalent provenance for every data source. Runtime SQL authorization and execution continue through the query gate and engine independently of this consumer-lineage extraction.

Impact analysis preserves the complete transitive downstream list for every lineage seed. Its per-seed traversal is O(V*(V+E)), while complete downstream output is O(V²): a dense graph can therefore require cubic CPU time and quadratic output space. The loader does not truncate, cap, or otherwise omit consumers from that result.

For native directory projects, a non-empty root `cubes.yml` is a semantic mirror:
cube names, base objects, members, expressions, types and hierarchies must agree
with the directory definitions. Descriptions are authored catalog prose; the
root list is authoritative for cube and member descriptions, so prose-only
differences do not require an engine rebuild.

## Deliver the planner skill

Retrieve the bundled guide with `wren skills get wren-planner`. Put that output in a `wren-planner/SKILL.md` directory using the external agent's supported skill installation mechanism. Do not install it into a global agent directory without the user's instruction.

The common skill works with `profiles/analysis`, `profiles/counts` and the opt-in `profiles/adhoc`. The first two describe a row count of one model and the third open-ended analysis, but all three let the private worker author read-only SQL through `run_sql`, and the host gates every statement the same way; "counts only" is the capability text and the worker's prompt, not something the host can enforce on a SQL statement. Their `capabilities.yml` files describe public tasks; internal prompts are not exported. A profile's `context_budget_bytes` (default 4096, at most 8192 because one runtime request is capped at 16 KiB) bounds the context index in the worker's first request.

The private worker reads context in three steps: the first page of the index (one line per model, cube and view with its description and any declared default rules, plus a summary of the rule files) is already in its request; `list_context` pages through the rest, `select_context` names what it needs, and `read_context` returns those items in full with the rule files that concern them. A project larger than the budget is paged, never truncated or refused. A view lists its output columns only if its `views/<name>/metadata.yml` declares them: `columns: [{name, type, description}]` (`name` matches `^[a-z0-9_]+$`, `type` is not empty, `description` is optional and at most 400 characters). The loader carries the declaration without parsing SQL. At startup the host parses the view's `statement` the way a query reads it and refuses to start with `context_inconsistent` if the declared names differ from the statement's output (the message names columns, never the statement); a view whose statement the host cannot read, or whose output has no stable names (`COLUMNS(...)`, any unaliased projection anywhere in the statement other than a bare column or `*` such as `id::BIGINT`, `CAST(...)`, a literal or `SUM(x)`, a repeated name), is not checked and is named in one `view_columns_unverified {view}` audit event. A malformed or duplicate entry refuses to start with `view_columns_invalid`. `read_context` of a view returns `columns` (name, type, description) and the planner's `structure` document gets a column table under that view; the index line is unchanged, and a column named like any model's denied column is dropped, together with description sentences that name one. A view without `columns` reads as before. A bundle's `binding.yml` of `kind: prepared` is bound at startup to the loader's prepared context, so the static `context.json` it names is not shipped.

MCP tools: `capabilities`, `open_session`, `ask_data`, `continue_task`, `get_evidence`, `read_metadata`, `close_session`. A completed `ask_data` and `get_evidence` answer with the same `evidence` object (see [What a result's evidence tells the planner](#what-a-results-evidence-tells-the-planner)). Direct mode (`serve mcp`) substitutes `run_sql` for delegation/clarification: the caller's statement goes through exactly the planning gate, audit events and authorization the private worker's `run_sql` does, and a statement rejected before execution comes back as the `{error, code, hint}` answer described under [Why a `run_sql` statement is refused](#why-a-run_sql-statement-is-refused). Each direct call is its own task, so the per-task budgets below never carry from one call to the next. Each tool is registered only if the deployment policy permits it. Metadata resources and the capability list are filtered independently. Inspect tool schemas for the `request` wrapper and required revision fields.

## Independent example planner

Every context index page fits `context_budget_bytes`, including its header, rule
summary and continuation hint. Long descriptions and rule tags are clipped. An
overlong item name receives a short selectable `@context-N` ID and a name preview;
`read_context` returns the complete name, and the original name remains a valid ID.

`planner-client/` is a standalone pi agent loop using an MCP client. It has no import of the service implementation or private profile. Install its locked dependencies with `npm ci`; supply `OPENAI_API_KEY` to the planner process and keep the private credential restricted to the server child. Luna's Chat Completions tool requests explicitly use `reasoning_effort: none`.

Create a client JSON file with:

- `command`: absolute installed `wren` executable;
- `args`: the service arguments shown above;
- `skill`: absolute path to the exported planner skill;
- `serviceCredentialEnv`: `["NVIDIA_INFERENCE_API_KEY"]`;
- `serviceReplyTimeoutMs`: a positive integer MCP reply timeout in milliseconds;
- optional `model` and `baseUrl` for the external planner.

`serviceReplyTimeoutMs` is required and must be at most 2147483647. Set it above the
service's effective host reply window, with time for reply delivery: for the example's
120-second execution deadline plus 40-second IPC margin, use `200000`; for a 600-second
deadline, use `700000`. If `WREN_IPC_CALL_TIMEOUT_S` overrides the host wait, allow more
than that many seconds instead. A shorter client timeout cancels the MCP exchange
before the service can return its structured completion or timeout reason.

Create a JSON array of conversational questions, then run:

```sh
node "$EXAMPLE/planner-client/client.mjs" client.json questions.json result.json
```

Test total orders → evidence lookup → a request to reveal hidden SQL. Expect 12 for the total. Reuse one session and reference previous results. A request to reveal hidden SQL should be refused while a separately allowed data request can still complete. The weekly and target questions in `questions.json` belong to the `adhoc` profile.

## Policy and supported scope

`service.yml` is trusted operator configuration, version 2:

```yaml
config_version: 2
caller: local-planner
project_id: synthetic-orders
policy: policy.cedar
connection: {datasource: local_file, url: ../data, format: duckdb}   # optional; see below
metadata_selection: []
private_model: {id: nvidia/nemotron-3.5-lightning-30b-a3b, base_url: https://integrate.api.nvidia.com/v1, credential_env: NVIDIA_INFERENCE_API_KEY}
execution: {deadline_ms: 120000}
```

Other optional keys: `default_preset`, `policy_presets` (the file `setup.py` writes declares four, see below), `audit_path`, `idle_seconds`. `execution` is described under [Execution limits](#execution-limits). The connection is, in order, `--profile` (a Wren connection profile), then `connection` in `service.yml`, then the connection profile the Wren project is pinned to; with none of them startup fails (`explicit_connection_required`). `metadata_selection` narrows public document access; it cannot expand `policy.cedar`. The example selections are `[]`, `[structure]`, `[structure, rules]` and `[rules]`. The external planner's documents have the fixed ids `structure` (kind `schema.structure`: models, columns, relationships) and `rules` (kind `knowledge.rules`: the rule files; `knowledge/sql` is never carried), generated from the project. Private metadata access, task capability and result disclosure are separate decisions. There is no per-rule-use action, and `policy.cedar` no longer lists models or columns: which columns are off limits is the project's `denied_columns`.

An `audit_path` must be outside `models/`, `cubes/`, `views/`, `knowledge/` and the
root source files covered by the project digest. Startup rejects an overlapping
resolved path before opening the database or creating the audit file.

`idle_seconds` must be a finite, non-negative number (default 1800). Startup
fingerprinting checks the exact bytes consumed for service configuration,
capabilities and policy; a replacement during startup is refused as
`context_changed`.

### Migrating a version 1 service.yml

A service configuration that still carries `dataset`, `adhoc`, `metadata`, `rules` or `query_scope` (also inside a preset) is refused at startup with `legacy_service_config` and a message naming each key; nothing is ignored silently. One without `config_version: 2`, or with a key outside the version 2 set, is refused with `invalid_service_config`.

| Version 1 key | Now |
| --- | --- |
| `dataset`, `adhoc` | The models, columns and relationships come from the Wren project. Deny a column with `denied_columns: [model.column]` in the front-matter of a `knowledge/rules/*.md` file |
| `metadata` | The `structure` and `rules` documents are generated from the project |
| `rules` | Business rules are project knowledge (`knowledge/rules/*.md`); enforceable defaults are declared in the same front-matter |
| `query_scope` | Removed. There is no date-range hard limit in this version; the project-level `denied_columns` and declared default rules replace it |

### Denied columns

`denied_columns` entries must read `model.column` (lower-case) and name a column the project has; a scalar value counts as a one-entry list. A malformed entry, an unknown column, a near-miss key (`Denied_Columns`, `denied-columns`, `denied_column`), or a rule file that mentions the key but has no readable front-matter, or has front-matter without a top-level key of exactly that name (a merge key, a nested mapping, a top-level list, a comment, a misspelling) makes the loader mark the catalog invalid and the service refuse to start (`denied_columns_invalid`). A denied column is removed from every metadata projection (the structure document, the worker's index and reads, the business summary of `describe_data`), together with its enum meanings, any cube member of that name, and any relationship or description sentence that names it (a bare column name in a view description is treated as that column, since a view has no resolvable owner). The `denied_columns` key is removed from the rule text the service serves: the front-matter is parsed as YAML, so every spelling the loader accepts is dropped, and if a denied `model.column` still appears in the remaining front-matter (for example in a `defaults` entry, in any rule file, and also when it is written with a YAML escape such as `"customers\x2eemail"`) the service refuses to start (`denied_columns_invalid`) rather than show it. Private SQL that references one, directly or through a CTE, a subquery or a `SELECT *` expansion, is an authorization failure: the task ends as `denied` and nothing runs. This is a project-level denylist, not a per-caller access-control system.

A rule path that names a denied column uses an opaque, snapshot-local identifier
consistently in the context index, selection, reads and rules document. Pass the
returned rule IDs verbatim when requesting their contents.

### Execution limits

`execution` holds the limits the host passes to the runtime as `init.limits`: `deadline_ms` (5000-600000, default 120000), `max_tokens`, `thinking` (`on`, `off` or `default`; `default` sends nothing so the provider's own setting applies), `max_turns`, `max_tool_calls`, `provider_max_retries` and `provider_max_retry_delay_ms`; `max_sql_attempts` (default 6, the cap on a task's SQL statements; see [Why a `run_sql` statement is refused](#why-a-run_sql-statement-is-refused)) is a host-side budget. All are optional, and so is `as_of`, a `YYYY-MM-DD` date (UTC) that stands for today in every task (see [Today's date for the worker](#todays-date-for-the-worker)); a value in any other form fails startup (`invalid_execution_config: as_of`). Unless `WREN_IPC_CALL_TIMEOUT_S` is set, the host waits `deadline_ms / 1000 + 40` seconds for one runtime call. If that wait ends first, the host attempts to send `cancel` for the task, answers any late tool call with a refusal, keeps the runtime running and reports `unavailable` with reason `timeout`. Cancellation delivery is best effort: if the control write cannot complete, ending the host task does not prove that provider work has stopped. The shared runtime stays alive for other sessions, so this is not a task-wide provider-work or billing cap. `max_tokens` caps the output of each provider request, not the total tokens of a task or session; it does not cap input tokens or billing. `max_turns` and `max_tool_calls` bound each component child's execution. Delegation starts another component child with its own counters and the same configured upper bounds; these are not a shared total over the root and all delegated work. There is no task-wide total token or tool-call cost cap. The runtime deadline and provider retry settings govern that invocation; `max_sql_attempts` counts SQL attempts in the host and carries across clarification continuation. A runtime that predates `init.limits` ignores those runtime limits; the host's own IPC and SQL lifetime bounds still apply.

Governed SQL in both `serve agent` and controlled `serve mcp` runs in a fresh host-owned child interpreter with its own engine and database connection. The host bounds its lifetime by the task's remaining `execution.deadline_ms`; `AdHocSQL.execute` used outside a service task has a 90-second default. IPC timeout/abort, session close and service shutdown terminate and reap active query workers (TERM, then KILL if needed), and drop their late results. A new query does not reuse a timed-out connection or occupy an abandoned tool-pool slot. Connection setup and planning in that worker are inside the same bound; process startup adds overhead and connection-local state does not carry between queries. This is local process management, not an OS sandbox. Closing the connection on termination does **not** prove that every remote database immediately cancels its server-side statement: configure server-side statement/resource limits where needed. Ordinary `wren query` and legacy ungoverned `serve mcp` retain their existing execution path.

Each wait for tool callbacks during IPC teardown is capped at one second. Queued callbacks
are cancelled; a running, non-cancellable callback can outlive `close()` and still delay
Python interpreter exit. This wait bound does not terminate the callback or provider work.

The task clock starts before its first session/context revalidation and authorization, and each authorization wait is capped by the remaining task time. Each IPC call shares one deadline across the write-lock wait, request write and reply wait. Control and tool-result writes have a bounded write budget too. Canceling an incomplete frame ends that stalled transport, since another JSON frame cannot safely follow it; canceling a healthy task keeps the shared runtime available. Runtime context fingerprints run in a separate fixed-purpose child, under the same task lifetime, so a stalled filesystem read can be terminated on close or shutdown. A fingerprint check outside an active task has a 15-second bound. These checks keep the same content-hash algorithm and revalidation points, with a process-start cost per check; initial project loading at service startup remains synchronous.

The shared runtime admits at most 128 unfinished tool calls in total, counting
both running callbacks and queued work across all invocations. A 129th call
closes that runtime and fails every request then waiting on it as
`unavailable` with reason `service`; it is not a per-request busy response.
Restart the service to create a fresh runtime. Late calls for an already-ended
invocation receive `tool_denied` without entering the executor. This admission
bound does not terminate non-cancellable external callbacks or prove that
provider work or billing has stopped.

Before a query result crosses into the host, the child validates its shape, supported scalar types and 256-character string-cell limit, compacts Arrow buffers, and caps the serialized response at 128 KiB. The host enforces that frame limit before deserialization and retains its final 32 KiB JSON result limit. These bounds cover transfer and host deserialization. A row limit does not bound a cell's size or the connector's allocation: the child/database may already have materialized a large value before validation, and this service supplies no hard memory limit for either process or remote database.

The hidden legacy `wren governed-stdio` command has a separate synchronous query
loop, without the task deadline or disconnect cancellation of controlled
`serve agent` / `serve mcp`. Its 1 MiB result budget checks logical Arrow values
before Python row conversion and accounts for encoded rows incrementally.
Connector-side query execution and Arrow materialization can allocate data before
those checks; this is not a connector or process memory limit.

A runtime that reports usage sends one `calls` entry per provider attempt (a retried 429 is its own entry) with every reply. The host never forwards it: it goes to the audit only, as one `model_call {request_id, turn, elapsed_ms, input, output, reasoning, cache_read, stop_reason, raw_stop_reason, tool_calls, status}` event per entry, written before the task's `task_completed` or `task_failed`. `input` excludes `cache_read`. An entry is recorded only if it has exactly those ten fields, every number is a non-negative integer and every label matches `[a-z0-9_]{0,32}`; anything else is dropped and counted in one `model_calls_dropped {request_id, count}` event. A runtime that sends no usage produces no `model_call` events, and that is not an error. When a task fails, `task_failed` also carries `turns` and `tool_calls` (the runtime's own counters when it reports them, otherwise `null`) and `sql_attempts` (the host's count of the task's SQL statements); `detail` keeps the runtime's exact failure code, for example `service_unavailable:turn_limit`.

### Named policy presets

An operator may declare named presets in `service.yml` and pick one at startup. A preset may set only `metadata_selection` and `policy` (another Cedar file inside the configuration directory); any other key is rejected (`invalid_policy_preset`), and a preset `query_scope` is a legacy key (`legacy_service_config`). Top-level values remain the fallback for keys a preset does not set. A preset's `policy` file is evaluated in addition to the deployment `policy` file, never in its place, and the metadata selection is one more policy; the runtime intersects them, so a request must be allowed by every one. A preset can therefore only narrow: the files `setup.py` writes are `permit(principal, action, resource);` followed by one `forbid` per evidence kind the preset withholds, and an edit to `policy.cedar` keeps applying under every preset.

`setup.py` writes this, with `hidden` as the default:

```yaml
metadata_selection: []
default_preset: hidden
policy_presets:
  hidden:    { metadata_selection: [],                 policy: policy-hidden.cedar }
  structure: { metadata_selection: [structure],        policy: policy-structure.cedar }
  rules:     { metadata_selection: [rules],            policy: policy-rules.cedar }
  full:      { metadata_selection: [structure, rules], policy: policy-full.cedar }
```

An operator's own preset is declared the same way (`q1: { metadata_selection: [structure], policy: q1-policy.cedar }`).

Without a preset (neither `default_preset` nor `--policy-preset`), `policy.cedar` grants every evidence kind, so the planner sees full-level evidence; declare a default preset to narrow it.

`wren serve agent --policy-preset <name>` selects a preset; without the flag `default_preset` applies, and without either the top-level values apply. An unknown name fails startup (`unknown_policy_preset`) rather than falling back. `wren serve agent-presets --service-config service.yml` prints the declared names as JSON without starting the engine; on the fixture it prints `{"default": "hidden", "presets": ["full", "hidden", "rules", "structure"]}`. The selected preset is reported by `capabilities` as `policy_preset: {name, available}`; the visible documents remain `metadata_documents`, which is already policy-filtered. Changing presets is a restart: sessions do not survive it, and a narrower preset cannot recall what a client already received.

### What a result's evidence tells the planner

A completed `ask_data` (or direct `run_sql`) answer and `get_evidence` carry the same `evidence` object, built by one function from the statement that actually ran. The private model writes none of it, it holds no SQL, rule text or model output, and it is computed once per reference and kept with it. Four kinds of content are authorized one by one through `receive_answer` (the `name` is the capability id, as for `answer.approved`). A kind the policy does not permit leaves out its fields; it never fails the answer.

| `receive_answer` kind | Fields | Content |
| --- | --- | --- |
| none: part of `answer.approved` | `mandatory_scope` | `{"kind": "project_defaults", "declared_defaults_enforced": <bool>}`: whether the project declares default rules the host enforces on every statement (`false` for a project with none). It names no rule. A host-written text result carries `{}` |
| none: part of `answer.approved` | `applied_period` | The one date range that bounds the statement that ran: `{lower, upper, lower_inclusive, upper_inclusive}` (ISO 8601 dates or timestamps; an absent bound is `null`), or `null`. It is set only when every read of a windowed model carries a window and all windows agree on both bounds and flags. A `null` means the host could not vouch for a single range: no window, windows that differ, a date filter it could not read, or a read of a windowed model with no window of its own (an unfiltered `UNION` branch, CTE or subquery next to a June one). It carries dates and flags only, never a column name or rule text (a window on `shipped_at` reads like one on `order_date`), which is why every preset shows it |
| `answer.evidence.checks_summary` | `checks_summary`, `has_unverified_semantics` | `all_satisfied` when at least one declared rule applied to the statement, otherwise `none_applicable`: no rule id, no count. `has_unverified_semantics` says whether anything no check covers was touched, not which |
| `answer.evidence.checks` | `checks` | `{<rule id>: {applicable, result, scope?}}` for every declared rule; `result` is `satisfied`, `satisfied_by_definition`, `satisfied_by_caller_scope` (then `scope` lists the confirmed statuses) or `not_applicable` |
| `answer.evidence.observed` | `observed` | What the statement reads, taken from its tree: `models`, `columns` per model, `joins` (model pairs), `aggregated`, `filters` (`{column, operator}`, never a literal), `status_literals` (the values a status column was compared with, only values the project lists for it) and `date_windows` (see below). A denied column never appears, in `date_windows` either |
| `answer.evidence.unverified` | `unverified` | The ids of the meanings no check covers that the statement touches (see [Declared default rules](#declared-default-rules)) |

| Preset | Fields in `evidence` |
| --- | --- |
| `hidden` | `mandatory_scope`, `applied_period`, `checks_summary`, `has_unverified_semantics` |
| `structure` | hidden + `observed` |
| `rules` | hidden + `checks` + `unverified` |
| `full` | all of them |

For one statement, `SELECT c.region, COUNT(*) FROM orders o JOIN customers c ON o.customer_id = c.id WHERE NOT o.is_test AND o.status IN ('paid', 'shipped') GROUP BY c.region`, `hidden` returns

```json
{"mandatory_scope": {"kind": "project_defaults", "declared_defaults_enforced": true},
 "applied_period": null,
 "checks_summary": "all_satisfied", "has_unverified_semantics": true}
```

and `full` returns that plus

```json
{"checks": {"exclude-test-orders": {"applicable": true, "result": "satisfied"},
            "convert-invoices-to-usd": {"applicable": false, "result": "not_applicable"},
            "count-paid-and-shipped": {"applicable": true, "result": "satisfied"}},
 "observed": {"models": ["customers", "orders"],
              "columns": {"customers": ["id", "region"], "orders": ["customer_id", "is_test", "status"]},
              "joins": [["customers", "orders"]], "aggregated": true,
              "filters": [{"column": "orders.is_test", "operator": "is false"},
                          {"column": "orders.status", "operator": "in"}],
              "status_literals": {"orders.status": ["paid", "shipped"]},
              "date_windows": []},
 "unverified": ["fiscal_calendar_bounds"]}
```

#### The date range a statement applied

The host reads the range from the statement's tree; it never takes the worker's word for it. For each select, source alias and date or timestamp column, the comparisons of that column with a date literal (`>=`, `>`, `<`, `<=`, `=`, `BETWEEN`; `DATE '2026-06-01'`, `CAST('2026-06-01' AS DATE)` or an ISO string) in its `WHERE`, `HAVING`, `QUALIFY` and join conditions make one window (a date literal in the `ON` of an outer join on the preserved side, on either side of a `FULL` join, or on either side of an `ANTI` join only decides which rows match, not which are kept, so it is not a window; `INNER`, `SEMI` and nullable-side `ON` literals still are). A column filtered any other way anywhere in the statement (`DATE_TRUNC`, `EXTRACT`, arithmetic such as `+ INTERVAL`, a non-literal operand, an `OR`, a `NOT`, `IN`, a `CASE` or `FILTER` condition, a value derived from it in a CTE) is not listed, and the statement carries `date_window_unverified` in `unverified` (and `has_unverified_semantics` is true), ahead of the ids a project declares. A null test (`IS [NOT] NULL`, for example a soft-delete column) and a comparison of two columns in a join condition are not date filters and count for nothing either way. A window ranks nothing: `ROW_NUMBER() OVER (... ORDER BY order_date)` is not a date filter.

```json
"observed": {"date_windows": [{"column": "orders.order_date", "lower": "2026-06-01", "upper": "2026-07-01",
                               "lower_inclusive": true, "upper_inclusive": false}]}
"applied_period": {"lower": "2026-06-01", "upper": "2026-07-01", "lower_inclusive": true, "upper_inclusive": false}
```

`date_windows` follows `observed` (`structure`, `full`); `applied_period` is shown to every preset. Windows over the same column on distinct source aliases or in different selects (the branches of a `UNION`, a CTE and its caller) are listed separately, equal ones once. A select that reads a model whose date column is windowed elsewhere in the statement, without a window of its own on that read, makes the statement unpinned: `date_window_unverified` is set and `applied_period` is `null`, while `date_windows` still lists the windows that were found. Coverage is judged per consuming edge: a select is covered through a table, CTE, derived table or view body only by its own filter on it (or by the filter of the select that consumes it), so a CTE that two selects read is bounded only for the one that filters it, and the other one unpins the statement; a filter inside the CTE bounds every consumer. A CTE nothing reads is ignored. A self-join is judged per alias: a window must cover every alias of the model, and an alias read without a window of its own (a window on `orders o` does not cover `orders p`) leaves `date_window_unverified` set and `applied_period` `null`. `applied_period` is also `null` whenever `date_window_unverified` is present. A literal in a `LEFT JOIN` condition on the joined (nullable) side is listed as a window, because it does restrict that side's rows; one on the preserved side is not. A nullable-side ON-only window cannot certify the whole statement: unmatched preserved rows remain, so it leaves `date_window_unverified` set and `applied_period` null. A date literal that is not a bound, and a bound the statement did not apply as a literal, never appear. The planner's skill compares `applied_period` with the period the user asked for and says so when they differ.

What this lets a planner conclude: a statement that broke a declared rule never ran, so the evidence it holds describes a statement that passed. A violated or undetermined verdict is never part of evidence (they exist only in the worker's rejection and the audit), so a worker that was refused and corrected its statement leaves no trace there. `checks_summary` is only two-valued, and "has a status filter: yes" is not a field in any preset because it cannot tell excluding cancelled orders from counting only paid ones. `all_satisfied` and an empty `unverified` still do not mean the question was understood: evidence says how the statement was checked, not that it answered what was asked. Failed attempts are not disclosed at all; a planner learns only a coarse `unavailable.reason`.

### Clarification questions follow the same policy

The status-scope question (see `sale_statuses` below) is built by the host and sent only after the same `receive_answer` check an answer goes through, once for each part. The declared set is a business rule, so it is listed only if `answer.evidence.checks` is permitted (`rules`, `full`). The column's whole set of values is structure, so it is listed only if `answer.evidence.observed` is permitted (`structure`, `full`). The two are decided separately:

| Preset | Question sent |
| --- | --- |
| `hidden` | `請指定要分析的訂單狀態` |
| `structure` | `請指定要分析的訂單狀態；可選的狀態有：paid、shipped、cancelled、pending。請以逗號分隔列出要分析的狀態。` |
| `rules` | `規則預設只納入這些訂單狀態：paid、shipped。請問是否只分析其中某些狀態？請以逗號分隔列出要分析的狀態。` |
| `full` | `規則預設只納入這些訂單狀態：paid、shipped；可選的狀態有：paid、shipped、cancelled、pending。請問是否只分析其中某些狀態？請以逗號分隔列出要分析的狀態。` |

Every status-scope question, including the second one after an unusable answer, is recorded as `clarification_sent {request_id, rule, disclosure: {set, domain}}` with what that question disclosed. The `analysis_definition` question is fixed text and discloses nothing.

### Asking what data exists

Every mode answers "what data is there" without showing structure. Each profile's `data_worker` borrows `describe_data`, which makes the host write a short business summary from the project (one line per model; no table, column or rule text, and no denied column). It comes back as `result.kind == "text"` and needs the `answer.description` disclosure, which both `policy.cedar` and `adhoc-policy.cedar` permit. Its evidence has `mandatory_scope: {}` and, where `checks_summary` is permitted, `checks_summary: none_applicable` and `has_unverified_semantics: false`, because no statement ran.

### Why a task was unavailable

An `unavailable` response carries a coarse `reason` so a planner can tell which side failed without receiving anything private: `provider` (the private model platform answered with an error or a broken stream), `timeout` (the invocation hit a deadline, was cancelled, or the host's own wait for the runtime ran out), `worker` (the private agent's output or limits: invalid final output, turn/tool/output limits, a tool failure, a spent SQL budget, or a final value that is not the host's evidence token), or `service` (the host or runtime itself, or a runtime that reports no diagnostic code). A `provider` or `timeout` reason is a signal to retry the identical request later; a `worker` reason is a signal to reformulate. Only `unavailable` has a reason; `denied`, `session_expired` and `context_changed` stay as they are, and `conflict` has its own (see [Why a request conflicts](#why-a-request-conflicts)).

The four values are a deliberate projection: the operator's `audit_path` records the exact code per request (`task_failed {request_id, reason, detail, turns, tool_calls, sql_attempts}`), still without provider text, SQL or credentials, and that finer code, with the `model_call` usage, is what an operator reads to tell a model that ran out of room from one that ran out of time. The planner is not given it. The mapping:

| Code in `detail` | Reason | Where it comes from |
| --- | --- | --- |
| `provider_http` | provider | runtime: the platform answered with an error status |
| `provider_stream` | provider | runtime: the response stream broke |
| `model_error` | provider | runtime: the model reported an error |
| `deadline` | timeout | runtime: `execution.deadline_ms` ran out |
| `cancelled` | timeout | runtime: the host cancelled the task |
| `ipc_timeout:host` | timeout | host: its own wait for the runtime ran out |
| `invalid_json` | worker | runtime: the final output was not valid JSON |
| `empty_output` | worker | runtime: the final output was empty |
| `turn_limit` | worker | runtime: `max_turns` reached |
| `incomplete_child` | worker | runtime: a delegated worker did not finish |
| `model_length` | worker | runtime: the model's output hit `max_tokens` |
| `output_limit` | worker | runtime: the output size cap |
| `request_limit` | worker | runtime: the request count cap |
| `response_limit` | worker | runtime: the response size cap |
| `missing_response` | worker | runtime: an empty or missing response |
| `tool_failure` | worker | runtime: a host tool call failed |
| `destination_denied` | worker | runtime: it refused a request (outside the configured endpoint, or over its request budget) |
| `child_exit` | worker | runtime: a worker process exited |
| `protocol` | worker | runtime: a protocol violation, including too many tool calls |
| `budget_exhausted:rejected` | worker | host: a rewrite budget ran out (see below) |
| `budget_exhausted:undetermined` | worker | host: the one retry for an unjudgeable statement was used |
| `budget_exhausted:query_unavailable` | worker | host: the retry after an engine failure was used |
| `budget_exhausted:sql_attempts` | worker | host: `execution.max_sql_attempts` was used |
| `status_scope_unresolved` | worker | host: two answers to the status-scope question named no usable status |
| `invalid_evidence` | worker | host: the final value was not a host-minted evidence token |

Any other code, a runtime error with no code, and an unexpected failure are `service`. A runtime that predates the per-attempt usage report names its failures the same way; it just sends no usage.

### Why a request conflicts

A `conflict` answer is `{"status": "conflict", "reason": <reason>, "revision": <int>}`, and `revision` is the session's own revision when the request was refused. Sessions are bound to their caller, so it discloses nothing about anyone else's state.

| `reason` | Cause | What the planner does |
| --- | --- | --- |
| `revision` | `expected_revision` is not the session's revision | resend the same question, capability and `reply_to` once, with a new request ID and `expected_revision` set to the returned `revision` |
| `request_id` | the ID was already used for a different request | use a new ID |
| `busy` | another call of the session is still running | wait for that call to answer and continue from its revision; the returned `revision` may be advanced by it at any moment, so it is a hint, not a promise |

The session is neither closed nor reopened, and a revision is never guessed. The operator's audit gets one `conflict {request_id, reason, expected_revision, revision}` event per refusal. `session_expired` and `context_changed` stay as they are.

### Today's date for the worker

The gate does not allow `now()` or `current_date`, so the worker needs the date from the host: every task's worker request carries `as_of`, the configured `execution.as_of` or, when that is not set, the host clock's UTC date taken as the task starts. The three example profiles' `data_worker/respond.md` tell the worker to resolve relative periods from it. `capabilities` reports `as_of` too (the fixed date, or `"clock"`), so a planner can tell the data's reference date from its own clock; a completed answer does not repeat it. The date is recorded in the audit's `task_completed` and `task_failed` events and in the internal evidence, and nowhere else.

### Declared default rules

Repeated mapping keys inside `defaults`, including nested declaration mappings,
are invalid. Standard YAML merge overrides remain supported; unrelated prose
front-matter retains its existing treatment.

A rule file may declare defaults in its front-matter (`defaults:`); the host checks every statement against them before it can run. `exclude_rows` requires the statement to exclude the flagged rows of every model it covers. It accepts no outer-join ON predicate at all: put the exclusion in `WHERE`, or in the ON of an INNER or comma join. Unused CTE definitions add no reads or aggregation obligations; actual scalar subqueries, EXISTS and IN reads still count. Exclusion is checked for each physical table alias and each consuming CTE/derived-table path: filtering one alias or one CTE consumer does not excuse another. An exclusion on a related entity must connect that read through declared relationship keys (or the same declared primary key); a constant or unrelated positive `IN` cannot establish it. Keyed `NOT IN` and correlated `NOT EXISTS` remain recognised by the default checker, but the agent SQL form gate still rejects correlated SQL. These supported shapes do not establish arbitrary SQL equivalence. `require_rate_join` requires an aggregate over a listed amount column to join the rate model on the amount's currency and on-or-before the amount's date; two optional keys tighten it: `match: single` requires the rate source to yield one row per amount row (an `ASOF JOIN`, or a derived source that keeps the newest row per amount through `ROW_NUMBER() ... ORDER BY date DESC` = 1; every partition key must be fixed by equality to the amount side or a literal at each consuming join; a date-range join against `PARTITION BY currency, rate_date` cannot establish a single match. Rank bounds preserve direction (`rn = 1`, `1 = rn`, `rn <= 1`, `1 >= rn`); `1 <= rn`, an OR branch, another alias's rank or mutually constrained rate sources cannot establish it. Unproved shapes and ordinary `date <=` joins are refused as `rate_multi_match`), and `base_currency: USD` names the currency whose amounts need no rate. With a base currency, an inner join of the rate model is refused (`base_currency_dropped`: the base-currency rows have no rate row and would vanish), and so is any literal default of a rate column outside a branch that only the base currency reaches (`rate_default_literal`: `COALESCE(rate, 1)` would turn a missing EUR rate into 1). A LEFT join that takes the base currency from the amount itself (`CASE WHEN currency = 'USD' THEN amount ELSE amount * rate END`) satisfies the rule; a LEFT join with neither guard nor default also passes, and the host records `observed.fx_missing_rate_handling = "unguarded_left_join"` so a later stage can say that the missing-rate behaviour was not verified.

`sale_statuses` (`column: <model>.<column>`, `values: [...]`, optional `domain: [...]`, `overridable_by_caller: true|false`, `when: aggregated`) requires the statement to keep exactly the declared status values. The host does not look for a filter; it computes which of the column's `domain` values the statement's filters still return (`=`, `<>`, `!=`, `IN`, `NOT IN`, `IS [NOT] NULL`, combined with `AND` / `OR` / `NOT`, with `LOWER`, `UPPER` or `TRIM` around the column), so `status NOT IN ('cancelled', 'pending')` keeps whatever else the domain lists. Bare-column comparisons retain declaration case folding; this does not certify mixed-case storage or guess a database collation. Explicit ASCII `LOWER`/`UPPER` operations on columns and literals are evaluated before comparison: `UPPER(status) IN ('paid', 'shipped')` keeps no declared values and is refused, while uppercase literals or `UPPER('paid')` retain support. Non-ASCII case mappings under these functions have no verdict because database/locale mappings vary. No new storage-normalisation declaration is introduced. The `domain` is the declaration's own list, or else the `enum_values` the project lists for the column; with neither the declaration is invalid. Each read of the model is judged on its own: a nullable-side ON predicate of an outer join restricts that read (`customers c LEFT JOIN orders o ON c.id = o.customer_id AND o.status IN ('paid', 'shipped')` with `SUM(o.amount)` is satisfied), while a preserved-side, FULL, SEMI/ANTI or unnamed join-group ON predicate never counts. A `status_scope` cannot clear a statement that keeps NULL statuses (`... OR status IS NULL` is always a superset), so the worker has to rewrite it. A kept set that is a proper subset is refused as `<id>:subset`, one that holds a value it should not as `<id>:superset`, and no status predicate at all as `<id>:missing`. A predicate on the column that the host does not evaluate (a comparison with another column, a function, a subquery, `LIKE`, a `CASE`) gets no verdict: `declared_default_undetermined` with the rule id.

When a rule is `overridable_by_caller: true` and a worker's statement broke it, the worker may call `clarify` with `missing: status_scope` (any other rule, or no violation in the task, answers `{"error": "clarification_not_applicable"}`). The task ends as `needs_clarification`; the host asks the question in the wording the policy permits (see [Clarification questions follow the same policy](#clarification-questions-follow-the-same-policy)). The `answer` of `continue_task` is read as a comma-separated list of statuses (`、` `;` and line breaks also separate); it must fall inside the rule's domain, or the question is asked once more, and a second unusable answer ends the task as `unavailable` with reason `worker` (`detail: status_scope_unresolved`). The confirmed set (`caller_scope_confirmed {request_id, rule, scope}` in the audit) replaces the declared values as the comparison target for that one rule and nothing else: the other rules, the denylist, the read-only check and the join limit are unchanged. It belongs to the task and to follow-ups that name its result in `reply_to` (`caller_scope_inherited`); a follow-up whose statement keeps a different set is a violation again and asks again, and a new task starts with no scope.

`checks` in the evidence (internal, and as the `answer.evidence.checks` field of [what the planner sees](#what-a-results-evidence-tells-the-planner)) record each declared rule as `{applicable, result}` with `satisfied`, `not_applicable`, `satisfied_by_definition` (every read of the models the rule concerns lies inside a view whose `guarantees` names the rule) or `satisfied_by_caller_scope` (which also carries `scope`). A view is expanded in place, so the models it reads are authorized, tracked and checked like any other source; its guarantee excuses only the rules it names, and only for the reads inside it. A cube is not a table and a cube measure is not a column: reading either by name is refused as `unsupported_query` with code `cube_not_a_table`.

A view's `guarantees` are trusted declarations by the project author. The host does not
prove that the view's SQL body satisfies those rules. Authors must maintain the declarations
when changing the view; `satisfied_by_definition` records reliance on that author claim,
not a host validation of the body.

Some meanings are beyond what any check can read. Front-matter may list them under `semantics:` as `{id, models, note}` (a model or view name in `models`); a statement that touches one of the models gets the id in `unverified` (the `answer.evidence.unverified` field), next to the ids the host adds itself: `fx_missing_rate_handling` (an unguarded LEFT join), `fx_default_shape_unverified` (a `COALESCE` / `IF` / `CASE` over a rate whose default is not a plain number or NULL, or whose test is not `IS [NOT] NULL`: `COALESCE(rate, 2 - 1)` passes the rate checks and is reported here) and `duplicate_aggregation` (an aggregate over a view's value in a select that joins the view to a model on a column that is not the model's key). The loader refuses a `semantics` block it cannot read in full, and the service refuses an entry that names an unknown model or view or a denied column.

A statement that breaks a rule is rejected before execution as `declared_default_missing` with the rule ids (`<id>`, or `<id>:<sub>` for the checks above). A statement the checker cannot judge is rejected as `declared_default_undetermined`. A project with no declared rule at all starts with a `declared_defaults_missing_in_project` audit event and enforces nothing: no statement is ever refused for a rule the project did not declare.

### Why a `run_sql` statement is refused

A statement fails in one of three ways, and the worker (or the direct caller) is told which.

1. **Rejected before execution**: nothing ran, nothing was authorized, and the answer is `{"error": <error>, "code": <code>, "rules"?: [...], "hint": <one sentence>}`. `error` is `unsupported_query` (the statement cannot be planned against the bound models; `code` is one of `invalid_sql`, `complexity_limit`, `recursive_query`, `join_limit` (more than four joins), `unsupported_source`, `unresolved_column` (an alias the worker never defined, a correlated reference), `no_source`, `column_limit`, `column_list_alias` (`customers AS c(a, b)`), `natural_join`, `positional_reference`, `unsupported_function` (a function or form the read-only gate does not allow), `unsupported` (the host could not plan it) or `cube_not_a_table`), `unsupported_result_shape` (`code` is `literal_disclosure`, `unbacked_result`, `text_synthesis`, `text_cast` or `duplicate_label`: literal strings, text casts or concatenation in a result column, or two result columns with the same label; use `GROUP BY` so a key is a data column instead of one column per literal), `declared_default_missing` (`code: rule_violation`, `rules` lists the rule ids) or `declared_default_undetermined` (`code: no_verdict`). Each is recorded as `private_sql_rejected {request_id, code, sub_code, rules?, attempt}`.
2. **Executed without a deliverable result**: the engine raised, so the statement did run. The answer is `{"error": "query_unavailable", "hint": ...}`; the audit event is `private_sql_failed {request_id, error_class, attempt}` (the exception class name only, never its message).
3. **Refused by authorization**: exactly `query_denied:not_read_only` (a write, DDL, several statements or a command), `query_denied:denied_column`, `query_denied:external_source`, `query_denied:unknown_model`, or a Cedar `deny` (`detail: "denied"`). Everything else is rewritable and budgeted. The task ends at once as `denied`: the audit event is `task_failed {reason: "denied", detail: "query_denied:<sub>" | "denied", turns, tool_calls, sql_attempts}`, the runtime is sent `cancel`, and anything it still hands back (a tool call, an evidence token) is refused or dropped. A rewrite cannot make it allowed.

The host counts the worker's attempts per task and a `continue_task` carries the count on. At most two statements may be rejected before execution (only one of them `declared_default_undetermined`), at most one retry follows an engine failure, and `execution.max_sql_attempts` (default 6) caps the task. The statement that goes over a budget ends the task: the host records `private_sql_budget_exhausted {request_id, kind, attempts}` (`kind` is `rejected`, `undetermined`, `query_unavailable` or `sql_attempts`), sends `cancel`, and the task is `unavailable` with reason `worker` (`detail: budget_exhausted:<kind>` in the audit; `sql_attempts` in `task_failed` is the count).

### Loopback HTTP transport

`wren serve agent --transport http --host 127.0.0.1 --port 0` serves the same tools over streamable HTTP for a client that manages the service process itself. The bind host must be loopback and the process must receive `WREN_AGENT_LOCAL_TOKEN`; every request must carry `Authorization: Bearer <token>` or it is answered `401 {"status":"denied"}`. After binding, the service prints one line to stderr, `ready transport=http host=<host> port=<port>`, so `--port 0` can be used. The token only guards against other local processes connecting by mistake; it is not authentication between operating-system users.

The default analysis/counts offer is described as a row count of one model; raw rows, SQL-only output and writes are not supported, and every statement the worker or a direct caller sends goes through the gate above before it can run.

Rules in prose help the agent select the domain definition. Tool execution mints an internal evidence token, and only an exact valid token can produce a public result. The planner receives authorized query result values and evidence; metadata restrictions do not make result values invisible. The result excludes internal SQL and rule text. Evidence does not certify the model selected the user's intended question; the planner must still check what was counted.

Session storage is in memory, with 30-minute idle and 8-hour maximum lifetime, one active mutation per session and bounded request history. Repeating the identical request ID replays an authorized response; changing its payload conflicts (`reason: request_id`), as does a stale `expected_revision` (`reason: revision`) or a call that arrives while another is running (`reason: busy`). Configuration or metadata changes invalidate context; restart after configuration changes. Old references do not survive restart or transfer between sessions.

An optional operator-only `audit_path` records bounded decision and query diagnostics, one JSON line per event, written and flushed as each event happens, so a killed process still leaves its trail. The first event is `context_loaded` (`digest`, `loader_identity`, `models`, `pages`, `budget_bytes`, `first_page_bytes`). It must name a new file and may contain private query conditions; never expose it as a resource or place it in shared public artifacts. It is disabled by default.

If a configured audit write or flush fails, the service stays unhealthy until restarted.
It stops controlled operations and result delivery, including existing evidence reads and
results from requests already in flight, with `{"status":"unavailable","reason":"service"}`.
SQL may already have executed; withholding its result does not undo that execution. Repair
the audit destination and restart with a usable new audit file. Replacing the stream on the
same service instance does not clear the failure. Session cancellation and shutdown remain
available. The operator's in-memory audit records one `audit_sink_failed` event with its
write/flush stage; the underlying exception text is never sent to the planner.

## Support boundary

A `SUM` or `COUNT` expression alone does not establish additivity across
dimensions. The loader leaves that additivity unknown while keeping the metric
declared and discoverable; snapshot balances, for example, need evidence about
which dimensions can be summed. This introduces no new declaration schema.

With published Warble 0.13, a pinned metric whose required additivity is unknown
returns `Unanswerable`; an existential selection containing only such unknown
metrics returns `Fail`. Both reject the additivity constraint. Ordinary metric
discovery remains available.

The runtime admits read-only analytical skill components with one model step, a root and declared leaf workers, and exact borrowed tool mappings. Context reading is performed by authored tool behavior. Unsupported effects, conditional steps, params, typed context requirements and deeper component graphs fail admission. This does not claim full Warble IR support.

HTTP sharing/authentication, durable sessions, arbitrary business-rule interpretation, operating-system isolation from the same local user, and private network hosting are outside this example. A client ignoring the skill still encounters service authorization checks. Filesystem/DB credentials held independently by the client are outside this service boundary.

If startup fails, check the profile, compiled IR compatibility, project manifest, model credential environment, policy syntax and runtime path. An `unavailable` result means execution or validation did not complete, not an empty database. Do not substitute a legacy endpoint to bypass a rejection.

## Re-run the checks

The checks come in two layers. Both run from the Wren Python package directory
with the MCP extra installed, and both need the context loader built (see above)
and the Warble compiler (`WARBLE_BIN`, the published `@warble/cli`).

**CI** (the `agent service tests` job) uses the scripted runtime in
`tests/unit/fixtures/fake_runtime.js` as `WARBLE_SERVICE`. It evaluates no Cedar
policy, so the tests that need a real policy engine are skipped there; the rest
cover the SQL gate, the declared-default checks and the host's own logic:

```sh
WARBLE_SERVICE="$PWD/tests/unit/fixtures/fake_runtime.js" \
WARBLE_BIN="$WARBLE" \
uv run --extra mcp pytest tests/unit/test_agent_service.py tests/unit/test_agent_sql.py \
  tests/unit/test_context_adapter.py tests/unit/test_agent_query_lifetime.py \
  tests/unit/test_declared_default_fx.py \
  tests/unit/test_declared_default_status.py tests/unit/test_query_gate_termination.py
```

CI also installs the pinned public `@cedar-policy/cedar-wasm` dependency under `core/wren/tests/policy-runtime` and runs `test_policy_denial.py` without optional skips. A separately authored test-only IPC peer evaluates the host's policies with real Cedar: an allowed query produces a result/evidence, an explicit forbid stops the host before SQL execution, and parse/evaluation errors fail closed. This checks the host authorization boundary; it does not certify the production runtime's admission, model loop, or entire policy adapter. To run that gate locally after building the loader and setting `WARBLE_BIN`:

```sh
npm ci --ignore-scripts --no-audit --no-fund --prefix tests/policy-runtime
uv run --extra mcp pytest tests/policy-runtime/test_policy_denial.py -v
```

**Local gate** (not in CI: the private runtime is not published) runs the same
files and the rest of the agent group against a built runtime, so Cedar is
evaluated for real. The runtime refuses an empty model key, so export any
non-empty `NVIDIA_INFERENCE_API_KEY` (the unit tests make no model call):

```sh
NVIDIA_INFERENCE_API_KEY=unused \
WARBLE_SERVICE="$RUNTIME/node_modules/@warble/pi/dist/service.js" \
WARBLE_BIN="$WARBLE" \
uv run --extra mcp pytest tests/unit/test_agent_service.py tests/unit/test_agent_sql.py \
  tests/unit/test_context_adapter.py tests/unit/test_agent_ipc.py \
  tests/unit/test_agent_query_lifetime.py \
  tests/unit/test_declared_defaults.py tests/unit/test_declared_default_fx.py \
  tests/unit/test_declared_default_status.py tests/unit/test_query_gate_termination.py \
  tests/unit/test_mcp_server.py
```

The local gate uses the actual Cedar subprocess and synthetic Wren database, with
model calls replaced only where hostile outputs or concurrency must be forced.
Hosted model acceptance is separate: run the independent planner with your own
model credentials and inspect both its trace and the configured local audit.
An `unavailable` attempt is not a pass, even when a later identical retry works.

Planner traces use regular files with mode 0600, tightened before writing even
for an existing file. Symbolic-link output paths are refused; trace output
requires the platform's no-follow file-open support.

The runtime preserves the original host task envelope (including the worker's
context index) across private component delegation so a coordinator's
paraphrase cannot drop the caller's previous result or clarification. This
does not change what metadata the external planner may read.

## Opt-in ad-hoc analysis

Prepare the same fixture with `setup.py --adhoc "$DEMO"` and launch
`serve agent` with `--agent-profile "$EXAMPLE/profiles/adhoc"`. This selects
`adhoc-policy.cedar`, which lets the private worker author SQL and names no model
or column. It does not broaden the count profiles or the external MCP tool list.

The private worker reads the project's context and authors DuckDB read-only SQL.
It can calculate revenue and average order value, group by dates or regions, join
orders to customers, rank results, and use CTEs. The host parses and qualifies the
query against the loader catalog's models and columns, refuses any reference to a
denied column, checks each referenced model and its columns with Cedar (including
filters and join keys), and checks result permission before executing. External
planners receive host-shaped tables and session evidence, never the SQL or the
private worker's final prose.

This fixture has total revenue 780 USD, average order value 65 USD, and 12 orders.
Regional revenues are East 300, South 260 and North 220. Weekly revenues are
60, 220 and 500 for UTC weeks beginning 2025-12-29, 2026-01-05 and 2026-01-12.
Customer email exists in the synthetic source but is denied by the project,
including use in filters or ordering. Public metadata is disabled by default.

Queries must pass a closed read-only AST/function gate. Writes, external file or
network readers, qualified external sources, recursive/correlated queries,
denied fields and string-synthesizing output are rejected. At most four
joins, 20 output columns and 100 rows are accepted; oversized results fail rather
than silently truncate. These are bounded analytical queries, not unrestricted
SQL access. Arbitrary prose rules are model interpreted and are not proof of
correctness; the defaults the fixture declares are enforced on every statement
(see [Declared default rules](#declared-default-rules)) and prose around them is not.

This governed SQL gate accepts view bodies over bound models, but refuses a view
that reads another view with `unsupported_source` before execution, including
when it is referenced by a larger query. The ordinary Wren engine supports
recursive view expansion; that capability does not expand this agent gate.

Decimal results retain their exact value across the runtime's JSON wire: integral
values within JavaScript's safe integer range are JSON integers; larger integers
and fractional decimals are decimal strings. Ordinary floating-point results keep
their existing JSON number representation.

The private worker may repair a rejected result shape using fixed feedback, but
no rejected SQL is executed. Use wide numeric columns for multiple metrics and
native dates instead of literal metric-name rows or formatted date strings.
Model-generated aliases and string literals do not become public column labels.
`mandatory_scope` no longer carries a date range, because the service injects none; it reports whether the project's declared defaults are enforced, and `applied_period` reports the range the statement itself set (see [What a result's evidence tells the planner](#what-a-results-evidence-tells-the-planner)).
Follow-ups must pass `reply_to`; original questions and authorized prior
results remain available to the private worker within the session.

A native Codex client can use its existing ChatGPT subscription login instead of
an OpenAI API key. Use an account-supported model and the same MCP/skill contract;
this is separate from the API-based `planner-client` example above. NVIDIA hosted
execution still requires the private model credential.
