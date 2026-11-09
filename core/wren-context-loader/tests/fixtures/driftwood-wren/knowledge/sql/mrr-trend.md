---
nl: Monthly MRR trend from month-end snapshots
sql: SELECT snapshot_date, mrr FROM mrr_metrics GROUP BY snapshot_date ORDER BY snapshot_date
source: user
tags:
- source:enrich
---
