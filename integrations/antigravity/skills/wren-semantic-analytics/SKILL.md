---
name: wren-semantic-analytics
description: Answer data questions through the Wren MCP server (semantic layer, business rules, knowledge). Use for any question about metrics, trends, comparisons or breakdowns that needs numbers from the connected Wren project.
---

# Wren semantic analytics

1. Call `get_instructions` first and follow every rule it returns. These are
   the organization's definitions, thresholds and report format; they win over
   general habits.
2. Find the right objects with `list_models`, `describe_model`, `list_cubes`
   and `describe_cube`. Check `list_knowledge` and `recall_queries` for curated
   examples before writing new SQL.
3. Query only through `run_sql` or `query_cube`. Never read raw files or the
   database directly.
4. Prefer cube measures for rates; never average rates.
5. In the answer, give the sample size and date window behind every number,
   and say "not enough data" when a sample is below the rules' minimum.
6. When a chart or visual table would help, call `show_html` with the final
   SQL and an HTML fragment you design (SVG, canvas or DOM with inline
   `<script>`). Read the rows from `window.wren.rows` at run time instead of
   copying numbers into the HTML, and label axes and units. External scripts
   and network requests are blocked. The view renders inline; keep the text
   answer short and refer to it.
