---
nl: What is the total revenue across all orders?
sql: |
  SELECT SUM(amount) AS total_revenue FROM orders
source: user
tags:
  - revenue
---
