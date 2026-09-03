---
nl: Order count by status on the new platform
sql: SELECT status, COUNT(*) AS order_count FROM orders GROUP BY status
source: user
tags:
- source:enrich
---
