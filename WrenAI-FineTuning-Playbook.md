WrenAI Fine-Tuning & Integration Playbook — NetRay / Orders
Instance: http://10.104.74.13:3000 (self-hosted OSS) Scope: Orders/Sales domain + a separate Tariffs/Customs domain 
Important framing: WrenAI is not model fine-tuning. There is no training run. You are doing context engineering — pushing your business knowledge into three layers Wren injects into the LLM prompt at query time (via vector retrieval). Do these in order; each layer compounds on the one before it.

How to use this doc: Anything in <FILL: ...> is a placeholder your team must replace with real schema/business facts. The defaults are SyteLine-flavoured starting points — keep, edit, or delete them. Sections 4 and 5 are meant to be pasted directly into Wren's Knowledge tab.


0. Order of operations (the whole playbook in 8 steps)
Prune staging/junk tables out of the model.
Gold schema — point Wren only at clean views (best) or curated base tables.
Generate semantics (Modeling AI Assistant) → auto-fill descriptions.
Hand-correct the cryptic/ambiguous columns only.
Relationships — generate + verify join keys.
Instructions — paste Section 4 into Knowledge, edit placeholders.
Question-SQL pairs — paste Section 5, verify each runs, save.
Deploy, smoke-test, then wire the API into SyteRay (Section 6).

Everything before "Deploy" is invisible to users until you hit Deploy. Deploy re-embeds the context into the vector store — it is not optional and it is the step people forget.


1. The three context layers (what actually moves accuracy)
Layer
Where in UI
What it holds
Fixes
Semantics (MDL)
Modeling tab
Table + column descriptions, types, relationships, calculated fields
"AI doesn't know what OrdNo / col_01_Division means"
Instructions
Knowledge tab
Reusable rules: terminology, filters, formatting, join rules
"AI counts cancelled orders in revenue", "money not rounded", inconsistent metric logic
Question-SQL pairs
Knowledge tab
Gold examples pinning a question → exact SQL
Complex/error-prone recurring questions (backlog cost, YoY growth)


Rule of thumb: facts about columns → Semantics. Rules about logic → Instructions. Whole gold answers → Q-SQL pairs.


