# ruff: noqa: F401
"""
## Dialects

While there is a SQL standard, most SQL engines support a variation of that standard. This makes it difficult
to write portable SQL code. SQLGlot bridges all the different variations, called "dialects", with an extensible
SQL transpilation framework.

The base `sqlglot.dialects.dialect.Dialect` class implements a generic dialect that aims to be as universal as possible.

Each SQL variation has its own `Dialect` subclass, extending the corresponding `Tokenizer`, `Parser` and `Generator`
classes as needed.

### Implementing a custom Dialect

Creating a new SQL dialect may seem complicated at first, but it is actually quite simple in SQLGlot:

```python
from sqlglot import exp
from sqlglot.dialects.dialect import Dialect
from sqlglot.generator import Generator
from sqlglot.tokens import Tokenizer, TokenType


class Custom(Dialect):
    class Tokenizer(Tokenizer):
        QUOTES = ["'", '"']  # Strings can be delimited by either single or double quotes
        IDENTIFIERS = ["`"]  # Identifiers can be delimited by backticks

        # Associates certain meaningful words with tokens that capture their intent
        KEYWORDS = {
            **Tokenizer.KEYWORDS,
            "INT64": TokenType.BIGINT,
            "FLOAT64": TokenType.DOUBLE,
        }

    class Generator(Generator):
        # Specifies how AST nodes, i.e. subclasses of exp.Expression, should be converted into SQL
        TRANSFORMS = {
            exp.Array: lambda self, e: f"[{self.expressions(e)}]",
        }

        # Specifies how AST nodes representing data types should be converted into SQL
        TYPE_MAPPING = {
            exp.DataType.Type.TINYINT: "INT64",
            exp.DataType.Type.SMALLINT: "INT64",
            exp.DataType.Type.INT: "INT64",
            exp.DataType.Type.BIGINT: "INT64",
            exp.DataType.Type.DECIMAL: "NUMERIC",
            exp.DataType.Type.FLOAT: "FLOAT64",
            exp.DataType.Type.DOUBLE: "FLOAT64",
            exp.DataType.Type.BOOLEAN: "BOOL",
            exp.DataType.Type.TEXT: "STRING",
        }
```

The above example demonstrates how certain parts of the base `Dialect` class can be overridden to match a different
specification. Even though it is a fairly realistic starting point, we strongly encourage the reader to study existing
dialect implementations in order to understand how their various components can be modified, depending on the use-case.

----
"""

from sqlglot.dialects.athena import Athena
from sqlglot.dialects.bigquery import BigQuery
from sqlglot.dialects.clickhouse import ClickHouse
from sqlglot.dialects.databricks import Databricks
from sqlglot.dialects.dialect import Dialect, Dialects
from sqlglot.dialects.doris import Doris
from sqlglot.dialects.drill import Drill
from sqlglot.dialects.duckdb import DuckDB
from sqlglot.dialects.hive import Hive
from sqlglot.dialects.materialize import Materialize
from sqlglot.dialects.mysql import MySQL
from sqlglot.dialects.oracle import Oracle
from sqlglot.dialects.postgres import Postgres
from sqlglot.dialects.presto import Presto
from sqlglot.dialects.prql import PRQL
from sqlglot.dialects.redshift import Redshift
from sqlglot.dialects.risingwave import RisingWave
from sqlglot.dialects.snowflake import Snowflake
from sqlglot.dialects.spark import Spark
from sqlglot.dialects.spark2 import Spark2
from sqlglot.dialects.sqlite import SQLite
from sqlglot.dialects.starrocks import StarRocks
from sqlglot.dialects.tableau import Tableau
from sqlglot.dialects.teradata import Teradata
from sqlglot.dialects.trino import Trino
from sqlglot.dialects.tsql import TSQL
