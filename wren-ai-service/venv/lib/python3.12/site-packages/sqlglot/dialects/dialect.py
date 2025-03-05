from __future__ import annotations

import logging
import typing as t
from enum import Enum, auto
from functools import reduce

from sqlglot import exp
from sqlglot.errors import ParseError
from sqlglot.generator import Generator, unsupported_args
from sqlglot.helper import AutoName, flatten, is_int, seq_get, subclasses, to_bool
from sqlglot.jsonpath import JSONPathTokenizer, parse as parse_json_path
from sqlglot.parser import Parser
from sqlglot.time import TIMEZONES, format_time, subsecond_precision
from sqlglot.tokens import Token, Tokenizer, TokenType
from sqlglot.trie import new_trie

DATE_ADD_OR_DIFF = t.Union[exp.DateAdd, exp.TsOrDsAdd, exp.DateDiff, exp.TsOrDsDiff]
DATE_ADD_OR_SUB = t.Union[exp.DateAdd, exp.TsOrDsAdd, exp.DateSub]
JSON_EXTRACT_TYPE = t.Union[exp.JSONExtract, exp.JSONExtractScalar]


if t.TYPE_CHECKING:
    from sqlglot._typing import B, E, F

    from sqlglot.optimizer.annotate_types import TypeAnnotator

    AnnotatorsType = t.Dict[t.Type[E], t.Callable[[TypeAnnotator, E], E]]

logger = logging.getLogger("sqlglot")

UNESCAPED_SEQUENCES = {
    "\\a": "\a",
    "\\b": "\b",
    "\\f": "\f",
    "\\n": "\n",
    "\\r": "\r",
    "\\t": "\t",
    "\\v": "\v",
    "\\\\": "\\",
}


def _annotate_with_type_lambda(data_type: exp.DataType.Type) -> t.Callable[[TypeAnnotator, E], E]:
    return lambda self, e: self._annotate_with_type(e, data_type)


class Dialects(str, Enum):
    """Dialects supported by SQLGLot."""

    DIALECT = ""

    ATHENA = "athena"
    BIGQUERY = "bigquery"
    CLICKHOUSE = "clickhouse"
    DATABRICKS = "databricks"
    DORIS = "doris"
    DRILL = "drill"
    DUCKDB = "duckdb"
    HIVE = "hive"
    MATERIALIZE = "materialize"
    MYSQL = "mysql"
    ORACLE = "oracle"
    POSTGRES = "postgres"
    PRESTO = "presto"
    PRQL = "prql"
    REDSHIFT = "redshift"
    RISINGWAVE = "risingwave"
    SNOWFLAKE = "snowflake"
    SPARK = "spark"
    SPARK2 = "spark2"
    SQLITE = "sqlite"
    STARROCKS = "starrocks"
    TABLEAU = "tableau"
    TERADATA = "teradata"
    TRINO = "trino"
    TSQL = "tsql"


class NormalizationStrategy(str, AutoName):
    """Specifies the strategy according to which identifiers should be normalized."""

    LOWERCASE = auto()
    """Unquoted identifiers are lowercased."""

    UPPERCASE = auto()
    """Unquoted identifiers are uppercased."""

    CASE_SENSITIVE = auto()
    """Always case-sensitive, regardless of quotes."""

    CASE_INSENSITIVE = auto()
    """Always case-insensitive, regardless of quotes."""


class _Dialect(type):
    classes: t.Dict[str, t.Type[Dialect]] = {}

    def __eq__(cls, other: t.Any) -> bool:
        if cls is other:
            return True
        if isinstance(other, str):
            return cls is cls.get(other)
        if isinstance(other, Dialect):
            return cls is type(other)

        return False

    def __hash__(cls) -> int:
        return hash(cls.__name__.lower())

    @classmethod
    def __getitem__(cls, key: str) -> t.Type[Dialect]:
        return cls.classes[key]

    @classmethod
    def get(
        cls, key: str, default: t.Optional[t.Type[Dialect]] = None
    ) -> t.Optional[t.Type[Dialect]]:
        return cls.classes.get(key, default)

    def __new__(cls, clsname, bases, attrs):
        klass = super().__new__(cls, clsname, bases, attrs)
        enum = Dialects.__members__.get(clsname.upper())
        cls.classes[enum.value if enum is not None else clsname.lower()] = klass

        klass.TIME_TRIE = new_trie(klass.TIME_MAPPING)
        klass.FORMAT_TRIE = (
            new_trie(klass.FORMAT_MAPPING) if klass.FORMAT_MAPPING else klass.TIME_TRIE
        )
        klass.INVERSE_TIME_MAPPING = {v: k for k, v in klass.TIME_MAPPING.items()}
        klass.INVERSE_TIME_TRIE = new_trie(klass.INVERSE_TIME_MAPPING)
        klass.INVERSE_FORMAT_MAPPING = {v: k for k, v in klass.FORMAT_MAPPING.items()}
        klass.INVERSE_FORMAT_TRIE = new_trie(klass.INVERSE_FORMAT_MAPPING)

        klass.INVERSE_CREATABLE_KIND_MAPPING = {
            v: k for k, v in klass.CREATABLE_KIND_MAPPING.items()
        }

        base = seq_get(bases, 0)
        base_tokenizer = (getattr(base, "tokenizer_class", Tokenizer),)
        base_jsonpath_tokenizer = (getattr(base, "jsonpath_tokenizer_class", JSONPathTokenizer),)
        base_parser = (getattr(base, "parser_class", Parser),)
        base_generator = (getattr(base, "generator_class", Generator),)

        klass.tokenizer_class = klass.__dict__.get(
            "Tokenizer", type("Tokenizer", base_tokenizer, {})
        )
        klass.jsonpath_tokenizer_class = klass.__dict__.get(
            "JSONPathTokenizer", type("JSONPathTokenizer", base_jsonpath_tokenizer, {})
        )
        klass.parser_class = klass.__dict__.get("Parser", type("Parser", base_parser, {}))
        klass.generator_class = klass.__dict__.get(
            "Generator", type("Generator", base_generator, {})
        )

        klass.QUOTE_START, klass.QUOTE_END = list(klass.tokenizer_class._QUOTES.items())[0]
        klass.IDENTIFIER_START, klass.IDENTIFIER_END = list(
            klass.tokenizer_class._IDENTIFIERS.items()
        )[0]

        def get_start_end(token_type: TokenType) -> t.Tuple[t.Optional[str], t.Optional[str]]:
            return next(
                (
                    (s, e)
                    for s, (e, t) in klass.tokenizer_class._FORMAT_STRINGS.items()
                    if t == token_type
                ),
                (None, None),
            )

        klass.BIT_START, klass.BIT_END = get_start_end(TokenType.BIT_STRING)
        klass.HEX_START, klass.HEX_END = get_start_end(TokenType.HEX_STRING)
        klass.BYTE_START, klass.BYTE_END = get_start_end(TokenType.BYTE_STRING)
        klass.UNICODE_START, klass.UNICODE_END = get_start_end(TokenType.UNICODE_STRING)

        if "\\" in klass.tokenizer_class.STRING_ESCAPES:
            klass.UNESCAPED_SEQUENCES = {
                **UNESCAPED_SEQUENCES,
                **klass.UNESCAPED_SEQUENCES,
            }

        klass.ESCAPED_SEQUENCES = {v: k for k, v in klass.UNESCAPED_SEQUENCES.items()}

        klass.SUPPORTS_COLUMN_JOIN_MARKS = "(+)" in klass.tokenizer_class.KEYWORDS

        if enum not in ("", "bigquery"):
            klass.generator_class.SELECT_KINDS = ()

        if enum not in ("", "athena", "presto", "trino"):
            klass.generator_class.TRY_SUPPORTED = False
            klass.generator_class.SUPPORTS_UESCAPE = False

        if enum not in ("", "databricks", "hive", "spark", "spark2"):
            modifier_transforms = klass.generator_class.AFTER_HAVING_MODIFIER_TRANSFORMS.copy()
            for modifier in ("cluster", "distribute", "sort"):
                modifier_transforms.pop(modifier, None)

            klass.generator_class.AFTER_HAVING_MODIFIER_TRANSFORMS = modifier_transforms

        if enum not in ("", "doris", "mysql"):
            klass.parser_class.ID_VAR_TOKENS = klass.parser_class.ID_VAR_TOKENS | {
                TokenType.STRAIGHT_JOIN,
            }
            klass.parser_class.TABLE_ALIAS_TOKENS = klass.parser_class.TABLE_ALIAS_TOKENS | {
                TokenType.STRAIGHT_JOIN,
            }

        if not klass.SUPPORTS_SEMI_ANTI_JOIN:
            klass.parser_class.TABLE_ALIAS_TOKENS = klass.parser_class.TABLE_ALIAS_TOKENS | {
                TokenType.ANTI,
                TokenType.SEMI,
            }

        return klass