2. Phase 0 — Data hygiene (do this first, it's 80% of the win)
Your model list is mostly staging junk: xStage, xStageLoad, xStageLoad2/3/4/5, xStageLoad8, xStageLoad8_Test, xStageNewOrders. Every one is a table the AI can wrongly select — that's exactly why it was recommending questions about dbo.xStageLoad8.

2.1 Prune. In Modeling, remove every staging/load/test table from the model. Keep only business-meaningful tables.

2.2 Build a gold layer (strongly recommended). In SQL Server, create a dedicated schema of clean, analytics-friendly views and point Wren only at those:

CREATE SCHEMA gold;

GO

-- One row per order line, business-named columns, junk excluded

CREATE VIEW gold.v_orders AS

SELECT

    OrdNo              AS order_number,

    CustNo             AS customer_number,

    CustName           AS customer_name,

    CustPO             AS customer_po,

    Market             AS market,

    <FILL: Division>   AS division,

    <FILL: Segment>    AS segment,

    <FILL: Salesperson> AS salesperson,

    <FILL: Product>    AS product,

    <FILL: OrderStatus> AS order_status,

    <FILL: OrderDate>  AS order_date,

    <FILL: InvoiceDate> AS invoice_date,

    <FILL: QtyOrdered> AS qty_ordered,

    <FILL: ExtendedPrice> AS line_amount,   -- pre-summed numeric measure

    <FILL: BacklogFlag> AS is_backlog       -- boolean, see §4

FROM dbo.<FILL: real_orders_table>

WHERE <FILL: exclude test/void rows>;

Why gold views beat raw tables:

The LLM reads clean names (order_status, not col_07_stat) → fewer wrong guesses.
You bake business logic (status filters, boolean flags, fiscal columns) into SQL once, so the AI doesn't reinvent it every query.
You control exactly what's exposed — no PII, no staging tables.

2.3 Read-only DB user. Wren should connect via a wren_ro login with SELECT-only on gold (and nothing on staging). Never a write-capable account.

2.4 Split domains into separate projects. dbo.ytblTarrifsFullA (Importer_Number, HTS, Entry_Date, Legal_Entity) is customs/tariff data — a different subject from sales. Mixing it into the Orders graph makes the AI blend customs columns into sales answers. Create a separate Wren project for Tariffs. Each project stays coherent and "opinionated," which is what reduces hallucination.


3. Phase 1 — Semantics (Modeling)
3.1 Auto-generate. Modeling page → Modeling AI Assistant (top-right) → Generate semantics. This fills the model + column Description fields across all tables from the schema. Then Generate relationships.

3.2 Hand-correct only what the AI can't infer. The assistant handles obvious columns. You manually fix:

Cryptic codes: col_01_Division, FY___Would_invoice_date, status/segment codes.
Ambiguous pairs: if two columns could both be "revenue" or "date," describe each precisely and say when each is used.
Measures vs dimensions vs IDs — phrasing matters (see table below).

3.3 Description conventions (this is your data dictionary; phrasing drives behaviour):

Column role
Write the description as…
Example
Measure (sum/avg)
"Total/Amount of … used for …"
line_amount → "Extended line amount in USD; sum for sales revenue."
Dimension (group/filter)
"Category of …" / "… segment, not geography"
market → "Business unit / market segment. NOT a country or region."
Date
"Date used for … filtering"
invoice_date → "Date the order line was invoiced; default date for revenue-by-period."
ID / key
"Unique identifier for …"
customer_number → "SyteLine customer code; use COUNT(DISTINCT) for customer counts."


Table-level description example for gold.v_orders:

"One row per sales order line from SyteLine. Grain = order line. Use for sales, revenue, backlog, orders-by-market/division/salesperson analysis. Excludes voided and test orders."

3.4 Relationships. Verify the auto-detected joins and add any missed keys explicitly (e.g. v_orders.customer_number → v_customers.customer_number, many-to-one). Explicit relationships = deterministic joins; without them the AI guesses.

3.5 Deploy.


4. Phase 2 — INSTRUCTIONS (paste into Knowledge → Instructions)
Two types: Global (always applied) and Question-Matching (applied only when the question matches a topic/keyword). Add each block below as a separate instruction of the stated type. Edit every <FILL> before deploying — a wrong rule is worse than no rule.
4A. Global instructions (always on)
[GLOBAL] Currency & rounding

All monetary values are in USD. Always ROUND(value, 2) for revenue, averages,

and percentages. Format large money values with thousands separators in summaries.

[GLOBAL] Valid orders only

Exclude orders where order_status IN (<FILL: 'Void','Cancelled','Quote','Test'>)

from any sales, revenue, backlog, or count calculation, unless the user explicitly

asks about cancelled/quoted orders.

[GLOBAL] Default date field

For any sales/revenue question by time period, use invoice_date as the default

date field. For "new orders" or "orders received," use order_date instead.

[GLOBAL] Default time range

If the user gives no date range, default to the last 90 days. Always state the

range you assumed in the answer summary.

[GLOBAL] Counting entities

Headcount-style counts must use COUNT(DISTINCT ...), not COUNT(*).

Customers = COUNT(DISTINCT customer_number). Orders = COUNT(DISTINCT order_number).

[GLOBAL] Safe joins

Use LEFT JOIN when joining optional/reference tables (products, salesperson,

customer master) so order rows are never dropped when a lookup is missing.

[GLOBAL] Grain awareness

gold.v_orders is at ORDER-LINE grain. When counting or summing at the order level,

aggregate to order_number first to avoid double counting.

[GLOBAL] Fiscal calendar

Our fiscal year runs <FILL: e.g. Apr 1 – Mar 31>. "FY", "quarter", "YTD", and

"MTD" all refer to the fiscal calendar, not the calendar year. <FILL: reference

your fiscal_year / fiscal_quarter columns if present in gold views>.
4B. Terminology instructions (Global — your business dictionary as rules)
[GLOBAL] Term: "Backlog"

"Backlog" = open order lines not yet shipped/invoiced, i.e.

is_backlog = 1 (or order_status = <FILL: 'Open'/'Booked'> AND invoice_date IS NULL).

"Backlog cost" / "total cost of backlog" = SUM(line_amount) over backlog lines.

[GLOBAL] Term: "Market" vs "Division" vs "Segment"

- market   = business unit / market segment (e.g. "Honeywell BTP"). NOT geography.

- division = <FILL: internal org division definition>.

- segment  = <FILL: definition>.

When a user says "market," never map it to a country/region column.

[GLOBAL] Term: "New orders"

"New orders" = orders where order_date falls in the requested period, regardless

of invoice status. Distinct from "sales/revenue" which uses invoice_date.

[GLOBAL] Term: "Growing / declining market"

Growth = period-over-period change in SUM(line_amount) by market. Default

comparison is <FILL: YoY / QoQ>. Always show both periods and the % change.
4C. Question-Matching instructions (topic-scoped)
[MATCH: "year over year", "YoY", "vs last year", "growth"]

Compute YoY as: current-period SUM(line_amount) vs the same period one fiscal

year earlier, grouped by the requested dimension. Return both values and

ROUND(((current-prior)/NULLIF(prior,0))*100, 2) AS pct_change.

[MATCH: "salesperson", "sales rep", "who sold"]

Attribute revenue via <FILL: salesperson column>. Exclude house/unassigned

accounts (<FILL: e.g. salesperson = 'HOUSE'>) unless explicitly asked.

[MATCH: "underperforming", "underperform", "lagging"]

"Underperforming" business units = those below <FILL: target column OR the

median of line_amount across units> for the period. State the benchmark used.

[MATCH: chart / trend / over time]

For time-series, order the x-axis chronologically and use a line chart. For

"by market/division/product" rankings, use a horizontal bar chart sorted desc.

Scoping discipline: Keep Globals few and universally true. Anything that only applies to one kind of question belongs in a Question-Matching instruction, or the AI over-applies it.


5. Phase 3 — QUESTION-SQL PAIRS (paste into Knowledge → Question-SQL Pairs)
These are drawn from the real questions already in your thread panel. Each SQL below is a template — replace <FILL> columns to match your gold views, run it in Wren once, confirm the result, then Save. A pair with wrong SQL trains the AI wrongly, so verify before saving.

Q1 — "Show total sales by market"

SELECT market,

       ROUND(SUM(line_amount), 2) AS total_sales

FROM gold.v_orders

WHERE order_status NOT IN (<FILL: 'Void','Cancelled'>)

GROUP BY market

ORDER BY total_sales DESC;

Q2 — "Which division has the highest sales?"

SELECT TOP 1 division,

       ROUND(SUM(line_amount), 2) AS total_sales

FROM gold.v_orders

WHERE order_status NOT IN (<FILL: 'Void','Cancelled'>)

GROUP BY division

ORDER BY total_sales DESC;

Q3 — "What is the total cost of all backlog?"

SELECT ROUND(SUM(line_amount), 2) AS backlog_value

FROM gold.v_orders

WHERE is_backlog = 1;

Q4 — "Break down month-to-date new orders"

SELECT market,

       COUNT(DISTINCT order_number) AS new_orders,

       ROUND(SUM(line_amount), 2)   AS order_value

FROM gold.v_orders

WHERE order_date >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)

  AND order_date <  DATEADD(DAY, 1, CAST(GETDATE() AS date))

