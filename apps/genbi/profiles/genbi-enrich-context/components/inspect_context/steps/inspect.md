Inspect the already bound project without changing it.

- Read the current MDL, cube names and definitions, business rules, NL-to-SQL pairs, and available
  raw material. Do not read or expose credential values, and do not put raw excerpts in the output.
- Classify gaps as structural coverage, raw-vs-current claim difference, or inference. Emit only
  opaque evidence ids/locators, confidence, the proposed sink, and whether a conflict or ambiguous
  sink exists.
- In grill mode, live database probes are allowed only after the host records the user's one-time
  consent; in autopilot they are forbidden. Probe results remain local to the executor.
- Do not write files, create a gaps/state artifact, invoke validation/build, or make a decision.

Produce `enrichment_gaps` as the input to the strong drafting step. It is an inventory, not a
proposal and not authorization to apply a change.