class Dialect(metaclass=_Dialect):
    INDEX_OFFSET = 0
    """The base index offset for arrays."""

    WEEK_OFFSET = 0
    """First day of the week in DATE_TRUNC(week). Defaults to 0 (Monday). -1 would be Sunday."""

    UNNEST_COLUMN_ONLY = False
    """Whether `UNNEST` table aliases are treated as column aliases."""

    ALIAS_POST_TABLESAMPLE = False
    """Whether the table alias comes after tablesample."""

    TABLESAMPLE_SIZE_IS_PERCENT = False
    """Whether a size in the table sample clause represents percentage."""

    NORMALIZATION_STRATEGY = NormalizationStrategy.LOWERCASE
    """Specifies the strategy according to which identifiers should be normalized."""

    IDENTIFIERS_CAN_START_WITH_DIGIT = False
    """Whether an unquoted identifier can start with a digit."""

    DPIPE_IS_STRING_CONCAT = True
    """Whether the DPIPE token (`||`) is a string concatenation operator."""

    STRICT_STRING_CONCAT = False
    """Whether `CONCAT`'s arguments must be strings."""

    SUPPORTS_USER_DEFINED_TYPES = True
    """Whether user-defined data types are supported."""

    SUPPORTS_SEMI_ANTI_JOIN = True
    """Whether `SEMI` or `ANTI` joins are supported."""

    SUPPORTS_COLUMN_JOIN_MARKS = False
    """Whether the old-style outer join (+) syntax is supported."""

    COPY_PARAMS_ARE_CSV = True
    """Separator of COPY statement parameters."""

    NORMALIZE_FUNCTIONS: bool | str = "upper"
    """
    Determines how function names are going to be normalized.
    Possible values:
        "upper" or True: Convert names to uppercase.
        "lower": Convert names to lowercase.
        False: Disables function name normalization.
    """

    PRESERVE_ORIGINAL_NAMES: bool = False
    """
    Whether the name of the function should be preserved inside the node's metadata,
    can be useful for roundtripping deprecated vs new functions that share an AST node
    e.g JSON_VALUE vs JSON_EXTRACT_SCALAR in BigQuery
    """

    LOG_BASE_FIRST: t.Optional[bool] = True
    """
    Whether the base comes first in the `LOG` function.
    Possible values: `True`, `False`, `None` (two arguments are not supported by `LOG`)
    """

    NULL_ORDERING = "nulls_are_small"
    """
    Default `NULL` ordering method to use if not explicitly set.
    Possible values: `"nulls_are_small"`, `"nulls_are_large"`, `"nulls_are_last"`
    """

    TYPED_DIVISION = False
    """
    Whether the behavior of `a / b` depends on the types of `a` and `b`.
    False means `a / b` is always float division.
    True means `a / b` is integer division if both `a` and `b` are integers.
    """

    SAFE_DIVISION = False
    """Whether division by zero throws an error (`False`) or returns NULL (`True`)."""

    CONCAT_COALESCE = False
    """A `NULL` arg in `CONCAT` yields `NULL` by default, but in some dialects it yields an empty string."""

    HEX_LOWERCASE = False
    """Whether the `HEX` function returns a lowercase hexadecimal string."""

    DATE_FORMAT = "'%Y-%m-%d'"
    DATEINT_FORMAT = "'%Y%m%d'"
    TIME_FORMAT = "'%Y-%m-%d %H:%M:%S'"

    TIME_MAPPING: t.Dict[str, str] = {}
    """Associates this dialect's time formats with their equivalent Python `strftime` formats."""

    # https://cloud.google.com/bigquery/docs/reference/standard-sql/format-elements#format_model_rules_date_time
    # https://docs.teradata.com/r/Teradata-Database-SQL-Functions-Operators-Expressions-and-Predicates/March-2017/Data-Type-Conversions/Character-to-DATE-Conversion/Forcing-a-FORMAT-on-CAST-for-Converting-Character-to-DATE
    FORMAT_MAPPING: t.Dict[str, str] = {}
    """
    Helper which is used for parsing the special syntax `CAST(x AS DATE FORMAT 'yyyy')`.
    If empty, the corresponding trie will be constructed off of `TIME_MAPPING`.
    """

    UNESCAPED_SEQUENCES: t.Dict[str, str] = {}
    """Mapping of an escaped sequence (`\\n`) to its unescaped version (`\n`)."""

    PSEUDOCOLUMNS: t.Set[str] = set()
    """
    Columns that are auto-generated by the engine corresponding to this dialect.
    For example, such columns may be excluded from `SELECT *` queries.
    """

    PREFER_CTE_ALIAS_COLUMN = False
    """
    Some dialects, such as Snowflake, allow you to reference a CTE column alias in the
    HAVING clause of the CTE. This flag will cause the CTE alias columns to override
    any projection aliases in the subquery.

    For example,
        WITH y(c) AS (
            SELECT SUM(a) FROM (SELECT 1 a) AS x HAVING c > 0
        ) SELECT c FROM y;

        will be rewritten as

        WITH y(c) AS (
            SELECT SUM(a) AS c FROM (SELECT 1 AS a) AS x HAVING c > 0
        ) SELECT c FROM y;
    """

    COPY_PARAMS_ARE_CSV = True
    """
    Whether COPY statement parameters are separated by comma or whitespace
    """

    FORCE_EARLY_ALIAS_REF_EXPANSION = False
    """
    Whether alias reference expansion (_expand_alias_refs()) should run before column qualification (_qualify_columns()).

    For example:
        WITH data AS (
        SELECT
            1 AS id,
            2 AS my_id
        )
        SELECT
            id AS my_id
        FROM
            data
        WHERE
            my_id = 1
        GROUP BY
            my_id,
        HAVING
            my_id = 1

    In most dialects, "my_id" would refer to "data.my_id" across the query, except:
        - BigQuery, which will forward the alias to GROUP BY + HAVING clauses i.e
          it resolves to "WHERE my_id = 1 GROUP BY id HAVING id = 1"
        - Clickhouse, which will forward the alias across the query i.e it resolves
        to "WHERE id = 1 GROUP BY id HAVING id = 1"
    """

    EXPAND_ALIAS_REFS_EARLY_ONLY_IN_GROUP_BY = False
    """Whether alias reference expansion before qualification should only happen for the GROUP BY clause."""

    SUPPORTS_ORDER_BY_ALL = False
    """
    Whether ORDER BY ALL is supported (expands to all the selected columns) as in DuckDB, Spark3/Databricks
    """

    HAS_DISTINCT_ARRAY_CONSTRUCTORS = False
    """
    Whether the ARRAY constructor is context-sensitive, i.e in Redshift ARRAY[1, 2, 3] != ARRAY(1, 2, 3)
    as the former is of type INT[] vs the latter which is SUPER
    """

    SUPPORTS_FIXED_SIZE_ARRAYS = False
    """
    Whether expressions such as x::INT[5] should be parsed as fixed-size array defs/casts e.g.
    in DuckDB. In dialects which don't support fixed size arrays such as Snowflake, this should
    be interpreted as a subscript/index operator.
    """

    STRICT_JSON_PATH_SYNTAX = True
    """Whether failing to parse a JSON path expression using the JSONPath dialect will log a warning."""

    ON_CONDITION_EMPTY_BEFORE_ERROR = True
    """Whether "X ON EMPTY" should come before "X ON ERROR" (for dialects like T-SQL, MySQL, Oracle)."""

    ARRAY_AGG_INCLUDES_NULLS: t.Optional[bool] = True
    """Whether ArrayAgg needs to filter NULL values."""

    PROMOTE_TO_INFERRED_DATETIME_TYPE = False
    """
    This flag is used in the optimizer's canonicalize rule and determines whether x will be promoted
    to the literal's type in x::DATE < '2020-01-01 12:05:03' (i.e., DATETIME). When false, the literal
    is cast to x's type to match it instead.
    """

    SUPPORTS_VALUES_DEFAULT = True
    """Whether the DEFAULT keyword is supported in the VALUES clause."""

    REGEXP_EXTRACT_DEFAULT_GROUP = 0
    """The default value for the capturing group."""

    SET_OP_DISTINCT_BY_DEFAULT: t.Dict[t.Type[exp.Expression], t.Optional[bool]] = {
        exp.Except: True,
        exp.Intersect: True,
        exp.Union: True,
    }
    """
    Whether a set operation uses DISTINCT by default. This is `None` when either `DISTINCT` or `ALL`
    must be explicitly specified.
    """

    CREATABLE_KIND_MAPPING: dict[str, str] = {}
    """
    Helper for dialects that use a different name for the same creatable kind. For example, the Clickhouse
    equivalent of CREATE SCHEMA is CREATE DATABASE.
    """

    # --- Autofilled ---

    tokenizer_class = Tokenizer
    jsonpath_tokenizer_class = JSONPathTokenizer
    parser_class = Parser
    generator_class = Generator

    # A trie of the time_mapping keys
    TIME_TRIE: t.Dict = {}
    FORMAT_TRIE: t.Dict = {}

    INVERSE_TIME_MAPPING: t.Dict[str, str] = {}
    INVERSE_TIME_TRIE: t.Dict = {}
    INVERSE_FORMAT_MAPPING: t.Dict[str, str] = {}
    INVERSE_FORMAT_TRIE: t.Dict = {}

    INVERSE_CREATABLE_KIND_MAPPING: dict[str, str] = {}

    ESCAPED_SEQUENCES: t.Dict[str, str] = {}

    # Delimiters for string literals and identifiers
    QUOTE_START = "'"
    QUOTE_END = "'"
    IDENTIFIER_START = '"'
    IDENTIFIER_END = '"'

    # Delimiters for bit, hex, byte and unicode literals
    BIT_START: t.Optional[str] = None
    BIT_END: t.Optional[str] = None
    HEX_START: t.Optional[str] = None
    HEX_END: t.Optional[str] = None
    BYTE_START: t.Optional[str] = None
    BYTE_END: t.Optional[str] = None
    UNICODE_START: t.Optional[str] = None
    UNICODE_END: t.Optional[str] = None

    DATE_PART_MAPPING = {
        "Y": "YEAR",
        "YY": "YEAR",
        "YYY": "YEAR",
        "YYYY": "YEAR",
        "YR": "YEAR",
        "YEARS": "YEAR",
        "YRS": "YEAR",
        "MM": "MONTH",
        "MON": "MONTH",
        "MONS": "MONTH",
        "MONTHS": "MONTH",
        "D": "DAY",
        "DD": "DAY",
        "DAYS": "DAY",
        "DAYOFMONTH": "DAY",
        "DAY OF WEEK": "DAYOFWEEK",
        "WEEKDAY": "DAYOFWEEK",
        "DOW": "DAYOFWEEK",
        "DW": "DAYOFWEEK",
        "WEEKDAY_ISO": "DAYOFWEEKISO",
        "DOW_ISO": "DAYOFWEEKISO",
        "DW_ISO": "DAYOFWEEKISO",
        "DAY OF YEAR": "DAYOFYEAR",
        "DOY": "DAYOFYEAR",
        "DY": "DAYOFYEAR",
        "W": "WEEK",
        "WK": "WEEK",
        "WEEKOFYEAR": "WEEK",
        "WOY": "WEEK",
        "WY": "WEEK",
        "WEEK_ISO": "WEEKISO",
        "WEEKOFYEARISO": "WEEKISO",
        "WEEKOFYEAR_ISO": "WEEKISO",
        "Q": "QUARTER",
        "QTR": "QUARTER",
        "QTRS": "QUARTER",
        "QUARTERS": "QUARTER",
        "H": "HOUR",
        "HH": "HOUR",
        "HR": "HOUR",
        "HOURS": "HOUR",
        "HRS": "HOUR",
        "M": "MINUTE",
        "MI": "MINUTE",
        "MIN": "MINUTE",
        "MINUTES": "MINUTE",
        "MINS": "MINUTE",
        "S": "SECOND",
        "SEC": "SECOND",
        "SECONDS": "SECOND",
        "SECS": "SECOND",
        "MS": "MILLISECOND",
        "MSEC": "MILLISECOND",
        "MSECS": "MILLISECOND",
        "MSECOND": "MILLISECOND",
        "MSECONDS": "MILLISECOND",
        "MILLISEC": "MILLISECOND",
        "MILLISECS": "MILLISECOND",
        "MILLISECON": "MILLISECOND",
        "MILLISECONDS": "MILLISECOND",
        "US": "MICROSECOND",
        "USEC": "MICROSECOND",
        "USECS": "MICROSECOND",
        "MICROSEC": "MICROSECOND",
        "MICROSECS": "MICROSECOND",
        "USECOND": "MICROSECOND",
        "USECONDS": "MICROSECOND",
        "MICROSECONDS": "MICROSECOND",
        "NS": "NANOSECOND",
        "NSEC": "NANOSECOND",
        "NANOSEC": "NANOSECOND",
        "NSECOND": "NANOSECOND",
        "NSECONDS": "NANOSECOND",
        "NANOSECS": "NANOSECOND",
        "EPOCH_SECOND": "EPOCH",
        "EPOCH_SECONDS": "EPOCH",
        "EPOCH_MILLISECONDS": "EPOCH_MILLISECOND",
        "EPOCH_MICROSECONDS": "EPOCH_MICROSECOND",
        "EPOCH_NANOSECONDS": "EPOCH_NANOSECOND",
        "TZH": "TIMEZONE_HOUR",
        "TZM": "TIMEZONE_MINUTE",
        "DEC": "DECADE",
        "DECS": "DECADE",
        "DECADES": "DECADE",
        "MIL": "MILLENIUM",
        "MILS": "MILLENIUM",
        "MILLENIA": "MILLENIUM",
        "C": "CENTURY",
        "CENT": "CENTURY",
        "CENTS": "CENTURY",
        "CENTURIES": "CENTURY",
    }

    TYPE_TO_EXPRESSIONS: t.Dict[exp.DataType.Type, t.Set[t.Type[exp.Expression]]] = {
        exp.DataType.Type.BIGINT: {
            exp.ApproxDistinct,
            exp.ArraySize,
            exp.Length,
        },
        exp.DataType.Type.BOOLEAN: {
            exp.Between,
            exp.Boolean,
            exp.In,
            exp.RegexpLike,
        },
        exp.DataType.Type.DATE: {
            exp.CurrentDate,
            exp.Date,
            exp.DateFromParts,
            exp.DateStrToDate,
            exp.DiToDate,
            exp.StrToDate,
            exp.TimeStrToDate,
            exp.TsOrDsToDate,
        },
        exp.DataType.Type.DATETIME: {
            exp.CurrentDatetime,
            exp.Datetime,
            exp.DatetimeAdd,
            exp.DatetimeSub,
        },
        exp.DataType.Type.DOUBLE: {
            exp.ApproxQuantile,
            exp.Avg,
            exp.Exp,
            exp.Ln,
            exp.Log,
            exp.Pow,
            exp.Quantile,
            exp.Round,
            exp.SafeDivide,
            exp.Sqrt,
            exp.Stddev,
            exp.StddevPop,
            exp.StddevSamp,
            exp.ToDouble,
            exp.Variance,
            exp.VariancePop,
        },
        exp.DataType.Type.INT: {
            exp.Ceil,
            exp.DatetimeDiff,
            exp.DateDiff,
            exp.TimestampDiff,
            exp.TimeDiff,
            exp.DateToDi,
            exp.Levenshtein,
            exp.Sign,
            exp.StrPosition,
            exp.TsOrDiToDi,
        },
        exp.DataType.Type.JSON: {
            exp.ParseJSON,
        },
        exp.DataType.Type.TIME: {
            exp.Time,
        },
        exp.DataType.Type.TIMESTAMP: {
            exp.CurrentTime,
            exp.CurrentTimestamp,
            exp.StrToTime,
            exp.TimeAdd,
            exp.TimeStrToTime,
            exp.TimeSub,
            exp.TimestampAdd,
            exp.TimestampSub,
            exp.UnixToTime,
        },
        exp.DataType.Type.TINYINT: {
            exp.Day,
            exp.Month,
            exp.Week,
            exp.Year,
            exp.Quarter,
        },
        exp.DataType.Type.VARCHAR: {
            exp.ArrayConcat,
            exp.Concat,
            exp.ConcatWs,
            exp.DateToDateStr,
            exp.GroupConcat,
            exp.Initcap,
            exp.Lower,
            exp.Substring,
            exp.String,
            exp.TimeToStr,
            exp.TimeToTimeStr,
            exp.Trim,
            exp.TsOrDsToDateStr,
            exp.UnixToStr,
            exp.UnixToTimeStr,
            exp.Upper,
        },
    }

    ANNOTATORS: AnnotatorsType = {
        **{
            expr_type: lambda self, e: self._annotate_unary(e)
            for expr_type in subclasses(exp.__name__, (exp.Unary, exp.Alias))
        },
        **{
            expr_type: lambda self, e: self._annotate_binary(e)
            for expr_type in subclasses(exp.__name__, exp.Binary)
        },
        **{
            expr_type: _annotate_with_type_lambda(data_type)
            for data_type, expressions in TYPE_TO_EXPRESSIONS.items()
            for expr_type in expressions
        },
        exp.Abs: lambda self, e: self._annotate_by_args(e, "this"),
        exp.Anonymous: lambda self, e: self._annotate_with_type(e, exp.DataType.Type.UNKNOWN),
        exp.Array: lambda self, e: self._annotate_by_args(e, "expressions", array=True),
        exp.ArrayAgg: lambda self, e: self._annotate_by_args(e, "this", array=True),
        exp.ArrayConcat: lambda self, e: self._annotate_by_args(e, "this", "expressions"),
        exp.Bracket: lambda self, e: self._annotate_bracket(e),
        exp.Cast: lambda self, e: self._annotate_with_type(e, e.args["to"]),
        exp.Case: lambda self, e: self._annotate_by_args(e, "default", "ifs"),
        exp.Coalesce: lambda self, e: self._annotate_by_args(e, "this", "expressions"),
        exp.Count: lambda self, e: self._annotate_with_type(
            e, exp.DataType.Type.BIGINT if e.args.get("big_int") else exp.DataType.Type.INT
        ),
        exp.DataType: lambda self, e: self._annotate_with_type(e, e.copy()),
        exp.DateAdd: lambda self, e: self._annotate_timeunit(e),
        exp.DateSub: lambda self, e: self._annotate_timeunit(e),
        exp.DateTrunc: lambda self, e: self._annotate_timeunit(e),
        exp.Distinct: lambda self, e: self._annotate_by_args(e, "expressions"),
        exp.Div: lambda self, e: self._annotate_div(e),
        exp.Dot: lambda self, e: self._annotate_dot(e),
        exp.Explode: lambda self, e: self._annotate_explode(e),
        exp.Extract: lambda self, e: self._annotate_extract(e),
        exp.Filter: lambda self, e: self._annotate_by_args(e, "this"),
        exp.GenerateDateArray: lambda self, e: self._annotate_with_type(
            e, exp.DataType.build("ARRAY<DATE>")
        ),
        exp.GenerateTimestampArray: lambda self, e: self._annotate_with_type(
            e, exp.DataType.build("ARRAY<TIMESTAMP>")
        ),
        exp.Greatest: lambda self, e: self._annotate_by_args(e, "this", "expressions"),
        exp.If: lambda self, e: self._annotate_by_args(e, "true", "false"),
        exp.Interval: lambda self, e: self._annotate_with_type(e, exp.DataType.Type.INTERVAL),
        exp.Least: lambda self, e: self._annotate_by_args(e, "this", "expressions"),
        exp.Literal: lambda self, e: self._annotate_literal(e),
        exp.Map: lambda self, e: self._annotate_map(e),
        exp.Max: lambda self, e: self._annotate_by_args(e, "this", "expressions"),
        exp.Min: lambda self, e: self._annotate_by_args(e, "this", "expressions"),
        exp.Null: lambda self, e: self._annotate_with_type(e, exp.DataType.Type.NULL),
        exp.Nullif: lambda self, e: self._annotate_by_args(e, "this", "expression"),
        exp.PropertyEQ: lambda self, e: self._annotate_by_args(e, "expression"),
        exp.Slice: lambda self, e: self._annotate_with_type(e, exp.DataType.Type.UNKNOWN),
        exp.Struct: lambda self, e: self._annotate_struct(e),
        exp.Sum: lambda self, e: self._annotate_by_args(e, "this", "expressions", promote=True),
        exp.Timestamp: lambda self, e: self._annotate_with_type(
            e,
            exp.DataType.Type.TIMESTAMPTZ if e.args.get("with_tz") else exp.DataType.Type.TIMESTAMP,
        ),
        exp.ToMap: lambda self, e: self._annotate_to_map(e),
        exp.TryCast: lambda self, e: self._annotate_with_type(e, e.args["to"]),
        exp.Unnest: lambda self, e: self._annotate_unnest(e),
        exp.VarMap: lambda self, e: self._annotate_map(e),
    }

    @classmethod
    def get_or_raise(cls, dialect: DialectType) -> Dialect:
        """
        Look up a dialect in the global dialect registry and return it if it exists.

        Args:
            dialect: The target dialect. If this is a string, it can be optionally followed by
                additional key-value pairs that are separated by commas and are used to specify
                dialect settings, such as whether the dialect's identifiers are case-sensitive.

        Example:
            >>> dialect = dialect_class = get_or_raise("duckdb")
            >>> dialect = get_or_raise("mysql, normalization_strategy = case_sensitive")

        Returns:
            The corresponding Dialect instance.
        """

        if not dialect:
            return cls()
        if isinstance(dialect, _Dialect):
            return dialect()
        if isinstance(dialect, Dialect):
            return dialect
        if isinstance(dialect, str):
            try:
                dialect_name, *kv_strings = dialect.split(",")
                kv_pairs = (kv.split("=") for kv in kv_strings)
                kwargs = {}
                for pair in kv_pairs:
                    key = pair[0].strip()
                    value: t.Union[bool | str | None] = None

                    if len(pair) == 1:
                        # Default initialize standalone settings to True
                        value = True
                    elif len(pair) == 2:
                        value = pair[1].strip()

                    kwargs[key] = to_bool(value)

            except ValueError:
                raise ValueError(
                    f"Invalid dialect format: '{dialect}'. "
                    "Please use the correct format: 'dialect [, k1 = v2 [, ...]]'."
                )

            result = cls.get(dialect_name.strip())
            if not result:
                from difflib import get_close_matches

                similar = seq_get(get_close_matches(dialect_name, cls.classes, n=1), 0) or ""
                if similar:
                    similar = f" Did you mean {similar}?"

                raise ValueError(f"Unknown dialect '{dialect_name}'.{similar}")

            return result(**kwargs)

        raise ValueError(f"Invalid dialect type for '{dialect}': '{type(dialect)}'.")

    @classmethod
    def format_time(
        cls, expression: t.Optional[str | exp.Expression]
    ) -> t.Optional[exp.Expression]:
        """Converts a time format in this dialect to its equivalent Python `strftime` format."""
        if isinstance(expression, str):
            return exp.Literal.string(
                # the time formats are quoted
                format_time(expression[1:-1], cls.TIME_MAPPING, cls.TIME_TRIE)
            )

        if expression and expression.is_string:
            return exp.Literal.string(format_time(expression.this, cls.TIME_MAPPING, cls.TIME_TRIE))

        return expression

    def __init__(self, **kwargs) -> None:
        normalization_strategy = kwargs.pop("normalization_strategy", None)

        if normalization_strategy is None:
            self.normalization_strategy = self.NORMALIZATION_STRATEGY
        else:
            self.normalization_strategy = NormalizationStrategy(normalization_strategy.upper())

        self.settings = kwargs

    def __eq__(self, other: t.Any) -> bool:
        # Does not currently take dialect state into account
        return type(self) == other

    def __hash__(self) -> int:
        # Does not currently take dialect state into account
        return hash(type(self))

    def normalize_identifier(self, expression: E) -> E:
        """
        Transforms an identifier in a way that resembles how it'd be resolved by this dialect.

        For example, an identifier like `FoO` would be resolved as `foo` in Postgres, because it
        lowercases all unquoted identifiers. On the other hand, Snowflake uppercases them, so
        it would resolve it as `FOO`. If it was quoted, it'd need to be treated as case-sensitive,
        and so any normalization would be prohibited in order to avoid "breaking" the identifier.

        There are also dialects like Spark, which are case-insensitive even when quotes are
        present, and dialects like MySQL, whose resolution rules match those employed by the
        underlying operating system, for example they may always be case-sensitive in Linux.

        Finally, the normalization behavior of some engines can even be controlled through flags,
        like in Redshift's case, where users can explicitly set enable_case_sensitive_identifier.

        SQLGlot aims to understand and handle all of these different behaviors gracefully, so
        that it can analyze queries in the optimizer and successfully capture their semantics.
        """
        if (
            isinstance(expression, exp.Identifier)
            and self.normalization_strategy is not NormalizationStrategy.CASE_SENSITIVE
            and (
                not expression.quoted
                or self.normalization_strategy is NormalizationStrategy.CASE_INSENSITIVE
            )
        ):
            expression.set(
                "this",
                (
                    expression.this.upper()
                    if self.normalization_strategy is NormalizationStrategy.UPPERCASE
                    else expression.this.lower()
                ),
            )

        return expression

    def case_sensitive(self, text: str) -> bool:
        """Checks if text contains any case sensitive characters, based on the dialect's rules."""
        if self.normalization_strategy is NormalizationStrategy.CASE_INSENSITIVE:
            return False

        unsafe = (
            str.islower
            if self.normalization_strategy is NormalizationStrategy.UPPERCASE
            else str.isupper
        )
        return any(unsafe(char) for char in text)

    def can_identify(self, text: str, identify: str | bool = "safe") -> bool:
        """Checks if text can be identified given an identify option.

        Args:
            text: The text to check.
            identify:
                `"always"` or `True`: Always returns `True`.
                `"safe"`: Only returns `True` if the identifier is case-insensitive.

        Returns:
            Whether the given text can be identified.
        """
        if identify is True or identify == "always":
            return True

        if identify == "safe":
            return not self.case_sensitive(text)

        return False

    def quote_identifier(self, expression: E, identify: bool = True) -> E:
        """
        Adds quotes to a given identifier.

        Args:
            expression: The expression of interest. If it's not an `Identifier`, this method is a no-op.
            identify: If set to `False`, the quotes will only be added if the identifier is deemed
                "unsafe", with respect to its characters and this dialect's normalization strategy.
        """
        if isinstance(expression, exp.Identifier) and not isinstance(expression.parent, exp.Func):
            name = expression.this
            expression.set(
                "quoted",
                identify or self.case_sensitive(name) or not exp.SAFE_IDENTIFIER_RE.match(name),
            )

        return expression

    def to_json_path(self, path: t.Optional[exp.Expression]) -> t.Optional[exp.Expression]:
        if isinstance(path, exp.Literal):
            path_text = path.name
            if path.is_number:
                path_text = f"[{path_text}]"
            try:
                return parse_json_path(path_text, self)
            except ParseError as e:
                if self.STRICT_JSON_PATH_SYNTAX:
                    logger.warning(f"Invalid JSON path syntax. {str(e)}")

        return path

    def parse(self, sql: str, **opts) -> t.List[t.Optional[exp.Expression]]:
        return self.parser(**opts).parse(self.tokenize(sql), sql)

    def parse_into(
        self, expression_type: exp.IntoType, sql: str, **opts
    ) -> t.List[t.Optional[exp.Expression]]:
        return self.parser(**opts).parse_into(expression_type, self.tokenize(sql), sql)

    def generate(self, expression: exp.Expression, copy: bool = True, **opts) -> str:
        return self.generator(**opts).generate(expression, copy=copy)

    def transpile(self, sql: str, **opts) -> t.List[str]:
        return [
            self.generate(expression, copy=False, **opts) if expression else ""
            for expression in self.parse(sql)
        ]

    def tokenize(self, sql: str) -> t.List[Token]:
        return self.tokenizer.tokenize(sql)

    @property
    def tokenizer(self) -> Tokenizer:
        return self.tokenizer_class(dialect=self)

    @property
    def jsonpath_tokenizer(self) -> JSONPathTokenizer:
        return self.jsonpath_tokenizer_class(dialect=self)

    def parser(self, **opts) -> Parser:
        return self.parser_class(dialect=self, **opts)

    def generator(self, **opts) -> Generator:
        return self.generator_class(dialect=self, **opts)


