from __future__ import annotations

import typing as t

from sqlglot import exp
from sqlglot.dialects.trino import Trino
from sqlglot.dialects.hive import Hive
from sqlglot.tokens import TokenType


def _generate_as_hive(expression: exp.Expression) -> bool:
    if isinstance(expression, exp.Create):
        if expression.kind == "TABLE":
            properties: t.Optional[exp.Properties] = expression.args.get("properties")
            if properties and properties.find(exp.ExternalProperty):
                return True  # CREATE EXTERNAL TABLE is Hive

            if not isinstance(expression.expression, exp.Select):
                return True  # any CREATE TABLE other than CREATE TABLE AS SELECT is Hive
        else:
            return expression.kind != "VIEW"  # CREATE VIEW is never Hive but CREATE SCHEMA etc is

    # https://docs.aws.amazon.com/athena/latest/ug/ddl-reference.html
    elif isinstance(expression, (exp.Alter, exp.Drop, exp.Describe)):
        if isinstance(expression, exp.Drop) and expression.kind == "VIEW":
            # DROP VIEW is Trino (I guess because CREATE VIEW is)
            return False

        # Everything else is Hive
        return True

    return False


def _location_property_sql(self: Athena.Generator, e: exp.LocationProperty):
    # If table_type='iceberg', the LocationProperty is called 'location'
    # Otherwise, it's called 'external_location'
    # ref: https://docs.aws.amazon.com/athena/latest/ug/create-table-as.html

    prop_name = "external_location"

    if isinstance(e.parent, exp.Properties):
        table_type_property = next(
            (
                p
                for p in e.parent.expressions
                if isinstance(p, exp.Property) and p.name == "table_type"
            ),
            None,
        )
        if table_type_property and table_type_property.text("value").lower() == "iceberg":
            prop_name = "location"

    return f"{prop_name}={self.sql(e, 'this')}"


class Athena(Trino):
    """
    Over the years, it looks like AWS has taken various execution engines, bolted on AWS-specific modifications and then
    built the Athena service around them.

    Thus, Athena is not simply hosted Trino, it's more like a router that routes SQL queries to an execution engine depending
    on the query type.

    As at 2024-09-10, assuming your Athena workgroup is configured to use "Athena engine version 3", the following engines exist:

    Hive:
     - Accepts mostly the same syntax as Hadoop / Hive
     - Uses backticks to quote identifiers
     - Has a distinctive DDL syntax (around things like setting table properties, storage locations etc) that is different from Trino
     - Used for *most* DDL, with some exceptions that get routed to the Trino engine instead:
        - CREATE [EXTERNAL] TABLE (without AS SELECT)
        - ALTER
        - DROP

    Trino:
      - Uses double quotes to quote identifiers
      - Used for DDL operations that involve SELECT queries, eg:
        - CREATE VIEW / DROP VIEW
        - CREATE TABLE... AS SELECT
      - Used for DML operations
        - SELECT, INSERT, UPDATE, DELETE, MERGE

    The SQLGlot Athena dialect tries to identify which engine a query would be routed to and then uses the parser / generator for that engine
    rather than trying to create a universal syntax that can handle both types.
    """

    class Tokenizer(Trino.Tokenizer):
        """
        The Tokenizer is flexible enough to tokenize queries across both the Hive and Trino engines
        """

        IDENTIFIERS = ['"', "`"]
        KEYWORDS = {
            **Hive.Tokenizer.KEYWORDS,
            **Trino.Tokenizer.KEYWORDS,
            "UNLOAD": TokenType.COMMAND,
        }

    class Parser(Trino.Parser):
        """
        Parse queries for the Athena Trino execution engine
        """

        STATEMENT_PARSERS = {
            **Trino.Parser.STATEMENT_PARSERS,
            TokenType.USING: lambda self: self._parse_as_command(self._prev),
        }

    class _HiveGenerator(Hive.Generator):
        def alter_sql(self, expression: exp.Alter) -> str:
            # package any ALTER TABLE ADD actions into a Schema object
            # so it gets generated as `ALTER TABLE .. ADD COLUMNS(...)`
            # instead of `ALTER TABLE ... ADD COLUMN` which is invalid syntax on Athena
            if isinstance(expression, exp.Alter) and expression.kind == "TABLE":
                if expression.actions and isinstance(expression.actions[0], exp.ColumnDef):
                    new_actions = exp.Schema(expressions=expression.actions)
                    expression.set("actions", [new_actions])

            return super().alter_sql(expression)

    class Generator(Trino.Generator):
        """
        Generate queries for the Athena Trino execution engine
        """

        PROPERTIES_LOCATION = {
            **Trino.Generator.PROPERTIES_LOCATION,
            exp.LocationProperty: exp.Properties.Location.POST_WITH,
        }

        TRANSFORMS = {
            **Trino.Generator.TRANSFORMS,
            exp.FileFormatProperty: lambda self, e: f"format={self.sql(e, 'this')}",
            exp.PartitionedByProperty: lambda self, e: f"partitioned_by={self.sql(e, 'this')}",
            exp.LocationProperty: _location_property_sql,
        }

        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)

            hive_kwargs = {**kwargs, "dialect": "hive"}

            self._hive_generator = Athena._HiveGenerator(*args, **hive_kwargs)

        def generate(self, expression: exp.Expression, copy: bool = True) -> str:
            if _generate_as_hive(expression):
                return self._hive_generator.generate(expression, copy)

            return super().generate(expression, copy)
