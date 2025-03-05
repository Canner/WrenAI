from __future__ import annotations

import typing as t

from sqlglot import exp
from sqlglot.dialects.dialect import (
    approx_count_distinct_sql,
    arrow_json_extract_sql,
    build_timestamp_trunc,
    rename_func,
    unit_to_str,
    inline_array_sql,
    property_sql,
)
from sqlglot.dialects.mysql import MySQL
from sqlglot.helper import seq_get


class StarRocks(MySQL):
    STRICT_JSON_PATH_SYNTAX = False

    class Parser(MySQL.Parser):
        FUNCTIONS = {
            **MySQL.Parser.FUNCTIONS,
            "DATE_TRUNC": build_timestamp_trunc,
            "DATEDIFF": lambda args: exp.DateDiff(
                this=seq_get(args, 0), expression=seq_get(args, 1), unit=exp.Literal.string("DAY")
            ),
            "DATE_DIFF": lambda args: exp.DateDiff(
                this=seq_get(args, 1), expression=seq_get(args, 2), unit=seq_get(args, 0)
            ),
            "REGEXP": exp.RegexpLike.from_arg_list,
        }

        PROPERTY_PARSERS = {
            **MySQL.Parser.PROPERTY_PARSERS,
            "PROPERTIES": lambda self: self._parse_wrapped_properties(),
        }

        def _parse_create(self) -> exp.Create | exp.Command:
            create = super()._parse_create()

            # Starrocks' primary key is defined outside of the schema, so we need to move it there
            # https://docs.starrocks.io/docs/table_design/table_types/primary_key_table/#usage
            if isinstance(create, exp.Create) and isinstance(create.this, exp.Schema):
                props = create.args.get("properties")
                if props:
                    primary_key = props.find(exp.PrimaryKey)
                    if primary_key:
                        create.this.append("expressions", primary_key.pop())

            return create

        def _parse_unnest(self, with_alias: bool = True) -> t.Optional[exp.Unnest]:
            unnest = super()._parse_unnest(with_alias=with_alias)

            if unnest:
                alias = unnest.args.get("alias")

                if not alias:
                    # Starrocks defaults to naming the table alias as "unnest"
                    alias = exp.TableAlias(
                        this=exp.to_identifier("unnest"), columns=[exp.to_identifier("unnest")]
                    )
                    unnest.set("alias", alias)
                elif not alias.args.get("columns"):
                    # Starrocks defaults to naming the UNNEST column as "unnest"
                    # if it's not otherwise specified
                    alias.set("columns", [exp.to_identifier("unnest")])

            return unnest

    class Generator(MySQL.Generator):
        EXCEPT_INTERSECT_SUPPORT_ALL_CLAUSE = False
        JSON_TYPE_REQUIRED_FOR_EXTRACTION = False
        VARCHAR_REQUIRES_SIZE = False
        PARSE_JSON_NAME: t.Optional[str] = "PARSE_JSON"
        WITH_PROPERTIES_PREFIX = "PROPERTIES"

        CAST_MAPPING = {}

        TYPE_MAPPING = {
            **MySQL.Generator.TYPE_MAPPING,
            exp.DataType.Type.TEXT: "STRING",
            exp.DataType.Type.TIMESTAMP: "DATETIME",
            exp.DataType.Type.TIMESTAMPTZ: "DATETIME",
        }

        PROPERTIES_LOCATION = {
            **MySQL.Generator.PROPERTIES_LOCATION,
            exp.PrimaryKey: exp.Properties.Location.POST_SCHEMA,
        }

        TRANSFORMS = {
            **MySQL.Generator.TRANSFORMS,
            exp.Array: inline_array_sql,
            exp.ApproxDistinct: approx_count_distinct_sql,
            exp.DateDiff: lambda self, e: self.func(
                "DATE_DIFF", unit_to_str(e), e.this, e.expression
            ),
            exp.JSONExtractScalar: arrow_json_extract_sql,
            exp.JSONExtract: arrow_json_extract_sql,
            exp.Property: property_sql,
            exp.RegexpLike: rename_func("REGEXP"),
            exp.StrToUnix: lambda self, e: self.func("UNIX_TIMESTAMP", e.this, self.format_time(e)),
            exp.TimestampTrunc: lambda self, e: self.func("DATE_TRUNC", unit_to_str(e), e.this),
            exp.TimeStrToDate: rename_func("TO_DATE"),
            exp.UnixToStr: lambda self, e: self.func("FROM_UNIXTIME", e.this, self.format_time(e)),
            exp.UnixToTime: rename_func("FROM_UNIXTIME"),
            exp.ArrayFilter: rename_func("ARRAY_FILTER"),
        }

        TRANSFORMS.pop(exp.DateTrunc)

        # https://docs.starrocks.io/docs/sql-reference/sql-statements/keywords/#reserved-keywords
        RESERVED_KEYWORDS = {
            "add",
            "all",
            "alter",
            "analyze",
            "and",
            "array",
            "as",
            "asc",
            "between",
            "bigint",
            "bitmap",
            "both",
            "by",
            "case",
            "char",
            "character",
            "check",
            "collate",
            "column",
            "compaction",
            "convert",
            "create",
            "cross",
            "cube",
            "current_date",
            "current_role",
            "current_time",
            "current_timestamp",
            "current_user",
            "database",
            "databases",
            "decimal",
            "decimalv2",
            "decimal32",
            "decimal64",
            "decimal128",
            "default",
            "deferred",
            "delete",
            "dense_rank",
            "desc",
            "describe",
            "distinct",
            "double",
            "drop",
            "dual",
            "else",
            "except",
            "exists",
            "explain",
            "false",
            "first_value",
            "float",
            "for",
            "force",
            "from",
            "full",
            "function",
            "grant",
            "group",
            "grouping",
            "grouping_id",
            "groups",
            "having",
            "hll",
            "host",
            "if",
            "ignore",
            "immediate",
            "in",
            "index",
            "infile",
            "inner",
            "insert",
            "int",
            "integer",
            "intersect",
            "into",
            "is",
            "join",
            "json",
            "key",
            "keys",
            "kill",
            "lag",
            "largeint",
            "last_value",
            "lateral",
            "lead",
            "left",
            "like",
            "limit",
            "load",
            "localtime",
            "localtimestamp",
            "maxvalue",
            "minus",
            "mod",
            "not",
            "ntile",
            "null",
            "on",
            "or",
            "order",
            "outer",
            "outfile",
            "over",
            "partition",
            "percentile",
            "primary",
            "procedure",
            "qualify",
            "range",
            "rank",
            "read",
            "regexp",
            "release",
            "rename",
            "replace",
            "revoke",
            "right",
            "rlike",
            "row",
            "row_number",
            "rows",
            "schema",
            "schemas",
            "select",
            "set",
            "set_var",
            "show",
            "smallint",
            "system",
            "table",
            "terminated",
            "text",
            "then",
            "tinyint",
            "to",
            "true",
            "union",
            "unique",
            "unsigned",
            "update",
            "use",
            "using",
            "values",
            "varchar",
            "when",
            "where",
            "with",
        }

        def create_sql(self, expression: exp.Create) -> str:
            # Starrocks' primary key is defined outside of the schema, so we need to move it there
            schema = expression.this
            if isinstance(schema, exp.Schema):
                primary_key = schema.find(exp.PrimaryKey)

                if primary_key:
                    props = expression.args.get("properties")

                    if not props:
                        props = exp.Properties(expressions=[])
                        expression.set("properties", props)

                    # Verify if the first one is an engine property. Is true then insert it after the engine,
                    # otherwise insert it at the beginning
                    engine = props.find(exp.EngineProperty)
                    engine_index = (engine.index or 0) if engine else -1
                    props.set("expressions", primary_key.pop(), engine_index + 1, overwrite=False)

            return super().create_sql(expression)
