# Warble-authored planner and dashboard design

`profile/` is the behavior source of truth. It mounts three single-step components:

- `resolve_intent` owns the intent extraction instructions and examples. The host
  binds Nemotron, the `resolve_intent` output tool, and the existing user-quote parser.
- `design_dashboard` owns the layout instructions shared by both designers. The
  host binds Nemotron or Claude according to the existing P4 route, with the same
  DashboardSpec schema. The private adapter adds its existing tool-return instruction.

- `design_free_dashboard` owns the P5 free frontend instructions. Both designers
  receive the same code contract and authorized aggregate payload; see `../p5/README.md`.

The tier is a capability requirement, not a trust zone or provider selector.
The host still owns conversations, clarification/resumption, model bindings,
route selection, authorization, recipient/expiry checks, evidence revalidation,
request isolation, budgets, cancellation, schema validation and rendering.
The Wren data worker continues using the separate `p1/profile` unchanged.
Structured-output tools are host protocols, not database tools granted by these components.

## Compile and run

Use Node 22.23.3 for parity with the benchmark and Warble 0.21.1:

```sh
npm install --global @warble/cli@0.21.1
node behaviors/compile.mjs
node behaviors/compile.mjs --check
node --test p4/test/*.test.mjs
node p4/run.mjs /absolute/path/to/config.json /absolute/path/to/new-run
```

Run these commands from `examples/private-first-planner`. Set `WARBLE_BIN` to an
existing pinned executable to avoid installing a compiler. Regenerate and review
both files under `compiled/` after editing the profile. They contain compiler output,
not a second hand-maintained prompt. The manifest records source and IR hashes;
it detects stale local artifacts, not malicious edits by an authorized repository author.
CI recompiles with the pinned compiler and rejects drift.

At process startup the host verifies the source/IR hashes and admits only this
profile's supported IR 0.9 shape. It consumes each step's compiled prompt; it does
not read Markdown as a fallback. Unsupported tools, guards, multi-step execution,
context bindings or effects fail explicitly. It executes neither Warble's static
prompt fragment headings nor an arbitrary workflow. Generated fingerprints are
included in P4 reports and the normal source snapshot.

This is a consumer adapter for Warble-authored behavior, **not** a new general
Warble dispatcher or private-root-to-cloud runtime implementation. A profile
instruction cannot authorize a cloud request. The original broker remains the
enforcement boundary, including reauthorization on every Claude HTTP attempt.

## Verification

The offline P4 tests run all eight scheduled cases through the compiled planner
and existing session, routing, export, design and rendering code with fake models.
Golden fingerprints compare the actual model-facing prompts and tool schemas to
the pre-extraction contract. A real fake CLI subprocess checks Claude arguments;
existing gateway tests check authorization, extra context/tools and retry limits.
Additional tests reject unsupported IR and stale source/generated artifacts.

These tests establish input/contract parity. Live model outputs need not be
identical even at temperature zero; use the same preregistered P4 matrix and retain
every failure when assessing behavioral parity.