GROUP BY market

ORDER BY order_value DESC;

Q5 — "Which markets are growing (YoY)?"

WITH cur AS (

  SELECT market, SUM(line_amount) AS amt

  FROM gold.v_orders

  WHERE invoice_date >= <FILL: current period start>

    AND invoice_date <  <FILL: current period end>

  GROUP BY market),

prior AS (

  SELECT market, SUM(line_amount) AS amt

  FROM gold.v_orders

  WHERE invoice_date >= <FILL: same period last year start>

    AND invoice_date <  <FILL: same period last year end>

  GROUP BY market)

SELECT c.market,

       ROUND(c.amt,2)  AS current_sales,

       ROUND(p.amt,2)  AS prior_sales,

       ROUND(((c.amt - p.amt)/NULLIF(p.amt,0))*100, 2) AS pct_change

FROM cur c LEFT JOIN prior p ON c.market = p.market

ORDER BY pct_change DESC;

Q6 — "Show new orders by CustName"

SELECT customer_name,

       COUNT(DISTINCT order_number) AS orders,

       ROUND(SUM(line_amount), 2)   AS order_value

FROM gold.v_orders

WHERE order_date >= <FILL: period start>

GROUP BY customer_name

ORDER BY order_value DESC;

Q7 — "Which salesperson generated the most revenue?"

SELECT TOP 10 salesperson,

       ROUND(SUM(line_amount), 2) AS revenue

FROM gold.v_orders

WHERE order_status NOT IN (<FILL: 'Void','Cancelled'>)

  AND salesperson <> <FILL: 'HOUSE'>

GROUP BY salesperson

ORDER BY revenue DESC;

Add 3–5 more from your panel ("Which products contributed most," "Which business units are underperforming," "Which customers increased sales") the same way once the gold views are final.


6. Phase 4 — Integration (wiring Wren into SyteRay / your stack)
6.1 Get an API key
Wren UI → API tab → generate a key. All REST calls use header Authorization: Bearer <KEY>. Base URL (self-hosted): http://10.104.74.21:3000/api/v1

Tier note: the REST Embedded AI API (generate_sql, generate_chart, streaming) is a governed/Agentic feature. If your OSS build's API tab exposes keys and these endpoints, use them (below). If not, the always-available OSS path is the GraphQL createAskingTask mutation (6.4). Check your API tab first.
6.2 Core REST endpoints
Generate SQL from a question:

curl -X POST 'http://10.104.74.21:3000/api/v1/generate_sql' \

  -H 'Authorization: Bearer <KEY>' \

  -H 'Content-Type: application/json' \

  -d '{ "projectId": <FILL: id>, "question": "Show total sales by market" }'

# → { "sql": "SELECT ...", "threadId": "..." }

