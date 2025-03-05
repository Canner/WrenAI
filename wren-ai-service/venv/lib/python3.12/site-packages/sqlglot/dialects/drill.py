from __future__ import annotations


from sqlglot import exp, generator, parser, tokens, transforms
from sqlglot.dialects.dialect import (
    Dialect,
    datestrtodate_sql,
    build_formatted_time,
    no_trycast_sql,
    rename_func,
    str_position_sql,
    timestrtotime_sql,
)
from sqlglot.dialects.mysql import date_add_sql
from sqlglot.transforms import preprocess, move_schema_columns_to_partitioned_by
from sqlglot.generator import unsupported_args


def _str_to_date(self: Drill.Generator, expression: exp.StrToDate) -> str:
    this = self.sql(expression, "this")
    time_format = self.format_time(expression)
    if time_format == Drill.DATE_FORMAT:
        return self.sql(exp.cast(this, exp.DataType.Type.DATE))
    return self.func("TO_DATE", this, time_format)


class Drill(Dialect):
    NORMALIZE_FUNCTIONS: bool | str = False
    PRESERVE_ORIGINAL_NAMES = True
    NULL_ORDERING = "nulls_are_last"
    DATE_FORMAT = "'yyyy-MM-dd'"
    DATEINT_FORMAT = "'yyyyMMdd'"
    TIME_FORMAT = "'yyyy-MM-dd HH:mm:ss'"
    SUPPORTS_USER_DEFINED_TYPES = False
    SUPPORTS_SEMI_ANTI_JOIN = False
    TYPED_DIVISION = True
    CONCAT_COALESCE = True

    TIME_MAPPING = {
        "y": "%Y",
        "Y": "%Y",
        "YYYY": "%Y",
        "yyyy": "%Y",
        "YY": "%y",
        "yy": "%y",
        "MMMM": "%B",
        "MMM": "%b",
        "MM": "%m",
        "M": "%-m",
        "dd": "%d",
        "d": "%-d",
        "HH": "%H",
        "H": "%-H",
        "hh": "%I",
        "h": "%-I",
        "mm": "%M",
        "m": "%-M",
        "ss": "%S",
        "s": "%-S",
        "SSSSSS": "%f",
        "a": "%p",
        "DD": "%j",
        "D": "%-j",
        "E": "%a",
        "EE": "%a",
        "EEE": "%a",
        "EEEE": "%A",
        "''T''": "T",
    }

    class Tokenizer(tokens.Tokenizer):
        IDENTIFIERS = ["`"]
        STRING_ESCAPES = ["\\"]

        KEYWORDS = tokens.Tokenizer.KEYWORDS.copy()
        KEYWORDS.pop("/*+")

    class Parser(parser.Parser):
        STRICT_CAST = False

        FUNCTIONS = {
            **parser.Parser.FUNCTIONS,
            "REPEATED_COUNT": exp.ArraySize.from_arg_list,
            "TO_TIMESTAMP": exp.TimeStrToTime.from_arg_list,
            "TO_CHAR": build_formatted_time(exp.TimeToStr, "drill"),
            "LEVENSHTEIN_DISTANCE": exp.Levenshtein.from_arg_list,
        }

        LOG_DEFAULTS_TO_LN = True

    class Generator(generator.Generator):
        JOIN_HINTS = False
        TABLE_HINTS = False
        QUERY_HINTS = False
        NVL2_SUPPORTED = False
        LAST_DAY_SUPPORTS_DATE_PART = False
        SUPPORTS_CREATE_TABLE_LIKE = False
        ARRAY_SIZE_NAME = "REPEATED_COUNT"

        TYPE_MAPPING = {
            **generator.Generator.TYPE_MAPPING,
            exp.DataType.Type.INT: "INTEGER",
            exp.DataType.Type.SMALLINT: "INTEGER",
            exp.DataType.Type.TINYINT: "INTEGER",
            exp.DataType.Type.BINARY: "VARBINARY",
            exp.DataType.Type.TEXT: "VARCHAR",
            exp.DataType.Type.NCHAR: "VARCHAR",
            exp.DataType.Type.TIMESTAMPLTZ: "TIMESTAMP",
            exp.DataType.Type.TIMESTAMPTZ: "TIMESTAMP",
            exp.DataType.Type.DATETIME: "TIMESTAMP",
        }

        PROPERTIES_LOCATION = {
            **generator.Generator.PROPERTIES_LOCATION,
            exp.PartitionedByProperty: exp.Properties.Location.POST_SCHEMA,
            exp.VolatileProperty: exp.Properties.Location.UNSUPPORTED,
        }

        TRANSFORMS = {
            **generator.Generator.TRANSFORMS,
            exp.CurrentTimestamp: lambda *_: "CURRENT_TIMESTAMP",
            exp.ArrayContains: rename_func("REPEATED_CONTAINS"),
            exp.Create: preprocess([move_schema_columns_to_partitioned_by]),
            exp.DateAdd: date_add_sql("ADD"),
            exp.DateStrToDate: datestrtodate_sql,
            exp.DateSub: date_add_sql("SUB"),
            exp.DateToDi: lambda self,
            e: f"CAST(TO_DATE({self.sql(e, 'this')}, {Drill.DATEINT_FORMAT}) AS INT)",
            exp.DiToDate: lambda self,
            e: f"TO_DATE(CAST({self.sql(e, 'this')} AS VARCHAR), {Drill.DATEINT_FORMAT})",
            exp.If: lambda self,
            e: f"`IF`({self.format_args(e.this, e.args.get('true'), e.args.get('false'))})",
            exp.ILike: lambda self, e: self.binary(e, "`ILIKE`"),
            exp.Levenshtein: unsupported_args("ins_cost", "del_cost", "sub_cost", "max_dist")(
                rename_func("LEVENSHTEIN_DISTANCE")
            ),
            exp.PartitionedByProperty: lambda self, e: f"PARTITION BY {self.sql(e, 'this')}",
            exp.RegexpLike: rename_func("REGEXP_MATCHES"),
            exp.StrPosition: str_position_sql,
            exp.StrToDate: _str_to_date,
            exp.Pow: rename_func("POW"),
            exp.Select: transforms.preprocess(
                [transforms.eliminate_distinct_on, transforms.eliminate_semi_and_anti_joins]
            ),
            exp.StrToTime: lambda self, e: self.func("TO_TIMESTAMP", e.this, self.format_time(e)),
            exp.TimeStrToDate: lambda self, e: self.sql(exp.cast(e.this, exp.DataType.Type.DATE)),
            exp.TimeStrToTime: timestrtotime_sql,
            exp.TimeStrToUnix: rename_func("UNIX_TIMESTAMP"),
            exp.TimeToStr: lambda self, e: self.func("TO_CHAR", e.this, self.format_time(e)),
            exp.TimeToUnix: rename_func("UNIX_TIMESTAMP"),
            exp.ToChar: lambda self, e: self.function_fallback_sql(e),
            exp.TryCast: no_trycast_sql,
            exp.TsOrDsAdd: lambda self,
            e: f"DATE_ADD(CAST({self.sql(e, 'this')} AS DATE), {self.sql(exp.Interval(this=e.expression, unit=exp.var('DAY')))})",
            exp.TsOrDiToDi: lambda self,
            e: f"CAST(SUBSTR(REPLACE(CAST({self.sql(e, 'this')} AS VARCHAR), '-', ''), 1, 8) AS INT)",
        }