DialectType = t.Union[str, Dialect, t.Type[Dialect], None]


def rename_func(name: str) -> t.Callable[[Generator, exp.Expression], str]:
    return lambda self, expression: self.func(name, *flatten(expression.args.values()))


@unsupported_args("accuracy")
def approx_count_distinct_sql(self: Generator, expression: exp.ApproxDistinct) -> str:
    return self.func("APPROX_COUNT_DISTINCT", expression.this)


def if_sql(
    name: str = "IF", false_value: t.Optional[exp.Expression | str] = None
) -> t.Callable[[Generator, exp.If], str]:
    def _if_sql(self: Generator, expression: exp.If) -> str:
        return self.func(
            name,
            expression.this,
            expression.args.get("true"),
            expression.args.get("false") or false_value,
        )

    return _if_sql


def arrow_json_extract_sql(self: Generator, expression: JSON_EXTRACT_TYPE) -> str:
    this = expression.this
    if self.JSON_TYPE_REQUIRED_FOR_EXTRACTION and isinstance(this, exp.Literal) and this.is_string:
        this.replace(exp.cast(this, exp.DataType.Type.JSON))

    return self.binary(expression, "->" if isinstance(expression, exp.JSONExtract) else "->>")


def inline_array_sql(self: Generator, expression: exp.Array) -> str:
    return f"[{self.expressions(expression, dynamic=True, new_line=True, skip_first=True, skip_last=True)}]"