Other endpoints under the same base:

POST /generate_chart — returns a Vega-Lite chart spec from a result set.
Streaming (SSE) — real-time token/step feedback for a chat UX.
Metadata introspection — list deployed models, columns, relationships, views (useful to render a schema picker in SyteRay).
Knowledge — read/manage instructions & Q-SQL pairs programmatically (supported tiers).

Note: there are no webhooks — the client long-polls or uses SSE for async results.
6.3 Recommended SyteRay integration pattern
User asks a question in your UI.
SyteRay → generate_sql → gets governed SQL (which already respects your instructions + semantics).
Execute against the gold schema with the read-only user (either let Wren run it, or run it yourself for tighter control).
Optionally generate_chart for the visual.
Log threadId for audit; feed thumbs-up answers back as new Q-SQL pairs (closes the learning loop).

This fits SyteRay cleanly: Wren becomes the text-to-SQL + governance layer; your policy engine / RBAC / audit trail wrap around it. Keep Wren's DB user scoped to gold so no agent can touch raw ERP tables.
6.4 OSS fallback (GraphQL asking task)
If REST embedded endpoints aren't in your build: submit questions via the createAskingTask GraphQL mutation and poll the task/thread for the answer. (Inspect the browser Network tab on the Home "Ask" flow to see the exact mutation shape your version uses.)
6.5 MCP (optional, for agent access)
Wren exposes a Model Context Protocol interface so agents (e.g. Claude, ChatGPT) query through your semantic layer instead of raw tables. On self-hosted, this runs via the Wren engine's MCP server. Useful if you want SyteRay's own agents to consult Wren as a governed data tool.
6.6 LLM configuration (self-hosted, LLM-agnostic)
Wren is LLM-agnostic. To keep ERP data on-prem, point it at a local model via LiteLLM/Ollama in ~/.wrenai/config.yaml:

type: llm

provider: litellm_llm

models:

  - api_base: http://host.docker.internal:11434/v1

    model: ollama_chat/<FILL: llama3.1:70b-instruct or your model>

    timeout: 600

    kwargs:

      n: 1

      temperature: 0

temperature: 0 for deterministic SQL. For accuracy, prefer a strong model (GPT-4o / o-series or a 70B-class local model); small models produce shakier SQL on messy ERP schemas.


7. Phase 5 — Maintenance loop (keep it accurate)
Schema change detection. Wren flags when tables/columns are added, renamed, removed, or retyped. Review after every ERP/gold-view change — renamed columns silently break Q-SQL pairs.
Smoke test. Keep a fixed list of your top ~10 questions. Re-run after any Deploy. If one regresses, fix the layer responsible (semantics vs instruction vs pair) — don't patch prompts ad hoc.
Feedback loop. Each week: take real user questions → if the SQL was right, Save as a Q-SQL pair; if it was almost right, add/refine an Instruction; if it picked the wrong table/column, fix the Semantic description. This is the "training set without training."
Version control. In newer Wren, this context lives in Git-friendly instructions.md + queries.yml. Even on your build, keep this document in Git as the source of truth and re-apply on rebuilds.


8. Rollout to the team
Owners

__ owns Semantics (Modeling + gold views).
__ owns Instructions + Q-SQL pairs (Knowledge).
Weekly 30-min review: smoke test + feedback-loop triage.

Guidance for people asking questions

Use business terms from the dictionary ("backlog," "market," "new orders") — they're now defined for the AI.
Always read the generated SQL before trusting a number. Wrong-but-confident is the failure mode.
If an answer is wrong, don't just rephrase — report it so an owner fixes the underlying layer.
Sales questions → Orders project. Customs/HTS questions → Tariffs project. Don't cross them.


Appendix A — Data dictionary CSV template
Fill one row per exposed column; use it to drive/QA the Modeling descriptions.

model,column,display_name,description,role,notes

v_orders,order_number,Order Number,"SyteLine sales order number",id,"COUNT(DISTINCT) for order counts"

v_orders,customer_number,Customer Number,"SyteLine customer code",id,"FK to v_customers"

v_orders,market,Market,"Business unit / market segment; NOT geography",dimension,""

v_orders,line_amount,Line Amount,"Extended line amount USD; sum for revenue",measure,""

v_orders,invoice_date,Invoice Date,"Date invoiced; default date for revenue-by-period",date,""

v_orders,order_date,Order Date,"Date order received; use for new orders",date,""

v_orders,is_backlog,Is Backlog,"1 = open unshipped line",dimension,"boolean flag"
Appendix B — Instruction scoping cheat-sheet
Universally true, every query → Global.
True only for one topic/keyword → Question-Matching.
A whole correct answer to a recurring question → Question-SQL pair.
A fact about what a column is → Semantic description, not an instruction.


