# Mobile label tuning

The free dashboard and repair Warble components retain full HTML/CSS/JavaScript
layout and chart generation. Their instructions now distinguish CSS/SVG units
from actual screen pixels, target 14px core values/full dates at 390px width,
and ask for initially visible value/date pairing. HTML labels or responsive SVG
are choices, not a host renderer or mandatory layout. The source table remains
supplementary. Output budgets, model bindings and disclosure boundaries are not
changed by these instructions.

The existing delivery policy is unchanged: small text and contrast uncertainty
remain quality warnings. `p5/readability.mjs` adds advisory observations for the
seven semantic value/week labels: presence, computed font size (including SVG
viewBox scale), horizontal text bounds, and a 14px target. This is separate from
the existing 12px all-text warning and from strict contrast/readability results.
It is not a general accessibility or visual-quality certification; arbitrary CSS
transforms, canvas text, subtle overlap and glyph legibility need visual review.

Compare old/new artifacts with the same observer at 1280×900 and 390×844. Preserve
original QA; reinspection is supplemental evidence written to a new directory.
Report initial candidates and actual final deliveries separately, including
rejected/missing artifacts and repair calls. Label-size improvements do not erase
contrast uncertainty or a data-verification failure.

Use the existing four-case, two-repeat, three-route host benchmark unchanged.
Private-only produces an inert table, not a Nemotron-designed dashboard. The
worker evidence validation from the preceding change remains active, so this is
an operational historical comparison, not a clean causal A/B test of a prompt.
Keep models, payloads, budgets and order fixed; never replace a failure or edit
the source mid-cohort. Report private-stage, generation, QA and end-to-end timing
separately; private costs remain unknown without authoritative usage pricing.