def inline_array_unless_query(self: Generator, expression: exp.Array) -> str:
    elem = seq_get(expression.expressions, 0)
    if isinstance(elem, exp.Expression) and elem.find(exp.Query):
        return self.func("ARRAY", elem)
    return inline_array_sql(self, expression)


def no_ilike_sql(self: Generator, expression: exp.ILike) -> str:
    return self.like_sql(
        exp.Like(
            this=exp.Lower(this=expression.this), expression=exp.Lower(this=expression.expression)
        )
    )


def no_paren_current_date_sql(self: Generator, expression: exp.CurrentDate) -> str:
    zone = self.sql(expression, "this")
    return f"CURRENT_DATE AT TIME ZONE {zone}" if zone else "CURRENT_DATE"


def no_recursive_cte_sql(self: Generator, expression: exp.With) -> str:
    if expression.args.get("recursive"):
        self.unsupported("Recursive CTEs are unsupported")
        expression.args["recursive"] = False
    return self.with_sql(expression)


def no_safe_divide_sql(self: Generator, expression: exp.SafeDivide, if_sql: str = "IF") -> str:
    n = self.sql(expression, "this")
    d = self.sql(expression, "expression")
    return f"{if_sql}(({d}) <> 0, ({n}) / ({d}), NULL)"


