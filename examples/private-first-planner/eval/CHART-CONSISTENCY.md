# Chart consistency evaluation

This change preserves free HTML/CSS/JavaScript generation and the approved aggregate boundary.
Design and repair components accept CSS bars, SVG and canvas; the host observes the actual
rendered chart. See host/VALIDATION.md for the versioned, bounded recognition contract.

Run the existing offline and browser suites. Browser tests cover direct SVG markers,
CSS bars, accessible recovery, painted canvas, empty/text-only/hidden SVG, hidden ancestors,
blank/solid canvas, hidden CSS, labels without marks and unrelated decoration at both widths.
Host browser tests prove a missing chart sends only chart_rendering and allows one repair;
a recovered CSS chart surfaces its marker warning and uses no repair. Wrong numbers,
changed-data errors, network requests and CSP failures still block.

Use host/revalidate.mjs with a preserved live report and a new output directory to replay
all candidates. Record original and new decisions; do not overwrite history or count replay
as new live delivery. This validates saved generated programs, not future model adherence.
No new cloud-generation latency, token cost or saved money can be claimed from replay.
Chart presence is not certification of truthful geometric encoding or general accessibility.
