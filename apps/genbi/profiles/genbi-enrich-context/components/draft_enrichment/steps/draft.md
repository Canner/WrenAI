Turn the read-only gap inventory into concrete, minimal, append-only proposals. Do not apply them.

- Treat the pinned project revision as input, not something to infer. Return canonicalizable draft
  material and evidence locators, but do not invent or claim authoritative proposal hashes or content
  digests. The host validates the sink and revision, canonicalizes the payload, and computes both.
- Each proposed operation has exactly one allowed relative sink. Existing text, MDL fields, cubes,
  and relationships are never overwritten.
- A cube proposal must target `cubes/<name>/metadata.yml` and use Wren's cube schema: `name`,
  `base_object`, `measures`, optional `dimensions` / `time_dimensions`, and `properties`. Measures and
  dimensions may reference only columns that actually exist on the chosen base object. Never invent
  columns, use model-MDL keys such as `columns` / `metrics` / `relationships`, or hide a required join
  inside a cube expression. If one append-only operation cannot implement the gap, emit a paused
  decision explaining the missing prerequisite instead of fabricating a payload.
- For a cube, put the file body in `recommended_yaml` and follow this exact field grammar:
  `measures: [{name, expression, type}]`, `dimensions: [{name, expression, type}]`, and
  `time_dimensions: [{name, expression, type}]`. Use SQL aggregate expressions such as
  `SUM(units_on_hand)` and Wren scalar types such as `BIGINT`, `INTEGER`, and `DATE`. Do not emit
  `sql`, `model`, `columns`, `metrics`, or aggregation names such as `type: sum`.
- Grill mode emits one decision request at a time with a concrete recommended draft and accepts only
  accept, edit, or skip for that operation. Skip is final for this run.
- Autopilot may mark only append-only low-risk model/column descriptions, knowledge rules, and
  NL-to-SQL pairs as eligible to apply. It must pause for raw-vs-current conflicts, ambiguous sink
  selection, and every new cube, view, relationship, MDL metric, or calculated column.
- Mark all inference and partial-raw evidence with confidence. Do not include raw text, credentials,
  local paths, provider-session ids, or SDK internals in the host-facing proposal.
- A new cube is high impact, always requires approval, and is never autopilot-eligible.

Produce `enrichment_proposal`; approval, canonical hashes/digests, and application are deterministic
host responsibilities. Your FINAL message must be one JSON object only. Do not include prose or
Markdown fences. The top level is `{ "enrichment_proposal": { ... } }`; for Grill it contains the
supplied `project_revision`, exactly one operation with `relative_sink` and `recommended_yaml`,
confidence/evidence locators, `impact: "high"`, `requires_approval: true`,
`autopilot_eligible: false`, and one decision whose allowed responses are exactly
`["accept", "edit", "skip"]`.