def no_tablesample_sql(self: Generator, expression: exp.TableSample) -> str:
    self.unsupported("TABLESAMPLE unsupported")
    return self.sql(expression.this)


def no_pivot_sql(self: Generator, expression: exp.Pivot) -> str:
    self.unsupported("PIVOT unsupported")
    return ""


def no_trycast_sql(self: Generator, expression: exp.TryCast) -> str:
    return self.cast_sql(expression)


def no_comment_column_constraint_sql(
    self: Generator, expression: exp.CommentColumnConstraint
) -> str:
    self.unsupported("CommentColumnConstraint unsupported")
    return ""


def no_map_from_entries_sql(self: Generator, expression: exp.MapFromEntries) -> str:
    self.unsupported("MAP_FROM_ENTRIES unsupported")
    return ""


def property_sql(self: Generator, expression: exp.Property) -> str:
    return f"{self.property_name(expression, string_key=True)}={self.sql(expression, 'value')}"


def str_position_sql(
    self: Generator,
    expression: exp.StrPosition,
    generate_instance: bool = False,
    str_position_func_name: str = "STRPOS",
) -> str:
    this = self.sql(expression, "this")
    substr = self.sql(expression, "substr")
    position = self.sql(expression, "position")
    instance = expression.args.get("instance") if generate_instance else None
    position_offset = ""

    if position:
        # Normalize third 'pos' argument into 'SUBSTR(..) + offset' across dialects
        this = self.func("SUBSTR", this, position)
        position_offset = f" + {position} - 1"

    return self.func(str_position_func_name, this, substr, instance) + position_offset


