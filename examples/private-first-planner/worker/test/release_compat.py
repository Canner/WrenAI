"""Exercise the installed release's SQL scope walker, without a model or DB."""

import unittest

import sqlglot
from sqlglot.optimizer.scope import traverse_scope
from wren.read_only import consumed_scopes


class ReleaseCompatibility(unittest.TestCase):
    def test_aggregate_scope(self):
        tree = sqlglot.parse_one(
            "SELECT SUM(amount) FROM orders WHERE order_date >= '2026-01-01'",
            read="duckdb",
        )
        scopes = consumed_scopes(list(traverse_scope(tree)))
        self.assertEqual(len(scopes), 1)
        self.assertEqual(scopes[0].expression, tree)

    def test_union_keeps_both_reads(self):
        tree = sqlglot.parse_one(
            "SELECT amount FROM orders UNION ALL SELECT amount FROM invoices",
            read="duckdb",
        )
        scopes = consumed_scopes(list(traverse_scope(tree)))
        names = {name for scope in scopes for name in scope.sources}
        self.assertTrue({"orders", "invoices"}.issubset(names))


if __name__ == "__main__":
    unittest.main()