def struct_extract_sql(self: Generator, expression: exp.StructExtract) -> str:
    return (
        f"{self.sql(expression, 'this')}.{self.sql(exp.to_identifier(expression.expression.name))}"
    )


def var_map_sql(
    self: Generator, expression: exp.Map | exp.VarMap, map_func_name: str = "MAP"
) -> str:
    keys = expression.args["keys"]
    values = expression.args["values"]

    if not isinstance(keys, exp.Array) or not isinstance(values, exp.Array):
        self.unsupported("Cannot convert array columns into map.")
        return self.func(map_func_name, keys, values)

    args = []
    for key, value in zip(keys.expressions, values.expressions):
        args.append(self.sql(key))
        args.append(self.sql(value))

    return self.func(map_func_name, *args)


def build_formatted_time(
    exp_class: t.Type[E], dialect: str, default: t.Optional[bool | str] = None
) -> t.Callable[[t.List], E]:
    """Helper used for time expressions.

    Args:
        exp_class: the expression class to instantiate.
        dialect: target sql dialect.
        default: the default format, True being time.

    Returns:
        A callable that can be used to return the appropriately formatted time expression.
    """

    def _builder(args: t.List):
        return exp_class(
            this=seq_get(args, 0),
            format=Dialect[dialect].format_time(
                seq_get(args, 1)
                or (Dialect[dialect].TIME_FORMAT if default is True else default or None)
            ),
        )

    return _builder


def time_format(
    dialect: DialectType = None,
) -> t.Callable[[Generator, exp.UnixToStr | exp.StrToUnix], t.Optional[str]]:
    def _time_format(self: Generator, expression: exp.UnixToStr | exp.StrToUnix) -> t.Optional[str]:
        """
        Returns the time format for a given expression, unless it's equivalent
        to the default time format of the dialect of interest.
        """
        time_format = self.format_time(expression)
        return time_format if time_format != Dialect.get_or_raise(dialect).TIME_FORMAT else None

    return _time_format


def build_date_delta(
    exp_class: t.Type[E],
    unit_mapping: t.Optional[t.Dict[str, str]] = None,
    default_unit: t.Optional[str] = "DAY",
) -> t.Callable[[t.List], E]:
    def _builder(args: t.List) -> E:
        unit_based = len(args) == 3
        this = args[2] if unit_based else seq_get(args, 0)
        unit = None
        if unit_based or default_unit:
            unit = args[0] if unit_based else exp.Literal.string(default_unit)
            unit = exp.var(unit_mapping.get(unit.name.lower(), unit.name)) if unit_mapping else unit
        return exp_class(this=this, expression=seq_get(args, 1), unit=unit)

    return _builder


def build_date_delta_with_interval(
    expression_class: t.Type[E],
) -> t.Callable[[t.List], t.Optional[E]]:
    def _builder(args: t.List) -> t.Optional[E]:
        if len(args) < 2:
            return None

        interval = args[1]

        if not isinstance(interval, exp.Interval):
            raise ParseError(f"INTERVAL expression expected but got '{interval}'")

        return expression_class(this=args[0], expression=interval.this, unit=unit_to_str(interval))

    return _builder


def date_trunc_to_time(args: t.List) -> exp.DateTrunc | exp.TimestampTrunc:
    unit = seq_get(args, 0)
    this = seq_get(args, 1)

    if isinstance(this, exp.Cast) and this.is_type("date"):
        return exp.DateTrunc(unit=unit, this=this)
    return exp.TimestampTrunc(this=this, unit=unit)


def date_add_interval_sql(
    data_type: str, kind: str
) -> t.Callable[[Generator, exp.Expression], str]:
    def func(self: Generator, expression: exp.Expression) -> str:
        this = self.sql(expression, "this")
        interval = exp.Interval(this=expression.expression, unit=unit_to_var(expression))
        return f"{data_type}_{kind}({this}, {self.sql(interval)})"

    return func


def timestamptrunc_sql(zone: bool = False) -> t.Callable[[Generator, exp.TimestampTrunc], str]:
    def _timestamptrunc_sql(self: Generator, expression: exp.TimestampTrunc) -> str:
        args = [unit_to_str(expression), expression.this]
        if zone:
            args.append(expression.args.get("zone"))
        return self.func("DATE_TRUNC", *args)

    return _timestamptrunc_sql


def no_timestamp_sql(self: Generator, expression: exp.Timestamp) -> str:
    zone = expression.args.get("zone")
    if not zone:
        from sqlglot.optimizer.annotate_types import annotate_types

        target_type = annotate_types(expression).type or exp.DataType.Type.TIMESTAMP
        return self.sql(exp.cast(expression.this, target_type))
    if zone.name.lower() in TIMEZONES:
        return self.sql(
            exp.AtTimeZone(
                this=exp.cast(expression.this, exp.DataType.Type.TIMESTAMP),
                zone=zone,
            )
        )
    return self.func("TIMESTAMP", expression.this, zone)


def no_time_sql(self: Generator, expression: exp.Time) -> str:
    # Transpile BQ's TIME(timestamp, zone) to CAST(TIMESTAMPTZ <timestamp> AT TIME ZONE <zone> AS TIME)
    this = exp.cast(expression.this, exp.DataType.Type.TIMESTAMPTZ)
    expr = exp.cast(
        exp.AtTimeZone(this=this, zone=expression.args.get("zone")), exp.DataType.Type.TIME
    )
    return self.sql(expr)


def no_datetime_sql(self: Generator, expression: exp.Datetime) -> str:
    this = expression.this
    expr = expression.expression

    if expr.name.lower() in TIMEZONES:
        # Transpile BQ's DATETIME(timestamp, zone) to CAST(TIMESTAMPTZ <timestamp> AT TIME ZONE <zone> AS TIMESTAMP)
        this = exp.cast(this, exp.DataType.Type.TIMESTAMPTZ)
        this = exp.cast(exp.AtTimeZone(this=this, zone=expr), exp.DataType.Type.TIMESTAMP)
        return self.sql(this)

    this = exp.cast(this, exp.DataType.Type.DATE)
    expr = exp.cast(expr, exp.DataType.Type.TIME)

    return self.sql(exp.cast(exp.Add(this=this, expression=expr), exp.DataType.Type.TIMESTAMP))


def locate_to_strposition(args: t.List) -> exp.Expression:
    return exp.StrPosition(
        this=seq_get(args, 1), substr=seq_get(args, 0), position=seq_get(args, 2)
    )


def strposition_to_locate_sql(self: Generator, expression: exp.StrPosition) -> str:
    return self.func(
        "LOCATE", expression.args.get("substr"), expression.this, expression.args.get("position")
    )


def left_to_substring_sql(self: Generator, expression: exp.Left) -> str:
    return self.sql(
        exp.Substring(
            this=expression.this, start=exp.Literal.number(1), length=expression.expression
        )
    )


def right_to_substring_sql(self: Generator, expression: exp.Left) -> str:
    return self.sql(
        exp.Substring(
            this=expression.this,
            start=exp.Length(this=expression.this) - exp.paren(expression.expression - 1),
        )
    )


def timestrtotime_sql(
    self: Generator,
    expression: exp.TimeStrToTime,
    include_precision: bool = False,
) -> str:
    datatype = exp.DataType.build(
        exp.DataType.Type.TIMESTAMPTZ
        if expression.args.get("zone")
        else exp.DataType.Type.TIMESTAMP
    )

    if isinstance(expression.this, exp.Literal) and include_precision:
        precision = subsecond_precision(expression.this.name)
        if precision > 0:
            datatype = exp.DataType.build(
                datatype.this, expressions=[exp.DataTypeParam(this=exp.Literal.number(precision))]
            )

    return self.sql(exp.cast(expression.this, datatype, dialect=self.dialect))


def datestrtodate_sql(self: Generator, expression: exp.DateStrToDate) -> str:
    return self.sql(exp.cast(expression.this, exp.DataType.Type.DATE))


# Used for Presto and Duckdb which use functions that don't support charset, and assume utf-8
def encode_decode_sql(
    self: Generator, expression: exp.Expression, name: str, replace: bool = True
) -> str:
    charset = expression.args.get("charset")
    if charset and charset.name.lower() != "utf-8":
        self.unsupported(f"Expected utf-8 character set, got {charset}.")

    return self.func(name, expression.this, expression.args.get("replace") if replace else None)


def min_or_least(self: Generator, expression: exp.Min) -> str:
    name = "LEAST" if expression.expressions else "MIN"
    return rename_func(name)(self, expression)


def max_or_greatest(self: Generator, expression: exp.Max) -> str:
    name = "GREATEST" if expression.expressions else "MAX"
    return rename_func(name)(self, expression)


def count_if_to_sum(self: Generator, expression: exp.CountIf) -> str:
    cond = expression.this

    if isinstance(expression.this, exp.Distinct):
        cond = expression.this.expressions[0]
        self.unsupported("DISTINCT is not supported when converting COUNT_IF to SUM")

    return self.func("sum", exp.func("if", cond, 1, 0))


def trim_sql(self: Generator, expression: exp.Trim) -> str:
    target = self.sql(expression, "this")
    trim_type = self.sql(expression, "position")
    remove_chars = self.sql(expression, "expression")
    collation = self.sql(expression, "collation")

    # Use TRIM/LTRIM/RTRIM syntax if the expression isn't database-specific
    if not remove_chars:
        return self.trim_sql(expression)

    trim_type = f"{trim_type} " if trim_type else ""
    remove_chars = f"{remove_chars} " if remove_chars else ""
    from_part = "FROM " if trim_type or remove_chars else ""
    collation = f" COLLATE {collation}" if collation else ""
    return f"TRIM({trim_type}{remove_chars}{from_part}{target}{collation})"


def str_to_time_sql(self: Generator, expression: exp.Expression) -> str:
    return self.func("STRPTIME", expression.this, self.format_time(expression))


def concat_to_dpipe_sql(self: Generator, expression: exp.Concat) -> str:
    return self.sql(reduce(lambda x, y: exp.DPipe(this=x, expression=y), expression.expressions))


def concat_ws_to_dpipe_sql(self: Generator, expression: exp.ConcatWs) -> str:
    delim, *rest_args = expression.expressions
    return self.sql(
        reduce(
            lambda x, y: exp.DPipe(this=x, expression=exp.DPipe(this=delim, expression=y)),
            rest_args,
        )
    )


@unsupported_args("position", "occurrence", "parameters")
def regexp_extract_sql(
    self: Generator, expression: exp.RegexpExtract | exp.RegexpExtractAll
) -> str:
    group = expression.args.get("group")

    # Do not render group if it's the default value for this dialect
    if group and group.name == str(self.dialect.REGEXP_EXTRACT_DEFAULT_GROUP):
        group = None

    return self.func(expression.sql_name(), expression.this, expression.expression, group)


@unsupported_args("position", "occurrence", "modifiers")
def regexp_replace_sql(self: Generator, expression: exp.RegexpReplace) -> str:
    return self.func(
        "REGEXP_REPLACE", expression.this, expression.expression, expression.args["replacement"]
    )


def pivot_column_names(aggregations: t.List[exp.Expression], dialect: DialectType) -> t.List[str]:
    names = []
    for agg in aggregations:
        if isinstance(agg, exp.Alias):
            names.append(agg.alias)
        else:
            """
            This case corresponds to aggregations without aliases being used as suffixes
            (e.g. col_avg(foo)). We need to unquote identifiers because they're going to
            be quoted in the base parser's `_parse_pivot` method, due to `to_identifier`.
            Otherwise, we'd end up with `col_avg(`foo`)` (notice the double quotes).
            """
            agg_all_unquoted = agg.transform(
                lambda node: (
                    exp.Identifier(this=node.name, quoted=False)
                    if isinstance(node, exp.Identifier)
                    else node
                )
            )
            names.append(agg_all_unquoted.sql(dialect=dialect, normalize_functions="lower"))

    return names


def binary_from_function(expr_type: t.Type[B]) -> t.Callable[[t.List], B]:
    return lambda args: expr_type(this=seq_get(args, 0), expression=seq_get(args, 1))


# Used to represent DATE_TRUNC in Doris, Postgres and Starrocks dialects
def build_timestamp_trunc(args: t.List) -> exp.TimestampTrunc:
    return exp.TimestampTrunc(this=seq_get(args, 1), unit=seq_get(args, 0))


def any_value_to_max_sql(self: Generator, expression: exp.AnyValue) -> str:
    return self.func("MAX", expression.this)


def bool_xor_sql(self: Generator, expression: exp.Xor) -> str:
    a = self.sql(expression.left)
    b = self.sql(expression.right)
    return f"({a} AND (NOT {b})) OR ((NOT {a}) AND {b})"


def is_parse_json(expression: exp.Expression) -> bool:
    return isinstance(expression, exp.ParseJSON) or (
        isinstance(expression, exp.Cast) and expression.is_type("json")
    )


def isnull_to_is_null(args: t.List) -> exp.Expression:
    return exp.Paren(this=exp.Is(this=seq_get(args, 0), expression=exp.null()))


def generatedasidentitycolumnconstraint_sql(
    self: Generator, expression: exp.GeneratedAsIdentityColumnConstraint
) -> str:
    start = self.sql(expression, "start") or "1"
    increment = self.sql(expression, "increment") or "1"
    return f"IDENTITY({start}, {increment})"


def arg_max_or_min_no_count(name: str) -> t.Callable[[Generator, exp.ArgMax | exp.ArgMin], str]:
    @unsupported_args("count")
    def _arg_max_or_min_sql(self: Generator, expression: exp.ArgMax | exp.ArgMin) -> str:
        return self.func(name, expression.this, expression.expression)

    return _arg_max_or_min_sql


def ts_or_ds_add_cast(expression: exp.TsOrDsAdd) -> exp.TsOrDsAdd:
    this = expression.this.copy()

    return_type = expression.return_type
    if return_type.is_type(exp.DataType.Type.DATE):
        # If we need to cast to a DATE, we cast to TIMESTAMP first to make sure we
        # can truncate timestamp strings, because some dialects can't cast them to DATE
        this = exp.cast(this, exp.DataType.Type.TIMESTAMP)

    expression.this.replace(exp.cast(this, return_type))
    return expression


def date_delta_sql(name: str, cast: bool = False) -> t.Callable[[Generator, DATE_ADD_OR_DIFF], str]:
    def _delta_sql(self: Generator, expression: DATE_ADD_OR_DIFF) -> str:
        if cast and isinstance(expression, exp.TsOrDsAdd):
            expression = ts_or_ds_add_cast(expression)

        return self.func(
            name,
            unit_to_var(expression),
            expression.expression,
            expression.this,
        )

    return _delta_sql


def unit_to_str(expression: exp.Expression, default: str = "DAY") -> t.Optional[exp.Expression]:
    unit = expression.args.get("unit")

    if isinstance(unit, exp.Placeholder):
        return unit
    if unit:
        return exp.Literal.string(unit.name)
    return exp.Literal.string(default) if default else None


def unit_to_var(expression: exp.Expression, default: str = "DAY") -> t.Optional[exp.Expression]:
    unit = expression.args.get("unit")

    if isinstance(unit, (exp.Var, exp.Placeholder)):
        return unit
    return exp.Var(this=default) if default else None


@t.overload
def map_date_part(part: exp.Expression, dialect: DialectType = Dialect) -> exp.Var:
    pass


@t.overload
def map_date_part(
    part: t.Optional[exp.Expression], dialect: DialectType = Dialect
) -> t.Optional[exp.Expression]:
    pass


def map_date_part(part, dialect: DialectType = Dialect):
    mapped = (
        Dialect.get_or_raise(dialect).DATE_PART_MAPPING.get(part.name.upper()) if part else None
    )
    return exp.var(mapped) if mapped else part


def no_last_day_sql(self: Generator, expression: exp.LastDay) -> str:
    trunc_curr_date = exp.func("date_trunc", "month", expression.this)
    plus_one_month = exp.func("date_add", trunc_curr_date, 1, "month")
    minus_one_day = exp.func("date_sub", plus_one_month, 1, "day")

    return self.sql(exp.cast(minus_one_day, exp.DataType.Type.DATE))


def merge_without_target_sql(self: Generator, expression: exp.Merge) -> str:
    """Remove table refs from columns in when statements."""
    alias = expression.this.args.get("alias")

    def normalize(identifier: t.Optional[exp.Identifier]) -> t.Optional[str]:
        return self.dialect.normalize_identifier(identifier).name if identifier else None

    targets = {normalize(expression.this.this)}

    if alias:
        targets.add(normalize(alias.this))

    for when in expression.expressions:
        # only remove the target names from the THEN clause
        # theyre still valid in the <condition> part of WHEN MATCHED / WHEN NOT MATCHED
        # ref: https://github.com/TobikoData/sqlmesh/issues/2934
        then = when.args.get("then")
        if then:
            then.transform(
                lambda node: (
                    exp.column(node.this)
                    if isinstance(node, exp.Column) and normalize(node.args.get("table")) in targets
                    else node
                ),
                copy=False,
            )

    return self.merge_sql(expression)


def build_json_extract_path(
    expr_type: t.Type[F], zero_based_indexing: bool = True, arrow_req_json_type: bool = False
) -> t.Callable[[t.List], F]:
    def _builder(args: t.List) -> F:
        segments: t.List[exp.JSONPathPart] = [exp.JSONPathRoot()]
        for arg in args[1:]:
            if not isinstance(arg, exp.Literal):
                # We use the fallback parser because we can't really transpile non-literals safely
                return expr_type.from_arg_list(args)

            text = arg.name
            if is_int(text):
                index = int(text)
                segments.append(
                    exp.JSONPathSubscript(this=index if zero_based_indexing else index - 1)
                )
            else:
                segments.append(exp.JSONPathKey(this=text))

        # This is done to avoid failing in the expression validator due to the arg count
        del args[2:]
        return expr_type(
            this=seq_get(args, 0),
            expression=exp.JSONPath(expressions=segments),
            only_json_types=arrow_req_json_type,
        )

    return _builder


def json_extract_segments(
    name: str, quoted_index: bool = True, op: t.Optional[str] = None
) -> t.Callable[[Generator, JSON_EXTRACT_TYPE], str]:
    def _json_extract_segments(self: Generator, expression: JSON_EXTRACT_TYPE) -> str:
        path = expression.expression
        if not isinstance(path, exp.JSONPath):
            return rename_func(name)(self, expression)

        escape = path.args.get("escape")

        segments = []
        for segment in path.expressions:
            path = self.sql(segment)
            if path:
                if isinstance(segment, exp.JSONPathPart) and (
                    quoted_index or not isinstance(segment, exp.JSONPathSubscript)
                ):
                    if escape:
                        path = self.escape_str(path)

                    path = f"{self.dialect.QUOTE_START}{path}{self.dialect.QUOTE_END}"

                segments.append(path)

        if op:
            return f" {op} ".join([self.sql(expression.this), *segments])
        return self.func(name, expression.this, *segments)

    return _json_extract_segments


def json_path_key_only_name(self: Generator, expression: exp.JSONPathKey) -> str:
    if isinstance(expression.this, exp.JSONPathWildcard):
        self.unsupported("Unsupported wildcard in JSONPathKey expression")

    return expression.name


def filter_array_using_unnest(self: Generator, expression: exp.ArrayFilter) -> str:
    cond = expression.expression
    if isinstance(cond, exp.Lambda) and len(cond.expressions) == 1:
        alias = cond.expressions[0]
        cond = cond.this
    elif isinstance(cond, exp.Predicate):
        alias = "_u"
    else:
        self.unsupported("Unsupported filter condition")
        return ""

    unnest = exp.Unnest(expressions=[expression.this])
    filtered = exp.select(alias).from_(exp.alias_(unnest, None, table=[alias])).where(cond)
    return self.sql(exp.Array(expressions=[filtered]))


def to_number_with_nls_param(self: Generator, expression: exp.ToNumber) -> str:
    return self.func(
        "TO_NUMBER",
        expression.this,
        expression.args.get("format"),
        expression.args.get("nlsparam"),
    )


def build_default_decimal_type(
    precision: t.Optional[int] = None, scale: t.Optional[int] = None
) -> t.Callable[[exp.DataType], exp.DataType]:
    def _builder(dtype: exp.DataType) -> exp.DataType:
        if dtype.expressions or precision is None:
            return dtype

        params = f"{precision}{f', {scale}' if scale is not None else ''}"
        return exp.DataType.build(f"DECIMAL({params})")

    return _builder


def build_timestamp_from_parts(args: t.List) -> exp.Func:
    if len(args) == 2:
        # Other dialects don't have the TIMESTAMP_FROM_PARTS(date, time) concept,
        # so we parse this into Anonymous for now instead of introducing complexity
        return exp.Anonymous(this="TIMESTAMP_FROM_PARTS", expressions=args)

    return exp.TimestampFromParts.from_arg_list(args)


def sha256_sql(self: Generator, expression: exp.SHA2) -> str:
    return self.func(f"SHA{expression.text('length') or '256'}", expression.this)


def sequence_sql(self: Generator, expression: exp.GenerateSeries | exp.GenerateDateArray) -> str:
    start = expression.args.get("start")
    end = expression.args.get("end")
    step = expression.args.get("step")

    if isinstance(start, exp.Cast):
        target_type = start.to
    elif isinstance(end, exp.Cast):
        target_type = end.to
    else:
        target_type = None

    if start and end and target_type and target_type.is_type("date", "timestamp"):
        if isinstance(start, exp.Cast) and target_type is start.to:
            end = exp.cast(end, target_type)
        else:
            start = exp.cast(start, target_type)

    return self.func("SEQUENCE", start, end, step)


def build_regexp_extract(expr_type: t.Type[E]) -> t.Callable[[t.List, Dialect], E]:
    def _builder(args: t.List, dialect: Dialect) -> E:
        return expr_type(
            this=seq_get(args, 0),
            expression=seq_get(args, 1),
            group=seq_get(args, 2) or exp.Literal.number(dialect.REGEXP_EXTRACT_DEFAULT_GROUP),
            parameters=seq_get(args, 3),
        )

    return _builder


def explode_to_unnest_sql(self: Generator, expression: exp.Lateral) -> str:
    if isinstance(expression.this, exp.Explode):
        return self.sql(
            exp.Join(
                this=exp.Unnest(
                    expressions=[expression.this.this],
                    alias=expression.args.get("alias"),
                    offset=isinstance(expression.this, exp.Posexplode),
                ),
                kind="cross",
            )
        )
    return self.lateral_sql(expression)


def timestampdiff_sql(self: Generator, expression: exp.DatetimeDiff | exp.TimestampDiff) -> str:
    return self.func("TIMESTAMPDIFF", expression.unit, expression.expression, expression.this)


def no_make_interval_sql(self: Generator, expression: exp.MakeInterval, sep: str = ", ") -> str:
    args = []
    for unit, value in expression.args.items():
        if isinstance(value, exp.Kwarg):
            value = value.expression

        args.append(f"{value} {unit}")

    return f"INTERVAL '{self.format_args(*args, sep=sep)}'"
