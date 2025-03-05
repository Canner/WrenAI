from __future__ import annotations

import logging
import typing as t
from collections import defaultdict

from sqlglot import exp
from sqlglot.errors import ErrorLevel, ParseError, concat_messages, merge_errors
from sqlglot.helper import apply_index_offset, ensure_list, seq_get
from sqlglot.time import format_time
from sqlglot.tokens import Token, Tokenizer, TokenType
from sqlglot.trie import TrieResult, in_trie, new_trie

if t.TYPE_CHECKING:
    from sqlglot._typing import E, Lit
    from sqlglot.dialects.dialect import Dialect, DialectType

    T = t.TypeVar("T")

logger = logging.getLogger("sqlglot")

OPTIONS_TYPE = t.Dict[str, t.Sequence[t.Union[t.Sequence[str], str]]]


def build_var_map(args: t.List) -> exp.StarMap | exp.VarMap:
    if len(args) == 1 and args[0].is_star:
        return exp.StarMap(this=args[0])

    keys = []
    values = []
    for i in range(0, len(args), 2):
        keys.append(args[i])
        values.append(args[i + 1])

    return exp.VarMap(keys=exp.array(*keys, copy=False), values=exp.array(*values, copy=False))


def build_like(args: t.List) -> exp.Escape | exp.Like:
    like = exp.Like(this=seq_get(args, 1), expression=seq_get(args, 0))
    return exp.Escape(this=like, expression=seq_get(args, 2)) if len(args) > 2 else like


def binary_range_parser(
    expr_type: t.Type[exp.Expression], reverse_args: bool = False
) -> t.Callable[[Parser, t.Optional[exp.Expression]], t.Optional[exp.Expression]]:
    def _parse_binary_range(
        self: Parser, this: t.Optional[exp.Expression]
    ) -> t.Optional[exp.Expression]:
        expression = self._parse_bitwise()
        if reverse_args:
            this, expression = expression, this
        return self._parse_escape(self.expression(expr_type, this=this, expression=expression))

    return _parse_binary_range


def build_logarithm(args: t.List, dialect: Dialect) -> exp.Func:
    # Default argument order is base, expression
    this = seq_get(args, 0)
    expression = seq_get(args, 1)

    if expression:
        if not dialect.LOG_BASE_FIRST:
            this, expression = expression, this
        return exp.Log(this=this, expression=expression)

    return (exp.Ln if dialect.parser_class.LOG_DEFAULTS_TO_LN else exp.Log)(this=this)


def build_hex(args: t.List, dialect: Dialect) -> exp.Hex | exp.LowerHex:
    arg = seq_get(args, 0)
    return exp.LowerHex(this=arg) if dialect.HEX_LOWERCASE else exp.Hex(this=arg)


def build_lower(args: t.List) -> exp.Lower | exp.Hex:
    # LOWER(HEX(..)) can be simplified to LowerHex to simplify its transpilation
    arg = seq_get(args, 0)
    return exp.LowerHex(this=arg.this) if isinstance(arg, exp.Hex) else exp.Lower(this=arg)


def build_upper(args: t.List) -> exp.Upper | exp.Hex:
    # UPPER(HEX(..)) can be simplified to Hex to simplify its transpilation
    arg = seq_get(args, 0)
    return exp.Hex(this=arg.this) if isinstance(arg, exp.Hex) else exp.Upper(this=arg)


def build_extract_json_with_path(expr_type: t.Type[E]) -> t.Callable[[t.List, Dialect], E]:
    def _builder(args: t.List, dialect: Dialect) -> E:
        expression = expr_type(
            this=seq_get(args, 0), expression=dialect.to_json_path(seq_get(args, 1))
        )
        if len(args) > 2 and expr_type is exp.JSONExtract:
            expression.set("expressions", args[2:])

        return expression

    return _builder


def build_mod(args: t.List) -> exp.Mod:
    this = seq_get(args, 0)
    expression = seq_get(args, 1)

    # Wrap the operands if they are binary nodes, e.g. MOD(a + 1, 7) -> (a + 1) % 7
    this = exp.Paren(this=this) if isinstance(this, exp.Binary) else this
    expression = exp.Paren(this=expression) if isinstance(expression, exp.Binary) else expression

    return exp.Mod(this=this, expression=expression)


def build_pad(args: t.List, is_left: bool = True):
    return exp.Pad(
        this=seq_get(args, 0),
        expression=seq_get(args, 1),
        fill_pattern=seq_get(args, 2),
        is_left=is_left,
    )


def build_array_constructor(
    exp_class: t.Type[E], args: t.List, bracket_kind: TokenType, dialect: Dialect
) -> exp.Expression:
    array_exp = exp_class(expressions=args)

    if exp_class == exp.Array and dialect.HAS_DISTINCT_ARRAY_CONSTRUCTORS:
        array_exp.set("bracket_notation", bracket_kind == TokenType.L_BRACKET)

    return array_exp


def build_convert_timezone(
    args: t.List, default_source_tz: t.Optional[str] = None
) -> t.Union[exp.ConvertTimezone, exp.Anonymous]:
    if len(args) == 2:
        source_tz = exp.Literal.string(default_source_tz) if default_source_tz else None
        return exp.ConvertTimezone(
            source_tz=source_tz, target_tz=seq_get(args, 0), timestamp=seq_get(args, 1)
        )

    return exp.ConvertTimezone.from_arg_list(args)


def build_trim(args: t.List, is_left: bool = True):
    return exp.Trim(
        this=seq_get(args, 0),
        expression=seq_get(args, 1),
        position="LEADING" if is_left else "TRAILING",
    )


def build_coalesce(args: t.List, is_nvl: t.Optional[bool] = None) -> exp.Coalesce:
    return exp.Coalesce(this=seq_get(args, 0), expressions=args[1:], is_nvl=is_nvl)


class _Parser(type):
    def __new__(cls, clsname, bases, attrs):
        klass = super().__new__(cls, clsname, bases, attrs)

        klass.SHOW_TRIE = new_trie(key.split(" ") for key in klass.SHOW_PARSERS)
        klass.SET_TRIE = new_trie(key.split(" ") for key in klass.SET_PARSERS)

        return klass


class Parser(metaclass=_Parser):
    """
    Parser consumes a list of tokens produced by the Tokenizer and produces a parsed syntax tree.

    Args:
        error_level: The desired error level.
            Default: ErrorLevel.IMMEDIATE
        error_message_context: The amount of context to capture from a query string when displaying
            the error message (in number of characters).
            Default: 100
        max_errors: Maximum number of error messages to include in a raised ParseError.
            This is only relevant if error_level is ErrorLevel.RAISE.
            Default: 3
    """

    FUNCTIONS: t.Dict[str, t.Callable] = {
        **{name: func.from_arg_list for name, func in exp.FUNCTION_BY_NAME.items()},
        **dict.fromkeys(("COALESCE", "IFNULL", "NVL"), build_coalesce),
        "ARRAY": lambda args, dialect: exp.Array(expressions=args),
        "ARRAYAGG": lambda args, dialect: exp.ArrayAgg(
            this=seq_get(args, 0), nulls_excluded=dialect.ARRAY_AGG_INCLUDES_NULLS is None or None
        ),
        "ARRAY_AGG": lambda args, dialect: exp.ArrayAgg(
            this=seq_get(args, 0), nulls_excluded=dialect.ARRAY_AGG_INCLUDES_NULLS is None or None
        ),
        "CHAR": lambda args: exp.Chr(expressions=args),
        "CHR": lambda args: exp.Chr(expressions=args),
        "COUNT": lambda args: exp.Count(this=seq_get(args, 0), expressions=args[1:], big_int=True),
        "CONCAT": lambda args, dialect: exp.Concat(
            expressions=args,
            safe=not dialect.STRICT_STRING_CONCAT,
            coalesce=dialect.CONCAT_COALESCE,
        ),
        "CONCAT_WS": lambda args, dialect: exp.ConcatWs(
            expressions=args,
            safe=not dialect.STRICT_STRING_CONCAT,
            coalesce=dialect.CONCAT_COALESCE,
        ),
        "CONVERT_TIMEZONE": build_convert_timezone,
        "DATE_TO_DATE_STR": lambda args: exp.Cast(
            this=seq_get(args, 0),
            to=exp.DataType(this=exp.DataType.Type.TEXT),
        ),
        "GENERATE_DATE_ARRAY": lambda args: exp.GenerateDateArray(
            start=seq_get(args, 0),
            end=seq_get(args, 1),
            step=seq_get(args, 2) or exp.Interval(this=exp.Literal.number(1), unit=exp.var("DAY")),
        ),
        "GLOB": lambda args: exp.Glob(this=seq_get(args, 1), expression=seq_get(args, 0)),
        "HEX": build_hex,
        "INSTR": lambda args: exp.StrPosition(this=seq_get(args, 0), substr=seq_get(args, 1)),
        "JSON_EXTRACT": build_extract_json_with_path(exp.JSONExtract),
        "JSON_EXTRACT_SCALAR": build_extract_json_with_path(exp.JSONExtractScalar),
        "JSON_EXTRACT_PATH_TEXT": build_extract_json_with_path(exp.JSONExtractScalar),
        "LIKE": build_like,
        "LOG": build_logarithm,
        "LOG2": lambda args: exp.Log(this=exp.Literal.number(2), expression=seq_get(args, 0)),
        "LOG10": lambda args: exp.Log(this=exp.Literal.number(10), expression=seq_get(args, 0)),
        "LOWER": build_lower,
        "LPAD": lambda args: build_pad(args),
        "LEFTPAD": lambda args: build_pad(args),
        "LTRIM": lambda args: build_trim(args),
        "MOD": build_mod,
        "RIGHTPAD": lambda args: build_pad(args, is_left=False),
        "RPAD": lambda args: build_pad(args, is_left=False),
        "RTRIM": lambda args: build_trim(args, is_left=False),
        "SCOPE_RESOLUTION": lambda args: exp.ScopeResolution(expression=seq_get(args, 0))
        if len(args) != 2
        else exp.ScopeResolution(this=seq_get(args, 0), expression=seq_get(args, 1)),
        "TIME_TO_TIME_STR": lambda args: exp.Cast(
            this=seq_get(args, 0),
            to=exp.DataType(this=exp.DataType.Type.TEXT),
        ),
        "TO_HEX": build_hex,
        "TS_OR_DS_TO_DATE_STR": lambda args: exp.Substring(
            this=exp.Cast(
                this=seq_get(args, 0),
                to=exp.DataType(this=exp.DataType.Type.TEXT),
            ),
            start=exp.Literal.number(1),
            length=exp.Literal.number(10),
        ),
        "UNNEST": lambda args: exp.Unnest(expressions=ensure_list(seq_get(args, 0))),
        "UPPER": build_upper,
        "VAR_MAP": build_var_map,
    }

    NO_PAREN_FUNCTIONS = {
        TokenType.CURRENT_DATE: exp.CurrentDate,
        TokenType.CURRENT_DATETIME: exp.CurrentDate,
        TokenType.CURRENT_TIME: exp.CurrentTime,
        TokenType.CURRENT_TIMESTAMP: exp.CurrentTimestamp,
        TokenType.CURRENT_USER: exp.CurrentUser,
    }

    STRUCT_TYPE_TOKENS = {
        TokenType.NESTED,
        TokenType.OBJECT,
        TokenType.STRUCT,
        TokenType.UNION,
    }

    NESTED_TYPE_TOKENS = {
        TokenType.ARRAY,
        TokenType.LIST,
        TokenType.LOWCARDINALITY,
        TokenType.MAP,
        TokenType.NULLABLE,
        TokenType.RANGE,
        *STRUCT_TYPE_TOKENS,
    }

    ENUM_TYPE_TOKENS = {
        TokenType.ENUM,
        TokenType.ENUM8,
        TokenType.ENUM16,
    }

    AGGREGATE_TYPE_TOKENS = {
        TokenType.AGGREGATEFUNCTION,
        TokenType.SIMPLEAGGREGATEFUNCTION,
    }

    TYPE_TOKENS = {
        TokenType.BIT,
        TokenType.BOOLEAN,
        TokenType.TINYINT,
        TokenType.UTINYINT,
        TokenType.SMALLINT,
        TokenType.USMALLINT,
        TokenType.INT,
        TokenType.UINT,
        TokenType.BIGINT,
        TokenType.UBIGINT,
        TokenType.INT128,
        TokenType.UINT128,
        TokenType.INT256,
        TokenType.UINT256,
        TokenType.MEDIUMINT,
        TokenType.UMEDIUMINT,
        TokenType.FIXEDSTRING,
        TokenType.FLOAT,
        TokenType.DOUBLE,
        TokenType.CHAR,
        TokenType.NCHAR,
        TokenType.VARCHAR,
        TokenType.NVARCHAR,
        TokenType.BPCHAR,
        TokenType.TEXT,
        TokenType.MEDIUMTEXT,
        TokenType.LONGTEXT,
        TokenType.MEDIUMBLOB,
        TokenType.LONGBLOB,
        TokenType.BINARY,
        TokenType.VARBINARY,
        TokenType.JSON,
        TokenType.JSONB,
        TokenType.INTERVAL,
        TokenType.TINYBLOB,
        TokenType.TINYTEXT,
        TokenType.TIME,
        TokenType.TIMETZ,
        TokenType.TIMESTAMP,
        TokenType.TIMESTAMP_S,
        TokenType.TIMESTAMP_MS,
        TokenType.TIMESTAMP_NS,
        TokenType.TIMESTAMPTZ,
        TokenType.TIMESTAMPLTZ,
        TokenType.TIMESTAMPNTZ,
        TokenType.DATETIME,
        TokenType.DATETIME64,
        TokenType.DATE,
        TokenType.DATE32,
        TokenType.INT4RANGE,
        TokenType.INT4MULTIRANGE,
        TokenType.INT8RANGE,
        TokenType.INT8MULTIRANGE,
        TokenType.NUMRANGE,
        TokenType.NUMMULTIRANGE,
        TokenType.TSRANGE,
        TokenType.TSMULTIRANGE,
        TokenType.TSTZRANGE,
        TokenType.TSTZMULTIRANGE,
        TokenType.DATERANGE,
        TokenType.DATEMULTIRANGE,
        TokenType.DECIMAL,
        TokenType.DECIMAL32,
        TokenType.DECIMAL64,
        TokenType.DECIMAL128,
        TokenType.DECIMAL256,
        TokenType.UDECIMAL,
        TokenType.BIGDECIMAL,
        TokenType.UUID,
        TokenType.GEOGRAPHY,
        TokenType.GEOMETRY,
        TokenType.POINT,
        TokenType.RING,
        TokenType.LINESTRING,
        TokenType.MULTILINESTRING,
        TokenType.POLYGON,
        TokenType.MULTIPOLYGON,
        TokenType.HLLSKETCH,
        TokenType.HSTORE,
        TokenType.PSEUDO_TYPE,
        TokenType.SUPER,
        TokenType.SERIAL,
        TokenType.SMALLSERIAL,
        TokenType.BIGSERIAL,
        TokenType.XML,
        TokenType.YEAR,
        TokenType.UNIQUEIDENTIFIER,
        TokenType.USERDEFINED,
        TokenType.MONEY,
        TokenType.SMALLMONEY,
        TokenType.ROWVERSION,
        TokenType.IMAGE,
        TokenType.VARIANT,
        TokenType.VECTOR,
        TokenType.OBJECT,
        TokenType.OBJECT_IDENTIFIER,
        TokenType.INET,
        TokenType.IPADDRESS,
        TokenType.IPPREFIX,
        TokenType.IPV4,
        TokenType.IPV6,
        TokenType.UNKNOWN,
        TokenType.NULL,
        TokenType.NAME,
        TokenType.TDIGEST,
        *ENUM_TYPE_TOKENS,
        *NESTED_TYPE_TOKENS,
        *AGGREGATE_TYPE_TOKENS,
    }

    SIGNED_TO_UNSIGNED_TYPE_TOKEN = {
        TokenType.BIGINT: TokenType.UBIGINT,
        TokenType.INT: TokenType.UINT,
        TokenType.MEDIUMINT: TokenType.UMEDIUMINT,
        TokenType.SMALLINT: TokenType.USMALLINT,
        TokenType.TINYINT: TokenType.UTINYINT,
        TokenType.DECIMAL: TokenType.UDECIMAL,
    }

    SUBQUERY_PREDICATES = {
        TokenType.ANY: exp.Any,
        TokenType.ALL: exp.All,
        TokenType.EXISTS: exp.Exists,
        TokenType.SOME: exp.Any,
    }

    RESERVED_TOKENS = {
        *Tokenizer.SINGLE_TOKENS.values(),
        TokenType.SELECT,
    } - {TokenType.IDENTIFIER}

    DB_CREATABLES = {
        TokenType.DATABASE,
        TokenType.DICTIONARY,
        TokenType.MODEL,
        TokenType.SCHEMA,
        TokenType.SEQUENCE,
        TokenType.STORAGE_INTEGRATION,
        TokenType.TABLE,
        TokenType.TAG,
        TokenType.VIEW,
        TokenType.WAREHOUSE,
        TokenType.STREAMLIT,
        TokenType.SINK,
        TokenType.SOURCE,
    }

    CREATABLES = {
        TokenType.COLUMN,
        TokenType.CONSTRAINT,
        TokenType.FOREIGN_KEY,
        TokenType.FUNCTION,
        TokenType.INDEX,
        TokenType.PROCEDURE,
        *DB_CREATABLES,
    }

    ALTERABLES = {
        TokenType.INDEX,
        TokenType.TABLE,
        TokenType.VIEW,
    }

    # Tokens that can represent identifiers
    ID_VAR_TOKENS = {
        TokenType.ALL,
        TokenType.ATTACH,
        TokenType.VAR,
        TokenType.ANTI,
        TokenType.APPLY,
        TokenType.ASC,
        TokenType.ASOF,
        TokenType.AUTO_INCREMENT,
        TokenType.BEGIN,
        TokenType.BPCHAR,
        TokenType.CACHE,
        TokenType.CASE,
        TokenType.COLLATE,
        TokenType.COMMAND,
        TokenType.COMMENT,
        TokenType.COMMIT,
        TokenType.CONSTRAINT,
        TokenType.COPY,
        TokenType.CUBE,
        TokenType.DEFAULT,
        TokenType.DELETE,
        TokenType.DESC,
        TokenType.DESCRIBE,
        TokenType.DETACH,
        TokenType.DICTIONARY,
        TokenType.DIV,
        TokenType.END,
        TokenType.EXECUTE,
        TokenType.ESCAPE,
        TokenType.FALSE,
        TokenType.FIRST,
        TokenType.FILTER,
        TokenType.FINAL,
        TokenType.FORMAT,
        TokenType.FULL,
        TokenType.IDENTIFIER,
        TokenType.IS,
        TokenType.ISNULL,
        TokenType.INTERVAL,
        TokenType.KEEP,
        TokenType.KILL,
        TokenType.LEFT,
        TokenType.LOAD,
        TokenType.MERGE,
        TokenType.NATURAL,
        TokenType.NEXT,
        TokenType.OFFSET,
        TokenType.OPERATOR,
        TokenType.ORDINALITY,
        TokenType.OVERLAPS,
        TokenType.OVERWRITE,
        TokenType.PARTITION,
        TokenType.PERCENT,
        TokenType.PIVOT,
        TokenType.PRAGMA,
        TokenType.RANGE,
        TokenType.RECURSIVE,
        TokenType.REFERENCES,
        TokenType.REFRESH,
        TokenType.RENAME,
        TokenType.REPLACE,
        TokenType.RIGHT,
        TokenType.ROLLUP,
        TokenType.ROW,
        TokenType.ROWS,
        TokenType.SEMI,
        TokenType.SET,
        TokenType.SETTINGS,
        TokenType.SHOW,
        TokenType.TEMPORARY,
        TokenType.TOP,
        TokenType.TRUE,
        TokenType.TRUNCATE,
        TokenType.UNIQUE,
        TokenType.UNNEST,
        TokenType.UNPIVOT,
        TokenType.UPDATE,
        TokenType.USE,
        TokenType.VOLATILE,
        TokenType.WINDOW,
        *CREATABLES,
        *SUBQUERY_PREDICATES,
        *TYPE_TOKENS,
        *NO_PAREN_FUNCTIONS,
    }
    ID_VAR_TOKENS.remove(TokenType.UNION)

    INTERVAL_VARS = ID_VAR_TOKENS - {TokenType.END}

    TABLE_ALIAS_TOKENS = ID_VAR_TOKENS - {
        TokenType.ANTI,
        TokenType.APPLY,
        TokenType.ASOF,
        TokenType.FULL,
        TokenType.LEFT,
        TokenType.LOCK,
        TokenType.NATURAL,
        TokenType.OFFSET,
        TokenType.RIGHT,
        TokenType.SEMI,
        TokenType.WINDOW,
    }

    ALIAS_TOKENS = ID_VAR_TOKENS

    ARRAY_CONSTRUCTORS = {
        "ARRAY": exp.Array,
        "LIST": exp.List,
    }

    COMMENT_TABLE_ALIAS_TOKENS = TABLE_ALIAS_TOKENS - {TokenType.IS}

    UPDATE_ALIAS_TOKENS = TABLE_ALIAS_TOKENS - {TokenType.SET}

    TRIM_TYPES = {"LEADING", "TRAILING", "BOTH"}

    FUNC_TOKENS = {
        TokenType.COLLATE,
        TokenType.COMMAND,
        TokenType.CURRENT_DATE,
        TokenType.CURRENT_DATETIME,
        TokenType.CURRENT_TIMESTAMP,
        TokenType.CURRENT_TIME,
        TokenType.CURRENT_USER,
        TokenType.FILTER,
        TokenType.FIRST,
        TokenType.FORMAT,
        TokenType.GLOB,
        TokenType.IDENTIFIER,
        TokenType.INDEX,
        TokenType.ISNULL,
        TokenType.ILIKE,
        TokenType.INSERT,
        TokenType.LIKE,
        TokenType.MERGE,
        TokenType.NEXT,
        TokenType.OFFSET,
        TokenType.PRIMARY_KEY,
        TokenType.RANGE,
        TokenType.REPLACE,
        TokenType.RLIKE,
        TokenType.ROW,
        TokenType.UNNEST,
        TokenType.VAR,
        TokenType.LEFT,
        TokenType.RIGHT,
        TokenType.SEQUENCE,
        TokenType.DATE,
        TokenType.DATETIME,
        TokenType.TABLE,
        TokenType.TIMESTAMP,
        TokenType.TIMESTAMPTZ,
        TokenType.TRUNCATE,
        TokenType.WINDOW,
        TokenType.XOR,
        *TYPE_TOKENS,
        *SUBQUERY_PREDICATES,
    }

    CONJUNCTION: t.Dict[TokenType, t.Type[exp.Expression]] = {
        TokenType.AND: exp.And,
    }

    ASSIGNMENT: t.Dict[TokenType, t.Type[exp.Expression]] = {
        TokenType.COLON_EQ: exp.PropertyEQ,
    }

    DISJUNCTION: t.Dict[TokenType, t.Type[exp.Expression]] = {
        TokenType.OR: exp.Or,
    }

    EQUALITY = {
        TokenType.EQ: exp.EQ,
        TokenType.NEQ: exp.NEQ,
        TokenType.NULLSAFE_EQ: exp.NullSafeEQ,
    }

    COMPARISON = {
        TokenType.GT: exp.GT,
        TokenType.GTE: exp.GTE,
        TokenType.LT: exp.LT,
        TokenType.LTE: exp.LTE,
    }

    BITWISE = {
        TokenType.AMP: exp.BitwiseAnd,
        TokenType.CARET: exp.BitwiseXor,
        TokenType.PIPE: exp.BitwiseOr,
    }

    TERM = {
        TokenType.DASH: exp.Sub,
        TokenType.PLUS: exp.Add,
        TokenType.MOD: exp.Mod,
        TokenType.COLLATE: exp.Collate,
    }

    FACTOR = {
        TokenType.DIV: exp.IntDiv,
        TokenType.LR_ARROW: exp.Distance,
        TokenType.SLASH: exp.Div,
        TokenType.STAR: exp.Mul,
    }

    EXPONENT: t.Dict[TokenType, t.Type[exp.Expression]] = {}

    TIMES = {
        TokenType.TIME,
        TokenType.TIMETZ,
    }

    TIMESTAMPS = {
        TokenType.TIMESTAMP,
        TokenType.TIMESTAMPTZ,
        TokenType.TIMESTAMPLTZ,
        *TIMES,
    }

    SET_OPERATIONS = {
        TokenType.UNION,
        TokenType.INTERSECT,
        TokenType.EXCEPT,
    }

    JOIN_METHODS = {
        TokenType.ASOF,
        TokenType.NATURAL,
        TokenType.POSITIONAL,
    }

    JOIN_SIDES = {
        TokenType.LEFT,
        TokenType.RIGHT,
        TokenType.FULL,
    }

    JOIN_KINDS = {
        TokenType.ANTI,
        TokenType.CROSS,
        TokenType.INNER,
        TokenType.OUTER,
        TokenType.SEMI,
        TokenType.STRAIGHT_JOIN,
    }

    JOIN_HINTS: t.Set[str] = set()

    LAMBDAS = {
        TokenType.ARROW: lambda self, expressions: self.expression(
            exp.Lambda,
            this=self._replace_lambda(
                self._parse_assignment(),
                expressions,
            ),
            expressions=expressions,
        ),
        TokenType.FARROW: lambda self, expressions: self.expression(
            exp.Kwarg,
            this=exp.var(expressions[0].name),
            expression=self._parse_assignment(),
        ),
    }

    COLUMN_OPERATORS = {
        TokenType.DOT: None,
        TokenType.DCOLON: lambda self, this, to: self.expression(
            exp.Cast if self.STRICT_CAST else exp.TryCast,
            this=this,
            to=to,
        ),
        TokenType.ARROW: lambda self, this, path: self.expression(
            exp.JSONExtract,
            this=this,
            expression=self.dialect.to_json_path(path),
            only_json_types=self.JSON_ARROWS_REQUIRE_JSON_TYPE,
        ),
        TokenType.DARROW: lambda self, this, path: self.expression(
            exp.JSONExtractScalar,
            this=this,
            expression=self.dialect.to_json_path(path),
            only_json_types=self.JSON_ARROWS_REQUIRE_JSON_TYPE,
        ),
        TokenType.HASH_ARROW: lambda self, this, path: self.expression(
            exp.JSONBExtract,
            this=this,
            expression=path,
        ),
        TokenType.DHASH_ARROW: lambda self, this, path: self.expression(
            exp.JSONBExtractScalar,
            this=this,
            expression=path,
        ),
        TokenType.PLACEHOLDER: lambda self, this, key: self.expression(
            exp.JSONBContains,
            this=this,
            expression=key,
        ),
    }

    EXPRESSION_PARSERS = {
        exp.Cluster: lambda self: self._parse_sort(exp.Cluster, TokenType.CLUSTER_BY),
        exp.Column: lambda self: self._parse_column(),
        exp.Condition: lambda self: self._parse_assignment(),
        exp.DataType: lambda self: self._parse_types(allow_identifiers=False, schema=True),
        exp.Expression: lambda self: self._parse_expression(),
        exp.From: lambda self: self._parse_from(joins=True),
        exp.Group: lambda self: self._parse_group(),
        exp.Having: lambda self: self._parse_having(),
        exp.Hint: lambda self: self._parse_hint_body(),
        exp.Identifier: lambda self: self._parse_id_var(),
        exp.Join: lambda self: self._parse_join(),
        exp.Lambda: lambda self: self._parse_lambda(),
        exp.Lateral: lambda self: self._parse_lateral(),
        exp.Limit: lambda self: self._parse_limit(),
        exp.Offset: lambda self: self._parse_offset(),
        exp.Order: lambda self: self._parse_order(),
        exp.Ordered: lambda self: self._parse_ordered(),
        exp.Properties: lambda self: self._parse_properties(),
        exp.Qualify: lambda self: self._parse_qualify(),
        exp.Returning: lambda self: self._parse_returning(),
        exp.Select: lambda self: self._parse_select(),
        exp.Sort: lambda self: self._parse_sort(exp.Sort, TokenType.SORT_BY),
        exp.Table: lambda self: self._parse_table_parts(),
        exp.TableAlias: lambda self: self._parse_table_alias(),
        exp.Tuple: lambda self: self._parse_value(),
        exp.When: lambda self: seq_get(self._parse_when_matched(), 0),
        exp.Where: lambda self: self._parse_where(),
        exp.Window: lambda self: self._parse_named_window(),
        exp.With: lambda self: self._parse_with(),
        "JOIN_TYPE": lambda self: self._parse_join_parts(),
    }

    STATEMENT_PARSERS = {
        TokenType.ALTER: lambda self: self._parse_alter(),
        TokenType.BEGIN: lambda self: self._parse_transaction(),
        TokenType.CACHE: lambda self: self._parse_cache(),
        TokenType.COMMENT: lambda self: self._parse_comment(),
        TokenType.COMMIT: lambda self: self._parse_commit_or_rollback(),
        TokenType.COPY: lambda self: self._parse_copy(),
        TokenType.CREATE: lambda self: self._parse_create(),
        TokenType.DELETE: lambda self: self._parse_delete(),
        TokenType.DESC: lambda self: self._parse_describe(),
        TokenType.DESCRIBE: lambda self: self._parse_describe(),
        TokenType.DROP: lambda self: self._parse_drop(),
        TokenType.GRANT: lambda self: self._parse_grant(),
        TokenType.INSERT: lambda self: self._parse_insert(),
        TokenType.KILL: lambda self: self._parse_kill(),
        TokenType.LOAD: lambda self: self._parse_load(),
        TokenType.MERGE: lambda self: self._parse_merge(),
        TokenType.PIVOT: lambda self: self._parse_simplified_pivot(),
        TokenType.PRAGMA: lambda self: self.expression(exp.Pragma, this=self._parse_expression()),
        TokenType.REFRESH: lambda self: self._parse_refresh(),
        TokenType.ROLLBACK: lambda self: self._parse_commit_or_rollback(),
        TokenType.SET: lambda self: self._parse_set(),
        TokenType.TRUNCATE: lambda self: self._parse_truncate_table(),
        TokenType.UNCACHE: lambda self: self._parse_uncache(),
        TokenType.UPDATE: lambda self: self._parse_update(),
        TokenType.USE: lambda self: self.expression(
            exp.Use,
            kind=self._parse_var_from_options(self.USABLES, raise_unmatched=False),
            this=self._parse_table(schema=False),
        ),
        TokenType.SEMICOLON: lambda self: exp.Semicolon(),
    }

    UNARY_PARSERS = {
        TokenType.PLUS: lambda self: self._parse_unary(),  # Unary + is handled as a no-op
        TokenType.NOT: lambda self: self.expression(exp.Not, this=self._parse_equality()),
        TokenType.TILDA: lambda self: self.expression(exp.BitwiseNot, this=self._parse_unary()),
        TokenType.DASH: lambda self: self.expression(exp.Neg, this=self._parse_unary()),
        TokenType.PIPE_SLASH: lambda self: self.expression(exp.Sqrt, this=self._parse_unary()),
        TokenType.DPIPE_SLASH: lambda self: self.expression(exp.Cbrt, this=self._parse_unary()),
    }

    STRING_PARSERS = {
        TokenType.HEREDOC_STRING: lambda self, token: self.expression(
            exp.RawString, this=token.text
        ),
        TokenType.NATIONAL_STRING: lambda self, token: self.expression(
            exp.National, this=token.text
        ),
        TokenType.RAW_STRING: lambda self, token: self.expression(exp.RawString, this=token.text),
        TokenType.STRING: lambda self, token: self.expression(
            exp.Literal, this=token.text, is_string=True
        ),
        TokenType.UNICODE_STRING: lambda self, token: self.expression(
            exp.UnicodeString,
            this=token.text,
            escape=self._match_text_seq("UESCAPE") and self._parse_string(),
        ),
    }

    NUMERIC_PARSERS = {
        TokenType.BIT_STRING: lambda self, token: self.expression(exp.BitString, this=token.text),
        TokenType.BYTE_STRING: lambda self, token: self.expression(exp.ByteString, this=token.text),
        TokenType.HEX_STRING: lambda self, token: self.expression(exp.HexString, this=token.text),
        TokenType.NUMBER: lambda self, token: self.expression(
            exp.Literal, this=token.text, is_string=False
        ),
    }

    PRIMARY_PARSERS = {
        **STRING_PARSERS,
        **NUMERIC_PARSERS,
        TokenType.INTRODUCER: lambda self, token: self._parse_introducer(token),
        TokenType.NULL: lambda self, _: self.expression(exp.Null),
        TokenType.TRUE: lambda self, _: self.expression(exp.Boolean, this=True),
        TokenType.FALSE: lambda self, _: self.expression(exp.Boolean, this=False),
        TokenType.SESSION_PARAMETER: lambda self, _: self._parse_session_parameter(),
        TokenType.STAR: lambda self, _: self._parse_star_ops(),
    }

    PLACEHOLDER_PARSERS = {
        TokenType.PLACEHOLDER: lambda self: self.expression(exp.Placeholder),
        TokenType.PARAMETER: lambda self: self._parse_parameter(),
        TokenType.COLON: lambda self: (
            self.expression(exp.Placeholder, this=self._prev.text)
            if self._match_set(self.ID_VAR_TOKENS)
            else None
        ),
    }

    RANGE_PARSERS = {
        TokenType.AT_GT: binary_range_parser(exp.ArrayContainsAll),
        TokenType.BETWEEN: lambda self, this: self._parse_between(this),
        TokenType.GLOB: binary_range_parser(exp.Glob),
        TokenType.ILIKE: binary_range_parser(exp.ILike),
        TokenType.IN: lambda self, this: self._parse_in(this),
        TokenType.IRLIKE: binary_range_parser(exp.RegexpILike),
        TokenType.IS: lambda self, this: self._parse_is(this),
        TokenType.LIKE: binary_range_parser(exp.Like),
        TokenType.LT_AT: binary_range_parser(exp.ArrayContainsAll, reverse_args=True),
        TokenType.OVERLAPS: binary_range_parser(exp.Overlaps),
        TokenType.RLIKE: binary_range_parser(exp.RegexpLike),
        TokenType.SIMILAR_TO: binary_range_parser(exp.SimilarTo),
        TokenType.FOR: lambda self, this: self._parse_comprehension(this),
    }

    PROPERTY_PARSERS: t.Dict[str, t.Callable] = {
        "ALLOWED_VALUES": lambda self: self.expression(
            exp.AllowedValuesProperty, expressions=self._parse_csv(self._parse_primary)
        ),
        "ALGORITHM": lambda self: self._parse_property_assignment(exp.AlgorithmProperty),
        "AUTO": lambda self: self._parse_auto_property(),
        "AUTO_INCREMENT": lambda self: self._parse_property_assignment(exp.AutoIncrementProperty),
        "BACKUP": lambda self: self.expression(
            exp.BackupProperty, this=self._parse_var(any_token=True)
        ),
        "BLOCKCOMPRESSION": lambda self: self._parse_blockcompression(),
        "CHARSET": lambda self, **kwargs: self._parse_character_set(**kwargs),
        "CHARACTER SET": lambda self, **kwargs: self._parse_character_set(**kwargs),
        "CHECKSUM": lambda self: self._parse_checksum(),
        "CLUSTER BY": lambda self: self._parse_cluster(),
        "CLUSTERED": lambda self: self._parse_clustered_by(),
        "COLLATE": lambda self, **kwargs: self._parse_property_assignment(
            exp.CollateProperty, **kwargs
        ),
        "COMMENT": lambda self: self._parse_property_assignment(exp.SchemaCommentProperty),
        "CONTAINS": lambda self: self._parse_contains_property(),
        "COPY": lambda self: self._parse_copy_property(),
        "DATABLOCKSIZE": lambda self, **kwargs: self._parse_datablocksize(**kwargs),
        "DATA_DELETION": lambda self: self._parse_data_deletion_property(),
        "DEFINER": lambda self: self._parse_definer(),
        "DETERMINISTIC": lambda self: self.expression(
            exp.StabilityProperty, this=exp.Literal.string("IMMUTABLE")
        ),
        "DISTRIBUTED": lambda self: self._parse_distributed_property(),
        "DUPLICATE": lambda self: self._parse_duplicate(),
        "DYNAMIC": lambda self: self.expression(exp.DynamicProperty),
        "DISTKEY": lambda self: self._parse_distkey(),
        "DISTSTYLE": lambda self: self._parse_property_assignment(exp.DistStyleProperty),
        "EMPTY": lambda self: self.expression(exp.EmptyProperty),
        "ENGINE": lambda self: self._parse_property_assignment(exp.EngineProperty),
        "EXECUTE": lambda self: self._parse_property_assignment(exp.ExecuteAsProperty),
        "EXTERNAL": lambda self: self.expression(exp.ExternalProperty),
        "FALLBACK": lambda self, **kwargs: self._parse_fallback(**kwargs),
        "FORMAT": lambda self: self._parse_property_assignment(exp.FileFormatProperty),
        "FREESPACE": lambda self: self._parse_freespace(),
        "GLOBAL": lambda self: self.expression(exp.GlobalProperty),
        "HEAP": lambda self: self.expression(exp.HeapProperty),
        "ICEBERG": lambda self: self.expression(exp.IcebergProperty),
        "IMMUTABLE": lambda self: self.expression(
            exp.StabilityProperty, this=exp.Literal.string("IMMUTABLE")
        ),
        "INHERITS": lambda self: self.expression(
            exp.InheritsProperty, expressions=self._parse_wrapped_csv(self._parse_table)
        ),
        "INPUT": lambda self: self.expression(exp.InputModelProperty, this=self._parse_schema()),
        "JOURNAL": lambda self, **kwargs: self._parse_journal(**kwargs),
        "LANGUAGE": lambda self: self._parse_property_assignment(exp.LanguageProperty),
        "LAYOUT": lambda self: self._parse_dict_property(this="LAYOUT"),
        "LIFETIME": lambda self: self._parse_dict_range(this="LIFETIME"),
        "LIKE": lambda self: self._parse_create_like(),
        "LOCATION": lambda self: self._parse_property_assignment(exp.LocationProperty),
        "LOCK": lambda self: self._parse_locking(),
        "LOCKING": lambda self: self._parse_locking(),
        "LOG": lambda self, **kwargs: self._parse_log(**kwargs),
        "MATERIALIZED": lambda self: self.expression(exp.MaterializedProperty),
        "MERGEBLOCKRATIO": lambda self, **kwargs: self._parse_mergeblockratio(**kwargs),
        "MODIFIES": lambda self: self._parse_modifies_property(),
        "MULTISET": lambda self: self.expression(exp.SetProperty, multi=True),
        "NO": lambda self: self._parse_no_property(),
        "ON": lambda self: self._parse_on_property(),
        "ORDER BY": lambda self: self._parse_order(skip_order_token=True),
        "OUTPUT": lambda self: self.expression(exp.OutputModelProperty, this=self._parse_schema()),
        "PARTITION": lambda self: self._parse_partitioned_of(),
        "PARTITION BY": lambda self: self._parse_partitioned_by(),
        "PARTITIONED BY": lambda self: self._parse_partitioned_by(),
        "PARTITIONED_BY": lambda self: self._parse_partitioned_by(),
        "PRIMARY KEY": lambda self: self._parse_primary_key(in_props=True),
        "RANGE": lambda self: self._parse_dict_range(this="RANGE"),
        "READS": lambda self: self._parse_reads_property(),
        "REMOTE": lambda self: self._parse_remote_with_connection(),
        "RETURNS": lambda self: self._parse_returns(),
        "STRICT": lambda self: self.expression(exp.StrictProperty),
        "STREAMING": lambda self: self.expression(exp.StreamingTableProperty),
        "ROW": lambda self: self._parse_row(),
        "ROW_FORMAT": lambda self: self._parse_property_assignment(exp.RowFormatProperty),
        "SAMPLE": lambda self: self.expression(
            exp.SampleProperty, this=self._match_text_seq("BY") and self._parse_bitwise()
        ),
        "SECURE": lambda self: self.expression(exp.SecureProperty),
        "SECURITY": lambda self: self._parse_security(),
        "SET": lambda self: self.expression(exp.SetProperty, multi=False),
        "SETTINGS": lambda self: self._parse_settings_property(),
        "SHARING": lambda self: self._parse_property_assignment(exp.SharingProperty),
        "SORTKEY": lambda self: self._parse_sortkey(),
        "SOURCE": lambda self: self._parse_dict_property(this="SOURCE"),
        "STABLE": lambda self: self.expression(
            exp.StabilityProperty, this=exp.Literal.string("STABLE")
        ),
        "STORED": lambda self: self._parse_stored(),
        "SYSTEM_VERSIONING": lambda self: self._parse_system_versioning_property(),
        "TBLPROPERTIES": lambda self: self._parse_wrapped_properties(),
        "TEMP": lambda self: self.expression(exp.TemporaryProperty),
        "TEMPORARY": lambda self: self.expression(exp.TemporaryProperty),
        "TO": lambda self: self._parse_to_table(),
        "TRANSIENT": lambda self: self.expression(exp.TransientProperty),
        "TRANSFORM": lambda self: self.expression(
            exp.TransformModelProperty, expressions=self._parse_wrapped_csv(self._parse_expression)
        ),
        "TTL": lambda self: self._parse_ttl(),
        "USING": lambda self: self._parse_property_assignment(exp.FileFormatProperty),
        "UNLOGGED": lambda self: self.expression(exp.UnloggedProperty),
        "VOLATILE": lambda self: self._parse_volatile_property(),
        "WITH": lambda self: self._parse_with_property(),
    }

    CONSTRAINT_PARSERS = {
        "AUTOINCREMENT": lambda self: self._parse_auto_increment(),
        "AUTO_INCREMENT": lambda self: self._parse_auto_increment(),
        "CASESPECIFIC": lambda self: self.expression(exp.CaseSpecificColumnConstraint, not_=False),
        "CHARACTER SET": lambda self: self.expression(
            exp.CharacterSetColumnConstraint, this=self._parse_var_or_string()
        ),
        "CHECK": lambda self: self.expression(
            exp.CheckColumnConstraint,
            this=self._parse_wrapped(self._parse_assignment),
            enforced=self._match_text_seq("ENFORCED"),
        ),
        "COLLATE": lambda self: self.expression(
            exp.CollateColumnConstraint,
            this=self._parse_identifier() or self._parse_column(),
        ),
        "COMMENT": lambda self: self.expression(
            exp.CommentColumnConstraint, this=self._parse_string()
        ),
        "COMPRESS": lambda self: self._parse_compress(),
        "CLUSTERED": lambda self: self.expression(
            exp.ClusteredColumnConstraint, this=self._parse_wrapped_csv(self._parse_ordered)
        ),
        "NONCLUSTERED": lambda self: self.expression(
            exp.NonClusteredColumnConstraint, this=self._parse_wrapped_csv(self._parse_ordered)
        ),
        "DEFAULT": lambda self: self.expression(
            exp.DefaultColumnConstraint, this=self._parse_bitwise()
        ),
        "ENCODE": lambda self: self.expression(exp.EncodeColumnConstraint, this=self._parse_var()),
        "EPHEMERAL": lambda self: self.expression(
            exp.EphemeralColumnConstraint, this=self._parse_bitwise()
        ),
        "EXCLUDE": lambda self: self.expression(
            exp.ExcludeColumnConstraint, this=self._parse_index_params()
        ),
        "FOREIGN KEY": lambda self: self._parse_foreign_key(),
        "FORMAT": lambda self: self.expression(
            exp.DateFormatColumnConstraint, this=self._parse_var_or_string()
        ),
        "GENERATED": lambda self: self._parse_generated_as_identity(),
        "IDENTITY": lambda self: self._parse_auto_increment(),
        "INLINE": lambda self: self._parse_inline(),
        "LIKE": lambda self: self._parse_create_like(),
        "NOT": lambda self: self._parse_not_constraint(),
        "NULL": lambda self: self.expression(exp.NotNullColumnConstraint, allow_null=True),
        "ON": lambda self: (
            self._match(TokenType.UPDATE)
            and self.expression(exp.OnUpdateColumnConstraint, this=self._parse_function())
        )
        or self.expression(exp.OnProperty, this=self._parse_id_var()),
        "PATH": lambda self: self.expression(exp.PathColumnConstraint, this=self._parse_string()),
        "PERIOD": lambda self: self._parse_period_for_system_time(),
        "PRIMARY KEY": lambda self: self._parse_primary_key(),
        "REFERENCES": lambda self: self._parse_references(match=False),
        "TITLE": lambda self: self.expression(
            exp.TitleColumnConstraint, this=self._parse_var_or_string()
        ),
        "TTL": lambda self: self.expression(exp.MergeTreeTTL, expressions=[self._parse_bitwise()]),
        "UNIQUE": lambda self: self._parse_unique(),
        "UPPERCASE": lambda self: self.expression(exp.UppercaseColumnConstraint),
        "WATERMARK": lambda self: self.expression(
            exp.WatermarkColumnConstraint,
            this=self._match(TokenType.FOR) and self._parse_column(),
            expression=self._match(TokenType.ALIAS) and self._parse_disjunction(),
        ),
        "WITH": lambda self: self.expression(
            exp.Properties, expressions=self._parse_wrapped_properties()
        ),
    }

    ALTER_PARSERS = {
        "ADD": lambda self: self._parse_alter_table_add(),
        "AS": lambda self: self._parse_select(),
        "ALTER": lambda self: self._parse_alter_table_alter(),
        "CLUSTER BY": lambda self: self._parse_cluster(wrapped=True),
        "DELETE": lambda self: self.expression(exp.Delete, where=self._parse_where()),
        "DROP": lambda self: self._parse_alter_table_drop(),
        "RENAME": lambda self: self._parse_alter_table_rename(),
        "SET": lambda self: self._parse_alter_table_set(),
        "SWAP": lambda self: self.expression(
            exp.SwapTable, this=self._match(TokenType.WITH) and self._parse_table(schema=True)
        ),
    }

    ALTER_ALTER_PARSERS = {
        "DISTKEY": lambda self: self._parse_alter_diststyle(),
        "DISTSTYLE": lambda self: self._parse_alter_diststyle(),
        "SORTKEY": lambda self: self._parse_alter_sortkey(),
        "COMPOUND": lambda self: self._parse_alter_sortkey(compound=True),
    }

    SCHEMA_UNNAMED_CONSTRAINTS = {
        "CHECK",
        "EXCLUDE",
        "FOREIGN KEY",
        "LIKE",
        "PERIOD",
        "PRIMARY KEY",
        "UNIQUE",
        "WATERMARK",
    }

    NO_PAREN_FUNCTION_PARSERS = {
        "ANY": lambda self: self.expression(exp.Any, this=self._parse_bitwise()),
        "CASE": lambda self: self._parse_case(),
        "CONNECT_BY_ROOT": lambda self: self.expression(
            exp.ConnectByRoot, this=self._parse_column()
        ),
        "IF": lambda self: self._parse_if(),
    }

    INVALID_FUNC_NAME_TOKENS = {
        TokenType.IDENTIFIER,
        TokenType.STRING,
    }

    FUNCTIONS_WITH_ALIASED_ARGS = {"STRUCT"}

    KEY_VALUE_DEFINITIONS = (exp.Alias, exp.EQ, exp.PropertyEQ, exp.Slice)

    FUNCTION_PARSERS = {
        "CAST": lambda self: self._parse_cast(self.STRICT_CAST),
        "CONVERT": lambda self: self._parse_convert(self.STRICT_CAST),
        "DECODE": lambda self: self._parse_decode(),
        "EXTRACT": lambda self: self._parse_extract(),
        "GAP_FILL": lambda self: self._parse_gap_fill(),
        "JSON_OBJECT": lambda self: self._parse_json_object(),
        "JSON_OBJECTAGG": lambda self: self._parse_json_object(agg=True),
        "JSON_TABLE": lambda self: self._parse_json_table(),
        "MATCH": lambda self: self._parse_match_against(),
        "NORMALIZE": lambda self: self._parse_normalize(),
        "OPENJSON": lambda self: self._parse_open_json(),
        "OVERLAY": lambda self: self._parse_overlay(),
        "POSITION": lambda self: self._parse_position(),
        "PREDICT": lambda self: self._parse_predict(),
        "SAFE_CAST": lambda self: self._parse_cast(False, safe=True),
        "STRING_AGG": lambda self: self._parse_string_agg(),
        "SUBSTRING": lambda self: self._parse_substring(),
        "TRIM": lambda self: self._parse_trim(),
        "TRY_CAST": lambda self: self._parse_cast(False, safe=True),
        "TRY_CONVERT": lambda self: self._parse_convert(False, safe=True),
    }

    QUERY_MODIFIER_PARSERS = {
        TokenType.MATCH_RECOGNIZE: lambda self: ("match", self._parse_match_recognize()),
        TokenType.PREWHERE: lambda self: ("prewhere", self._parse_prewhere()),
        TokenType.WHERE: lambda self: ("where", self._parse_where()),
        TokenType.GROUP_BY: lambda self: ("group", self._parse_group()),
        TokenType.HAVING: lambda self: ("having", self._parse_having()),
        TokenType.QUALIFY: lambda self: ("qualify", self._parse_qualify()),
        TokenType.WINDOW: lambda self: ("windows", self._parse_window_clause()),
        TokenType.ORDER_BY: lambda self: ("order", self._parse_order()),
        TokenType.LIMIT: lambda self: ("limit", self._parse_limit()),
        TokenType.FETCH: lambda self: ("limit", self._parse_limit()),
        TokenType.OFFSET: lambda self: ("offset", self._parse_offset()),
        TokenType.FOR: lambda self: ("locks", self._parse_locks()),
        TokenType.LOCK: lambda self: ("locks", self._parse_locks()),
        TokenType.TABLE_SAMPLE: lambda self: ("sample", self._parse_table_sample(as_modifier=True)),
        TokenType.USING: lambda self: ("sample", self._parse_table_sample(as_modifier=True)),
        TokenType.CLUSTER_BY: lambda self: (
            "cluster",
            self._parse_sort(exp.Cluster, TokenType.CLUSTER_BY),
        ),
        TokenType.DISTRIBUTE_BY: lambda self: (
            "distribute",
            self._parse_sort(exp.Distribute, TokenType.DISTRIBUTE_BY),
        ),
        TokenType.SORT_BY: lambda self: ("sort", self._parse_sort(exp.Sort, TokenType.SORT_BY)),
        TokenType.CONNECT_BY: lambda self: ("connect", self._parse_connect(skip_start_token=True)),
        TokenType.START_WITH: lambda self: ("connect", self._parse_connect()),
    }

    SET_PARSERS = {
        "GLOBAL": lambda self: self._parse_set_item_assignment("GLOBAL"),
        "LOCAL": lambda self: self._parse_set_item_assignment("LOCAL"),
        "SESSION": lambda self: self._parse_set_item_assignment("SESSION"),
        "TRANSACTION": lambda self: self._parse_set_transaction(),
    }

    SHOW_PARSERS: t.Dict[str, t.Callable] = {}

    TYPE_LITERAL_PARSERS = {
        exp.DataType.Type.JSON: lambda self, this, _: self.expression(exp.ParseJSON, this=this),
    }

    TYPE_CONVERTERS: t.Dict[exp.DataType.Type, t.Callable[[exp.DataType], exp.DataType]] = {}

    DDL_SELECT_TOKENS = {TokenType.SELECT, TokenType.WITH, TokenType.L_PAREN}

    PRE_VOLATILE_TOKENS = {TokenType.CREATE, TokenType.REPLACE, TokenType.UNIQUE}

    TRANSACTION_KIND = {"DEFERRED", "IMMEDIATE", "EXCLUSIVE"}
    TRANSACTION_CHARACTERISTICS: OPTIONS_TYPE = {
        "ISOLATION": (
            ("LEVEL", "REPEATABLE", "READ"),
            ("LEVEL", "READ", "COMMITTED"),
            ("LEVEL", "READ", "UNCOMITTED"),
            ("LEVEL", "SERIALIZABLE"),
        ),
        "READ": ("WRITE", "ONLY"),
    }

    CONFLICT_ACTIONS: OPTIONS_TYPE = dict.fromkeys(
        ("ABORT", "FAIL", "IGNORE", "REPLACE", "ROLLBACK", "UPDATE"), tuple()
    )
    CONFLICT_ACTIONS["DO"] = ("NOTHING", "UPDATE")

    CREATE_SEQUENCE: OPTIONS_TYPE = {
        "SCALE": ("EXTEND", "NOEXTEND"),
        "SHARD": ("EXTEND", "NOEXTEND"),
        "NO": ("CYCLE", "CACHE", "MAXVALUE", "MINVALUE"),
        **dict.fromkeys(
            (
                "SESSION",
                "GLOBAL",
                "KEEP",
                "NOKEEP",
                "ORDER",
                "NOORDER",
                "NOCACHE",
                "CYCLE",
                "NOCYCLE",
                "NOMINVALUE",
                "NOMAXVALUE",
                "NOSCALE",
                "NOSHARD",
            ),
            tuple(),
        ),
    }

    ISOLATED_LOADING_OPTIONS: OPTIONS_TYPE = {"FOR": ("ALL", "INSERT", "NONE")}

    USABLES: OPTIONS_TYPE = dict.fromkeys(
        ("ROLE", "WAREHOUSE", "DATABASE", "SCHEMA", "CATALOG"), tuple()
    )

    CAST_ACTIONS: OPTIONS_TYPE = dict.fromkeys(("RENAME", "ADD"), ("FIELDS",))

    SCHEMA_BINDING_OPTIONS: OPTIONS_TYPE = {
        "TYPE": ("EVOLUTION",),
        **dict.fromkeys(("BINDING", "COMPENSATION", "EVOLUTION"), tuple()),
    }

    PROCEDURE_OPTIONS: OPTIONS_TYPE = {}

    EXECUTE_AS_OPTIONS: OPTIONS_TYPE = dict.fromkeys(("CALLER", "SELF", "OWNER"), tuple())

    KEY_CONSTRAINT_OPTIONS: OPTIONS_TYPE = {
        "NOT": ("ENFORCED",),
        "MATCH": (
            "FULL",
            "PARTIAL",
            "SIMPLE",
        ),
        "INITIALLY": ("DEFERRED", "IMMEDIATE"),
        **dict.fromkeys(("DEFERRABLE", "NORELY"), tuple()),
    }

    INSERT_ALTERNATIVES = {"ABORT", "FAIL", "IGNORE", "REPLACE", "ROLLBACK"}

    CLONE_KEYWORDS = {"CLONE", "COPY"}
    HISTORICAL_DATA_PREFIX = {"AT", "BEFORE", "END"}
    HISTORICAL_DATA_KIND = {"TIMESTAMP", "OFFSET", "STATEMENT", "STREAM"}

    OPCLASS_FOLLOW_KEYWORDS = {"ASC", "DESC", "NULLS", "WITH"}

    OPTYPE_FOLLOW_TOKENS = {TokenType.COMMA, TokenType.R_PAREN}

    TABLE_INDEX_HINT_TOKENS = {TokenType.FORCE, TokenType.IGNORE, TokenType.USE}

    VIEW_ATTRIBUTES = {"ENCRYPTION", "SCHEMABINDING", "VIEW_METADATA"}

    WINDOW_ALIAS_TOKENS = ID_VAR_TOKENS - {TokenType.ROWS}
    WINDOW_BEFORE_PAREN_TOKENS = {TokenType.OVER}
    WINDOW_SIDES = {"FOLLOWING", "PRECEDING"}

    JSON_KEY_VALUE_SEPARATOR_TOKENS = {TokenType.COLON, TokenType.COMMA, TokenType.IS}

    FETCH_TOKENS = ID_VAR_TOKENS - {TokenType.ROW, TokenType.ROWS, TokenType.PERCENT}

    ADD_CONSTRAINT_TOKENS = {
        TokenType.CONSTRAINT,
        TokenType.FOREIGN_KEY,
        TokenType.INDEX,
        TokenType.KEY,
        TokenType.PRIMARY_KEY,
        TokenType.UNIQUE,
    }

    DISTINCT_TOKENS = {TokenType.DISTINCT}

    NULL_TOKENS = {TokenType.NULL}

    UNNEST_OFFSET_ALIAS_TOKENS = ID_VAR_TOKENS - SET_OPERATIONS

    SELECT_START_TOKENS = {TokenType.L_PAREN, TokenType.WITH, TokenType.SELECT}

    COPY_INTO_VARLEN_OPTIONS = {"FILE_FORMAT", "COPY_OPTIONS", "FORMAT_OPTIONS", "CREDENTIAL"}

    IS_JSON_PREDICATE_KIND = {"VALUE", "SCALAR", "ARRAY", "OBJECT"}

    ODBC_DATETIME_LITERALS = {
        "d": exp.Date,
        "t": exp.Time,
        "ts": exp.Timestamp,
    }

    ON_CONDITION_TOKENS = {"ERROR", "NULL", "TRUE", "FALSE", "EMPTY"}

    PRIVILEGE_FOLLOW_TOKENS = {TokenType.ON, TokenType.COMMA, TokenType.L_PAREN}

    # The style options for the DESCRIBE statement
    DESCRIBE_STYLES = {"ANALYZE", "EXTENDED", "FORMATTED", "HISTORY"}

    OPERATION_MODIFIERS: t.Set[str] = set()

    STRICT_CAST = True

    PREFIXED_PIVOT_COLUMNS = False
    IDENTIFY_PIVOT_STRINGS = False

    LOG_DEFAULTS_TO_LN = False

    # Whether ADD is present for each column added by ALTER TABLE
    ALTER_TABLE_ADD_REQUIRED_FOR_EACH_COLUMN = True

    # Whether the table sample clause expects CSV syntax
    TABLESAMPLE_CSV = False

    # The default method used for table sampling
    DEFAULT_SAMPLING_METHOD: t.Optional[str] = None

    # Whether the SET command needs a delimiter (e.g. "=") for assignments
    SET_REQUIRES_ASSIGNMENT_DELIMITER = True

    # Whether the TRIM function expects the characters to trim as its first argument
    TRIM_PATTERN_FIRST = False

    # Whether string aliases are supported `SELECT COUNT(*) 'count'`
    STRING_ALIASES = False

    # Whether query modifiers such as LIMIT are attached to the UNION node (vs its right operand)
    MODIFIERS_ATTACHED_TO_SET_OP = True
    SET_OP_MODIFIERS = {"order", "limit", "offset"}

    # Whether to parse IF statements that aren't followed by a left parenthesis as commands
    NO_PAREN_IF_COMMANDS = True

    # Whether the -> and ->> operators expect documents of type JSON (e.g. Postgres)
    JSON_ARROWS_REQUIRE_JSON_TYPE = False

    # Whether the `:` operator is used to extract a value from a VARIANT column
    COLON_IS_VARIANT_EXTRACT = False

    # Whether or not a VALUES keyword needs to be followed by '(' to form a VALUES clause.
    # If this is True and '(' is not found, the keyword will be treated as an identifier
    VALUES_FOLLOWED_BY_PAREN = True

    # Whether implicit unnesting is supported, e.g. SELECT 1 FROM y.z AS z, z.a (Redshift)
    SUPPORTS_IMPLICIT_UNNEST = False

    # Whether or not interval spans are supported, INTERVAL 1 YEAR TO MONTHS
    INTERVAL_SPANS = True

    # Whether a PARTITION clause can follow a table reference
    SUPPORTS_PARTITION_SELECTION = False

    # Whether the `name AS expr` schema/column constraint requires parentheses around `expr`
    WRAPPED_TRANSFORM_COLUMN_CONSTRAINT = True

    __slots__ = (
        "error_level",
        "error_message_context",
        "max_errors",
        "dialect",
        "sql",
        "errors",
        "_tokens",
        "_index",
        "_curr",
        "_next",
        "_prev",
        "_prev_comments",
    )

    # Autofilled
    SHOW_TRIE: t.Dict = {}
    SET_TRIE: t.Dict = {}

    def __init__(
        self,
        error_level: t.Optional[ErrorLevel] = None,
        error_message_context: int = 100,
        max_errors: int = 3,
        dialect: DialectType = None,
    ):
        from sqlglot.dialects import Dialect

        self.error_level = error_level or ErrorLevel.IMMEDIATE
        self.error_message_context = error_message_context
        self.max_errors = max_errors
        self.dialect = Dialect.get_or_raise(dialect)
        self.reset()

    def reset(self):
        self.sql = ""
        self.errors = []
        self._tokens = []
        self._index = 0
        self._curr = None
        self._next = None
        self._prev = None
        self._prev_comments = None

    def parse(
        self, raw_tokens: t.List[Token], sql: t.Optional[str] = None
    ) -> t.List[t.Optional[exp.Expression]]:
        """
        Parses a list of tokens and returns a list of syntax trees, one tree
        per parsed SQL statement.

        Args:
            raw_tokens: The list of tokens.
            sql: The original SQL string, used to produce helpful debug messages.

        Returns:
            The list of the produced syntax trees.
        """
        return self._parse(
            parse_method=self.__class__._parse_statement, raw_tokens=raw_tokens, sql=sql
        )

    def parse_into(
        self,
        expression_types: exp.IntoType,
        raw_tokens: t.List[Token],
        sql: t.Optional[str] = None,
    ) -> t.List[t.Optional[exp.Expression]]:
        """
        Parses a list of tokens into a given Expression type. If a collection of Expression
        types is given instead, this method will try to parse the token list into each one
        of them, stopping at the first for which the parsing succeeds.

        Args:
            expression_types: The expression type(s) to try and parse the token list into.
            raw_tokens: The list of tokens.
            sql: The original SQL string, used to produce helpful debug messages.

        Returns:
            The target Expression.
        """
        errors = []
        for expression_type in ensure_list(expression_types):
            parser = self.EXPRESSION_PARSERS.get(expression_type)
            if not parser:
                raise TypeError(f"No parser registered for {expression_type}")

            try:
                return self._parse(parser, raw_tokens, sql)
            except ParseError as e:
                e.errors[0]["into_expression"] = expression_type
                errors.append(e)

        raise ParseError(
            f"Failed to parse '{sql or raw_tokens}' into {expression_types}",
            errors=merge_errors(errors),
        ) from errors[-1]

    def _parse(
        self,
        parse_method: t.Callable[[Parser], t.Optional[exp.Expression]],
        raw_tokens: t.List[Token],
        sql: t.Optional[str] = None,
    ) -> t.List[t.Optional[exp.Expression]]:
        self.reset()
        self.sql = sql or ""

        total = len(raw_tokens)
        chunks: t.List[t.List[Token]] = [[]]

        for i, token in enumerate(raw_tokens):
            if token.token_type == TokenType.SEMICOLON:
                if token.comments:
                    chunks.append([token])

                if i < total - 1:
                    chunks.append([])
            else:
                chunks[-1].append(token)

        expressions = []

        for tokens in chunks:
            self._index = -1
            self._tokens = tokens
            self._advance()

            expressions.append(parse_method(self))

            if self._index < len(self._tokens):
                self.raise_error("Invalid expression / Unexpected token")

            self.check_errors()

        return expressions

    def check_errors(self) -> None:
        """Logs or raises any found errors, depending on the chosen error level setting."""
        if self.error_level == ErrorLevel.WARN:
            for error in self.errors:
                logger.error(str(error))
        elif self.error_level == ErrorLevel.RAISE and self.errors:
            raise ParseError(
                concat_messages(self.errors, self.max_errors),
                errors=merge_errors(self.errors),
            )

    def raise_error(self, message: str, token: t.Optional[Token] = None) -> None:
        """
        Appends an error in the list of recorded errors or raises it, depending on the chosen
        error level setting.
        """
        token = token or self._curr or self._prev or Token.string("")
        start = token.start
        end = token.end + 1
        start_context = self.sql[max(start - self.error_message_context, 0) : start]
        highlight = self.sql[start:end]
        end_context = self.sql[end : end + self.error_message_context]

        error = ParseError.new(
            f"{message}. Line {token.line}, Col: {token.col}.\n"
            f"  {start_context}\033[4m{highlight}\033[0m{end_context}",
            description=message,
            line=token.line,
            col=token.col,
            start_context=start_context,
            highlight=highlight,
            end_context=end_context,
        )

        if self.error_level == ErrorLevel.IMMEDIATE:
            raise error

        self.errors.append(error)

    def expression(
        self, exp_class: t.Type[E], comments: t.Optional[t.List[str]] = None, **kwargs
    ) -> E:
        """
        Creates a new, validated Expression.

        Args:
            exp_class: The expression class to instantiate.
            comments: An optional list of comments to attach to the expression.
            kwargs: The arguments to set for the expression along with their respective values.

        Returns:
            The target expression.
        """
        instance = exp_class(**kwargs)
        instance.add_comments(comments) if comments else self._add_comments(instance)
        return self.validate_expression(instance)

    def _add_comments(self, expression: t.Optional[exp.Expression]) -> None:
        if expression and self._prev_comments:
            expression.add_comments(self._prev_comments)
            self._prev_comments = None

    def validate_expression(self, expression: E, args: t.Optional[t.List] = None) -> E:
        """
        Validates an Expression, making sure that all its mandatory arguments are set.

        Args:
            expression: The expression to validate.
            args: An optional list of items that was used to instantiate the expression, if it's a Func.

        Returns:
            The validated expression.
        """
        if self.error_level != ErrorLevel.IGNORE:
            for error_message in expression.error_messages(args):
                self.raise_error(error_message)

        return expression

    def _find_sql(self, start: Token, end: Token) -> str:
        return self.sql[start.start : end.end + 1]

    def _is_connected(self) -> bool:
        return self._prev and self._curr and self._prev.end + 1 == self._curr.start

    def _advance(self, times: int = 1) -> None:
        self._index += times
        self._curr = seq_get(self._tokens, self._index)
        self._next = seq_get(self._tokens, self._index + 1)

        if self._index > 0:
            self._prev = self._tokens[self._index - 1]
            self._prev_comments = self._prev.comments
        else:
            self._prev = None
            self._prev_comments = None

    def _retreat(self, index: int) -> None:
        if index != self._index:
            self._advance(index - self._index)

    def _warn_unsupported(self) -> None:
        if len(self._tokens) <= 1:
            return

        # We use _find_sql because self.sql may comprise multiple chunks, and we're only
        # interested in emitting a warning for the one being currently processed.
        sql = self._find_sql(self._tokens[0], self._tokens[-1])[: self.error_message_context]

        logger.warning(
            f"'{sql}' contains unsupported syntax. Falling back to parsing as a 'Command'."
        )

    def _parse_command(self) -> exp.Command:
        self._warn_unsupported()
        return self.expression(
            exp.Command,
            comments=self._prev_comments,
            this=self._prev.text.upper(),
            expression=self._parse_string(),
        )

    def _try_parse(self, parse_method: t.Callable[[], T], retreat: bool = False) -> t.Optional[T]:
        """
        Attemps to backtrack if a parse function that contains a try/catch internally raises an error.
        This behavior can be different depending on the uset-set ErrorLevel, so _try_parse aims to
        solve this by setting & resetting the parser state accordingly
        """
        index = self._index
        error_level = self.error_level

        self.error_level = ErrorLevel.IMMEDIATE
        try:
            this = parse_method()
        except ParseError:
            this = None
        finally:
            if not this or retreat:
                self._retreat(index)
            self.error_level = error_level

        return this

    def _parse_comment(self, allow_exists: bool = True) -> exp.Expression:
        start = self._prev
        exists = self._parse_exists() if allow_exists else None

        self._match(TokenType.ON)

        materialized = self._match_text_seq("MATERIALIZED")
        kind = self._match_set(self.CREATABLES) and self._prev
        if not kind:
            return self._parse_as_command(start)

        if kind.token_type in (TokenType.FUNCTION, TokenType.PROCEDURE):
            this = self._parse_user_defined_function(kind=kind.token_type)
        elif kind.token_type == TokenType.TABLE:
            this = self._parse_table(alias_tokens=self.COMMENT_TABLE_ALIAS_TOKENS)
        elif kind.token_type == TokenType.COLUMN:
            this = self._parse_column()
        else:
            this = self._parse_id_var()

        self._match(TokenType.IS)

        return self.expression(
            exp.Comment,
            this=this,
            kind=kind.text,
            expression=self._parse_string(),
            exists=exists,
            materialized=materialized,
        )

    def _parse_to_table(
        self,
    ) -> exp.ToTableProperty:
        table = self._parse_table_parts(schema=True)
        return self.expression(exp.ToTableProperty, this=table)

    # https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/mergetree#mergetree-table-ttl
    def _parse_ttl(self) -> exp.Expression:
        def _parse_ttl_action() -> t.Optional[exp.Expression]:
            this = self._parse_bitwise()

            if self._match_text_seq("DELETE"):
                return self.expression(exp.MergeTreeTTLAction, this=this, delete=True)
            if self._match_text_seq("RECOMPRESS"):
                return self.expression(
                    exp.MergeTreeTTLAction, this=this, recompress=self._parse_bitwise()
                )
            if self._match_text_seq("TO", "DISK"):
                return self.expression(
                    exp.MergeTreeTTLAction, this=this, to_disk=self._parse_string()
                )
            if self._match_text_seq("TO", "VOLUME"):
                return self.expression(
                    exp.MergeTreeTTLAction, this=this, to_volume=self._parse_string()
                )

            return this

        expressions = self._parse_csv(_parse_ttl_action)
        where = self._parse_where()
        group = self._parse_group()

        aggregates = None
        if group and self._match(TokenType.SET):
            aggregates = self._parse_csv(self._parse_set_item)

        return self.expression(
            exp.MergeTreeTTL,
            expressions=expressions,
            where=where,
            group=group,
            aggregates=aggregates,
        )

    def _parse_statement(self) -> t.Optional[exp.Expression]:
        if self._curr is None:
            return None

        if self._match_set(self.STATEMENT_PARSERS):
            comments = self._prev_comments
            stmt = self.STATEMENT_PARSERS[self._prev.token_type](self)
            stmt.add_comments(comments, prepend=True)
            return stmt

        if self._match_set(self.dialect.tokenizer.COMMANDS):
            return self._parse_command()

        expression = self._parse_expression()
        expression = self._parse_set_operations(expression) if expression else self._parse_select()
        return self._parse_query_modifiers(expression)

    def _parse_drop(self, exists: bool = False) -> exp.Drop | exp.Command:
        start = self._prev
        temporary = self._match(TokenType.TEMPORARY)
        materialized = self._match_text_seq("MATERIALIZED")

        kind = self._match_set(self.CREATABLES) and self._prev.text.upper()
        if not kind:
            return self._parse_as_command(start)

        concurrently = self._match_text_seq("CONCURRENTLY")
        if_exists = exists or self._parse_exists()

        if kind == "COLUMN":
            this = self._parse_column()
        else:
            this = self._parse_table_parts(
                schema=True, is_db_reference=self._prev.token_type == TokenType.SCHEMA
            )

        cluster = self._parse_on_property() if self._match(TokenType.ON) else None

        if self._match(TokenType.L_PAREN, advance=False):
            expressions = self._parse_wrapped_csv(self._parse_types)
        else:
            expressions = None

        return self.expression(
            exp.Drop,
            exists=if_exists,
            this=this,
            expressions=expressions,
            kind=self.dialect.CREATABLE_KIND_MAPPING.get(kind) or kind,
            temporary=temporary,
            materialized=materialized,
            cascade=self._match_text_seq("CASCADE"),
            constraints=self._match_text_seq("CONSTRAINTS"),
            purge=self._match_text_seq("PURGE"),
            cluster=cluster,
            concurrently=concurrently,
        )

    def _parse_exists(self, not_: bool = False) -> t.Optional[bool]:
        return (
            self._match_text_seq("IF")
            and (not not_ or self._match(TokenType.NOT))
            and self._match(TokenType.EXISTS)
        )

    def _parse_create(self) -> exp.Create | exp.Command:
        # Note: this can't be None because we've matched a statement parser
        start = self._prev

        replace = (
            start.token_type == TokenType.REPLACE
            or self._match_pair(TokenType.OR, TokenType.REPLACE)
            or self._match_pair(TokenType.OR, TokenType.ALTER)
        )
        refresh = self._match_pair(TokenType.OR, TokenType.REFRESH)

        unique = self._match(TokenType.UNIQUE)

        if self._match_text_seq("CLUSTERED", "COLUMNSTORE"):
            clustered = True
        elif self._match_text_seq("NONCLUSTERED", "COLUMNSTORE") or self._match_text_seq(
            "COLUMNSTORE"
        ):
            clustered = False
        else:
            clustered = None

        if self._match_pair(TokenType.TABLE, TokenType.FUNCTION, advance=False):
            self._advance()

        properties = None
        create_token = self._match_set(self.CREATABLES) and self._prev

        if not create_token:
            # exp.Properties.Location.POST_CREATE
            properties = self._parse_properties()
            create_token = self._match_set(self.CREATABLES) and self._prev

            if not properties or not create_token:
                return self._parse_as_command(start)

        concurrently = self._match_text_seq("CONCURRENTLY")
        exists = self._parse_exists(not_=True)
        this = None
        expression: t.Optional[exp.Expression] = None
        indexes = None
        no_schema_binding = None
        begin = None
        end = None
        clone = None

        def extend_props(temp_props: t.Optional[exp.Properties]) -> None:
            nonlocal properties
            if properties and temp_props:
                properties.expressions.extend(temp_props.expressions)
            elif temp_props:
                properties = temp_props

        if create_token.token_type in (TokenType.FUNCTION, TokenType.PROCEDURE):
            this = self._parse_user_defined_function(kind=create_token.token_type)

            # exp.Properties.Location.POST_SCHEMA ("schema" here is the UDF's type signature)
            extend_props(self._parse_properties())

            expression = self._match(TokenType.ALIAS) and self._parse_heredoc()
            extend_props(self._parse_properties())

            if not expression:
                if self._match(TokenType.COMMAND):
                    expression = self._parse_as_command(self._prev)
                else:
                    begin = self._match(TokenType.BEGIN)
                    return_ = self._match_text_seq("RETURN")

                    if self._match(TokenType.STRING, advance=False):
                        # Takes care of BigQuery's JavaScript UDF definitions that end in an OPTIONS property
                        # # https://cloud.google.com/bigquery/docs/reference/standard-sql/data-definition-language#create_function_statement
                        expression = self._parse_string()
                        extend_props(self._parse_properties())
                    else:
                        expression = self._parse_user_defined_function_expression()

                    end = self._match_text_seq("END")

                    if return_:
                        expression = self.expression(exp.Return, this=expression)
        elif create_token.token_type == TokenType.INDEX:
            # Postgres allows anonymous indexes, eg. CREATE INDEX IF NOT EXISTS ON t(c)
            if not self._match(TokenType.ON):
                index = self._parse_id_var()
                anonymous = False
            else:
                index = None
                anonymous = True

            this = self._parse_index(index=index, anonymous=anonymous)
        elif create_token.token_type in self.DB_CREATABLES:
            table_parts = self._parse_table_parts(
                schema=True, is_db_reference=create_token.token_type == TokenType.SCHEMA
            )

            # exp.Properties.Location.POST_NAME
            self._match(TokenType.COMMA)
            extend_props(self._parse_properties(before=True))

            this = self._parse_schema(this=table_parts)

            # exp.Properties.Location.POST_SCHEMA and POST_WITH
            extend_props(self._parse_properties())

            self._match(TokenType.ALIAS)
            if not self._match_set(self.DDL_SELECT_TOKENS, advance=False):
                # exp.Properties.Location.POST_ALIAS
                extend_props(self._parse_properties())

            if create_token.token_type == TokenType.SEQUENCE:
                expression = self._parse_types()
                extend_props(self._parse_properties())
            else:
                expression = self._parse_ddl_select()

            if create_token.token_type == TokenType.TABLE:
                # exp.Properties.Location.POST_EXPRESSION
                extend_props(self._parse_properties())

                indexes = []
                while True:
                    index = self._parse_index()

                    # exp.Properties.Location.POST_INDEX
                    extend_props(self._parse_properties())
                    if not index:
                        break
                    else:
                        self._match(TokenType.COMMA)
                        indexes.append(index)
            elif create_token.token_type == TokenType.VIEW:
                if self._match_text_seq("WITH", "NO", "SCHEMA", "BINDING"):
                    no_schema_binding = True
            elif create_token.token_type in (TokenType.SINK, TokenType.SOURCE):
                extend_props(self._parse_properties())

            shallow = self._match_text_seq("SHALLOW")

            if self._match_texts(self.CLONE_KEYWORDS):
                copy = self._prev.text.lower() == "copy"
                clone = self.expression(
                    exp.Clone, this=self._parse_table(schema=True), shallow=shallow, copy=copy
                )

        if self._curr and not self._match_set((TokenType.R_PAREN, TokenType.COMMA), advance=False):
            return self._parse_as_command(start)

        create_kind_text = create_token.text.upper()
        return self.expression(
            exp.Create,
            this=this,
            kind=self.dialect.CREATABLE_KIND_MAPPING.get(create_kind_text) or create_kind_text,
            replace=replace,
            refresh=refresh,
            unique=unique,
            expression=expression,
            exists=exists,
            properties=properties,
            indexes=indexes,
            no_schema_binding=no_schema_binding,
            begin=begin,
            end=end,
            clone=clone,
            concurrently=concurrently,
            clustered=clustered,
        )

    def _parse_sequence_properties(self) -> t.Optional[exp.SequenceProperties]:
        seq = exp.SequenceProperties()

        options = []
        index = self._index

        while self._curr:
            self._match(TokenType.COMMA)
            if self._match_text_seq("INCREMENT"):
                self._match_text_seq("BY")
                self._match_text_seq("=")
                seq.set("increment", self._parse_term())
            elif self._match_text_seq("MINVALUE"):
                seq.set("minvalue", self._parse_term())
            elif self._match_text_seq("MAXVALUE"):
                seq.set("maxvalue", self._parse_term())
            elif self._match(TokenType.START_WITH) or self._match_text_seq("START"):
                self._match_text_seq("=")
                seq.set("start", self._parse_term())
            elif self._match_text_seq("CACHE"):
                # T-SQL allows empty CACHE which is initialized dynamically
                seq.set("cache", self._parse_number() or True)
            elif self._match_text_seq("OWNED", "BY"):
                # "OWNED BY NONE" is the default
                seq.set("owned", None if self._match_text_seq("NONE") else self._parse_column())
            else:
                opt = self._parse_var_from_options(self.CREATE_SEQUENCE, raise_unmatched=False)
                if opt:
                    options.append(opt)
                else:
                    break

        seq.set("options", options if options else None)
        return None if self._index == index else seq

    def _parse_property_before(self) -> t.Optional[exp.Expression]:
        # only used for teradata currently
        self._match(TokenType.COMMA)

        kwargs = {
            "no": self._match_text_seq("NO"),
            "dual": self._match_text_seq("DUAL"),
            "before": self._match_text_seq("BEFORE"),
            "default": self._match_text_seq("DEFAULT"),
            "local": (self._match_text_seq("LOCAL") and "LOCAL")
            or (self._match_text_seq("NOT", "LOCAL") and "NOT LOCAL"),
            "after": self._match_text_seq("AFTER"),
            "minimum": self._match_texts(("MIN", "MINIMUM")),
            "maximum": self._match_texts(("MAX", "MAXIMUM")),
        }

        if self._match_texts(self.PROPERTY_PARSERS):
            parser = self.PROPERTY_PARSERS[self._prev.text.upper()]
            try:
                return parser(self, **{k: v for k, v in kwargs.items() if v})
            except TypeError:
                self.raise_error(f"Cannot parse property '{self._prev.text}'")

        return None

    def _parse_wrapped_properties(self) -> t.List[exp.Expression]:
        return self._parse_wrapped_csv(self._parse_property)

    def _parse_property(self) -> t.Optional[exp.Expression]:
        if self._match_texts(self.PROPERTY_PARSERS):
            return self.PROPERTY_PARSERS[self._prev.text.upper()](self)

        if self._match(TokenType.DEFAULT) and self._match_texts(self.PROPERTY_PARSERS):
            return self.PROPERTY_PARSERS[self._prev.text.upper()](self, default=True)

        if self._match_text_seq("COMPOUND", "SORTKEY"):
            return self._parse_sortkey(compound=True)

        if self._match_text_seq("SQL", "SECURITY"):
            return self.expression(exp.SqlSecurityProperty, definer=self._match_text_seq("DEFINER"))

        index = self._index
        key = self._parse_column()

        if not self._match(TokenType.EQ):
            self._retreat(index)
            return self._parse_sequence_properties()

        # Transform the key to exp.Dot if it's dotted identifiers wrapped in exp.Column or to exp.Var otherwise
        if isinstance(key, exp.Column):
            key = key.to_dot() if len(key.parts) > 1 else exp.var(key.name)

        value = self._parse_bitwise() or self._parse_var(any_token=True)

        # Transform the value to exp.Var if it was parsed as exp.Column(exp.Identifier())
        if isinstance(value, exp.Column):
            value = exp.var(value.name)

        return self.expression(exp.Property, this=key, value=value)

    def _parse_stored(self) -> exp.FileFormatProperty:
        self._match(TokenType.ALIAS)

        input_format = self._parse_string() if self._match_text_seq("INPUTFORMAT") else None
        output_format = self._parse_string() if self._match_text_seq("OUTPUTFORMAT") else None

        return self.expression(
            exp.FileFormatProperty,
            this=(
                self.expression(
                    exp.InputOutputFormat, input_format=input_format, output_format=output_format
                )
                if input_format or output_format
                else self._parse_var_or_string() or self._parse_number() or self._parse_id_var()
            ),
        )

    def _parse_unquoted_field(self) -> t.Optional[exp.Expression]:
        field = self._parse_field()
        if isinstance(field, exp.Identifier) and not field.quoted:
            field = exp.var(field)

        return field

    def _parse_property_assignment(self, exp_class: t.Type[E], **kwargs: t.Any) -> E:
        self._match(TokenType.EQ)
        self._match(TokenType.ALIAS)

        return self.expression(exp_class, this=self._parse_unquoted_field(), **kwargs)

    def _parse_properties(self, before: t.Optional[bool] = None) -> t.Optional[exp.Properties]:
        properties = []
        while True:
            if before:
                prop = self._parse_property_before()
            else:
                prop = self._parse_property()
            if not prop:
                break
            for p in ensure_list(prop):
                properties.append(p)

        if properties:
            return self.expression(exp.Properties, expressions=properties)

        return None

    def _parse_fallback(self, no: bool = False) -> exp.FallbackProperty:
        return self.expression(
            exp.FallbackProperty, no=no, protection=self._match_text_seq("PROTECTION")
        )

    def _parse_security(self) -> t.Optional[exp.SecurityProperty]:
        if self._match_texts(("DEFINER", "INVOKER")):
            security_specifier = self._prev.text.upper()
            return self.expression(exp.SecurityProperty, this=security_specifier)
        return None

    def _parse_settings_property(self) -> exp.SettingsProperty:
        return self.expression(
            exp.SettingsProperty, expressions=self._parse_csv(self._parse_assignment)
        )

    def _parse_volatile_property(self) -> exp.VolatileProperty | exp.StabilityProperty:
        if self._index >= 2:
            pre_volatile_token = self._tokens[self._index - 2]
        else:
            pre_volatile_token = None

        if pre_volatile_token and pre_volatile_token.token_type in self.PRE_VOLATILE_TOKENS:
            return exp.VolatileProperty()

        return self.expression(exp.StabilityProperty, this=exp.Literal.string("VOLATILE"))

    def _parse_retention_period(self) -> exp.Var:
        # Parse TSQL's HISTORY_RETENTION_PERIOD: {INFINITE | <number> DAY | DAYS | MONTH ...}
        number = self._parse_number()
        number_str = f"{number} " if number else ""
        unit = self._parse_var(any_token=True)
        return exp.var(f"{number_str}{unit}")

    def _parse_system_versioning_property(
        self, with_: bool = False
    ) -> exp.WithSystemVersioningProperty:
        self._match(TokenType.EQ)
        prop = self.expression(
            exp.WithSystemVersioningProperty,
            **{  # type: ignore
                "on": True,
                "with": with_,
            },
        )

        if self._match_text_seq("OFF"):
            prop.set("on", False)
            return prop

        self._match(TokenType.ON)
        if self._match(TokenType.L_PAREN):
            while self._curr and not self._match(TokenType.R_PAREN):
                if self._match_text_seq("HISTORY_TABLE", "="):
                    prop.set("this", self._parse_table_parts())
                elif self._match_text_seq("DATA_CONSISTENCY_CHECK", "="):
                    prop.set("data_consistency", self._advance_any() and self._prev.text.upper())
                elif self._match_text_seq("HISTORY_RETENTION_PERIOD", "="):
                    prop.set("retention_period", self._parse_retention_period())

                self._match(TokenType.COMMA)

        return prop

    def _parse_data_deletion_property(self) -> exp.DataDeletionProperty:
        self._match(TokenType.EQ)
        on = self._match_text_seq("ON") or not self._match_text_seq("OFF")
        prop = self.expression(exp.DataDeletionProperty, on=on)

        if self._match(TokenType.L_PAREN):
            while self._curr and not self._match(TokenType.R_PAREN):
                if self._match_text_seq("FILTER_COLUMN", "="):
                    prop.set("filter_column", self._parse_column())
                elif self._match_text_seq("RETENTION_PERIOD", "="):
                    prop.set("retention_period", self._parse_retention_period())

                self._match(TokenType.COMMA)

        return prop

    def _parse_distributed_property(self) -> exp.DistributedByProperty:
        kind = "HASH"
        expressions: t.Optional[t.List[exp.Expression]] = None
        if self._match_text_seq("BY", "HASH"):
            expressions = self._parse_wrapped_csv(self._parse_id_var)
        elif self._match_text_seq("BY", "RANDOM"):
            kind = "RANDOM"

        # If the BUCKETS keyword is not present, the number of buckets is AUTO
        buckets: t.Optional[exp.Expression] = None
        if self._match_text_seq("BUCKETS") and not self._match_text_seq("AUTO"):
            buckets = self._parse_number()

        return self.expression(
            exp.DistributedByProperty,
            expressions=expressions,
            kind=kind,
            buckets=buckets,
            order=self._parse_order(),
        )

    def _parse_duplicate(self) -> exp.DuplicateKeyProperty:
        self._match_text_seq("KEY")
        expressions = self._parse_wrapped_csv(self._parse_id_var, optional=False)
        return self.expression(exp.DuplicateKeyProperty, expressions=expressions)

    def _parse_with_property(self) -> t.Optional[exp.Expression] | t.List[exp.Expression]:
        if self._match_text_seq("(", "SYSTEM_VERSIONING"):
            prop = self._parse_system_versioning_property(with_=True)
            self._match_r_paren()
            return prop

        if self._match(TokenType.L_PAREN, advance=False):
            return self._parse_wrapped_properties()

        if self._match_text_seq("JOURNAL"):
            return self._parse_withjournaltable()

        if self._match_texts(self.VIEW_ATTRIBUTES):
            return self.expression(exp.ViewAttributeProperty, this=self._prev.text.upper())

        if self._match_text_seq("DATA"):
            return self._parse_withdata(no=False)
        elif self._match_text_seq("NO", "DATA"):
            return self._parse_withdata(no=True)

        if self._match(TokenType.SERDE_PROPERTIES, advance=False):
            return self._parse_serde_properties(with_=True)

        if self._match(TokenType.SCHEMA):
            return self.expression(
                exp.WithSchemaBindingProperty,
                this=self._parse_var_from_options(self.SCHEMA_BINDING_OPTIONS),
            )

        if self._match_texts(self.PROCEDURE_OPTIONS, advance=False):
            return self.expression(
                exp.WithProcedureOptions, expressions=self._parse_csv(self._parse_procedure_option)
            )

        if not self._next:
            return None

        return self._parse_withisolatedloading()

    def _parse_procedure_option(self) -> exp.Expression | None:
        if self._match_text_seq("EXECUTE", "AS"):
            return self.expression(
                exp.ExecuteAsProperty,
                this=self._parse_var_from_options(self.EXECUTE_AS_OPTIONS, raise_unmatched=False)
                or self._parse_string(),
            )

        return self._parse_var_from_options(self.PROCEDURE_OPTIONS)

    # https://dev.mysql.com/doc/refman/8.0/en/create-view.html
    def _parse_definer(self) -> t.Optional[exp.DefinerProperty]:
        self._match(TokenType.EQ)

        user = self._parse_id_var()
        self._match(TokenType.PARAMETER)
        host = self._parse_id_var() or (self._match(TokenType.MOD) and self._prev.text)

        if not user or not host:
            return None

        return exp.DefinerProperty(this=f"{user}@{host}")

    def _parse_withjournaltable(self) -> exp.WithJournalTableProperty:
        self._match(TokenType.TABLE)
        self._match(TokenType.EQ)
        return self.expression(exp.WithJournalTableProperty, this=self._parse_table_parts())

    def _parse_log(self, no: bool = False) -> exp.LogProperty:
        return self.expression(exp.LogProperty, no=no)

    def _parse_journal(self, **kwargs) -> exp.JournalProperty:
        return self.expression(exp.JournalProperty, **kwargs)

    def _parse_checksum(self) -> exp.ChecksumProperty:
        self._match(TokenType.EQ)

        on = None
        if self._match(TokenType.ON):
            on = True
        elif self._match_text_seq("OFF"):
            on = False

        return self.expression(exp.ChecksumProperty, on=on, default=self._match(TokenType.DEFAULT))

    def _parse_cluster(self, wrapped: bool = False) -> exp.Cluster:
        return self.expression(
            exp.Cluster,
            expressions=(
                self._parse_wrapped_csv(self._parse_ordered)
                if wrapped
                else self._parse_csv(self._parse_ordered)
            ),
        )

    def _parse_clustered_by(self) -> exp.ClusteredByProperty:
        self._match_text_seq("BY")

        self._match_l_paren()
        expressions = self._parse_csv(self._parse_column)
        self._match_r_paren()

        if self._match_text_seq("SORTED", "BY"):
            self._match_l_paren()
            sorted_by = self._parse_csv(self._parse_ordered)
            self._match_r_paren()
        else:
            sorted_by = None

        self._match(TokenType.INTO)
        buckets = self._parse_number()
        self._match_text_seq("BUCKETS")

        return self.expression(
            exp.ClusteredByProperty,
            expressions=expressions,
            sorted_by=sorted_by,
            buckets=buckets,
        )

    def _parse_copy_property(self) -> t.Optional[exp.CopyGrantsProperty]:
        if not self._match_text_seq("GRANTS"):
            self._retreat(self._index - 1)
            return None

        return self.expression(exp.CopyGrantsProperty)

    def _parse_freespace(self) -> exp.FreespaceProperty:
        self._match(TokenType.EQ)
        return self.expression(
            exp.FreespaceProperty, this=self._parse_number(), percent=self._match(TokenType.PERCENT)
        )

    def _parse_mergeblockratio(
        self, no: bool = False, default: bool = False
    ) -> exp.MergeBlockRatioProperty:
        if self._match(TokenType.EQ):
            return self.expression(
                exp.MergeBlockRatioProperty,
                this=self._parse_number(),
                percent=self._match(TokenType.PERCENT),
            )

        return self.expression(exp.MergeBlockRatioProperty, no=no, default=default)

    def _parse_datablocksize(
        self,
        default: t.Optional[bool] = None,
        minimum: t.Optional[bool] = None,
        maximum: t.Optional[bool] = None,
    ) -> exp.DataBlocksizeProperty:
        self._match(TokenType.EQ)
        size = self._parse_number()

        units = None
        if self._match_texts(("BYTES", "KBYTES", "KILOBYTES")):
            units = self._prev.text

        return self.expression(
            exp.DataBlocksizeProperty,
            size=size,
            units=units,
            default=default,
            minimum=minimum,
            maximum=maximum,
        )

    def _parse_blockcompression(self) -> exp.BlockCompressionProperty:
        self._match(TokenType.EQ)
        always = self._match_text_seq("ALWAYS")
        manual = self._match_text_seq("MANUAL")
        never = self._match_text_seq("NEVER")
        default = self._match_text_seq("DEFAULT")

        autotemp = None
        if self._match_text_seq("AUTOTEMP"):
            autotemp = self._parse_schema()

        return self.expression(
            exp.BlockCompressionProperty,
            always=always,
            manual=manual,
            never=never,
            default=default,
            autotemp=autotemp,
        )

    def _parse_withisolatedloading(self) -> t.Optional[exp.IsolatedLoadingProperty]:
        index = self._index
        no = self._match_text_seq("NO")
        concurrent = self._match_text_seq("CONCURRENT")

        if not self._match_text_seq("ISOLATED", "LOADING"):
            self._retreat(index)
            return None

        target = self._parse_var_from_options(self.ISOLATED_LOADING_OPTIONS, raise_unmatched=False)
        return self.expression(
            exp.IsolatedLoadingProperty, no=no, concurrent=concurrent, target=target
        )

    def _parse_locking(self) -> exp.LockingProperty:
        if self._match(TokenType.TABLE):
            kind = "TABLE"
        elif self._match(TokenType.VIEW):
            kind = "VIEW"
        elif self._match(TokenType.ROW):
            kind = "ROW"
        elif self._match_text_seq("DATABASE"):
            kind = "DATABASE"
        else:
            kind = None

        if kind in ("DATABASE", "TABLE", "VIEW"):
            this = self._parse_table_parts()
        else:
            this = None

        if self._match(TokenType.FOR):
            for_or_in = "FOR"
        elif self._match(TokenType.IN):
            for_or_in = "IN"
        else:
            for_or_in = None

        if self._match_text_seq("ACCESS"):
            lock_type = "ACCESS"
        elif self._match_texts(("EXCL", "EXCLUSIVE")):
            lock_type = "EXCLUSIVE"
        elif self._match_text_seq("SHARE"):
            lock_type = "SHARE"
        elif self._match_text_seq("READ"):
            lock_type = "READ"
        elif self._match_text_seq("WRITE"):
            lock_type = "WRITE"
        elif self._match_text_seq("CHECKSUM"):
            lock_type = "CHECKSUM"
        else:
            lock_type = None

        override = self._match_text_seq("OVERRIDE")

        return self.expression(
            exp.LockingProperty,
            this=this,
            kind=kind,
            for_or_in=for_or_in,
            lock_type=lock_type,
            override=override,
        )

    def _parse_partition_by(self) -> t.List[exp.Expression]:
        if self._match(TokenType.PARTITION_BY):
            return self._parse_csv(self._parse_assignment)
        return []

    def _parse_partition_bound_spec(self) -> exp.PartitionBoundSpec:
        def _parse_partition_bound_expr() -> t.Optional[exp.Expression]:
            if self._match_text_seq("MINVALUE"):
                return exp.var("MINVALUE")
            if self._match_text_seq("MAXVALUE"):
                return exp.var("MAXVALUE")
            return self._parse_bitwise()

        this: t.Optional[exp.Expression | t.List[exp.Expression]] = None
        expression = None
        from_expressions = None
        to_expressions = None

        if self._match(TokenType.IN):
            this = self._parse_wrapped_csv(self._parse_bitwise)
        elif self._match(TokenType.FROM):
            from_expressions = self._parse_wrapped_csv(_parse_partition_bound_expr)
            self._match_text_seq("TO")
            to_expressions = self._parse_wrapped_csv(_parse_partition_bound_expr)
        elif self._match_text_seq("WITH", "(", "MODULUS"):
            this = self._parse_number()
            self._match_text_seq(",", "REMAINDER")
            expression = self._parse_number()
            self._match_r_paren()
        else:
            self.raise_error("Failed to parse partition bound spec.")

        return self.expression(
            exp.PartitionBoundSpec,
            this=this,
            expression=expression,
            from_expressions=from_expressions,
            to_expressions=to_expressions,
        )

    # https://www.postgresql.org/docs/current/sql-createtable.html
    def _parse_partitioned_of(self) -> t.Optional[exp.PartitionedOfProperty]:
        if not self._match_text_seq("OF"):
            self._retreat(self._index - 1)
            return None

        this = self._parse_table(schema=True)

        if self._match(TokenType.DEFAULT):
            expression: exp.Var | exp.PartitionBoundSpec = exp.var("DEFAULT")
        elif self._match_text_seq("FOR", "VALUES"):
            expression = self._parse_partition_bound_spec()
        else:
            self.raise_error("Expecting either DEFAULT or FOR VALUES clause.")

        return self.expression(exp.PartitionedOfProperty, this=this, expression=expression)

    def _parse_partitioned_by(self) -> exp.PartitionedByProperty:
        self._match(TokenType.EQ)
        return self.expression(
            exp.PartitionedByProperty,
            this=self._parse_schema() or self._parse_bracket(self._parse_field()),
        )

    def _parse_withdata(self, no: bool = False) -> exp.WithDataProperty:
        if self._match_text_seq("AND", "STATISTICS"):
            statistics = True
        elif self._match_text_seq("AND", "NO", "STATISTICS"):
            statistics = False
        else:
            statistics = None

        return self.expression(exp.WithDataProperty, no=no, statistics=statistics)

    def _parse_contains_property(self) -> t.Optional[exp.SqlReadWriteProperty]:
        if self._match_text_seq("SQL"):
            return self.expression(exp.SqlReadWriteProperty, this="CONTAINS SQL")
        return None

    def _parse_modifies_property(self) -> t.Optional[exp.SqlReadWriteProperty]:
        if self._match_text_seq("SQL", "DATA"):
            return self.expression(exp.SqlReadWriteProperty, this="MODIFIES SQL DATA")
        return None

    def _parse_no_property(self) -> t.Optional[exp.Expression]:
        if self._match_text_seq("PRIMARY", "INDEX"):
            return exp.NoPrimaryIndexProperty()
        if self._match_text_seq("SQL"):
            return self.expression(exp.SqlReadWriteProperty, this="NO SQL")
        return None

    def _parse_on_property(self) -> t.Optional[exp.Expression]:
        if self._match_text_seq("COMMIT", "PRESERVE", "ROWS"):
            return exp.OnCommitProperty()
        if self._match_text_seq("COMMIT", "DELETE", "ROWS"):
            return exp.OnCommitProperty(delete=True)
        return self.expression(exp.OnProperty, this=self._parse_schema(self._parse_id_var()))

    def _parse_reads_property(self) -> t.Optional[exp.SqlReadWriteProperty]:
        if self._match_text_seq("SQL", "DATA"):
            return self.expression(exp.SqlReadWriteProperty, this="READS SQL DATA")
        return None

    def _parse_distkey(self) -> exp.DistKeyProperty:
        return self.expression(exp.DistKeyProperty, this=self._parse_wrapped(self._parse_id_var))

    def _parse_create_like(self) -> t.Optional[exp.LikeProperty]:
        table = self._parse_table(schema=True)

        options = []
        while self._match_texts(("INCLUDING", "EXCLUDING")):
            this = self._prev.text.upper()

            id_var = self._parse_id_var()
            if not id_var:
                return None

            options.append(
                self.expression(exp.Property, this=this, value=exp.var(id_var.this.upper()))
            )

        return self.expression(exp.LikeProperty, this=table, expressions=options)

    def _parse_sortkey(self, compound: bool = False) -> exp.SortKeyProperty:
        return self.expression(
            exp.SortKeyProperty, this=self._parse_wrapped_id_vars(), compound=compound
        )

    def _parse_character_set(self, default: bool = False) -> exp.CharacterSetProperty:
        self._match(TokenType.EQ)
        return self.expression(
            exp.CharacterSetProperty, this=self._parse_var_or_string(), default=default
        )

    def _parse_remote_with_connection(self) -> exp.RemoteWithConnectionModelProperty:
        self._match_text_seq("WITH", "CONNECTION")
        return self.expression(
            exp.RemoteWithConnectionModelProperty, this=self._parse_table_parts()
        )

    def _parse_returns(self) -> exp.ReturnsProperty:
        value: t.Optional[exp.Expression]
        null = None
        is_table = self._match(TokenType.TABLE)

        if is_table:
            if self._match(TokenType.LT):
                value = self.expression(
                    exp.Schema,
                    this="TABLE",
                    expressions=self._parse_csv(self._parse_struct_types),
                )
                if not self._match(TokenType.GT):
                    self.raise_error("Expecting >")
            else:
                value = self._parse_schema(exp.var("TABLE"))
        elif self._match_text_seq("NULL", "ON", "NULL", "INPUT"):
            null = True
            value = None
        else:
            value = self._parse_types()

        return self.expression(exp.ReturnsProperty, this=value, is_table=is_table, null=null)

    def _parse_describe(self) -> exp.Describe:
        kind = self._match_set(self.CREATABLES) and self._prev.text
        style = self._match_texts(self.DESCRIBE_STYLES) and self._prev.text.upper()
        if self._match(TokenType.DOT):
            style = None
            self._retreat(self._index - 2)

        format = self._parse_property() if self._match(TokenType.FORMAT, advance=False) else None

        if self._match_set(self.STATEMENT_PARSERS, advance=False):
            this = self._parse_statement()
        else:
            this = self._parse_table(schema=True)

        properties = self._parse_properties()
        expressions = properties.expressions if properties else None
        partition = self._parse_partition()
        return self.expression(
            exp.Describe,
            this=this,
            style=style,
            kind=kind,
            expressions=expressions,
            partition=partition,
            format=format,
        )

    def _parse_multitable_inserts(self, comments: t.Optional[t.List[str]]) -> exp.MultitableInserts:
        kind = self._prev.text.upper()
        expressions = []

        def parse_conditional_insert() -> t.Optional[exp.ConditionalInsert]:
            if self._match(TokenType.WHEN):
                expression = self._parse_disjunction()
                self._match(TokenType.THEN)
            else:
                expression = None

            else_ = self._match(TokenType.ELSE)

            if not self._match(TokenType.INTO):
                return None

            return self.expression(
                exp.ConditionalInsert,
                this=self.expression(
                    exp.Insert,
                    this=self._parse_table(schema=True),
                    expression=self._parse_derived_table_values(),
                ),
                expression=expression,
                else_=else_,
            )

        expression = parse_conditional_insert()
        while expression is not None:
            expressions.append(expression)
            expression = parse_conditional_insert()

        return self.expression(
            exp.MultitableInserts,
            kind=kind,
            comments=comments,
            expressions=expressions,
            source=self._parse_table(),
        )

    def _parse_insert(self) -> t.Union[exp.Insert, exp.MultitableInserts]:
        comments = []
        hint = self._parse_hint()
        overwrite = self._match(TokenType.OVERWRITE)
        ignore = self._match(TokenType.IGNORE)
        local = self._match_text_seq("LOCAL")
        alternative = None
        is_function = None

        if self._match_text_seq("DIRECTORY"):
            this: t.Optional[exp.Expression] = self.expression(
                exp.Directory,
                this=self._parse_var_or_string(),
                local=local,
                row_format=self._parse_row_format(match_row=True),
            )
        else:
            if self._match_set((TokenType.FIRST, TokenType.ALL)):
                comments += ensure_list(self._prev_comments)
                return self._parse_multitable_inserts(comments)

            if self._match(TokenType.OR):
                alternative = self._match_texts(self.INSERT_ALTERNATIVES) and self._prev.text

            self._match(TokenType.INTO)
            comments += ensure_list(self._prev_comments)
            self._match(TokenType.TABLE)
            is_function = self._match(TokenType.FUNCTION)

            this = (
                self._parse_table(schema=True, parse_partition=True)
                if not is_function
                else self._parse_function()
            )

        returning = self._parse_returning()

        return self.expression(
            exp.Insert,
            comments=comments,
            hint=hint,
            is_function=is_function,
            this=this,
            stored=self._match_text_seq("STORED") and self._parse_stored(),
            by_name=self._match_text_seq("BY", "NAME"),
            exists=self._parse_exists(),
            where=self._match_pair(TokenType.REPLACE, TokenType.WHERE) and self._parse_assignment(),
            partition=self._match(TokenType.PARTITION_BY) and self._parse_partitioned_by(),
            settings=self._match_text_seq("SETTINGS") and self._parse_settings_property(),
            expression=self._parse_derived_table_values() or self._parse_ddl_select(),
            conflict=self._parse_on_conflict(),
            returning=returning or self._parse_returning(),
            overwrite=overwrite,
            alternative=alternative,
            ignore=ignore,
            source=self._match(TokenType.TABLE) and self._parse_table(),
        )

    def _parse_kill(self) -> exp.Kill:
        kind = exp.var(self._prev.text) if self._match_texts(("CONNECTION", "QUERY")) else None

        return self.expression(
            exp.Kill,
            this=self._parse_primary(),
            kind=kind,
        )

    def _parse_on_conflict(self) -> t.Optional[exp.OnConflict]:
        conflict = self._match_text_seq("ON", "CONFLICT")
        duplicate = self._match_text_seq("ON", "DUPLICATE", "KEY")

        if not conflict and not duplicate:
            return None

        conflict_keys = None
        constraint = None

        if conflict:
            if self._match_text_seq("ON", "CONSTRAINT"):
                constraint = self._parse_id_var()
            elif self._match(TokenType.L_PAREN):
                conflict_keys = self._parse_csv(self._parse_id_var)
                self._match_r_paren()

        action = self._parse_var_from_options(self.CONFLICT_ACTIONS)
        if self._prev.token_type == TokenType.UPDATE:
            self._match(TokenType.SET)
            expressions = self._parse_csv(self._parse_equality)
        else:
            expressions = None

        return self.expression(
            exp.OnConflict,
            duplicate=duplicate,
            expressions=expressions,
            action=action,
            conflict_keys=conflict_keys,
            constraint=constraint,
        )

    def _parse_returning(self) -> t.Optional[exp.Returning]:
        if not self._match(TokenType.RETURNING):
            return None
        return self.expression(
            exp.Returning,
            expressions=self._parse_csv(self._parse_expression),
            into=self._match(TokenType.INTO) and self._parse_table_part(),
        )

    def _parse_row(self) -> t.Optional[exp.RowFormatSerdeProperty | exp.RowFormatDelimitedProperty]:
        if not self._match(TokenType.FORMAT):
            return None
        return self._parse_row_format()

    def _parse_serde_properties(self, with_: bool = False) -> t.Optional[exp.SerdeProperties]:
        index = self._index
        with_ = with_ or self._match_text_seq("WITH")

        if not self._match(TokenType.SERDE_PROPERTIES):
            self._retreat(index)
            return None
        return self.expression(
            exp.SerdeProperties,
            **{  # type: ignore
                "expressions": self._parse_wrapped_properties(),
                "with": with_,
            },
        )

    def _parse_row_format(
        self, match_row: bool = False
    ) -> t.Optional[exp.RowFormatSerdeProperty | exp.RowFormatDelimitedProperty]:
        if match_row and not self._match_pair(TokenType.ROW, TokenType.FORMAT):
            return None

        if self._match_text_seq("SERDE"):
            this = self._parse_string()

            serde_properties = self._parse_serde_properties()

            return self.expression(
                exp.RowFormatSerdeProperty, this=this, serde_properties=serde_properties
            )

        self._match_text_seq("DELIMITED")

        kwargs = {}

        if self._match_text_seq("FIELDS", "TERMINATED", "BY"):
            kwargs["fields"] = self._parse_string()
            if self._match_text_seq("ESCAPED", "BY"):
                kwargs["escaped"] = self._parse_string()
        if self._match_text_seq("COLLECTION", "ITEMS", "TERMINATED", "BY"):
            kwargs["collection_items"] = self._parse_string()
        if self._match_text_seq("MAP", "KEYS", "TERMINATED", "BY"):
            kwargs["map_keys"] = self._parse_string()
        if self._match_text_seq("LINES", "TERMINATED", "BY"):
            kwargs["lines"] = self._parse_string()
        if self._match_text_seq("NULL", "DEFINED", "AS"):
            kwargs["null"] = self._parse_string()

        return self.expression(exp.RowFormatDelimitedProperty, **kwargs)  # type: ignore

    def _parse_load(self) -> exp.LoadData | exp.Command:
        if self._match_text_seq("DATA"):
            local = self._match_text_seq("LOCAL")
            self._match_text_seq("INPATH")
            inpath = self._parse_string()
            overwrite = self._match(TokenType.OVERWRITE)
            self._match_pair(TokenType.INTO, TokenType.TABLE)

            return self.expression(
                exp.LoadData,
                this=self._parse_table(schema=True),
                local=local,
                overwrite=overwrite,
                inpath=inpath,
                partition=self._parse_partition(),
                input_format=self._match_text_seq("INPUTFORMAT") and self._parse_string(),
                serde=self._match_text_seq("SERDE") and self._parse_string(),
            )
        return self._parse_as_command(self._prev)

    def _parse_delete(self) -> exp.Delete:
        # This handles MySQL's "Multiple-Table Syntax"
        # https://dev.mysql.com/doc/refman/8.0/en/delete.html
        tables = None
        if not self._match(TokenType.FROM, advance=False):
            tables = self._parse_csv(self._parse_table) or None

        returning = self._parse_returning()

        return self.expression(
            exp.Delete,
            tables=tables,
            this=self._match(TokenType.FROM) and self._parse_table(joins=True),
            using=self._match(TokenType.USING) and self._parse_table(joins=True),
            cluster=self._match(TokenType.ON) and self._parse_on_property(),
            where=self._parse_where(),
            returning=returning or self._parse_returning(),
            limit=self._parse_limit(),
        )

    def _parse_update(self) -> exp.Update:
        this = self._parse_table(joins=True, alias_tokens=self.UPDATE_ALIAS_TOKENS)
        expressions = self._match(TokenType.SET) and self._parse_csv(self._parse_equality)
        returning = self._parse_returning()
        return self.expression(
            exp.Update,
            **{  # type: ignore
                "this": this,
                "expressions": expressions,
                "from": self._parse_from(joins=True),
                "where": self._parse_where(),
                "returning": returning or self._parse_returning(),
                "order": self._parse_order(),
                "limit": self._parse_limit(),
            },
        )

    def _parse_uncache(self) -> exp.Uncache:
        if not self._match(TokenType.TABLE):
            self.raise_error("Expecting TABLE after UNCACHE")

        return self.expression(
            exp.Uncache, exists=self._parse_exists(), this=self._parse_table(schema=True)
        )

    def _parse_cache(self) -> exp.Cache:
        lazy = self._match_text_seq("LAZY")
        self._match(TokenType.TABLE)
        table = self._parse_table(schema=True)

        options = []
        if self._match_text_seq("OPTIONS"):
            self._match_l_paren()
            k = self._parse_string()
            self._match(TokenType.EQ)
            v = self._parse_string()
            options = [k, v]
            self._match_r_paren()

        self._match(TokenType.ALIAS)
        return self.expression(
            exp.Cache,
            this=table,
            lazy=lazy,
            options=options,
            expression=self._parse_select(nested=True),
        )

    def _parse_partition(self) -> t.Optional[exp.Partition]:
        if not self._match(TokenType.PARTITION):
            return None

        return self.expression(
            exp.Partition, expressions=self._parse_wrapped_csv(self._parse_assignment)
        )

    def _parse_value(self) -> t.Optional[exp.Tuple]:
        def _parse_value_expression() -> t.Optional[exp.Expression]:
            if self.dialect.SUPPORTS_VALUES_DEFAULT and self._match(TokenType.DEFAULT):
                return exp.var(self._prev.text.upper())
            return self._parse_expression()

        if self._match(TokenType.L_PAREN):
            expressions = self._parse_csv(_parse_value_expression)
            self._match_r_paren()
            return self.expression(exp.Tuple, expressions=expressions)

        # In some dialects we can have VALUES 1, 2 which results in 1 column & 2 rows.
        expression = self._parse_expression()
        if expression:
            return self.expression(exp.Tuple, expressions=[expression])
        return None

    def _parse_projections(self) -> t.List[exp.Expression]:
        return self._parse_expressions()

    def _parse_select(
        self,
        nested: bool = False,
        table: bool = False,
        parse_subquery_alias: bool = True,
        parse_set_operation: bool = True,
    ) -> t.Optional[exp.Expression]:
        cte = self._parse_with()

        if cte:
            this = self._parse_statement()

            if not this:
                self.raise_error("Failed to parse any statement following CTE")
                return cte

            if "with" in this.arg_types:
                this.set("with", cte)
            else:
                self.raise_error(f"{this.key} does not support CTE")
                this = cte

            return this

        # duckdb supports leading with FROM x
        from_ = self._parse_from() if self._match(TokenType.FROM, advance=False) else None

        if self._match(TokenType.SELECT):
            comments = self._prev_comments

            hint = self._parse_hint()

            if self._next and not self._next.token_type == TokenType.DOT:
                all_ = self._match(TokenType.ALL)
                distinct = self._match_set(self.DISTINCT_TOKENS)
            else:
                all_, distinct = None, None

            kind = (
                self._match(TokenType.ALIAS)
                and self._match_texts(("STRUCT", "VALUE"))
                and self._prev.text.upper()
            )

            if distinct:
                distinct = self.expression(
                    exp.Distinct,
                    on=self._parse_value() if self._match(TokenType.ON) else None,
                )

            if all_ and distinct:
                self.raise_error("Cannot specify both ALL and DISTINCT after SELECT")

            operation_modifiers = []
            while self._curr and self._match_texts(self.OPERATION_MODIFIERS):
                operation_modifiers.append(exp.var(self._prev.text.upper()))

            limit = self._parse_limit(top=True)
            projections = self._parse_projections()

            this = self.expression(
                exp.Select,
                kind=kind,
                hint=hint,
                distinct=distinct,
                expressions=projections,
                limit=limit,
                operation_modifiers=operation_modifiers or None,
            )
            this.comments = comments

            into = self._parse_into()
            if into:
                this.set("into", into)

            if not from_:
                from_ = self._parse_from()

            if from_:
                this.set("from", from_)

            this = self._parse_query_modifiers(this)
        elif (table or nested) and self._match(TokenType.L_PAREN):
            if self._match(TokenType.PIVOT):
                this = self._parse_simplified_pivot()
            elif self._match(TokenType.FROM):
                this = exp.select("*").from_(
                    t.cast(exp.From, self._parse_from(skip_from_token=True))
                )
            else:
                this = (
                    self._parse_table()
                    if table
                    else self._parse_select(nested=True, parse_set_operation=False)
                )

                # Transform exp.Values into a exp.Table to pass through parse_query_modifiers
                # in case a modifier (e.g. join) is following
                if table and isinstance(this, exp.Values) and this.alias:
                    alias = this.args["alias"].pop()
                    this = exp.Table(this=this, alias=alias)

                this = self._parse_query_modifiers(self._parse_set_operations(this))

            self._match_r_paren()

            # We return early here so that the UNION isn't attached to the subquery by the
            # following call to _parse_set_operations, but instead becomes the parent node
            return self._parse_subquery(this, parse_alias=parse_subquery_alias)
        elif self._match(TokenType.VALUES, advance=False):
            this = self._parse_derived_table_values()
        elif from_:
            this = exp.select("*").from_(from_.this, copy=False)
        elif self._match(TokenType.SUMMARIZE):
            table = self._match(TokenType.TABLE)
            this = self._parse_select() or self._parse_string() or self._parse_table()
            return self.expression(exp.Summarize, this=this, table=table)
        elif self._match(TokenType.DESCRIBE):
            this = self._parse_describe()
        elif self._match_text_seq("STREAM"):
            this = self._parse_function()
            if this:
                this = self.expression(exp.Stream, this=this)
            else:
                self._retreat(self._index - 1)
        else:
            this = None

        return self._parse_set_operations(this) if parse_set_operation else this

    def _parse_with(self, skip_with_token: bool = False) -> t.Optional[exp.With]:
        if not skip_with_token and not self._match(TokenType.WITH):
            return None

        comments = self._prev_comments
        recursive = self._match(TokenType.RECURSIVE)

        last_comments = None
        expressions = []
        while True:
            expressions.append(self._parse_cte())
            if last_comments:
                expressions[-1].add_comments(last_comments)

            if not self._match(TokenType.COMMA) and not self._match(TokenType.WITH):
                break
            else:
                self._match(TokenType.WITH)

            last_comments = self._prev_comments

        return self.expression(
            exp.With, comments=comments, expressions=expressions, recursive=recursive
        )

    def _parse_cte(self) -> exp.CTE:
        alias = self._parse_table_alias(self.ID_VAR_TOKENS)
        if not alias or not alias.this:
            self.raise_error("Expected CTE to have alias")

        self._match(TokenType.ALIAS)
        comments = self._prev_comments

        if self._match_text_seq("NOT", "MATERIALIZED"):
            materialized = False
        elif self._match_text_seq("MATERIALIZED"):
            materialized = True
        else:
            materialized = None

        return self.expression(
            exp.CTE,
            this=self._parse_wrapped(self._parse_statement),
            alias=alias,
            materialized=materialized,
            comments=comments,
        )

    def _parse_table_alias(
        self, alias_tokens: t.Optional[t.Collection[TokenType]] = None
    ) -> t.Optional[exp.TableAlias]:
        any_token = self._match(TokenType.ALIAS)
        alias = (
            self._parse_id_var(any_token=any_token, tokens=alias_tokens or self.TABLE_ALIAS_TOKENS)
            or self._parse_string_as_identifier()
        )

        index = self._index
        if self._match(TokenType.L_PAREN):
            columns = self._parse_csv(self._parse_function_parameter)
            self._match_r_paren() if columns else self._retreat(index)
        else:
            columns = None

        if not alias and not columns:
            return None

        table_alias = self.expression(exp.TableAlias, this=alias, columns=columns)

        # We bubble up comments from the Identifier to the TableAlias
        if isinstance(alias, exp.Identifier):
            table_alias.add_comments(alias.pop_comments())

        return table_alias

    def _parse_subquery(
        self, this: t.Optional[exp.Expression], parse_alias: bool = True
    ) -> t.Optional[exp.Subquery]:
        if not this:
            return None

        return self.expression(
            exp.Subquery,
            this=this,
            pivots=self._parse_pivots(),
            alias=self._parse_table_alias() if parse_alias else None,
            sample=self._parse_table_sample(),
        )

    def _implicit_unnests_to_explicit(self, this: E) -> E:
        from sqlglot.optimizer.normalize_identifiers import normalize_identifiers as _norm

        refs = {_norm(this.args["from"].this.copy(), dialect=self.dialect).alias_or_name}
        for i, join in enumerate(this.args.get("joins") or []):
            table = join.this
            normalized_table = table.copy()
            normalized_table.meta["maybe_column"] = True
            normalized_table = _norm(normalized_table, dialect=self.dialect)

            if isinstance(table, exp.Table) and not join.args.get("on"):
                if normalized_table.parts[0].name in refs:
                    table_as_column = table.to_column()
                    unnest = exp.Unnest(expressions=[table_as_column])

                    # Table.to_column creates a parent Alias node that we want to convert to
                    # a TableAlias and attach to the Unnest, so it matches the parser's output
                    if isinstance(table.args.get("alias"), exp.TableAlias):
                        table_as_column.replace(table_as_column.this)
                        exp.alias_(unnest, None, table=[table.args["alias"].this], copy=False)

                    table.replace(unnest)

            refs.add(normalized_table.alias_or_name)

        return this

    def _parse_query_modifiers(
        self, this: t.Optional[exp.Expression]
    ) -> t.Optional[exp.Expression]:
        if isinstance(this, (exp.Query, exp.Table)):
            for join in self._parse_joins():
                this.append("joins", join)
            for lateral in iter(self._parse_lateral, None):
                this.append("laterals", lateral)

            while True:
                if self._match_set(self.QUERY_MODIFIER_PARSERS, advance=False):
                    parser = self.QUERY_MODIFIER_PARSERS[self._curr.token_type]
                    key, expression = parser(self)

                    if expression:
                        this.set(key, expression)
                        if key == "limit":
                            offset = expression.args.pop("offset", None)

                            if offset:
                                offset = exp.Offset(expression=offset)
                                this.set("offset", offset)

                                limit_by_expressions = expression.expressions
                                expression.set("expressions", None)
                                offset.set("expressions", limit_by_expressions)
                        continue
                break

        if self.SUPPORTS_IMPLICIT_UNNEST and this and this.args.get("from"):
            this = self._implicit_unnests_to_explicit(this)

        return this

    def _parse_hint_fallback_to_string(self) -> t.Optional[exp.Hint]:
        start = self._curr
        while self._curr:
            self._advance()

        end = self._tokens[self._index - 1]
        return exp.Hint(expressions=[self._find_sql(start, end)])

    def _parse_hint_function_call(self) -> t.Optional[exp.Expression]:
        return self._parse_function_call()

    def _parse_hint_body(self) -> t.Optional[exp.Hint]:
        start_index = self._index
        should_fallback_to_string = False

        hints = []
        try:
            for hint in iter(
                lambda: self._parse_csv(
                    lambda: self._parse_hint_function_call() or self._parse_var(upper=True),
                ),
                [],
            ):
                hints.extend(hint)
        except ParseError:
            should_fallback_to_string = True

        if should_fallback_to_string or self._curr:
            self._retreat(start_index)
            return self._parse_hint_fallback_to_string()

        return self.expression(exp.Hint, expressions=hints)

    def _parse_hint(self) -> t.Optional[exp.Hint]:
        if self._match(TokenType.HINT) and self._prev_comments:
            return exp.maybe_parse(self._prev_comments[0], into=exp.Hint, dialect=self.dialect)

        return None

    def _parse_into(self) -> t.Optional[exp.Into]:
        if not self._match(TokenType.INTO):
            return None

        temp = self._match(TokenType.TEMPORARY)
        unlogged = self._match_text_seq("UNLOGGED")
        self._match(TokenType.TABLE)

        return self.expression(
            exp.Into, this=self._parse_table(schema=True), temporary=temp, unlogged=unlogged
        )

    def _parse_from(
        self, joins: bool = False, skip_from_token: bool = False
    ) -> t.Optional[exp.From]:
        if not skip_from_token and not self._match(TokenType.FROM):
            return None

        return self.expression(
            exp.From, comments=self._prev_comments, this=self._parse_table(joins=joins)
        )

    def _parse_match_recognize_measure(self) -> exp.MatchRecognizeMeasure:
        return self.expression(
            exp.MatchRecognizeMeasure,
            window_frame=self._match_texts(("FINAL", "RUNNING")) and self._prev.text.upper(),
            this=self._parse_expression(),
        )

    def _parse_match_recognize(self) -> t.Optional[exp.MatchRecognize]:
        if not self._match(TokenType.MATCH_RECOGNIZE):
            return None

        self._match_l_paren()

        partition = self._parse_partition_by()
        order = self._parse_order()

        measures = (
            self._parse_csv(self._parse_match_recognize_measure)
            if self._match_text_seq("MEASURES")
            else None
        )

        if self._match_text_seq("ONE", "ROW", "PER", "MATCH"):
            rows = exp.var("ONE ROW PER MATCH")
        elif self._match_text_seq("ALL", "ROWS", "PER", "MATCH"):
            text = "ALL ROWS PER MATCH"
            if self._match_text_seq("SHOW", "EMPTY", "MATCHES"):
                text += " SHOW EMPTY MATCHES"
            elif self._match_text_seq("OMIT", "EMPTY", "MATCHES"):
                text += " OMIT EMPTY MATCHES"
            elif self._match_text_seq("WITH", "UNMATCHED", "ROWS"):
                text += " WITH UNMATCHED ROWS"
            rows = exp.var(text)
        else:
            rows = None

        if self._match_text_seq("AFTER", "MATCH", "SKIP"):
            text = "AFTER MATCH SKIP"
            if self._match_text_seq("PAST", "LAST", "ROW"):
                text += " PAST LAST ROW"
            elif self._match_text_seq("TO", "NEXT", "ROW"):
                text += " TO NEXT ROW"
            elif self._match_text_seq("TO", "FIRST"):
                text += f" TO FIRST {self._advance_any().text}"  # type: ignore
            elif self._match_text_seq("TO", "LAST"):
                text += f" TO LAST {self._advance_any().text}"  # type: ignore
            after = exp.var(text)
        else:
            after = None

        if self._match_text_seq("PATTERN"):
            self._match_l_paren()

            if not self._curr:
                self.raise_error("Expecting )", self._curr)

            paren = 1
            start = self._curr

            while self._curr and paren > 0:
                if self._curr.token_type == TokenType.L_PAREN:
                    paren += 1
                if self._curr.token_type == TokenType.R_PAREN:
                    paren -= 1

                end = self._prev
                self._advance()

            if paren > 0:
                self.raise_error("Expecting )", self._curr)

            pattern = exp.var(self._find_sql(start, end))
        else:
            pattern = None

        define = (
            self._parse_csv(self._parse_name_as_expression)
            if self._match_text_seq("DEFINE")
            else None
        )

        self._match_r_paren()

        return self.expression(
            exp.MatchRecognize,
            partition_by=partition,
            order=order,
            measures=measures,
            rows=rows,
            after=after,
            pattern=pattern,
            define=define,
            alias=self._parse_table_alias(),
        )

    def _parse_lateral(self) -> t.Optional[exp.Lateral]:
        cross_apply = self._match_pair(TokenType.CROSS, TokenType.APPLY)
        if not cross_apply and self._match_pair(TokenType.OUTER, TokenType.APPLY):
            cross_apply = False

        if cross_apply is not None:
            this = self._parse_select(table=True)
            view = None
            outer = None
        elif self._match(TokenType.LATERAL):
            this = self._parse_select(table=True)
            view = self._match(TokenType.VIEW)
            outer = self._match(TokenType.OUTER)
        else:
            return None

        if not this:
            this = (
                self._parse_unnest()
                or self._parse_function()
                or self._parse_id_var(any_token=False)
            )

            while self._match(TokenType.DOT):
                this = exp.Dot(
                    this=this,
                    expression=self._parse_function() or self._parse_id_var(any_token=False),
                )

        if view:
            table = self._parse_id_var(any_token=False)
            columns = self._parse_csv(self._parse_id_var) if self._match(TokenType.ALIAS) else []
            table_alias: t.Optional[exp.TableAlias] = self.expression(
                exp.TableAlias, this=table, columns=columns
            )
        elif isinstance(this, (exp.Subquery, exp.Unnest)) and this.alias:
            # We move the alias from the lateral's child node to the lateral itself
            table_alias = this.args["alias"].pop()
        else:
            table_alias = self._parse_table_alias()

        return self.expression(
            exp.Lateral,
            this=this,
            view=view,
            outer=outer,
            alias=table_alias,
            cross_apply=cross_apply,
        )

    def _parse_join_parts(
        self,
    ) -> t.Tuple[t.Optional[Token], t.Optional[Token], t.Optional[Token]]:
        return (
            self._match_set(self.JOIN_METHODS) and self._prev,
            self._match_set(self.JOIN_SIDES) and self._prev,
            self._match_set(self.JOIN_KINDS) and self._prev,
        )

    def _parse_using_identifiers(self) -> t.List[exp.Expression]:
        def _parse_column_as_identifier() -> t.Optional[exp.Expression]:
            this = self._parse_column()
            if isinstance(this, exp.Column):
                return this.this
            return this

        return self._parse_wrapped_csv(_parse_column_as_identifier, optional=True)

    def _parse_join(
        self, skip_join_token: bool = False, parse_bracket: bool = False
    ) -> t.Optional[exp.Join]:
        if self._match(TokenType.COMMA):
            return self.expression(exp.Join, this=self._parse_table())

        index = self._index
        method, side, kind = self._parse_join_parts()
        hint = self._prev.text if self._match_texts(self.JOIN_HINTS) else None
        join = self._match(TokenType.JOIN) or (kind and kind.token_type == TokenType.STRAIGHT_JOIN)

        if not skip_join_token and not join:
            self._retreat(index)
            kind = None
            method = None
            side = None

        outer_apply = self._match_pair(TokenType.OUTER, TokenType.APPLY, False)
        cross_apply = self._match_pair(TokenType.CROSS, TokenType.APPLY, False)

        if not skip_join_token and not join and not outer_apply and not cross_apply:
            return None

        kwargs: t.Dict[str, t.Any] = {"this": self._parse_table(parse_bracket=parse_bracket)}
        if kind and kind.token_type == TokenType.ARRAY and self._match(TokenType.COMMA):
            kwargs["expressions"] = self._parse_csv(
                lambda: self._parse_table(parse_bracket=parse_bracket)
            )

        if method:
            kwargs["method"] = method.text
        if side:
            kwargs["side"] = side.text
        if kind:
            kwargs["kind"] = kind.text
        if hint:
            kwargs["hint"] = hint

        if self._match(TokenType.MATCH_CONDITION):
            kwargs["match_condition"] = self._parse_wrapped(self._parse_comparison)

        if self._match(TokenType.ON):
            kwargs["on"] = self._parse_assignment()
        elif self._match(TokenType.USING):
            kwargs["using"] = self._parse_using_identifiers()
        elif (
            not (outer_apply or cross_apply)
            and not isinstance(kwargs["this"], exp.Unnest)
            and not (kind and kind.token_type in (TokenType.CROSS, TokenType.ARRAY))
        ):
            index = self._index
            joins: t.Optional[list] = list(self._parse_joins())

            if joins and self._match(TokenType.ON):
                kwargs["on"] = self._parse_assignment()
            elif joins and self._match(TokenType.USING):
                kwargs["using"] = self._parse_using_identifiers()
            else:
                joins = None
                self._retreat(index)

            kwargs["this"].set("joins", joins if joins else None)

        comments = [c for token in (method, side, kind) if token for c in token.comments]
        return self.expression(exp.Join, comments=comments, **kwargs)

    def _parse_opclass(self) -> t.Optional[exp.Expression]:
        this = self._parse_assignment()

        if self._match_texts(self.OPCLASS_FOLLOW_KEYWORDS, advance=False):
            return this

        if not self._match_set(self.OPTYPE_FOLLOW_TOKENS, advance=False):
            return self.expression(exp.Opclass, this=this, expression=self._parse_table_parts())

        return this

    def _parse_index_params(self) -> exp.IndexParameters:
        using = self._parse_var(any_token=True) if self._match(TokenType.USING) else None

        if self._match(TokenType.L_PAREN, advance=False):
            columns = self._parse_wrapped_csv(self._parse_with_operator)
        else:
            columns = None

        include = self._parse_wrapped_id_vars() if self._match_text_seq("INCLUDE") else None
        partition_by = self._parse_partition_by()
        with_storage = self._match(TokenType.WITH) and self._parse_wrapped_properties()
        tablespace = (
            self._parse_var(any_token=True)
            if self._match_text_seq("USING", "INDEX", "TABLESPACE")
            else None
        )
        where = self._parse_where()

        on = self._parse_field() if self._match(TokenType.ON) else None

        return self.expression(
            exp.IndexParameters,
            using=using,
            columns=columns,
            include=include,
            partition_by=partition_by,
            where=where,
            with_storage=with_storage,
            tablespace=tablespace,
            on=on,
        )

    def _parse_index(
        self, index: t.Optional[exp.Expression] = None, anonymous: bool = False
    ) -> t.Optional[exp.Index]:
        if index or anonymous:
            unique = None
            primary = None
            amp = None

            self._match(TokenType.ON)
            self._match(TokenType.TABLE)  # hive
            table = self._parse_table_parts(schema=True)
        else:
            unique = self._match(TokenType.UNIQUE)
            primary = self._match_text_seq("PRIMARY")
            amp = self._match_text_seq("AMP")

            if not self._match(TokenType.INDEX):
                return None

            index = self._parse_id_var()
            table = None

        params = self._parse_index_params()

        return self.expression(
            exp.Index,
            this=index,
            table=table,
            unique=unique,
            primary=primary,
            amp=amp,
            params=params,
        )

    def _parse_table_hints(self) -> t.Optional[t.List[exp.Expression]]:
        hints: t.List[exp.Expression] = []
        if self._match_pair(TokenType.WITH, TokenType.L_PAREN):
            # https://learn.microsoft.com/en-us/sql/t-sql/queries/hints-transact-sql-table?view=sql-server-ver16
            hints.append(
                self.expression(
                    exp.WithTableHint,
                    expressions=self._parse_csv(
                        lambda: self._parse_function() or self._parse_var(any_token=True)
                    ),
                )
            )
            self._match_r_paren()
        else:
            # https://dev.mysql.com/doc/refman/8.0/en/index-hints.html
            while self._match_set(self.TABLE_INDEX_HINT_TOKENS):
                hint = exp.IndexTableHint(this=self._prev.text.upper())

                self._match_set((TokenType.INDEX, TokenType.KEY))
                if self._match(TokenType.FOR):
                    hint.set("target", self._advance_any() and self._prev.text.upper())

                hint.set("expressions", self._parse_wrapped_id_vars())
                hints.append(hint)

        return hints or None

    def _parse_table_part(self, schema: bool = False) -> t.Optional[exp.Expression]:
        return (
            (not schema and self._parse_function(optional_parens=False))
            or self._parse_id_var(any_token=False)
            or self._parse_string_as_identifier()
            or self._parse_placeholder()
        )

    def _parse_table_parts(
        self, schema: bool = False, is_db_reference: bool = False, wildcard: bool = False
    ) -> exp.Table:
        catalog = None
        db = None
        table: t.Optional[exp.Expression | str] = self._parse_table_part(schema=schema)

        while self._match(TokenType.DOT):
            if catalog:
                # This allows nesting the table in arbitrarily many dot expressions if needed
                table = self.expression(
                    exp.Dot, this=table, expression=self._parse_table_part(schema=schema)
                )
            else:
                catalog = db
                db = table
                # "" used for tsql FROM a..b case
                table = self._parse_table_part(schema=schema) or ""

        if (
            wildcard
            and self._is_connected()
            and (isinstance(table, exp.Identifier) or not table)
            and self._match(TokenType.STAR)
        ):
            if isinstance(table, exp.Identifier):
                table.args["this"] += "*"
            else:
                table = exp.Identifier(this="*")

        # We bubble up comments from the Identifier to the Table
        comments = table.pop_comments() if isinstance(table, exp.Expression) else None

        if is_db_reference:
            catalog = db
            db = table
            table = None

        if not table and not is_db_reference:
            self.raise_error(f"Expected table name but got {self._curr}")
        if not db and is_db_reference:
            self.raise_error(f"Expected database name but got {self._curr}")

        table = self.expression(
            exp.Table,
            comments=comments,
            this=table,
            db=db,
            catalog=catalog,
        )

        changes = self._parse_changes()
        if changes:
            table.set("changes", changes)

        at_before = self._parse_historical_data()
        if at_before:
            table.set("when", at_before)

        pivots = self._parse_pivots()
        if pivots:
            table.set("pivots", pivots)

        return table

    def _parse_table(
        self,
        schema: bool = False,
        joins: bool = False,
        alias_tokens: t.Optional[t.Collection[TokenType]] = None,
        parse_bracket: bool = False,
        is_db_reference: bool = False,
        parse_partition: bool = False,
    ) -> t.Optional[exp.Expression]:
        lateral = self._parse_lateral()
        if lateral:
            return lateral

        unnest = self._parse_unnest()
        if unnest:
            return unnest

        values = self._parse_derived_table_values()
        if values:
            return values

        subquery = self._parse_select(table=True)
        if subquery:
            if not subquery.args.get("pivots"):
                subquery.set("pivots", self._parse_pivots())
            return subquery

        bracket = parse_bracket and self._parse_bracket(None)
        bracket = self.expression(exp.Table, this=bracket) if bracket else None

        rows_from = self._match_text_seq("ROWS", "FROM") and self._parse_wrapped_csv(
            self._parse_table
        )
        rows_from = self.expression(exp.Table, rows_from=rows_from) if rows_from else None

        only = self._match(TokenType.ONLY)

        this = t.cast(
            exp.Expression,
            bracket
            or rows_from
            or self._parse_bracket(
                self._parse_table_parts(schema=schema, is_db_reference=is_db_reference)
            ),
        )

        if only:
            this.set("only", only)

        # Postgres supports a wildcard (table) suffix operator, which is a no-op in this context
        self._match_text_seq("*")

        parse_partition = parse_partition or self.SUPPORTS_PARTITION_SELECTION
        if parse_partition and self._match(TokenType.PARTITION, advance=False):
            this.set("partition", self._parse_partition())

        if schema:
            return self._parse_schema(this=this)

        version = self._parse_version()

        if version:
            this.set("version", version)

        if self.dialect.ALIAS_POST_TABLESAMPLE:
            this.set("sample", self._parse_table_sample())

        alias = self._parse_table_alias(alias_tokens=alias_tokens or self.TABLE_ALIAS_TOKENS)
        if alias:
            this.set("alias", alias)

        if isinstance(this, exp.Table) and self._match_text_seq("AT"):
            return self.expression(
                exp.AtIndex, this=this.to_column(copy=False), expression=self._parse_id_var()
            )

        this.set("hints", self._parse_table_hints())

        if not this.args.get("pivots"):
            this.set("pivots", self._parse_pivots())

        if not self.dialect.ALIAS_POST_TABLESAMPLE:
            this.set("sample", self._parse_table_sample())

        if joins:
            for join in self._parse_joins():
                this.append("joins", join)

        if self._match_pair(TokenType.WITH, TokenType.ORDINALITY):
            this.set("ordinality", True)
            this.set("alias", self._parse_table_alias())

        return this

    def _parse_version(self) -> t.Optional[exp.Version]:
        if self._match(TokenType.TIMESTAMP_SNAPSHOT):
            this = "TIMESTAMP"
        elif self._match(TokenType.VERSION_SNAPSHOT):
            this = "VERSION"
        else:
            return None

        if self._match_set((TokenType.FROM, TokenType.BETWEEN)):
            kind = self._prev.text.upper()
            start = self._parse_bitwise()
            self._match_texts(("TO", "AND"))
            end = self._parse_bitwise()
            expression: t.Optional[exp.Expression] = self.expression(
                exp.Tuple, expressions=[start, end]
            )
        elif self._match_text_seq("CONTAINED", "IN"):
            kind = "CONTAINED IN"
            expression = self.expression(
                exp.Tuple, expressions=self._parse_wrapped_csv(self._parse_bitwise)
            )
        elif self._match(TokenType.ALL):
            kind = "ALL"
            expression = None
        else:
            self._match_text_seq("AS", "OF")
            kind = "AS OF"
            expression = self._parse_type()

        return self.expression(exp.Version, this=this, expression=expression, kind=kind)

    def _parse_historical_data(self) -> t.Optional[exp.HistoricalData]:
        # https://docs.snowflake.com/en/sql-reference/constructs/at-before
        index = self._index
        historical_data = None
        if self._match_texts(self.HISTORICAL_DATA_PREFIX):
            this = self._prev.text.upper()
            kind = (
                self._match(TokenType.L_PAREN)
                and self._match_texts(self.HISTORICAL_DATA_KIND)
                and self._prev.text.upper()
            )
            expression = self._match(TokenType.FARROW) and self._parse_bitwise()

            if expression:
                self._match_r_paren()
                historical_data = self.expression(
                    exp.HistoricalData, this=this, kind=kind, expression=expression
                )
            else:
                self._retreat(index)

        return historical_data

    def _parse_changes(self) -> t.Optional[exp.Changes]:
        if not self._match_text_seq("CHANGES", "(", "INFORMATION", "=>"):
            return None

        information = self._parse_var(any_token=True)
        self._match_r_paren()

        return self.expression(
            exp.Changes,
            information=information,
            at_before=self._parse_historical_data(),
            end=self._parse_historical_data(),
        )

    def _parse_unnest(self, with_alias: bool = True) -> t.Optional[exp.Unnest]:
        if not self._match(TokenType.UNNEST):
            return None

        expressions = self._parse_wrapped_csv(self._parse_equality)
        offset = self._match_pair(TokenType.WITH, TokenType.ORDINALITY)

        alias = self._parse_table_alias() if with_alias else None

        if alias:
            if self.dialect.UNNEST_COLUMN_ONLY:
                if alias.args.get("columns"):
                    self.raise_error("Unexpected extra column alias in unnest.")

                alias.set("columns", [alias.this])
                alias.set("this", None)

            columns = alias.args.get("columns") or []
            if offset and len(expressions) < len(columns):
                offset = columns.pop()

        if not offset and self._match_pair(TokenType.WITH, TokenType.OFFSET):
            self._match(TokenType.ALIAS)
            offset = self._parse_id_var(
                any_token=False, tokens=self.UNNEST_OFFSET_ALIAS_TOKENS
            ) or exp.to_identifier("offset")

        return self.expression(exp.Unnest, expressions=expressions, alias=alias, offset=offset)

    def _parse_derived_table_values(self) -> t.Optional[exp.Values]:
        is_derived = self._match_pair(TokenType.L_PAREN, TokenType.VALUES)
        if not is_derived and not (
            # ClickHouse's `FORMAT Values` is equivalent to `VALUES`
            self._match_text_seq("VALUES") or self._match_text_seq("FORMAT", "VALUES")
        ):
            return None

        expressions = self._parse_csv(self._parse_value)
        alias = self._parse_table_alias()

        if is_derived:
            self._match_r_paren()

        return self.expression(
            exp.Values, expressions=expressions, alias=alias or self._parse_table_alias()
        )

    def _parse_table_sample(self, as_modifier: bool = False) -> t.Optional[exp.TableSample]:
        if not self._match(TokenType.TABLE_SAMPLE) and not (
            as_modifier and self._match_text_seq("USING", "SAMPLE")
        ):
            return None

        bucket_numerator = None
        bucket_denominator = None
        bucket_field = None
        percent = None
        size = None
        seed = None

        method = self._parse_var(tokens=(TokenType.ROW,), upper=True)
        matched_l_paren = self._match(TokenType.L_PAREN)

        if self.TABLESAMPLE_CSV:
            num = None
            expressions = self._parse_csv(self._parse_primary)
        else:
            expressions = None
            num = (
                self._parse_factor()
                if self._match(TokenType.NUMBER, advance=False)
                else self._parse_primary() or self._parse_placeholder()
            )

        if self._match_text_seq("BUCKET"):
            bucket_numerator = self._parse_number()
            self._match_text_seq("OUT", "OF")
            bucket_denominator = bucket_denominator = self._parse_number()
            self._match(TokenType.ON)
            bucket_field = self._parse_field()
        elif self._match_set((TokenType.PERCENT, TokenType.MOD)):
            percent = num
        elif self._match(TokenType.ROWS) or not self.dialect.TABLESAMPLE_SIZE_IS_PERCENT:
            size = num
        else:
            percent = num

        if matched_l_paren:
            self._match_r_paren()

        if self._match(TokenType.L_PAREN):
            method = self._parse_var(upper=True)
            seed = self._match(TokenType.COMMA) and self._parse_number()
            self._match_r_paren()
        elif self._match_texts(("SEED", "REPEATABLE")):
            seed = self._parse_wrapped(self._parse_number)

        if not method and self.DEFAULT_SAMPLING_METHOD:
            method = exp.var(self.DEFAULT_SAMPLING_METHOD)

        return self.expression(
            exp.TableSample,
            expressions=expressions,
            method=method,
            bucket_numerator=bucket_numerator,
            bucket_denominator=bucket_denominator,
            bucket_field=bucket_field,
            percent=percent,
            size=size,
            seed=seed,
        )

    def _parse_pivots(self) -> t.Optional[t.List[exp.Pivot]]:
        return list(iter(self._parse_pivot, None)) or None

    def _parse_joins(self) -> t.Iterator[exp.Join]:
        return iter(self._parse_join, None)

    # https://duckdb.org/docs/sql/statements/pivot
    def _parse_simplified_pivot(self) -> exp.Pivot:
        def _parse_on() -> t.Optional[exp.Expression]:
            this = self._parse_bitwise()
            return self._parse_in(this) if self._match(TokenType.IN) else this

        this = self._parse_table()
        expressions = self._match(TokenType.ON) and self._parse_csv(_parse_on)
        using = self._match(TokenType.USING) and self._parse_csv(
            lambda: self._parse_alias(self._parse_function())
        )
        group = self._parse_group()
        return self.expression(
            exp.Pivot, this=this, expressions=expressions, using=using, group=group
        )

    def _parse_pivot_in(self) -> exp.In | exp.PivotAny:
        def _parse_aliased_expression() -> t.Optional[exp.Expression]:
            this = self._parse_select_or_expression()

            self._match(TokenType.ALIAS)
            alias = self._parse_bitwise()
            if alias:
                if isinstance(alias, exp.Column) and not alias.db:
                    alias = alias.this
                return self.expression(exp.PivotAlias, this=this, alias=alias)

            return this

        value = self._parse_column()

        if not self._match_pair(TokenType.IN, TokenType.L_PAREN):
            self.raise_error("Expecting IN (")

        if self._match(TokenType.ANY):
            exprs: t.List[exp.Expression] = ensure_list(exp.PivotAny(this=self._parse_order()))
        else:
            exprs = self._parse_csv(_parse_aliased_expression)

        self._match_r_paren()
        return self.expression(exp.In, this=value, expressions=exprs)

    def _parse_pivot(self) -> t.Optional[exp.Pivot]:
        index = self._index
        include_nulls = None

        if self._match(TokenType.PIVOT):
            unpivot = False
        elif self._match(TokenType.UNPIVOT):
            unpivot = True

            # https://docs.databricks.com/en/sql/language-manual/sql-ref-syntax-qry-select-unpivot.html#syntax
            if self._match_text_seq("INCLUDE", "NULLS"):
                include_nulls = True
            elif self._match_text_seq("EXCLUDE", "NULLS"):
                include_nulls = False
        else:
            return None

        expressions = []

        if not self._match(TokenType.L_PAREN):
            self._retreat(index)
            return None

        if unpivot:
            expressions = self._parse_csv(self._parse_column)
        else:
            expressions = self._parse_csv(lambda: self._parse_alias(self._parse_function()))

        if not expressions:
            self.raise_error("Failed to parse PIVOT's aggregation list")

        if not self._match(TokenType.FOR):
            self.raise_error("Expecting FOR")

        field = self._parse_pivot_in()
        default_on_null = self._match_text_seq("DEFAULT", "ON", "NULL") and self._parse_wrapped(
            self._parse_bitwise
        )

        self._match_r_paren()

        pivot = self.expression(
            exp.Pivot,
            expressions=expressions,
            field=field,
            unpivot=unpivot,
            include_nulls=include_nulls,
            default_on_null=default_on_null,
        )

        if not self._match_set((TokenType.PIVOT, TokenType.UNPIVOT), advance=False):
            pivot.set("alias", self._parse_table_alias())

        if not unpivot:
            names = self._pivot_column_names(t.cast(t.List[exp.Expression], expressions))

            columns: t.List[exp.Expression] = []
            for fld in pivot.args["field"].expressions:
                field_name = fld.sql() if self.IDENTIFY_PIVOT_STRINGS else fld.alias_or_name
                for name in names:
                    if self.PREFIXED_PIVOT_COLUMNS:
                        name = f"{name}_{field_name}" if name else field_name
                    else:
                        name = f"{field_name}_{name}" if name else field_name

                    columns.append(exp.to_identifier(name))

            pivot.set("columns", columns)

        return pivot

    def _pivot_column_names(self, aggregations: t.List[exp.Expression]) -> t.List[str]:
        return [agg.alias for agg in aggregations]

    def _parse_prewhere(self, skip_where_token: bool = False) -> t.Optional[exp.PreWhere]:
        if not skip_where_token and not self._match(TokenType.PREWHERE):
            return None

        return self.expression(
            exp.PreWhere, comments=self._prev_comments, this=self._parse_assignment()
        )

    def _parse_where(self, skip_where_token: bool = False) -> t.Optional[exp.Where]:
        if not skip_where_token and not self._match(TokenType.WHERE):
            return None

        return self.expression(
            exp.Where, comments=self._prev_comments, this=self._parse_assignment()
        )

    def _parse_group(self, skip_group_by_token: bool = False) -> t.Optional[exp.Group]:
        if not skip_group_by_token and not self._match(TokenType.GROUP_BY):
            return None

        elements: t.Dict[str, t.Any] = defaultdict(list)

        if self._match(TokenType.ALL):
            elements["all"] = True
        elif self._match(TokenType.DISTINCT):
            elements["all"] = False

        while True:
            index = self._index

            elements["expressions"].extend(
                self._parse_csv(
                    lambda: None
                    if self._match_set((TokenType.CUBE, TokenType.ROLLUP), advance=False)
                    else self._parse_assignment()
                )
            )

            before_with_index = self._index
            with_prefix = self._match(TokenType.WITH)

            if self._match(TokenType.ROLLUP):
                elements["rollup"].append(
                    self._parse_cube_or_rollup(exp.Rollup, with_prefix=with_prefix)
                )
            elif self._match(TokenType.CUBE):
                elements["cube"].append(
                    self._parse_cube_or_rollup(exp.Cube, with_prefix=with_prefix)
                )
            elif self._match(TokenType.GROUPING_SETS):
                elements["grouping_sets"].append(
                    self.expression(
                        exp.GroupingSets,
                        expressions=self._parse_wrapped_csv(self._parse_grouping_set),
                    )
                )
            elif self._match_text_seq("TOTALS"):
                elements["totals"] = True  # type: ignore

            if before_with_index <= self._index <= before_with_index + 1:
                self._retreat(before_with_index)
                break

            if index == self._index:
                break

        return self.expression(exp.Group, **elements)  # type: ignore

    def _parse_cube_or_rollup(self, kind: t.Type[E], with_prefix: bool = False) -> E:
        return self.expression(
            kind, expressions=[] if with_prefix else self._parse_wrapped_csv(self._parse_column)
        )

    def _parse_grouping_set(self) -> t.Optional[exp.Expression]:
        if self._match(TokenType.L_PAREN):
            grouping_set = self._parse_csv(self._parse_column)
            self._match_r_paren()
            return self.expression(exp.Tuple, expressions=grouping_set)

        return self._parse_column()

    def _parse_having(self, skip_having_token: bool = False) -> t.Optional[exp.Having]:
        if not skip_having_token and not self._match(TokenType.HAVING):
            return None
        return self.expression(exp.Having, this=self._parse_assignment())

    def _parse_qualify(self) -> t.Optional[exp.Qualify]:
        if not self._match(TokenType.QUALIFY):
            return None
        return self.expression(exp.Qualify, this=self._parse_assignment())

    def _parse_connect(self, skip_start_token: bool = False) -> t.Optional[exp.Connect]:
        if skip_start_token:
            start = None
        elif self._match(TokenType.START_WITH):
            start = self._parse_assignment()
        else:
            return None

        self._match(TokenType.CONNECT_BY)
        nocycle = self._match_text_seq("NOCYCLE")
        self.NO_PAREN_FUNCTION_PARSERS["PRIOR"] = lambda self: self.expression(
            exp.Prior, this=self._parse_bitwise()
        )
        connect = self._parse_assignment()
        self.NO_PAREN_FUNCTION_PARSERS.pop("PRIOR")

        if not start and self._match(TokenType.START_WITH):
            start = self._parse_assignment()

        return self.expression(exp.Connect, start=start, connect=connect, nocycle=nocycle)

    def _parse_name_as_expression(self) -> t.Optional[exp.Expression]:
        this = self._parse_id_var(any_token=True)
        if self._match(TokenType.ALIAS):
            this = self.expression(exp.Alias, alias=this, this=self._parse_assignment())
        return this

    def _parse_interpolate(self) -> t.Optional[t.List[exp.Expression]]:
        if self._match_text_seq("INTERPOLATE"):
            return self._parse_wrapped_csv(self._parse_name_as_expression)
        return None

    def _parse_order(
        self, this: t.Optional[exp.Expression] = None, skip_order_token: bool = False
    ) -> t.Optional[exp.Expression]:
        siblings = None
        if not skip_order_token and not self._match(TokenType.ORDER_BY):
            if not self._match(TokenType.ORDER_SIBLINGS_BY):
                return this

            siblings = True

        return self.expression(
            exp.Order,
            this=this,
            expressions=self._parse_csv(self._parse_ordered),
            siblings=siblings,
        )

    def _parse_sort(self, exp_class: t.Type[E], token: TokenType) -> t.Optional[E]:
        if not self._match(token):
            return None
        return self.expression(exp_class, expressions=self._parse_csv(self._parse_ordered))

    def _parse_ordered(
        self, parse_method: t.Optional[t.Callable] = None
    ) -> t.Optional[exp.Ordered]:
        this = parse_method() if parse_method else self._parse_assignment()
        if not this:
            return None

        if this.name.upper() == "ALL" and self.dialect.SUPPORTS_ORDER_BY_ALL:
            this = exp.var("ALL")

        asc = self._match(TokenType.ASC)
        desc = self._match(TokenType.DESC) or (asc and False)

        is_nulls_first = self._match_text_seq("NULLS", "FIRST")
        is_nulls_last = self._match_text_seq("NULLS", "LAST")

        nulls_first = is_nulls_first or False
        explicitly_null_ordered = is_nulls_first or is_nulls_last

        if (
            not explicitly_null_ordered
            and (
                (not desc and self.dialect.NULL_ORDERING == "nulls_are_small")
                or (desc and self.dialect.NULL_ORDERING != "nulls_are_small")
            )
            and self.dialect.NULL_ORDERING != "nulls_are_last"
        ):
            nulls_first = True

        if self._match_text_seq("WITH", "FILL"):
            with_fill = self.expression(
                exp.WithFill,
                **{  # type: ignore
                    "from": self._match(TokenType.FROM) and self._parse_bitwise(),
                    "to": self._match_text_seq("TO") and self._parse_bitwise(),
                    "step": self._match_text_seq("STEP") and self._parse_bitwise(),
                    "interpolate": self._parse_interpolate(),
                },
            )
        else:
            with_fill = None

        return self.expression(
            exp.Ordered, this=this, desc=desc, nulls_first=nulls_first, with_fill=with_fill
        )

    def _parse_limit(
        self,
        this: t.Optional[exp.Expression] = None,
        top: bool = False,
        skip_limit_token: bool = False,
    ) -> t.Optional[exp.Expression]:
        if skip_limit_token or self._match(TokenType.TOP if top else TokenType.LIMIT):
            comments = self._prev_comments
            if top:
                limit_paren = self._match(TokenType.L_PAREN)
                expression = self._parse_term() if limit_paren else self._parse_number()

                if limit_paren:
                    self._match_r_paren()
            else:
                expression = self._parse_term()

            if self._match(TokenType.COMMA):
                offset = expression
                expression = self._parse_term()
            else:
                offset = None

            limit_exp = self.expression(
                exp.Limit,
                this=this,
                expression=expression,
                offset=offset,
                comments=comments,
                expressions=self._parse_limit_by(),
            )

            return limit_exp

        if self._match(TokenType.FETCH):
            direction = self._match_set((TokenType.FIRST, TokenType.NEXT))
            direction = self._prev.text.upper() if direction else "FIRST"

            count = self._parse_field(tokens=self.FETCH_TOKENS)
            percent = self._match(TokenType.PERCENT)

            self._match_set((TokenType.ROW, TokenType.ROWS))

            only = self._match_text_seq("ONLY")
            with_ties = self._match_text_seq("WITH", "TIES")

            if only and with_ties:
                self.raise_error("Cannot specify both ONLY and WITH TIES in FETCH clause")

            return self.expression(
                exp.Fetch,
                direction=direction,
                count=count,
                percent=percent,
                with_ties=with_ties,
            )

        return this

    def _parse_offset(self, this: t.Optional[exp.Expression] = None) -> t.Optional[exp.Expression]:
        if not self._match(TokenType.OFFSET):
            return this

        count = self._parse_term()
        self._match_set((TokenType.ROW, TokenType.ROWS))

        return self.expression(
            exp.Offset, this=this, expression=count, expressions=self._parse_limit_by()
        )

    def _parse_limit_by(self) -> t.Optional[t.List[exp.Expression]]:
        return self._match_text_seq("BY") and self._parse_csv(self._parse_bitwise)

    def _parse_locks(self) -> t.List[exp.Lock]:
        locks = []
        while True:
            if self._match_text_seq("FOR", "UPDATE"):
                update = True
            elif self._match_text_seq("FOR", "SHARE") or self._match_text_seq(
                "LOCK", "IN", "SHARE", "MODE"
            ):
                update = False
            else:
                break

            expressions = None
            if self._match_text_seq("OF"):
                expressions = self._parse_csv(lambda: self._parse_table(schema=True))

            wait: t.Optional[bool | exp.Expression] = None
            if self._match_text_seq("NOWAIT"):
                wait = True
            elif self._match_text_seq("WAIT"):
                wait = self._parse_primary()
            elif self._match_text_seq("SKIP", "LOCKED"):
                wait = False

            locks.append(
                self.expression(exp.Lock, update=update, expressions=expressions, wait=wait)
            )

        return locks

    def _parse_set_operations(self, this: t.Optional[exp.Expression]) -> t.Optional[exp.Expression]:
        while this and self._match_set(self.SET_OPERATIONS):
            token_type = self._prev.token_type

            if token_type == TokenType.UNION:
                operation: t.Type[exp.SetOperation] = exp.Union
            elif token_type == TokenType.EXCEPT:
                operation = exp.Except
            else:
                operation = exp.Intersect

            comments = self._prev.comments

            if self._match(TokenType.DISTINCT):
                distinct: t.Optional[bool] = True
            elif self._match(TokenType.ALL):
                distinct = False
            else:
                distinct = self.dialect.SET_OP_DISTINCT_BY_DEFAULT[operation]
                if distinct is None:
                    self.raise_error(f"Expected DISTINCT or ALL for {operation.__name__}")

            by_name = self._match_text_seq("BY", "NAME")
            expression = self._parse_select(nested=True, parse_set_operation=False)

            this = self.expression(
                operation,
                comments=comments,
                this=this,
                distinct=distinct,
                by_name=by_name,
                expression=expression,
            )

        if isinstance(this, exp.SetOperation) and self.MODIFIERS_ATTACHED_TO_SET_OP:
            expression = this.expression

            if expression:
                for arg in self.SET_OP_MODIFIERS:
                    expr = expression.args.get(arg)
                    if expr:
                        this.set(arg, expr.pop())

        return this

    def _parse_expression(self) -> t.Optional[exp.Expression]:
        return self._parse_alias(self._parse_assignment())

    def _parse_assignment(self) -> t.Optional[exp.Expression]:
        this = self._parse_disjunction()
        if not this and self._next and self._next.token_type in self.ASSIGNMENT:
            # This allows us to parse <non-identifier token> := <expr>
            this = exp.column(
                t.cast(str, self._advance_any(ignore_reserved=True) and self._prev.text)
            )

        while self._match_set(self.ASSIGNMENT):
            if isinstance(this, exp.Column) and len(this.parts) == 1:
                this = this.this

            this = self.expression(
                self.ASSIGNMENT[self._prev.token_type],
                this=this,
                comments=self._prev_comments,
                expression=self._parse_assignment(),
            )

        return this

    def _parse_disjunction(self) -> t.Optional[exp.Expression]:
        return self._parse_tokens(self._parse_conjunction, self.DISJUNCTION)

    def _parse_conjunction(self) -> t.Optional[exp.Expression]:
        return self._parse_tokens(self._parse_equality, self.CONJUNCTION)

    def _parse_equality(self) -> t.Optional[exp.Expression]:
        return self._parse_tokens(self._parse_comparison, self.EQUALITY)

    def _parse_comparison(self) -> t.Optional[exp.Expression]:
        return self._parse_tokens(self._parse_range, self.COMPARISON)

    def _parse_range(self, this: t.Optional[exp.Expression] = None) -> t.Optional[exp.Expression]:
        this = this or self._parse_bitwise()
        negate = self._match(TokenType.NOT)

        if self._match_set(self.RANGE_PARSERS):
            expression = self.RANGE_PARSERS[self._prev.token_type](self, this)
            if not expression:
                return this

            this = expression
        elif self._match(TokenType.ISNULL):
            this = self.expression(exp.Is, this=this, expression=exp.Null())

        # Postgres supports ISNULL and NOTNULL for conditions.
        # https://blog.andreiavram.ro/postgresql-null-composite-type/
        if self._match(TokenType.NOTNULL):
            this = self.expression(exp.Is, this=this, expression=exp.Null())
            this = self.expression(exp.Not, this=this)

        if negate:
            this = self._negate_range(this)

        if self._match(TokenType.IS):
            this = self._parse_is(this)

        return this

    def _negate_range(self, this: t.Optional[exp.Expression] = None) -> t.Optional[exp.Expression]:
        if not this:
            return this

        return self.expression(exp.Not, this=this)

    def _parse_is(self, this: t.Optional[exp.Expression]) -> t.Optional[exp.Expression]:
        index = self._index - 1
        negate = self._match(TokenType.NOT)

        if self._match_text_seq("DISTINCT", "FROM"):
            klass = exp.NullSafeEQ if negate else exp.NullSafeNEQ
            return self.expression(klass, this=this, expression=self._parse_bitwise())

        if self._match(TokenType.JSON):
            kind = self._match_texts(self.IS_JSON_PREDICATE_KIND) and self._prev.text.upper()

            if self._match_text_seq("WITH"):
                _with = True
            elif self._match_text_seq("WITHOUT"):
                _with = False
            else:
                _with = None

            unique = self._match(TokenType.UNIQUE)
            self._match_text_seq("KEYS")
            expression: t.Optional[exp.Expression] = self.expression(
                exp.JSON, **{"this": kind, "with": _with, "unique": unique}
            )
        else:
            expression = self._parse_primary() or self._parse_null()
            if not expression:
                self._retreat(index)
                return None

        this = self.expression(exp.Is, this=this, expression=expression)
        return self.expression(exp.Not, this=this) if negate else this

    def _parse_in(self, this: t.Optional[exp.Expression], alias: bool = False) -> exp.In:
        unnest = self._parse_unnest(with_alias=False)
        if unnest:
            this = self.expression(exp.In, this=this, unnest=unnest)
        elif self._match_set((TokenType.L_PAREN, TokenType.L_BRACKET)):
            matched_l_paren = self._prev.token_type == TokenType.L_PAREN
            expressions = self._parse_csv(lambda: self._parse_select_or_expression(alias=alias))

            if len(expressions) == 1 and isinstance(expressions[0], exp.Query):
                this = self.expression(exp.In, this=this, query=expressions[0].subquery(copy=False))
            else:
                this = self.expression(exp.In, this=this, expressions=expressions)

            if matched_l_paren:
                self._match_r_paren(this)
            elif not self._match(TokenType.R_BRACKET, expression=this):
                self.raise_error("Expecting ]")
        else:
            this = self.expression(exp.In, this=this, field=self._parse_column())

        return this

    def _parse_between(self, this: t.Optional[exp.Expression]) -> exp.Between:
        low = self._parse_bitwise()
        self._match(TokenType.AND)
        high = self._parse_bitwise()
        return self.expression(exp.Between, this=this, low=low, high=high)

    def _parse_escape(self, this: t.Optional[exp.Expression]) -> t.Optional[exp.Expression]:
        if not self._match(TokenType.ESCAPE):
            return this
        return self.expression(exp.Escape, this=this, expression=self._parse_string())

    def _parse_interval(self, match_interval: bool = True) -> t.Optional[exp.Add | exp.Interval]:
        index = self._index

        if not self._match(TokenType.INTERVAL) and match_interval:
            return None

        if self._match(TokenType.STRING, advance=False):
            this = self._parse_primary()
        else:
            this = self._parse_term()

        if not this or (
            isinstance(this, exp.Column)
            and not this.table
            and not this.this.quoted
            and this.name.upper() == "IS"
        ):
            self._retreat(index)
            return None

        unit = self._parse_function() or (
            not self._match(TokenType.ALIAS, advance=False)
            and self._parse_var(any_token=True, upper=True)
        )

        # Most dialects support, e.g., the form INTERVAL '5' day, thus we try to parse
        # each INTERVAL expression into this canonical form so it's easy to transpile
        if this and this.is_number:
            this = exp.Literal.string(this.to_py())
        elif this and this.is_string:
            parts = exp.INTERVAL_STRING_RE.findall(this.name)
            if len(parts) == 1:
                if unit:
                    # Unconsume the eagerly-parsed unit, since the real unit was part of the string
                    self._retreat(self._index - 1)

                this = exp.Literal.string(parts[0][0])
                unit = self.expression(exp.Var, this=parts[0][1].upper())

        if self.INTERVAL_SPANS and self._match_text_seq("TO"):
            unit = self.expression(
                exp.IntervalSpan, this=unit, expression=self._parse_var(any_token=True, upper=True)
            )

        interval = self.expression(exp.Interval, this=this, unit=unit)

        index = self._index
        self._match(TokenType.PLUS)

        # Convert INTERVAL 'val_1' unit_1 [+] ... [+] 'val_n' unit_n into a sum of intervals
        if self._match_set((TokenType.STRING, TokenType.NUMBER), advance=False):
            return self.expression(
                exp.Add, this=interval, expression=self._parse_interval(match_interval=False)
            )

        self._retreat(index)
        return interval

    def _parse_bitwise(self) -> t.Optional[exp.Expression]:
        this = self._parse_term()

        while True:
            if self._match_set(self.BITWISE):
                this = self.expression(
                    self.BITWISE[self._prev.token_type],
                    this=this,
                    expression=self._parse_term(),
                )
            elif self.dialect.DPIPE_IS_STRING_CONCAT and self._match(TokenType.DPIPE):
                this = self.expression(
                    exp.DPipe,
                    this=this,
                    expression=self._parse_term(),
                    safe=not self.dialect.STRICT_STRING_CONCAT,
                )
            elif self._match(TokenType.DQMARK):
                this = self.expression(
                    exp.Coalesce, this=this, expressions=ensure_list(self._parse_term())
                )
            elif self._match_pair(TokenType.LT, TokenType.LT):
                this = self.expression(
                    exp.BitwiseLeftShift, this=this, expression=self._parse_term()
                )
            elif self._match_pair(TokenType.GT, TokenType.GT):
                this = self.expression(
                    exp.BitwiseRightShift, this=this, expression=self._parse_term()
                )
            else:
                break

        return this

    def _parse_term(self) -> t.Optional[exp.Expression]:
        this = self._parse_factor()

        while self._match_set(self.TERM):
            klass = self.TERM[self._prev.token_type]
            comments = self._prev_comments
            expression = self._parse_factor()

            this = self.expression(klass, this=this, comments=comments, expression=expression)

            if isinstance(this, exp.Collate):
                expr = this.expression

                # Preserve collations such as pg_catalog."default" (Postgres) as columns, otherwise
                # fallback to Identifier / Var
                if isinstance(expr, exp.Column) and len(expr.parts) == 1:
                    ident = expr.this
                    if isinstance(ident, exp.Identifier):
                        this.set("expression", ident if ident.quoted else exp.var(ident.name))

        return this

    def _parse_factor(self) -> t.Optional[exp.Expression]:
        parse_method = self._parse_exponent if self.EXPONENT else self._parse_unary
        this = parse_method()

        while self._match_set(self.FACTOR):
            klass = self.FACTOR[self._prev.token_type]
            comments = self._prev_comments
            expression = parse_method()

            if not expression and klass is exp.IntDiv and self._prev.text.isalpha():
                self._retreat(self._index - 1)
                return this

            this = self.expression(klass, this=this, comments=comments, expression=expression)

            if isinstance(this, exp.Div):
                this.args["typed"] = self.dialect.TYPED_DIVISION
                this.args["safe"] = self.dialect.SAFE_DIVISION

        return this

    def _parse_exponent(self) -> t.Optional[exp.Expression]:
        return self._parse_tokens(self._parse_unary, self.EXPONENT)

    def _parse_unary(self) -> t.Optional[exp.Expression]:
        if self._match_set(self.UNARY_PARSERS):
            return self.UNARY_PARSERS[self._prev.token_type](self)
        return self._parse_at_time_zone(self._parse_type())

    def _parse_type(
        self, parse_interval: bool = True, fallback_to_identifier: bool = False
    ) -> t.Optional[exp.Expression]:
        interval = parse_interval and self._parse_interval()
        if interval:
            return interval

        index = self._index
        data_type = self._parse_types(check_func=True, allow_identifiers=False)

        # parse_types() returns a Cast if we parsed BQ's inline constructor <type>(<values>) e.g.
        # STRUCT<a INT, b STRING>(1, 'foo'), which is canonicalized to CAST(<values> AS <type>)
        if isinstance(data_type, exp.Cast):
            # This constructor can contain ops directly after it, for instance struct unnesting:
            # STRUCT<a INT, b STRING>(1, 'foo').* --> CAST(STRUCT(1, 'foo') AS STRUCT<a iNT, b STRING).*
            return self._parse_column_ops(data_type)

        if data_type:
            index2 = self._index
            this = self._parse_primary()

            if isinstance(this, exp.Literal):
                parser = self.TYPE_LITERAL_PARSERS.get(data_type.this)
                if parser:
                    return parser(self, this, data_type)

                return self.expression(exp.Cast, this=this, to=data_type)

            # The expressions arg gets set by the parser when we have something like DECIMAL(38, 0)
            # in the input SQL. In that case, we'll produce these tokens: DECIMAL ( 38 , 0 )
            #
            # If the index difference here is greater than 1, that means the parser itself must have
            # consumed additional tokens such as the DECIMAL scale and precision in the above example.
            #
            # If it's not greater than 1, then it must be 1, because we've consumed at least the type
            # keyword, meaning that the expressions arg of the DataType must have gotten set by a
            # callable in the TYPE_CONVERTERS mapping. For example, Snowflake converts DECIMAL to
            # DECIMAL(38, 0)) in order to facilitate the data type's transpilation.
            #
            # In these cases, we don't really want to return the converted type, but instead retreat
            # and try to parse a Column or Identifier in the section below.
            if data_type.expressions and index2 - index > 1:
                self._retreat(index2)
                return self._parse_column_ops(data_type)

            self._retreat(index)

        if fallback_to_identifier:
            return self._parse_id_var()

        this = self._parse_column()
        return this and self._parse_column_ops(this)

    def _parse_type_size(self) -> t.Optional[exp.DataTypeParam]:
        this = self._parse_type()
        if not this:
            return None

        if isinstance(this, exp.Column) and not this.table:
            this = exp.var(this.name.upper())

        return self.expression(
            exp.DataTypeParam, this=this, expression=self._parse_var(any_token=True)
        )

    def _parse_types(
        self, check_func: bool = False, schema: bool = False, allow_identifiers: bool = True
    ) -> t.Optional[exp.Expression]:
        index = self._index

        this: t.Optional[exp.Expression] = None
        prefix = self._match_text_seq("SYSUDTLIB", ".")

        if not self._match_set(self.TYPE_TOKENS):
            identifier = allow_identifiers and self._parse_id_var(
                any_token=False, tokens=(TokenType.VAR,)
            )
            if isinstance(identifier, exp.Identifier):
                tokens = self.dialect.tokenize(identifier.sql(dialect=self.dialect))

                if len(tokens) != 1:
                    self.raise_error("Unexpected identifier", self._prev)

                if tokens[0].token_type in self.TYPE_TOKENS:
                    self._prev = tokens[0]
                elif self.dialect.SUPPORTS_USER_DEFINED_TYPES:
                    type_name = identifier.name

                    while self._match(TokenType.DOT):
                        type_name = f"{type_name}.{self._advance_any() and self._prev.text}"

                    this = exp.DataType.build(type_name, udt=True)
                else:
                    self._retreat(self._index - 1)
                    return None
            else:
                return None

        type_token = self._prev.token_type

        if type_token == TokenType.PSEUDO_TYPE:
            return self.expression(exp.PseudoType, this=self._prev.text.upper())

        if type_token == TokenType.OBJECT_IDENTIFIER:
            return self.expression(exp.ObjectIdentifier, this=self._prev.text.upper())

        # https://materialize.com/docs/sql/types/map/
        if type_token == TokenType.MAP and self._match(TokenType.L_BRACKET):
            key_type = self._parse_types(
                check_func=check_func, schema=schema, allow_identifiers=allow_identifiers
            )
            if not self._match(TokenType.FARROW):
                self._retreat(index)
                return None

            value_type = self._parse_types(
                check_func=check_func, schema=schema, allow_identifiers=allow_identifiers
            )
            if not self._match(TokenType.R_BRACKET):
                self._retreat(index)
                return None

            return exp.DataType(
                this=exp.DataType.Type.MAP,
                expressions=[key_type, value_type],
                nested=True,
                prefix=prefix,
            )

        nested = type_token in self.NESTED_TYPE_TOKENS
        is_struct = type_token in self.STRUCT_TYPE_TOKENS
        is_aggregate = type_token in self.AGGREGATE_TYPE_TOKENS
        expressions = None
        maybe_func = False

        if self._match(TokenType.L_PAREN):
            if is_struct:
                expressions = self._parse_csv(lambda: self._parse_struct_types(type_required=True))
            elif nested:
                expressions = self._parse_csv(
                    lambda: self._parse_types(
                        check_func=check_func, schema=schema, allow_identifiers=allow_identifiers
                    )
                )
                if type_token == TokenType.NULLABLE and len(expressions) == 1:
                    this = expressions[0]
                    this.set("nullable", True)
                    self._match_r_paren()
                    return this
            elif type_token in self.ENUM_TYPE_TOKENS:
                expressions = self._parse_csv(self._parse_equality)
            elif is_aggregate:
                func_or_ident = self._parse_function(anonymous=True) or self._parse_id_var(
                    any_token=False, tokens=(TokenType.VAR,)
                )
                if not func_or_ident or not self._match(TokenType.COMMA):
                    return None
                expressions = self._parse_csv(
                    lambda: self._parse_types(
                        check_func=check_func, schema=schema, allow_identifiers=allow_identifiers
                    )
                )
                expressions.insert(0, func_or_ident)
            else:
                expressions = self._parse_csv(self._parse_type_size)

                # https://docs.snowflake.com/en/sql-reference/data-types-vector
                if type_token == TokenType.VECTOR and len(expressions) == 2:
                    expressions[0] = exp.DataType.build(expressions[0].name, dialect=self.dialect)

            if not expressions or not self._match(TokenType.R_PAREN):
                self._retreat(index)
                return None

            maybe_func = True

        values: t.Optional[t.List[exp.Expression]] = None

        if nested and self._match(TokenType.LT):
            if is_struct:
                expressions = self._parse_csv(lambda: self._parse_struct_types(type_required=True))
            else:
                expressions = self._parse_csv(
                    lambda: self._parse_types(
                        check_func=check_func, schema=schema, allow_identifiers=allow_identifiers
                    )
                )

            if not self._match(TokenType.GT):
                self.raise_error("Expecting >")

            if self._match_set((TokenType.L_BRACKET, TokenType.L_PAREN)):
                values = self._parse_csv(self._parse_assignment)
                if not values and is_struct:
                    values = None
                    self._retreat(self._index - 1)
                else:
                    self._match_set((TokenType.R_BRACKET, TokenType.R_PAREN))

        if type_token in self.TIMESTAMPS:
            if self._match_text_seq("WITH", "TIME", "ZONE"):
                maybe_func = False
                tz_type = (
                    exp.DataType.Type.TIMETZ
                    if type_token in self.TIMES
                    else exp.DataType.Type.TIMESTAMPTZ
                )
                this = exp.DataType(this=tz_type, expressions=expressions)
            elif self._match_text_seq("WITH", "LOCAL", "TIME", "ZONE"):
                maybe_func = False
                this = exp.DataType(this=exp.DataType.Type.TIMESTAMPLTZ, expressions=expressions)
            elif self._match_text_seq("WITHOUT", "TIME", "ZONE"):
                maybe_func = False
        elif type_token == TokenType.INTERVAL:
            unit = self._parse_var(upper=True)
            if unit:
                if self._match_text_seq("TO"):
                    unit = exp.IntervalSpan(this=unit, expression=self._parse_var(upper=True))

                this = self.expression(exp.DataType, this=self.expression(exp.Interval, unit=unit))
            else:
                this = self.expression(exp.DataType, this=exp.DataType.Type.INTERVAL)

        if maybe_func and check_func:
            index2 = self._index
            peek = self._parse_string()

            if not peek:
                self._retreat(index)
                return None

            self._retreat(index2)

        if not this:
            if self._match_text_seq("UNSIGNED"):
                unsigned_type_token = self.SIGNED_TO_UNSIGNED_TYPE_TOKEN.get(type_token)
                if not unsigned_type_token:
                    self.raise_error(f"Cannot convert {type_token.value} to unsigned.")

                type_token = unsigned_type_token or type_token

            this = exp.DataType(
                this=exp.DataType.Type[type_token.value],
                expressions=expressions,
                nested=nested,
                prefix=prefix,
            )

            # Empty arrays/structs are allowed
            if values is not None:
                cls = exp.Struct if is_struct else exp.Array
                this = exp.cast(cls(expressions=values), this, copy=False)

        elif expressions:
            this.set("expressions", expressions)

        # https://materialize.com/docs/sql/types/list/#type-name
        while self._match(TokenType.LIST):
            this = exp.DataType(this=exp.DataType.Type.LIST, expressions=[this], nested=True)

        index = self._index

        # Postgres supports the INT ARRAY[3] syntax as a synonym for INT[3]
        matched_array = self._match(TokenType.ARRAY)

        while self._curr:
            datatype_token = self._prev.token_type
            matched_l_bracket = self._match(TokenType.L_BRACKET)
            if not matched_l_bracket and not matched_array:
                break

            matched_array = False
            values = self._parse_csv(self._parse_assignment) or None
            if (
                values
                and not schema
                and (
                    not self.dialect.SUPPORTS_FIXED_SIZE_ARRAYS or datatype_token == TokenType.ARRAY
                )
            ):
                # Retreating here means that we should not parse the following values as part of the data type, e.g. in DuckDB
                # ARRAY[1] should retreat and instead be parsed into exp.Array in contrast to INT[x][y] which denotes a fixed-size array data type
                self._retreat(index)
                break

            this = exp.DataType(
                this=exp.DataType.Type.ARRAY, expressions=[this], values=values, nested=True
            )
            self._match(TokenType.R_BRACKET)

        if self.TYPE_CONVERTERS and isinstance(this.this, exp.DataType.Type):
            converter = self.TYPE_CONVERTERS.get(this.this)
            if converter:
                this = converter(t.cast(exp.DataType, this))

        return this

    def _parse_struct_types(self, type_required: bool = False) -> t.Optional[exp.Expression]:
        index = self._index

        if (
            self._curr
            and self._next
            and self._curr.token_type in self.TYPE_TOKENS
            and self._next.token_type in self.TYPE_TOKENS
        ):
            # Takes care of special cases like `STRUCT<list ARRAY<...>>` where the identifier is also a
            # type token. Without this, the list will be parsed as a type and we'll eventually crash
            this = self._parse_id_var()
        else:
            this = (
                self._parse_type(parse_interval=False, fallback_to_identifier=True)
                or self._parse_id_var()
            )

        self._match(TokenType.COLON)

        if (
            type_required
            and not isinstance(this, exp.DataType)
            and not self._match_set(self.TYPE_TOKENS, advance=False)
        ):
            self._retreat(index)
            return self._parse_types()

        return self._parse_column_def(this)

    def _parse_at_time_zone(self, this: t.Optional[exp.Expression]) -> t.Optional[exp.Expression]:
        if not self._match_text_seq("AT", "TIME", "ZONE"):
            return this
        return self.expression(exp.AtTimeZone, this=this, zone=self._parse_unary())

    def _parse_column(self) -> t.Optional[exp.Expression]:
        this = self._parse_column_reference()
        column = self._parse_column_ops(this) if this else self._parse_bracket(this)

        if self.dialect.SUPPORTS_COLUMN_JOIN_MARKS and column:
            column.set("join_mark", self._match(TokenType.JOIN_MARKER))

        return column

    def _parse_column_reference(self) -> t.Optional[exp.Expression]:
        this = self._parse_field()
        if (
            not this
            and self._match(TokenType.VALUES, advance=False)
            and self.VALUES_FOLLOWED_BY_PAREN
            and (not self._next or self._next.token_type != TokenType.L_PAREN)
        ):
            this = self._parse_id_var()

        if isinstance(this, exp.Identifier):
            # We bubble up comments from the Identifier to the Column
            this = self.expression(exp.Column, comments=this.pop_comments(), this=this)

        return this

    def _parse_colon_as_variant_extract(
        self, this: t.Optional[exp.Expression]
    ) -> t.Optional[exp.Expression]:
        casts = []
        json_path = []
        escape = None

        while self._match(TokenType.COLON):
            start_index = self._index

            # Snowflake allows reserved keywords as json keys but advance_any() excludes TokenType.SELECT from any_tokens=True
            path = self._parse_column_ops(
                self._parse_field(any_token=True, tokens=(TokenType.SELECT,))
            )

            # The cast :: operator has a lower precedence than the extraction operator :, so
            # we rearrange the AST appropriately to avoid casting the JSON path
            while isinstance(path, exp.Cast):
                casts.append(path.to)
                path = path.this

            if casts:
                dcolon_offset = next(
                    i
                    for i, t in enumerate(self._tokens[start_index:])
                    if t.token_type == TokenType.DCOLON
                )
                end_token = self._tokens[start_index + dcolon_offset - 1]
            else:
                end_token = self._prev

            if path:
                # Escape single quotes from Snowflake's colon extraction (e.g. col:"a'b") as
                # it'll roundtrip to a string literal in GET_PATH
                if isinstance(path, exp.Identifier) and path.quoted:
                    escape = True

                json_path.append(self._find_sql(self._tokens[start_index], end_token))

        # The VARIANT extract in Snowflake/Databricks is parsed as a JSONExtract; Snowflake uses the json_path in GET_PATH() while
        # Databricks transforms it back to the colon/dot notation
        if json_path:
            json_path_expr = self.dialect.to_json_path(exp.Literal.string(".".join(json_path)))

            if json_path_expr:
                json_path_expr.set("escape", escape)

            this = self.expression(
                exp.JSONExtract,
                this=this,
                expression=json_path_expr,
                variant_extract=True,
            )

            while casts:
                this = self.expression(exp.Cast, this=this, to=casts.pop())

        return this

    def _parse_dcolon(self) -> t.Optional[exp.Expression]:
        return self._parse_types()

    def _parse_column_ops(self, this: t.Optional[exp.Expression]) -> t.Optional[exp.Expression]:
        this = self._parse_bracket(this)

        while self._match_set(self.COLUMN_OPERATORS):
            op_token = self._prev.token_type
            op = self.COLUMN_OPERATORS.get(op_token)

            if op_token == TokenType.DCOLON:
                field = self._parse_dcolon()
                if not field:
                    self.raise_error("Expected type")
            elif op and self._curr:
                field = self._parse_column_reference() or self._parse_bracket()
            else:
                field = self._parse_field(any_token=True, anonymous_func=True)

            if isinstance(field, (exp.Func, exp.Window)) and this:
                # BQ & snowflake allow function calls like x.y.count(...), SAFE.SUBSTR(...) etc
                # https://cloud.google.com/bigquery/docs/reference/standard-sql/functions-reference#function_call_rules
                this = exp.replace_tree(
                    this,
                    lambda n: (
                        self.expression(exp.Dot, this=n.args.get("table"), expression=n.this)
                        if n.table
                        else n.this
                    )
                    if isinstance(n, exp.Column)
                    else n,
                )

            if op:
                this = op(self, this, field)
            elif isinstance(this, exp.Column) and not this.args.get("catalog"):
                this = self.expression(
                    exp.Column,
                    comments=this.comments,
                    this=field,
                    table=this.this,
                    db=this.args.get("table"),
                    catalog=this.args.get("db"),
                )
            elif isinstance(field, exp.Window):
                # Move the exp.Dot's to the window's function
                window_func = self.expression(exp.Dot, this=this, expression=field.this)
                field.set("this", window_func)
                this = field
            else:
                this = self.expression(exp.Dot, this=this, expression=field)

            if field and field.comments:
                t.cast(exp.Expression, this).add_comments(field.pop_comments())

            this = self._parse_bracket(this)

        return self._parse_colon_as_variant_extract(this) if self.COLON_IS_VARIANT_EXTRACT else this

    def _parse_primary(self) -> t.Optional[exp.Expression]:
        if self._match_set(self.PRIMARY_PARSERS):
            token_type = self._prev.token_type
            primary = self.PRIMARY_PARSERS[token_type](self, self._prev)

            if token_type == TokenType.STRING:
                expressions = [primary]
                while self._match(TokenType.STRING):
                    expressions.append(exp.Literal.string(self._prev.text))

                if len(expressions) > 1:
                    return self.expression(exp.Concat, expressions=expressions)

            return primary

        if self._match_pair(TokenType.DOT, TokenType.NUMBER):
            return exp.Literal.number(f"0.{self._prev.text}")

        if self._match(TokenType.L_PAREN):
            comments = self._prev_comments
            query = self._parse_select()

            if query:
                expressions = [query]
            else:
                expressions = self._parse_expressions()

            this = self._parse_query_modifiers(seq_get(expressions, 0))

            if not this and self._match(TokenType.R_PAREN, advance=False):
                this = self.expression(exp.Tuple)
            elif isinstance(this, exp.UNWRAPPED_QUERIES):
                this = self._parse_subquery(this=this, parse_alias=False)
            elif isinstance(this, exp.Subquery):
                this = self._parse_subquery(
                    this=self._parse_set_operations(this), parse_alias=False
                )
            elif len(expressions) > 1 or self._prev.token_type == TokenType.COMMA:
                this = self.expression(exp.Tuple, expressions=expressions)
            else:
                this = self.expression(exp.Paren, this=this)

            if this:
                this.add_comments(comments)

            self._match_r_paren(expression=this)
            return this

        return None

    def _parse_field(
        self,
        any_token: bool = False,
        tokens: t.Optional[t.Collection[TokenType]] = None,
        anonymous_func: bool = False,
    ) -> t.Optional[exp.Expression]:
        if anonymous_func:
            field = (
                self._parse_function(anonymous=anonymous_func, any_token=any_token)
                or self._parse_primary()
            )
        else:
            field = self._parse_primary() or self._parse_function(
                anonymous=anonymous_func, any_token=any_token
            )
        return field or self._parse_id_var(any_token=any_token, tokens=tokens)

    def _parse_function(
        self,
        functions: t.Optional[t.Dict[str, t.Callable]] = None,
        anonymous: bool = False,
        optional_parens: bool = True,
        any_token: bool = False,
    ) -> t.Optional[exp.Expression]:
        # This allows us to also parse {fn <function>} syntax (Snowflake, MySQL support this)
        # See: https://community.snowflake.com/s/article/SQL-Escape-Sequences
        fn_syntax = False
        if (
            self._match(TokenType.L_BRACE, advance=False)
            and self._next
            and self._next.text.upper() == "FN"
        ):
            self._advance(2)
            fn_syntax = True

        func = self._parse_function_call(
            functions=functions,
            anonymous=anonymous,
            optional_parens=optional_parens,
            any_token=any_token,
        )

        if fn_syntax:
            self._match(TokenType.R_BRACE)

        return func

    def _parse_function_call(
        self,
        functions: t.Optional[t.Dict[str, t.Callable]] = None,
        anonymous: bool = False,
        optional_parens: bool = True,
        any_token: bool = False,
    ) -> t.Optional[exp.Expression]:
        if not self._curr:
            return None

        comments = self._curr.comments
        token_type = self._curr.token_type
        this = self._curr.text
        upper = this.upper()

        parser = self.NO_PAREN_FUNCTION_PARSERS.get(upper)
        if optional_parens and parser and token_type not in self.INVALID_FUNC_NAME_TOKENS:
            self._advance()
            return self._parse_window(parser(self))

        if not self._next or self._next.token_type != TokenType.L_PAREN:
            if optional_parens and token_type in self.NO_PAREN_FUNCTIONS:
                self._advance()
                return self.expression(self.NO_PAREN_FUNCTIONS[token_type])

            return None

        if any_token:
            if token_type in self.RESERVED_TOKENS:
                return None
        elif token_type not in self.FUNC_TOKENS:
            return None

        self._advance(2)

        parser = self.FUNCTION_PARSERS.get(upper)
        if parser and not anonymous:
            this = parser(self)
        else:
            subquery_predicate = self.SUBQUERY_PREDICATES.get(token_type)

            if subquery_predicate and self._curr.token_type in (TokenType.SELECT, TokenType.WITH):
                this = self.expression(
                    subquery_predicate, comments=comments, this=self._parse_select()
                )
                self._match_r_paren()
                return this

            if functions is None:
                functions = self.FUNCTIONS

            function = functions.get(upper)

            alias = upper in self.FUNCTIONS_WITH_ALIASED_ARGS
            args = self._parse_csv(lambda: self._parse_lambda(alias=alias))

            if alias:
                args = self._kv_to_prop_eq(args)

            if function and not anonymous:
                if "dialect" in function.__code__.co_varnames:
                    func = function(args, dialect=self.dialect)
                else:
                    func = function(args)

                func = self.validate_expression(func, args)
                if self.dialect.PRESERVE_ORIGINAL_NAMES:
                    func.meta["name"] = this

                this = func
            else:
                if token_type == TokenType.IDENTIFIER:
                    this = exp.Identifier(this=this, quoted=True)
                this = self.expression(exp.Anonymous, this=this, expressions=args)

        if isinstance(this, exp.Expression):
            this.add_comments(comments)

        self._match_r_paren(this)
        return self._parse_window(this)

    def _to_prop_eq(self, expression: exp.Expression, index: int) -> exp.Expression:
        return expression

    def _kv_to_prop_eq(self, expressions: t.List[exp.Expression]) -> t.List[exp.Expression]:
        transformed = []

        for index, e in enumerate(expressions):
            if isinstance(e, self.KEY_VALUE_DEFINITIONS):
                if isinstance(e, exp.Alias):
                    e = self.expression(exp.PropertyEQ, this=e.args.get("alias"), expression=e.this)

                if not isinstance(e, exp.PropertyEQ):
                    e = self.expression(
                        exp.PropertyEQ, this=exp.to_identifier(e.this.name), expression=e.expression
                    )

                if isinstance(e.this, exp.Column):
                    e.this.replace(e.this.this)
            else:
                e = self._to_prop_eq(e, index)

            transformed.append(e)

        return transformed

    def _parse_user_defined_function_expression(self) -> t.Optional[exp.Expression]:
        return self._parse_statement()

    def _parse_function_parameter(self) -> t.Optional[exp.Expression]:
        return self._parse_column_def(self._parse_id_var())

    def _parse_user_defined_function(
        self, kind: t.Optional[TokenType] = None
    ) -> t.Optional[exp.Expression]:
        this = self._parse_id_var()

        while self._match(TokenType.DOT):
            this = self.expression(exp.Dot, this=this, expression=self._parse_id_var())

        if not self._match(TokenType.L_PAREN):
            return this

        expressions = self._parse_csv(self._parse_function_parameter)
        self._match_r_paren()
        return self.expression(
            exp.UserDefinedFunction, this=this, expressions=expressions, wrapped=True
        )

    def _parse_introducer(self, token: Token) -> exp.Introducer | exp.Identifier:
        literal = self._parse_primary()
        if literal:
            return self.expression(exp.Introducer, this=token.text, expression=literal)

        return self.expression(exp.Identifier, this=token.text)

    def _parse_session_parameter(self) -> exp.SessionParameter:
        kind = None
        this = self._parse_id_var() or self._parse_primary()

        if this and self._match(TokenType.DOT):
            kind = this.name
            this = self._parse_var() or self._parse_primary()

        return self.expression(exp.SessionParameter, this=this, kind=kind)

    def _parse_lambda_arg(self) -> t.Optional[exp.Expression]:
        return self._parse_id_var()

    def _parse_lambda(self, alias: bool = False) -> t.Optional[exp.Expression]:
        index = self._index

        if self._match(TokenType.L_PAREN):
            expressions = t.cast(
                t.List[t.Optional[exp.Expression]], self._parse_csv(self._parse_lambda_arg)
            )

            if not self._match(TokenType.R_PAREN):
                self._retreat(index)
        else:
            expressions = [self._parse_lambda_arg()]

        if self._match_set(self.LAMBDAS):
            return self.LAMBDAS[self._prev.token_type](self, expressions)

        self._retreat(index)

        this: t.Optional[exp.Expression]

        if self._match(TokenType.DISTINCT):
            this = self.expression(
                exp.Distinct, expressions=self._parse_csv(self._parse_assignment)
            )
        else:
            this = self._parse_select_or_expression(alias=alias)

        return self._parse_limit(
            self._parse_order(self._parse_having_max(self._parse_respect_or_ignore_nulls(this)))
        )

    def _parse_schema(self, this: t.Optional[exp.Expression] = None) -> t.Optional[exp.Expression]:
        index = self._index
        if not self._match(TokenType.L_PAREN):
            return this

        # Disambiguate between schema and subquery/CTE, e.g. in INSERT INTO table (<expr>),
        # expr can be of both types
        if self._match_set(self.SELECT_START_TOKENS):
            self._retreat(index)
            return this
        args = self._parse_csv(lambda: self._parse_constraint() or self._parse_field_def())
        self._match_r_paren()
        return self.expression(exp.Schema, this=this, expressions=args)

    def _parse_field_def(self) -> t.Optional[exp.Expression]:
        return self._parse_column_def(self._parse_field(any_token=True))

    def _parse_column_def(self, this: t.Optional[exp.Expression]) -> t.Optional[exp.Expression]:
        # column defs are not really columns, they're identifiers
        if isinstance(this, exp.Column):
            this = this.this

        kind = self._parse_types(schema=True)

        if self._match_text_seq("FOR", "ORDINALITY"):
            return self.expression(exp.ColumnDef, this=this, ordinality=True)

        constraints: t.List[exp.Expression] = []

        if (not kind and self._match(TokenType.ALIAS)) or self._match_texts(
            ("ALIAS", "MATERIALIZED")
        ):
            persisted = self._prev.text.upper() == "MATERIALIZED"
            constraint_kind = exp.ComputedColumnConstraint(
                this=self._parse_assignment(),
                persisted=persisted or self._match_text_seq("PERSISTED"),
                not_null=self._match_pair(TokenType.NOT, TokenType.NULL),
            )
            constraints.append(self.expression(exp.ColumnConstraint, kind=constraint_kind))
        elif (
            kind
            and self._match(TokenType.ALIAS, advance=False)
            and (
                not self.WRAPPED_TRANSFORM_COLUMN_CONSTRAINT
                or (self._next and self._next.token_type == TokenType.L_PAREN)
            )
        ):
            self._advance()
            constraints.append(
                self.expression(
                    exp.ColumnConstraint,
                    kind=exp.TransformColumnConstraint(this=self._parse_disjunction()),
                )
            )

        while True:
            constraint = self._parse_column_constraint()
            if not constraint:
                break
            constraints.append(constraint)

        if not kind and not constraints:
            return this

        return self.expression(exp.ColumnDef, this=this, kind=kind, constraints=constraints)

    def _parse_auto_increment(
        self,
    ) -> exp.GeneratedAsIdentityColumnConstraint | exp.AutoIncrementColumnConstraint:
        start = None
        increment = None

        if self._match(TokenType.L_PAREN, advance=False):
            args = self._parse_wrapped_csv(self._parse_bitwise)
            start = seq_get(args, 0)
            increment = seq_get(args, 1)
        elif self._match_text_seq("START"):
            start = self._parse_bitwise()
            self._match_text_seq("INCREMENT")
            increment = self._parse_bitwise()

        if start and increment:
            return exp.GeneratedAsIdentityColumnConstraint(start=start, increment=increment)

        return exp.AutoIncrementColumnConstraint()

    def _parse_auto_property(self) -> t.Optional[exp.AutoRefreshProperty]:
        if not self._match_text_seq("REFRESH"):
            self._retreat(self._index - 1)
            return None
        return self.expression(exp.AutoRefreshProperty, this=self._parse_var(upper=True))

    def _parse_compress(self) -> exp.CompressColumnConstraint:
        if self._match(TokenType.L_PAREN, advance=False):
            return self.expression(
                exp.CompressColumnConstraint, this=self._parse_wrapped_csv(self._parse_bitwise)
            )

        return self.expression(exp.CompressColumnConstraint, this=self._parse_bitwise())

    def _parse_generated_as_identity(
        self,
    ) -> (
        exp.GeneratedAsIdentityColumnConstraint
        | exp.ComputedColumnConstraint
        | exp.GeneratedAsRowColumnConstraint
    ):
        if self._match_text_seq("BY", "DEFAULT"):
            on_null = self._match_pair(TokenType.ON, TokenType.NULL)
            this = self.expression(
                exp.GeneratedAsIdentityColumnConstraint, this=False, on_null=on_null
            )
        else:
            self._match_text_seq("ALWAYS")
            this = self.expression(exp.GeneratedAsIdentityColumnConstraint, this=True)

        self._match(TokenType.ALIAS)

        if self._match_text_seq("ROW"):
            start = self._match_text_seq("START")
            if not start:
                self._match(TokenType.END)
            hidden = self._match_text_seq("HIDDEN")
            return self.expression(exp.GeneratedAsRowColumnConstraint, start=start, hidden=hidden)

        identity = self._match_text_seq("IDENTITY")

        if self._match(TokenType.L_PAREN):
            if self._match(TokenType.START_WITH):
                this.set("start", self._parse_bitwise())
            if self._match_text_seq("INCREMENT", "BY"):
                this.set("increment", self._parse_bitwise())
            if self._match_text_seq("MINVALUE"):
                this.set("minvalue", self._parse_bitwise())
            if self._match_text_seq("MAXVALUE"):
                this.set("maxvalue", self._parse_bitwise())

            if self._match_text_seq("CYCLE"):
                this.set("cycle", True)
            elif self._match_text_seq("NO", "CYCLE"):
                this.set("cycle", False)

            if not identity:
                this.set("expression", self._parse_range())
            elif not this.args.get("start") and self._match(TokenType.NUMBER, advance=False):
                args = self._parse_csv(self._parse_bitwise)
                this.set("start", seq_get(args, 0))
                this.set("increment", seq_get(args, 1))

            self._match_r_paren()

        return this

    def _parse_inline(self) -> exp.InlineLengthColumnConstraint:
        self._match_text_seq("LENGTH")
        return self.expression(exp.InlineLengthColumnConstraint, this=self._parse_bitwise())

    def _parse_not_constraint(self) -> t.Optional[exp.Expression]:
        if self._match_text_seq("NULL"):
            return self.expression(exp.NotNullColumnConstraint)
        if self._match_text_seq("CASESPECIFIC"):
            return self.expression(exp.CaseSpecificColumnConstraint, not_=True)
        if self._match_text_seq("FOR", "REPLICATION"):
            return self.expression(exp.NotForReplicationColumnConstraint)

        # Unconsume the `NOT` token
        self._retreat(self._index - 1)
        return None

    def _parse_column_constraint(self) -> t.Optional[exp.Expression]:
        this = self._match(TokenType.CONSTRAINT) and self._parse_id_var()

        procedure_option_follows = (
            self._match(TokenType.WITH, advance=False)
            and self._next
            and self._next.text.upper() in self.PROCEDURE_OPTIONS
        )

        if not procedure_option_follows and self._match_texts(self.CONSTRAINT_PARSERS):
            return self.expression(
                exp.ColumnConstraint,
                this=this,
                kind=self.CONSTRAINT_PARSERS[self._prev.text.upper()](self),
            )

        return this

    def _parse_constraint(self) -> t.Optional[exp.Expression]:
        if not self._match(TokenType.CONSTRAINT):
            return self._parse_unnamed_constraint(constraints=self.SCHEMA_UNNAMED_CONSTRAINTS)

        return self.expression(
            exp.Constraint,
            this=self._parse_id_var(),
            expressions=self._parse_unnamed_constraints(),
        )

    def _parse_unnamed_constraints(self) -> t.List[exp.Expression]:
        constraints = []
        while True:
            constraint = self._parse_unnamed_constraint() or self._parse_function()
            if not constraint:
                break
            constraints.append(constraint)

        return constraints

    def _parse_unnamed_constraint(
        self, constraints: t.Optional[t.Collection[str]] = None
    ) -> t.Optional[exp.Expression]:
        if self._match(TokenType.IDENTIFIER, advance=False) or not self._match_texts(
            constraints or self.CONSTRAINT_PARSERS
        ):
            return None

        constraint = self._prev.text.upper()
        if constraint not in self.CONSTRAINT_PARSERS:
            self.raise_error(f"No parser found for schema constraint {constraint}.")

        return self.CONSTRAINT_PARSERS[constraint](self)

    def _parse_unique_key(self) -> t.Optional[exp.Expression]:
        return self._parse_id_var(any_token=False)

    def _parse_unique(self) -> exp.UniqueColumnConstraint:
        self._match_text_seq("KEY")
        return self.expression(
            exp.UniqueColumnConstraint,
            nulls=self._match_text_seq("NULLS", "NOT", "DISTINCT"),
            this=self._parse_schema(self._parse_unique_key()),
            index_type=self._match(TokenType.USING) and self._advance_any() and self._prev.text,
            on_conflict=self._parse_on_conflict(),
        )

    def _parse_key_constraint_options(self) -> t.List[str]:
        options = []
        while True:
            if not self._curr:
                break

            if self._match(TokenType.ON):
                action = None
                on = self._advance_any() and self._prev.text

                if self._match_text_seq("NO", "ACTION"):
                    action = "NO ACTION"
                elif self._match_text_seq("CASCADE"):
                    action = "CASCADE"
                elif self._match_text_seq("RESTRICT"):
                    action = "RESTRICT"
                elif self._match_pair(TokenType.SET, TokenType.NULL):
                    action = "SET NULL"
                elif self._match_pair(TokenType.SET, TokenType.DEFAULT):
                    action = "SET DEFAULT"
                else:
                    self.raise_error("Invalid key constraint")

                options.append(f"ON {on} {action}")
            else:
                var = self._parse_var_from_options(
                    self.KEY_CONSTRAINT_OPTIONS, raise_unmatched=False
                )
                if not var:
                    break
                options.append(var.name)

        return options

    def _parse_references(self, match: bool = True) -> t.Optional[exp.Reference]:
        if match and not self._match(TokenType.REFERENCES):
            return None

        expressions = None
        this = self._parse_table(schema=True)
        options = self._parse_key_constraint_options()
        return self.expression(exp.Reference, this=this, expressions=expressions, options=options)

    def _parse_foreign_key(self) -> exp.ForeignKey:
        expressions = self._parse_wrapped_id_vars()
        reference = self._parse_references()
        options = {}

        while self._match(TokenType.ON):
            if not self._match_set((TokenType.DELETE, TokenType.UPDATE)):
                self.raise_error("Expected DELETE or UPDATE")

            kind = self._prev.text.lower()

            if self._match_text_seq("NO", "ACTION"):
                action = "NO ACTION"
            elif self._match(TokenType.SET):
                self._match_set((TokenType.NULL, TokenType.DEFAULT))
                action = "SET " + self._prev.text.upper()
            else:
                self._advance()
                action = self._prev.text.upper()

            options[kind] = action

        return self.expression(
            exp.ForeignKey,
            expressions=expressions,
            reference=reference,
            **options,  # type: ignore
        )

    def _parse_primary_key_part(self) -> t.Optional[exp.Expression]:
        return self._parse_field()

    def _parse_period_for_system_time(self) -> t.Optional[exp.PeriodForSystemTimeConstraint]:
        if not self._match(TokenType.TIMESTAMP_SNAPSHOT):
            self._retreat(self._index - 1)
            return None

        id_vars = self._parse_wrapped_id_vars()
        return self.expression(
            exp.PeriodForSystemTimeConstraint,
            this=seq_get(id_vars, 0),
            expression=seq_get(id_vars, 1),
        )

    def _parse_primary_key(
        self, wrapped_optional: bool = False, in_props: bool = False
    ) -> exp.PrimaryKeyColumnConstraint | exp.PrimaryKey:
        desc = (
            self._match_set((TokenType.ASC, TokenType.DESC))
            and self._prev.token_type == TokenType.DESC
        )

        if not in_props and not self._match(TokenType.L_PAREN, advance=False):
            return self.expression(exp.PrimaryKeyColumnConstraint, desc=desc)

        expressions = self._parse_wrapped_csv(
            self._parse_primary_key_part, optional=wrapped_optional
        )
        options = self._parse_key_constraint_options()
        return self.expression(exp.PrimaryKey, expressions=expressions, options=options)

    def _parse_bracket_key_value(self, is_map: bool = False) -> t.Optional[exp.Expression]:
        return self._parse_slice(self._parse_alias(self._parse_assignment(), explicit=True))

    def _parse_odbc_datetime_literal(self) -> exp.Expression:
        """
        Parses a datetime column in ODBC format. We parse the column into the corresponding
        types, for example `{d'yyyy-mm-dd'}` will be parsed as a `Date` column, exactly the
        same as we did for `DATE('yyyy-mm-dd')`.

        Reference:
        https://learn.microsoft.com/en-us/sql/odbc/reference/develop-app/date-time-and-timestamp-literals
        """
        self._match(TokenType.VAR)
        exp_class = self.ODBC_DATETIME_LITERALS[self._prev.text.lower()]
        expression = self.expression(exp_class=exp_class, this=self._parse_string())
        if not self._match(TokenType.R_BRACE):
            self.raise_error("Expected }")
        return expression

    def _parse_bracket(self, this: t.Optional[exp.Expression] = None) -> t.Optional[exp.Expression]:
        if not self._match_set((TokenType.L_BRACKET, TokenType.L_BRACE)):
            return this

        bracket_kind = self._prev.token_type
        if (
            bracket_kind == TokenType.L_BRACE
            and self._curr
            and self._curr.token_type == TokenType.VAR
            and self._curr.text.lower() in self.ODBC_DATETIME_LITERALS
        ):
            return self._parse_odbc_datetime_literal()

        expressions = self._parse_csv(
            lambda: self._parse_bracket_key_value(is_map=bracket_kind == TokenType.L_BRACE)
        )

        if bracket_kind == TokenType.L_BRACKET and not self._match(TokenType.R_BRACKET):
            self.raise_error("Expected ]")
        elif bracket_kind == TokenType.L_BRACE and not self._match(TokenType.R_BRACE):
            self.raise_error("Expected }")

        # https://duckdb.org/docs/sql/data_types/struct.html#creating-structs
        if bracket_kind == TokenType.L_BRACE:
            this = self.expression(exp.Struct, expressions=self._kv_to_prop_eq(expressions))
        elif not this:
            this = build_array_constructor(
                exp.Array, args=expressions, bracket_kind=bracket_kind, dialect=self.dialect
            )
        else:
            constructor_type = self.ARRAY_CONSTRUCTORS.get(this.name.upper())
            if constructor_type:
                return build_array_constructor(
                    constructor_type,
                    args=expressions,
                    bracket_kind=bracket_kind,
                    dialect=self.dialect,
                )

            expressions = apply_index_offset(this, expressions, -self.dialect.INDEX_OFFSET)
            this = self.expression(exp.Bracket, this=this, expressions=expressions)

        self._add_comments(this)
        return self._parse_bracket(this)

    def _parse_slice(self, this: t.Optional[exp.Expression]) -> t.Optional[exp.Expression]:
        if self._match(TokenType.COLON):
            return self.expression(exp.Slice, this=this, expression=self._parse_assignment())
        return this

    def _parse_case(self) -> t.Optional[exp.Expression]:
        ifs = []
        default = None

        comments = self._prev_comments
        expression = self._parse_assignment()

        while self._match(TokenType.WHEN):
            this = self._parse_assignment()
            self._match(TokenType.THEN)
            then = self._parse_assignment()
            ifs.append(self.expression(exp.If, this=this, true=then))

        if self._match(TokenType.ELSE):
            default = self._parse_assignment()

        if not self._match(TokenType.END):
            if isinstance(default, exp.Interval) and default.this.sql().upper() == "END":
                default = exp.column("interval")
            else:
                self.raise_error("Expected END after CASE", self._prev)

        return self.expression(
            exp.Case, comments=comments, this=expression, ifs=ifs, default=default
        )

    def _parse_if(self) -> t.Optional[exp.Expression]:
        if self._match(TokenType.L_PAREN):
            args = self._parse_csv(self._parse_assignment)
            this = self.validate_expression(exp.If.from_arg_list(args), args)
            self._match_r_paren()
        else:
            index = self._index - 1

            if self.NO_PAREN_IF_COMMANDS and index == 0:
                return self._parse_as_command(self._prev)

            condition = self._parse_assignment()

            if not condition:
                self._retreat(index)
                return None

            self._match(TokenType.THEN)
            true = self._parse_assignment()
            false = self._parse_assignment() if self._match(TokenType.ELSE) else None
            self._match(TokenType.END)
            this = self.expression(exp.If, this=condition, true=true, false=false)

        return this

    def _parse_next_value_for(self) -> t.Optional[exp.Expression]:
        if not self._match_text_seq("VALUE", "FOR"):
            self._retreat(self._index - 1)
            return None

        return self.expression(
            exp.NextValueFor,
            this=self._parse_column(),
            order=self._match(TokenType.OVER) and self._parse_wrapped(self._parse_order),
        )

    def _parse_extract(self) -> exp.Extract | exp.Anonymous:
        this = self._parse_function() or self._parse_var_or_string(upper=True)

        if self._match(TokenType.FROM):
            return self.expression(exp.Extract, this=this, expression=self._parse_bitwise())

        if not self._match(TokenType.COMMA):
            self.raise_error("Expected FROM or comma after EXTRACT", self._prev)

        return self.expression(exp.Extract, this=this, expression=self._parse_bitwise())

    def _parse_gap_fill(self) -> exp.GapFill:
        self._match(TokenType.TABLE)
        this = self._parse_table()

        self._match(TokenType.COMMA)
        args = [this, *self._parse_csv(self._parse_lambda)]

        gap_fill = exp.GapFill.from_arg_list(args)
        return self.validate_expression(gap_fill, args)

    def _parse_cast(self, strict: bool, safe: t.Optional[bool] = None) -> exp.Expression:
        this = self._parse_assignment()

        if not self._match(TokenType.ALIAS):
            if self._match(TokenType.COMMA):
                return self.expression(exp.CastToStrType, this=this, to=self._parse_string())

            self.raise_error("Expected AS after CAST")

        fmt = None
        to = self._parse_types()

        if self._match(TokenType.FORMAT):
            fmt_string = self._parse_string()
            fmt = self._parse_at_time_zone(fmt_string)

            if not to:
                to = exp.DataType.build(exp.DataType.Type.UNKNOWN)
            if to.this in exp.DataType.TEMPORAL_TYPES:
                this = self.expression(
                    exp.StrToDate if to.this == exp.DataType.Type.DATE else exp.StrToTime,
                    this=this,
                    format=exp.Literal.string(
                        format_time(
                            fmt_string.this if fmt_string else "",
                            self.dialect.FORMAT_MAPPING or self.dialect.TIME_MAPPING,
                            self.dialect.FORMAT_TRIE or self.dialect.TIME_TRIE,
                        )
                    ),
                    safe=safe,
                )

                if isinstance(fmt, exp.AtTimeZone) and isinstance(this, exp.StrToTime):
                    this.set("zone", fmt.args["zone"])
                return this
        elif not to:
            self.raise_error("Expected TYPE after CAST")
        elif isinstance(to, exp.Identifier):
            to = exp.DataType.build(to.name, udt=True)
        elif to.this == exp.DataType.Type.CHAR:
            if self._match(TokenType.CHARACTER_SET):
                to = self.expression(exp.CharacterSet, this=self._parse_var_or_string())

        return self.expression(
            exp.Cast if strict else exp.TryCast,
            this=this,
            to=to,
            format=fmt,
            safe=safe,
            action=self._parse_var_from_options(self.CAST_ACTIONS, raise_unmatched=False),
        )

    def _parse_string_agg(self) -> exp.GroupConcat:
        if self._match(TokenType.DISTINCT):
            args: t.List[t.Optional[exp.Expression]] = [
                self.expression(exp.Distinct, expressions=[self._parse_assignment()])
            ]
            if self._match(TokenType.COMMA):
                args.extend(self._parse_csv(self._parse_assignment))
        else:
            args = self._parse_csv(self._parse_assignment)  # type: ignore

        if self._match_text_seq("ON", "OVERFLOW"):
            # trino: LISTAGG(expression [, separator] [ON OVERFLOW overflow_behavior])
            if self._match_text_seq("ERROR"):
                on_overflow: t.Optional[exp.Expression] = exp.var("ERROR")
            else:
                self._match_text_seq("TRUNCATE")
                on_overflow = self.expression(
                    exp.OverflowTruncateBehavior,
                    this=self._parse_string(),
                    with_count=(
                        self._match_text_seq("WITH", "COUNT")
                        or not self._match_text_seq("WITHOUT", "COUNT")
                    ),
                )
        else:
            on_overflow = None

        index = self._index
        if not self._match(TokenType.R_PAREN) and args:
            # postgres: STRING_AGG([DISTINCT] expression, separator [ORDER BY expression1 {ASC | DESC} [, ...]])
            # bigquery: STRING_AGG([DISTINCT] expression [, separator] [ORDER BY key [{ASC | DESC}] [, ... ]] [LIMIT n])
            args[-1] = self._parse_limit(this=self._parse_order(this=args[-1]))
            return self.expression(exp.GroupConcat, this=args[0], separator=seq_get(args, 1))

        # Checks if we can parse an order clause: WITHIN GROUP (ORDER BY <order_by_expression_list> [ASC | DESC]).
        # This is done "manually", instead of letting _parse_window parse it into an exp.WithinGroup node, so that
        # the STRING_AGG call is parsed like in MySQL / SQLite and can thus be transpiled more easily to them.
        if not self._match_text_seq("WITHIN", "GROUP"):
            self._retreat(index)
            return self.validate_expression(exp.GroupConcat.from_arg_list(args), args)

        # The corresponding match_r_paren will be called in parse_function (caller)
        self._match_l_paren()

        return self.expression(
            exp.GroupConcat,
            this=self._parse_order(this=seq_get(args, 0)),
            separator=seq_get(args, 1),
            on_overflow=on_overflow,
        )

    def _parse_convert(
        self, strict: bool, safe: t.Optional[bool] = None
    ) -> t.Optional[exp.Expression]:
        this = self._parse_bitwise()

        if self._match(TokenType.USING):
            to: t.Optional[exp.Expression] = self.expression(
                exp.CharacterSet, this=self._parse_var()
            )
        elif self._match(TokenType.COMMA):
            to = self._parse_types()
        else:
            to = None

        return self.expression(exp.Cast if strict else exp.TryCast, this=this, to=to, safe=safe)

    def _parse_decode(self) -> t.Optional[exp.Decode | exp.Case]:
        """
        There are generally two variants of the DECODE function:

        - DECODE(bin, charset)
        - DECODE(expression, search, result [, search, result] ... [, default])

        The second variant will always be parsed into a CASE expression. Note that NULL
        needs special treatment, since we need to explicitly check for it with `IS NULL`,
        instead of relying on pattern matching.
        """
        args = self._parse_csv(self._parse_assignment)

        if len(args) < 3:
            return self.expression(exp.Decode, this=seq_get(args, 0), charset=seq_get(args, 1))

        expression, *expressions = args
        if not expression:
            return None

        ifs = []
        for search, result in zip(expressions[::2], expressions[1::2]):
            if not search or not result:
                return None

            if isinstance(search, exp.Literal):
                ifs.append(
                    exp.If(this=exp.EQ(this=expression.copy(), expression=search), true=result)
                )
            elif isinstance(search, exp.Null):
                ifs.append(
                    exp.If(this=exp.Is(this=expression.copy(), expression=exp.Null()), true=result)
                )
            else:
                cond = exp.or_(
                    exp.EQ(this=expression.copy(), expression=search),
                    exp.and_(
                        exp.Is(this=expression.copy(), expression=exp.Null()),
                        exp.Is(this=search.copy(), expression=exp.Null()),
                        copy=False,
                    ),
                    copy=False,
                )
                ifs.append(exp.If(this=cond, true=result))

        return exp.Case(ifs=ifs, default=expressions[-1] if len(expressions) % 2 == 1 else None)

    def _parse_json_key_value(self) -> t.Optional[exp.JSONKeyValue]:
        self._match_text_seq("KEY")
        key = self._parse_column()
        self._match_set(self.JSON_KEY_VALUE_SEPARATOR_TOKENS)
        self._match_text_seq("VALUE")
        value = self._parse_bitwise()

        if not key and not value:
            return None
        return self.expression(exp.JSONKeyValue, this=key, expression=value)

    def _parse_format_json(self, this: t.Optional[exp.Expression]) -> t.Optional[exp.Expression]:
        if not this or not self._match_text_seq("FORMAT", "JSON"):
            return this

        return self.expression(exp.FormatJson, this=this)

    def _parse_on_condition(self) -> t.Optional[exp.OnCondition]:
        # MySQL uses "X ON EMPTY Y ON ERROR" (e.g. JSON_VALUE) while Oracle uses the opposite (e.g. JSON_EXISTS)
        if self.dialect.ON_CONDITION_EMPTY_BEFORE_ERROR:
            empty = self._parse_on_handling("EMPTY", *self.ON_CONDITION_TOKENS)
            error = self._parse_on_handling("ERROR", *self.ON_CONDITION_TOKENS)
        else:
            error = self._parse_on_handling("ERROR", *self.ON_CONDITION_TOKENS)
            empty = self._parse_on_handling("EMPTY", *self.ON_CONDITION_TOKENS)

        null = self._parse_on_handling("NULL", *self.ON_CONDITION_TOKENS)

        if not empty and not error and not null:
            return None

        return self.expression(
            exp.OnCondition,
            empty=empty,
            error=error,
            null=null,
        )

    def _parse_on_handling(
        self, on: str, *values: str
    ) -> t.Optional[str] | t.Optional[exp.Expression]:
        # Parses the "X ON Y" or "DEFAULT <expr> ON Y syntax, e.g. NULL ON NULL (Oracle, T-SQL, MySQL)
        for value in values:
            if self._match_text_seq(value, "ON", on):
                return f"{value} ON {on}"

        index = self._index
        if self._match(TokenType.DEFAULT):
            default_value = self._parse_bitwise()
            if self._match_text_seq("ON", on):
                return default_value

            self._retreat(index)

        return None

    @t.overload
    def _parse_json_object(self, agg: Lit[False]) -> exp.JSONObject: ...

    @t.overload
    def _parse_json_object(self, agg: Lit[True]) -> exp.JSONObjectAgg: ...

    def _parse_json_object(self, agg=False):
        star = self._parse_star()
        expressions = (
            [star]
            if star
            else self._parse_csv(lambda: self._parse_format_json(self._parse_json_key_value()))
        )
        null_handling = self._parse_on_handling("NULL", "NULL", "ABSENT")

        unique_keys = None
        if self._match_text_seq("WITH", "UNIQUE"):
            unique_keys = True
        elif self._match_text_seq("WITHOUT", "UNIQUE"):
            unique_keys = False

        self._match_text_seq("KEYS")

        return_type = self._match_text_seq("RETURNING") and self._parse_format_json(
            self._parse_type()
        )
        encoding = self._match_text_seq("ENCODING") and self._parse_var()

        return self.expression(
            exp.JSONObjectAgg if agg else exp.JSONObject,
            expressions=expressions,
            null_handling=null_handling,
            unique_keys=unique_keys,
            return_type=return_type,
            encoding=encoding,
        )

    # Note: this is currently incomplete; it only implements the "JSON_value_column" part
    def _parse_json_column_def(self) -> exp.JSONColumnDef:
        if not self._match_text_seq("NESTED"):
            this = self._parse_id_var()
            kind = self._parse_types(allow_identifiers=False)
            nested = None
        else:
            this = None
            kind = None
            nested = True

        path = self._match_text_seq("PATH") and self._parse_string()
        nested_schema = nested and self._parse_json_schema()

        return self.expression(
            exp.JSONColumnDef,
            this=this,
            kind=kind,
            path=path,
            nested_schema=nested_schema,
        )

    def _parse_json_schema(self) -> exp.JSONSchema:
        self._match_text_seq("COLUMNS")
        return self.expression(
            exp.JSONSchema,
            expressions=self._parse_wrapped_csv(self._parse_json_column_def, optional=True),
        )

    def _parse_json_table(self) -> exp.JSONTable:
        this = self._parse_format_json(self._parse_bitwise())
        path = self._match(TokenType.COMMA) and self._parse_string()
        error_handling = self._parse_on_handling("ERROR", "ERROR", "NULL")
        empty_handling = self._parse_on_handling("EMPTY", "ERROR", "NULL")
        schema = self._parse_json_schema()

        return exp.JSONTable(
            this=this,
            schema=schema,
            path=path,
            error_handling=error_handling,
            empty_handling=empty_handling,
        )

    def _parse_match_against(self) -> exp.MatchAgainst:
        expressions = self._parse_csv(self._parse_column)

        self._match_text_seq(")", "AGAINST", "(")

        this = self._parse_string()

        if self._match_text_seq("IN", "NATURAL", "LANGUAGE", "MODE"):
            modifier = "IN NATURAL LANGUAGE MODE"
            if self._match_text_seq("WITH", "QUERY", "EXPANSION"):
                modifier = f"{modifier} WITH QUERY EXPANSION"
        elif self._match_text_seq("IN", "BOOLEAN", "MODE"):
            modifier = "IN BOOLEAN MODE"
        elif self._match_text_seq("WITH", "QUERY", "EXPANSION"):
            modifier = "WITH QUERY EXPANSION"
        else:
            modifier = None

        return self.expression(
            exp.MatchAgainst, this=this, expressions=expressions, modifier=modifier
        )

    # https://learn.microsoft.com/en-us/sql/t-sql/functions/openjson-transact-sql?view=sql-server-ver16
    def _parse_open_json(self) -> exp.OpenJSON:
        this = self._parse_bitwise()
        path = self._match(TokenType.COMMA) and self._parse_string()

        def _parse_open_json_column_def() -> exp.OpenJSONColumnDef:
            this = self._parse_field(any_token=True)
            kind = self._parse_types()
            path = self._parse_string()
            as_json = self._match_pair(TokenType.ALIAS, TokenType.JSON)

            return self.expression(
                exp.OpenJSONColumnDef, this=this, kind=kind, path=path, as_json=as_json
            )

        expressions = None
        if self._match_pair(TokenType.R_PAREN, TokenType.WITH):
            self._match_l_paren()
            expressions = self._parse_csv(_parse_open_json_column_def)

        return self.expression(exp.OpenJSON, this=this, path=path, expressions=expressions)

    def _parse_position(self, haystack_first: bool = False) -> exp.StrPosition:
        args = self._parse_csv(self._parse_bitwise)

        if self._match(TokenType.IN):
            return self.expression(
                exp.StrPosition, this=self._parse_bitwise(), substr=seq_get(args, 0)
            )

        if haystack_first:
            haystack = seq_get(args, 0)
            needle = seq_get(args, 1)
        else:
            needle = seq_get(args, 0)
            haystack = seq_get(args, 1)

        return self.expression(
            exp.StrPosition, this=haystack, substr=needle, position=seq_get(args, 2)
        )

    def _parse_predict(self) -> exp.Predict:
        self._match_text_seq("MODEL")
        this = self._parse_table()

        self._match(TokenType.COMMA)
        self._match_text_seq("TABLE")

        return self.expression(
            exp.Predict,
            this=this,
            expression=self._parse_table(),
            params_struct=self._match(TokenType.COMMA) and self._parse_bitwise(),
        )

    def _parse_join_hint(self, func_name: str) -> exp.JoinHint:
        args = self._parse_csv(self._parse_table)
        return exp.JoinHint(this=func_name.upper(), expressions=args)

    def _parse_substring(self) -> exp.Substring:
        # Postgres supports the form: substring(string [from int] [for int])
        # https://www.postgresql.org/docs/9.1/functions-string.html @ Table 9-6

        args = t.cast(t.List[t.Optional[exp.Expression]], self._parse_csv(self._parse_bitwise))

        if self._match(TokenType.FROM):
            args.append(self._parse_bitwise())
        if self._match(TokenType.FOR):
            if len(args) == 1:
                args.append(exp.Literal.number(1))
            args.append(self._parse_bitwise())

        return self.validate_expression(exp.Substring.from_arg_list(args), args)

    def _parse_trim(self) -> exp.Trim:
        # https://www.w3resource.com/sql/character-functions/trim.php
        # https://docs.oracle.com/javadb/10.8.3.0/ref/rreftrimfunc.html

        position = None
        collation = None
        expression = None

        if self._match_texts(self.TRIM_TYPES):
            position = self._prev.text.upper()

        this = self._parse_bitwise()
        if self._match_set((TokenType.FROM, TokenType.COMMA)):
            invert_order = self._prev.token_type == TokenType.FROM or self.TRIM_PATTERN_FIRST
            expression = self._parse_bitwise()

            if invert_order:
                this, expression = expression, this

        if self._match(TokenType.COLLATE):
            collation = self._parse_bitwise()

        return self.expression(
            exp.Trim, this=this, position=position, expression=expression, collation=collation
        )

    def _parse_window_clause(self) -> t.Optional[t.List[exp.Expression]]:
        return self._match(TokenType.WINDOW) and self._parse_csv(self._parse_named_window)

    def _parse_named_window(self) -> t.Optional[exp.Expression]:
        return self._parse_window(self._parse_id_var(), alias=True)

    def _parse_respect_or_ignore_nulls(
        self, this: t.Optional[exp.Expression]
    ) -> t.Optional[exp.Expression]:
        if self._match_text_seq("IGNORE", "NULLS"):
            return self.expression(exp.IgnoreNulls, this=this)
        if self._match_text_seq("RESPECT", "NULLS"):
            return self.expression(exp.RespectNulls, this=this)
        return this

    def _parse_having_max(self, this: t.Optional[exp.Expression]) -> t.Optional[exp.Expression]:
        if self._match(TokenType.HAVING):
            self._match_texts(("MAX", "MIN"))
            max = self._prev.text.upper() != "MIN"
            return self.expression(
                exp.HavingMax, this=this, expression=self._parse_column(), max=max
            )

        return this

    def _parse_window(
        self, this: t.Optional[exp.Expression], alias: bool = False
    ) -> t.Optional[exp.Expression]:
        func = this
        comments = func.comments if isinstance(func, exp.Expression) else None

        if self._match_pair(TokenType.FILTER, TokenType.L_PAREN):
            self._match(TokenType.WHERE)
            this = self.expression(
                exp.Filter, this=this, expression=self._parse_where(skip_where_token=True)
            )
            self._match_r_paren()

        # T-SQL allows the OVER (...) syntax after WITHIN GROUP.
        # https://learn.microsoft.com/en-us/sql/t-sql/functions/percentile-disc-transact-sql?view=sql-server-ver16
        if self._match_text_seq("WITHIN", "GROUP"):
            order = self._parse_wrapped(self._parse_order)
            this = self.expression(exp.WithinGroup, this=this, expression=order)

        # SQL spec defines an optional [ { IGNORE | RESPECT } NULLS ] OVER
        # Some dialects choose to implement and some do not.
        # https://dev.mysql.com/doc/refman/8.0/en/window-function-descriptions.html

        # There is some code above in _parse_lambda that handles
        #   SELECT FIRST_VALUE(TABLE.COLUMN IGNORE|RESPECT NULLS) OVER ...

        # The below changes handle
        #   SELECT FIRST_VALUE(TABLE.COLUMN) IGNORE|RESPECT NULLS OVER ...

        # Oracle allows both formats
        #   (https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/img_text/first_value.html)
        #   and Snowflake chose to do the same for familiarity
        #   https://docs.snowflake.com/en/sql-reference/functions/first_value.html#usage-notes
        if isinstance(this, exp.AggFunc):
            ignore_respect = this.find(exp.IgnoreNulls, exp.RespectNulls)

            if ignore_respect and ignore_respect is not this:
                ignore_respect.replace(ignore_respect.this)
                this = self.expression(ignore_respect.__class__, this=this)

        this = self._parse_respect_or_ignore_nulls(this)

        # bigquery select from window x AS (partition by ...)
        if alias:
            over = None
            self._match(TokenType.ALIAS)
        elif not self._match_set(self.WINDOW_BEFORE_PAREN_TOKENS):
            return this
        else:
            over = self._prev.text.upper()

        if comments and isinstance(func, exp.Expression):
            func.pop_comments()

        if not self._match(TokenType.L_PAREN):
            return self.expression(
                exp.Window,
                comments=comments,
                this=this,
                alias=self._parse_id_var(False),
                over=over,
            )

        window_alias = self._parse_id_var(any_token=False, tokens=self.WINDOW_ALIAS_TOKENS)

        first = self._match(TokenType.FIRST)
        if self._match_text_seq("LAST"):
            first = False

        partition, order = self._parse_partition_and_order()
        kind = self._match_set((TokenType.ROWS, TokenType.RANGE)) and self._prev.text

        if kind:
            self._match(TokenType.BETWEEN)
            start = self._parse_window_spec()
            self._match(TokenType.AND)
            end = self._parse_window_spec()

            spec = self.expression(
                exp.WindowSpec,
                kind=kind,
                start=start["value"],
                start_side=start["side"],
                end=end["value"],
                end_side=end["side"],
            )
        else:
            spec = None

        self._match_r_paren()

        window = self.expression(
            exp.Window,
            comments=comments,
            this=this,
            partition_by=partition,
            order=order,
            spec=spec,
            alias=window_alias,
            over=over,
            first=first,
        )

        # This covers Oracle's FIRST/LAST syntax: aggregate KEEP (...) OVER (...)
        if self._match_set(self.WINDOW_BEFORE_PAREN_TOKENS, advance=False):
            return self._parse_window(window, alias=alias)

        return window

    def _parse_partition_and_order(
        self,
    ) -> t.Tuple[t.List[exp.Expression], t.Optional[exp.Expression]]:
        return self._parse_partition_by(), self._parse_order()

    def _parse_window_spec(self) -> t.Dict[str, t.Optional[str | exp.Expression]]:
        self._match(TokenType.BETWEEN)

        return {
            "value": (
                (self._match_text_seq("UNBOUNDED") and "UNBOUNDED")
                or (self._match_text_seq("CURRENT", "ROW") and "CURRENT ROW")
                or self._parse_bitwise()
            ),
            "side": self._match_texts(self.WINDOW_SIDES) and self._prev.text,
        }

    def _parse_alias(
        self, this: t.Optional[exp.Expression], explicit: bool = False
    ) -> t.Optional[exp.Expression]:
        any_token = self._match(TokenType.ALIAS)
        comments = self._prev_comments or []

        if explicit and not any_token:
            return this

        if self._match(TokenType.L_PAREN):
            aliases = self.expression(
                exp.Aliases,
                comments=comments,
                this=this,
                expressions=self._parse_csv(lambda: self._parse_id_var(any_token)),
            )
            self._match_r_paren(aliases)
            return aliases

        alias = self._parse_id_var(any_token, tokens=self.ALIAS_TOKENS) or (
            self.STRING_ALIASES and self._parse_string_as_identifier()
        )

        if alias:
            comments.extend(alias.pop_comments())
            this = self.expression(exp.Alias, comments=comments, this=this, alias=alias)
            column = this.this

            # Moves the comment next to the alias in `expr /* comment */ AS alias`
            if not this.comments and column and column.comments:
                this.comments = column.pop_comments()

        return this

    def _parse_id_var(
        self,
        any_token: bool = True,
        tokens: t.Optional[t.Collection[TokenType]] = None,
    ) -> t.Optional[exp.Expression]:
        expression = self._parse_identifier()
        if not expression and (
            (any_token and self._advance_any()) or self._match_set(tokens or self.ID_VAR_TOKENS)
        ):
            quoted = self._prev.token_type == TokenType.STRING
            expression = self.expression(exp.Identifier, this=self._prev.text, quoted=quoted)

        return expression

    def _parse_string(self) -> t.Optional[exp.Expression]:
        if self._match_set(self.STRING_PARSERS):
            return self.STRING_PARSERS[self._prev.token_type](self, self._prev)
        return self._parse_placeholder()

    def _parse_string_as_identifier(self) -> t.Optional[exp.Identifier]:
        return exp.to_identifier(self._match(TokenType.STRING) and self._prev.text, quoted=True)

    def _parse_number(self) -> t.Optional[exp.Expression]:
        if self._match_set(self.NUMERIC_PARSERS):
            return self.NUMERIC_PARSERS[self._prev.token_type](self, self._prev)
        return self._parse_placeholder()

    def _parse_identifier(self) -> t.Optional[exp.Expression]:
        if self._match(TokenType.IDENTIFIER):
            return self.expression(exp.Identifier, this=self._prev.text, quoted=True)
        return self._parse_placeholder()

    def _parse_var(
        self,
        any_token: bool = False,
        tokens: t.Optional[t.Collection[TokenType]] = None,
        upper: bool = False,
    ) -> t.Optional[exp.Expression]:
        if (
            (any_token and self._advance_any())
            or self._match(TokenType.VAR)
            or (self._match_set(tokens) if tokens else False)
        ):
            return self.expression(
                exp.Var, this=self._prev.text.upper() if upper else self._prev.text
            )
        return self._parse_placeholder()

    def _advance_any(self, ignore_reserved: bool = False) -> t.Optional[Token]:
        if self._curr and (ignore_reserved or self._curr.token_type not in self.RESERVED_TOKENS):
            self._advance()
            return self._prev
        return None

    def _parse_var_or_string(self, upper: bool = False) -> t.Optional[exp.Expression]:
        return self._parse_string() or self._parse_var(any_token=True, upper=upper)

    def _parse_primary_or_var(self) -> t.Optional[exp.Expression]:
        return self._parse_primary() or self._parse_var(any_token=True)

    def _parse_null(self) -> t.Optional[exp.Expression]:
        if self._match_set(self.NULL_TOKENS):
            return self.PRIMARY_PARSERS[TokenType.NULL](self, self._prev)
        return self._parse_placeholder()

    def _parse_boolean(self) -> t.Optional[exp.Expression]:
        if self._match(TokenType.TRUE):
            return self.PRIMARY_PARSERS[TokenType.TRUE](self, self._prev)
        if self._match(TokenType.FALSE):
            return self.PRIMARY_PARSERS[TokenType.FALSE](self, self._prev)
        return self._parse_placeholder()

    def _parse_star(self) -> t.Optional[exp.Expression]:
        if self._match(TokenType.STAR):
            return self.PRIMARY_PARSERS[TokenType.STAR](self, self._prev)
        return self._parse_placeholder()

    def _parse_parameter(self) -> exp.Parameter:
        this = self._parse_identifier() or self._parse_primary_or_var()
        return self.expression(exp.Parameter, this=this)

    def _parse_placeholder(self) -> t.Optional[exp.Expression]:
        if self._match_set(self.PLACEHOLDER_PARSERS):
            placeholder = self.PLACEHOLDER_PARSERS[self._prev.token_type](self)
            if placeholder:
                return placeholder
            self._advance(-1)
        return None

    def _parse_star_op(self, *keywords: str) -> t.Optional[t.List[exp.Expression]]:
        if not self._match_texts(keywords):
            return None
        if self._match(TokenType.L_PAREN, advance=False):
            return self._parse_wrapped_csv(self._parse_expression)

        expression = self._parse_expression()
        return [expression] if expression else None

    def _parse_csv(
        self, parse_method: t.Callable, sep: TokenType = TokenType.COMMA
    ) -> t.List[exp.Expression]:
        parse_result = parse_method()
        items = [parse_result] if parse_result is not None else []

        while self._match(sep):
            self._add_comments(parse_result)
            parse_result = parse_method()
            if parse_result is not None:
                items.append(parse_result)

        return items

    def _parse_tokens(
        self, parse_method: t.Callable, expressions: t.Dict
    ) -> t.Optional[exp.Expression]:
        this = parse_method()

        while self._match_set(expressions):
            this = self.expression(
                expressions[self._prev.token_type],
                this=this,
                comments=self._prev_comments,
                expression=parse_method(),
            )

        return this

    def _parse_wrapped_id_vars(self, optional: bool = False) -> t.List[exp.Expression]:
        return self._parse_wrapped_csv(self._parse_id_var, optional=optional)

    def _parse_wrapped_csv(
        self, parse_method: t.Callable, sep: TokenType = TokenType.COMMA, optional: bool = False
    ) -> t.List[exp.Expression]:
        return self._parse_wrapped(
            lambda: self._parse_csv(parse_method, sep=sep), optional=optional
        )

    def _parse_wrapped(self, parse_method: t.Callable, optional: bool = False) -> t.Any:
        wrapped = self._match(TokenType.L_PAREN)
        if not wrapped and not optional:
            self.raise_error("Expecting (")
        parse_result = parse_method()
        if wrapped:
            self._match_r_paren()
        return parse_result

    def _parse_expressions(self) -> t.List[exp.Expression]:
        return self._parse_csv(self._parse_expression)

    def _parse_select_or_expression(self, alias: bool = False) -> t.Optional[exp.Expression]:
        return self._parse_select() or self._parse_set_operations(
            self._parse_expression() if alias else self._parse_assignment()
        )

    def _parse_ddl_select(self) -> t.Optional[exp.Expression]:
        return self._parse_query_modifiers(
            self._parse_set_operations(self._parse_select(nested=True, parse_subquery_alias=False))
        )

    def _parse_transaction(self) -> exp.Transaction | exp.Command:
        this = None
        if self._match_texts(self.TRANSACTION_KIND):
            this = self._prev.text

        self._match_texts(("TRANSACTION", "WORK"))

        modes = []
        while True:
            mode = []
            while self._match(TokenType.VAR):
                mode.append(self._prev.text)

            if mode:
                modes.append(" ".join(mode))
            if not self._match(TokenType.COMMA):
                break

        return self.expression(exp.Transaction, this=this, modes=modes)

    def _parse_commit_or_rollback(self) -> exp.Commit | exp.Rollback:
        chain = None
        savepoint = None
        is_rollback = self._prev.token_type == TokenType.ROLLBACK

        self._match_texts(("TRANSACTION", "WORK"))

        if self._match_text_seq("TO"):
            self._match_text_seq("SAVEPOINT")
            savepoint = self._parse_id_var()

        if self._match(TokenType.AND):
            chain = not self._match_text_seq("NO")
            self._match_text_seq("CHAIN")

        if is_rollback:
            return self.expression(exp.Rollback, savepoint=savepoint)

        return self.expression(exp.Commit, chain=chain)

    def _parse_refresh(self) -> exp.Refresh:
        self._match(TokenType.TABLE)
        return self.expression(exp.Refresh, this=self._parse_string() or self._parse_table())

    def _parse_add_column(self) -> t.Optional[exp.Expression]:
        if not self._match_text_seq("ADD"):
            return None

        self._match(TokenType.COLUMN)
        exists_column = self._parse_exists(not_=True)
        expression = self._parse_field_def()

        if expression:
            expression.set("exists", exists_column)

            # https://docs.databricks.com/delta/update-schema.html#explicitly-update-schema-to-add-columns
            if self._match_texts(("FIRST", "AFTER")):
                position = self._prev.text
                column_position = self.expression(
                    exp.ColumnPosition, this=self._parse_column(), position=position
                )
                expression.set("position", column_position)

        return expression

    def _parse_drop_column(self) -> t.Optional[exp.Drop | exp.Command]:
        drop = self._match(TokenType.DROP) and self._parse_drop()
        if drop and not isinstance(drop, exp.Command):
            drop.set("kind", drop.args.get("kind", "COLUMN"))
        return drop

    # https://docs.aws.amazon.com/athena/latest/ug/alter-table-drop-partition.html
    def _parse_drop_partition(self, exists: t.Optional[bool] = None) -> exp.DropPartition:
        return self.expression(
            exp.DropPartition, expressions=self._parse_csv(self._parse_partition), exists=exists
        )

    def _parse_alter_table_add(self) -> t.List[exp.Expression]:
        index = self._index - 1

        if self._match_set(self.ADD_CONSTRAINT_TOKENS, advance=False):
            return self._parse_csv(
                lambda: self.expression(
                    exp.AddConstraint, expressions=self._parse_csv(self._parse_constraint)
                )
            )

        self._retreat(index)
        if not self.ALTER_TABLE_ADD_REQUIRED_FOR_EACH_COLUMN and self._match_text_seq("ADD"):
            return self._parse_wrapped_csv(self._parse_field_def, optional=True)

        if self._match_text_seq("ADD", "COLUMNS"):
            schema = self._parse_schema()
            if schema:
                return [schema]
            return []

        return self._parse_wrapped_csv(self._parse_add_column, optional=True)

    def _parse_alter_table_alter(self) -> t.Optional[exp.Expression]:
        if self._match_texts(self.ALTER_ALTER_PARSERS):
            return self.ALTER_ALTER_PARSERS[self._prev.text.upper()](self)

        # Many dialects support the ALTER [COLUMN] syntax, so if there is no
        # keyword after ALTER we default to parsing this statement
        self._match(TokenType.COLUMN)
        column = self._parse_field(any_token=True)

        if self._match_pair(TokenType.DROP, TokenType.DEFAULT):
            return self.expression(exp.AlterColumn, this=column, drop=True)
        if self._match_pair(TokenType.SET, TokenType.DEFAULT):
            return self.expression(exp.AlterColumn, this=column, default=self._parse_assignment())
        if self._match(TokenType.COMMENT):
            return self.expression(exp.AlterColumn, this=column, comment=self._parse_string())
        if self._match_text_seq("DROP", "NOT", "NULL"):
            return self.expression(
                exp.AlterColumn,
                this=column,
                drop=True,
                allow_null=True,
            )
        if self._match_text_seq("SET", "NOT", "NULL"):
            return self.expression(
                exp.AlterColumn,
                this=column,
                allow_null=False,
            )
        self._match_text_seq("SET", "DATA")
        self._match_text_seq("TYPE")
        return self.expression(
            exp.AlterColumn,
            this=column,
            dtype=self._parse_types(),
            collate=self._match(TokenType.COLLATE) and self._parse_term(),
            using=self._match(TokenType.USING) and self._parse_assignment(),
        )

    def _parse_alter_diststyle(self) -> exp.AlterDistStyle:
        if self._match_texts(("ALL", "EVEN", "AUTO")):
            return self.expression(exp.AlterDistStyle, this=exp.var(self._prev.text.upper()))

        self._match_text_seq("KEY", "DISTKEY")
        return self.expression(exp.AlterDistStyle, this=self._parse_column())

    def _parse_alter_sortkey(self, compound: t.Optional[bool] = None) -> exp.AlterSortKey:
        if compound:
            self._match_text_seq("SORTKEY")

        if self._match(TokenType.L_PAREN, advance=False):
            return self.expression(
                exp.AlterSortKey, expressions=self._parse_wrapped_id_vars(), compound=compound
            )

        self._match_texts(("AUTO", "NONE"))
        return self.expression(
            exp.AlterSortKey, this=exp.var(self._prev.text.upper()), compound=compound
        )

    def _parse_alter_table_drop(self) -> t.List[exp.Expression]:
        index = self._index - 1

        partition_exists = self._parse_exists()
        if self._match(TokenType.PARTITION, advance=False):
            return self._parse_csv(lambda: self._parse_drop_partition(exists=partition_exists))

        self._retreat(index)
        return self._parse_csv(self._parse_drop_column)

    def _parse_alter_table_rename(self) -> t.Optional[exp.AlterRename | exp.RenameColumn]:
        if self._match(TokenType.COLUMN):
            exists = self._parse_exists()
            old_column = self._parse_column()
            to = self._match_text_seq("TO")
            new_column = self._parse_column()

            if old_column is None or to is None or new_column is None:
                return None

            return self.expression(exp.RenameColumn, this=old_column, to=new_column, exists=exists)

        self._match_text_seq("TO")
        return self.expression(exp.AlterRename, this=self._parse_table(schema=True))

    def _parse_alter_table_set(self) -> exp.AlterSet:
        alter_set = self.expression(exp.AlterSet)

        if self._match(TokenType.L_PAREN, advance=False) or self._match_text_seq(
            "TABLE", "PROPERTIES"
        ):
            alter_set.set("expressions", self._parse_wrapped_csv(self._parse_assignment))
        elif self._match_text_seq("FILESTREAM_ON", advance=False):
            alter_set.set("expressions", [self._parse_assignment()])
        elif self._match_texts(("LOGGED", "UNLOGGED")):
            alter_set.set("option", exp.var(self._prev.text.upper()))
        elif self._match_text_seq("WITHOUT") and self._match_texts(("CLUSTER", "OIDS")):
            alter_set.set("option", exp.var(f"WITHOUT {self._prev.text.upper()}"))
        elif self._match_text_seq("LOCATION"):
            alter_set.set("location", self._parse_field())
        elif self._match_text_seq("ACCESS", "METHOD"):
            alter_set.set("access_method", self._parse_field())
        elif self._match_text_seq("TABLESPACE"):
            alter_set.set("tablespace", self._parse_field())
        elif self._match_text_seq("FILE", "FORMAT") or self._match_text_seq("FILEFORMAT"):
            alter_set.set("file_format", [self._parse_field()])
        elif self._match_text_seq("STAGE_FILE_FORMAT"):
            alter_set.set("file_format", self._parse_wrapped_options())
        elif self._match_text_seq("STAGE_COPY_OPTIONS"):
            alter_set.set("copy_options", self._parse_wrapped_options())
        elif self._match_text_seq("TAG") or self._match_text_seq("TAGS"):
            alter_set.set("tag", self._parse_csv(self._parse_assignment))
        else:
            if self._match_text_seq("SERDE"):
                alter_set.set("serde", self._parse_field())

            alter_set.set("expressions", [self._parse_properties()])

        return alter_set

    def _parse_alter(self) -> exp.Alter | exp.Command:
        start = self._prev

        alter_token = self._match_set(self.ALTERABLES) and self._prev
        if not alter_token:
            return self._parse_as_command(start)

        exists = self._parse_exists()
        only = self._match_text_seq("ONLY")
        this = self._parse_table(schema=True)
        cluster = self._parse_on_property() if self._match(TokenType.ON) else None

        if self._next:
            self._advance()

        parser = self.ALTER_PARSERS.get(self._prev.text.upper()) if self._prev else None
        if parser:
            actions = ensure_list(parser(self))
            not_valid = self._match_text_seq("NOT", "VALID")
            options = self._parse_csv(self._parse_property)

            if not self._curr and actions:
                return self.expression(
                    exp.Alter,
                    this=this,
                    kind=alter_token.text.upper(),
                    exists=exists,
                    actions=actions,
                    only=only,
                    options=options,
                    cluster=cluster,
                    not_valid=not_valid,
                )

        return self._parse_as_command(start)

    def _parse_merge(self) -> exp.Merge:
        self._match(TokenType.INTO)
        target = self._parse_table()

        if target and self._match(TokenType.ALIAS, advance=False):
            target.set("alias", self._parse_table_alias())

        self._match(TokenType.USING)
        using = self._parse_table()

        self._match(TokenType.ON)
        on = self._parse_assignment()

        return self.expression(
            exp.Merge,
            this=target,
            using=using,
            on=on,
            expressions=self._parse_when_matched(),
            returning=self._parse_returning(),
        )

    def _parse_when_matched(self) -> t.List[exp.When]:
        whens = []

        while self._match(TokenType.WHEN):
            matched = not self._match(TokenType.NOT)
            self._match_text_seq("MATCHED")
            source = (
                False
                if self._match_text_seq("BY", "TARGET")
                else self._match_text_seq("BY", "SOURCE")
            )
            condition = self._parse_assignment() if self._match(TokenType.AND) else None

            self._match(TokenType.THEN)

            if self._match(TokenType.INSERT):
                this = self._parse_star()
                if this:
                    then: t.Optional[exp.Expression] = self.expression(exp.Insert, this=this)
                else:
                    then = self.expression(
                        exp.Insert,
                        this=exp.var("ROW") if self._match_text_seq("ROW") else self._parse_value(),
                        expression=self._match_text_seq("VALUES") and self._parse_value(),
                    )
            elif self._match(TokenType.UPDATE):
                expressions = self._parse_star()
                if expressions:
                    then = self.expression(exp.Update, expressions=expressions)
                else:
                    then = self.expression(
                        exp.Update,
                        expressions=self._match(TokenType.SET)
                        and self._parse_csv(self._parse_equality),
                    )
            elif self._match(TokenType.DELETE):
                then = self.expression(exp.Var, this=self._prev.text)
            else:
                then = self._parse_var_from_options(self.CONFLICT_ACTIONS)

            whens.append(
                self.expression(
                    exp.When,
                    matched=matched,
                    source=source,
                    condition=condition,
                    then=then,
                )
            )
        return whens

    def _parse_show(self) -> t.Optional[exp.Expression]:
        parser = self._find_parser(self.SHOW_PARSERS, self.SHOW_TRIE)
        if parser:
            return parser(self)
        return self._parse_as_command(self._prev)

    def _parse_set_item_assignment(
        self, kind: t.Optional[str] = None
    ) -> t.Optional[exp.Expression]:
        index = self._index

        if kind in ("GLOBAL", "SESSION") and self._match_text_seq("TRANSACTION"):
            return self._parse_set_transaction(global_=kind == "GLOBAL")

        left = self._parse_primary() or self._parse_column()
        assignment_delimiter = self._match_texts(("=", "TO"))

        if not left or (self.SET_REQUIRES_ASSIGNMENT_DELIMITER and not assignment_delimiter):
            self._retreat(index)
            return None

        right = self._parse_statement() or self._parse_id_var()
        if isinstance(right, (exp.Column, exp.Identifier)):
            right = exp.var(right.name)

        this = self.expression(exp.EQ, this=left, expression=right)
        return self.expression(exp.SetItem, this=this, kind=kind)

    def _parse_set_transaction(self, global_: bool = False) -> exp.Expression:
        self._match_text_seq("TRANSACTION")
        characteristics = self._parse_csv(
            lambda: self._parse_var_from_options(self.TRANSACTION_CHARACTERISTICS)
        )
        return self.expression(
            exp.SetItem,
            expressions=characteristics,
            kind="TRANSACTION",
            **{"global": global_},  # type: ignore
        )

    def _parse_set_item(self) -> t.Optional[exp.Expression]:
        parser = self._find_parser(self.SET_PARSERS, self.SET_TRIE)
        return parser(self) if parser else self._parse_set_item_assignment(kind=None)

    def _parse_set(self, unset: bool = False, tag: bool = False) -> exp.Set | exp.Command:
        index = self._index
        set_ = self.expression(
            exp.Set, expressions=self._parse_csv(self._parse_set_item), unset=unset, tag=tag
        )

        if self._curr:
            self._retreat(index)
            return self._parse_as_command(self._prev)

        return set_

    def _parse_var_from_options(
        self, options: OPTIONS_TYPE, raise_unmatched: bool = True
    ) -> t.Optional[exp.Var]:
        start = self._curr
        if not start:
            return None

        option = start.text.upper()
        continuations = options.get(option)

        index = self._index
        self._advance()
        for keywords in continuations or []:
            if isinstance(keywords, str):
                keywords = (keywords,)

            if self._match_text_seq(*keywords):
                option = f"{option} {' '.join(keywords)}"
                break
        else:
            if continuations or continuations is None:
                if raise_unmatched:
                    self.raise_error(f"Unknown option {option}")

                self._retreat(index)
                return None

        return exp.var(option)

    def _parse_as_command(self, start: Token) -> exp.Command:
        while self._curr:
            self._advance()
        text = self._find_sql(start, self._prev)
        size = len(start.text)
        self._warn_unsupported()
        return exp.Command(this=text[:size], expression=text[size:])

    def _parse_dict_property(self, this: str) -> exp.DictProperty:
        settings = []

        self._match_l_paren()
        kind = self._parse_id_var()

        if self._match(TokenType.L_PAREN):
            while True:
                key = self._parse_id_var()
                value = self._parse_primary()
                if not key and value is None:
                    break
                settings.append(self.expression(exp.DictSubProperty, this=key, value=value))
            self._match(TokenType.R_PAREN)

        self._match_r_paren()

        return self.expression(
            exp.DictProperty,
            this=this,
            kind=kind.this if kind else None,
            settings=settings,
        )

    def _parse_dict_range(self, this: str) -> exp.DictRange:
        self._match_l_paren()
        has_min = self._match_text_seq("MIN")
        if has_min:
            min = self._parse_var() or self._parse_primary()
            self._match_text_seq("MAX")
            max = self._parse_var() or self._parse_primary()
        else:
            max = self._parse_var() or self._parse_primary()
            min = exp.Literal.number(0)
        self._match_r_paren()
        return self.expression(exp.DictRange, this=this, min=min, max=max)

    def _parse_comprehension(
        self, this: t.Optional[exp.Expression]
    ) -> t.Optional[exp.Comprehension]:
        index = self._index
        expression = self._parse_column()
        if not self._match(TokenType.IN):
            self._retreat(index - 1)
            return None
        iterator = self._parse_column()
        condition = self._parse_assignment() if self._match_text_seq("IF") else None
        return self.expression(
            exp.Comprehension,
            this=this,
            expression=expression,
            iterator=iterator,
            condition=condition,
        )

    def _parse_heredoc(self) -> t.Optional[exp.Heredoc]:
        if self._match(TokenType.HEREDOC_STRING):
            return self.expression(exp.Heredoc, this=self._prev.text)

        if not self._match_text_seq("$"):
            return None

        tags = ["$"]
        tag_text = None

        if self._is_connected():
            self._advance()
            tags.append(self._prev.text.upper())
        else:
            self.raise_error("No closing $ found")

        if tags[-1] != "$":
            if self._is_connected() and self._match_text_seq("$"):
                tag_text = tags[-1]
                tags.append("$")
            else:
                self.raise_error("No closing $ found")

        heredoc_start = self._curr

        while self._curr:
            if self._match_text_seq(*tags, advance=False):
                this = self._find_sql(heredoc_start, self._prev)
                self._advance(len(tags))
                return self.expression(exp.Heredoc, this=this, tag=tag_text)

            self._advance()

        self.raise_error(f"No closing {''.join(tags)} found")
        return None

    def _find_parser(
        self, parsers: t.Dict[str, t.Callable], trie: t.Dict
    ) -> t.Optional[t.Callable]:
        if not self._curr:
            return None

        index = self._index
        this = []
        while True:
            # The current token might be multiple words
            curr = self._curr.text.upper()
            key = curr.split(" ")
            this.append(curr)

            self._advance()
            result, trie = in_trie(trie, key)
            if result == TrieResult.FAILED:
                break

            if result == TrieResult.EXISTS:
                subparser = parsers[" ".join(this)]
                return subparser

        self._retreat(index)
        return None

    def _match(self, token_type, advance=True, expression=None):
        if not self._curr:
            return None

        if self._curr.token_type == token_type:
            if advance:
                self._advance()
            self._add_comments(expression)
            return True

        return None

    def _match_set(self, types, advance=True):
        if not self._curr:
            return None

        if self._curr.token_type in types:
            if advance:
                self._advance()
            return True

        return None

    def _match_pair(self, token_type_a, token_type_b, advance=True):
        if not self._curr or not self._next:
            return None

        if self._curr.token_type == token_type_a and self._next.token_type == token_type_b:
            if advance:
                self._advance(2)
            return True

        return None

    def _match_l_paren(self, expression: t.Optional[exp.Expression] = None) -> None:
        if not self._match(TokenType.L_PAREN, expression=expression):
            self.raise_error("Expecting (")

    def _match_r_paren(self, expression: t.Optional[exp.Expression] = None) -> None:
        if not self._match(TokenType.R_PAREN, expression=expression):
            self.raise_error("Expecting )")

    def _match_texts(self, texts, advance=True):
        if (
            self._curr
            and self._curr.token_type != TokenType.STRING
            and self._curr.text.upper() in texts
        ):
            if advance:
                self._advance()
            return True
        return None

    def _match_text_seq(self, *texts, advance=True):
        index = self._index
        for text in texts:
            if (
                self._curr
                and self._curr.token_type != TokenType.STRING
                and self._curr.text.upper() == text
            ):
                self._advance()
            else:
                self._retreat(index)
                return None

        if not advance:
            self._retreat(index)

        return True

    def _replace_lambda(
        self, node: t.Optional[exp.Expression], expressions: t.List[exp.Expression]
    ) -> t.Optional[exp.Expression]:
        if not node:
            return node

        lambda_types = {e.name: e.args.get("to") or False for e in expressions}

        for column in node.find_all(exp.Column):
            typ = lambda_types.get(column.parts[0].name)
            if typ is not None:
                dot_or_id = column.to_dot() if column.table else column.this

                if typ:
                    dot_or_id = self.expression(
                        exp.Cast,
                        this=dot_or_id,
                        to=typ,
                    )

                parent = column.parent

                while isinstance(parent, exp.Dot):
                    if not isinstance(parent.parent, exp.Dot):
                        parent.replace(dot_or_id)
                        break
                    parent = parent.parent
                else:
                    if column is node:
                        node = dot_or_id
                    else:
                        column.replace(dot_or_id)
        return node

    def _parse_truncate_table(self) -> t.Optional[exp.TruncateTable] | exp.Expression:
        start = self._prev

        # Not to be confused with TRUNCATE(number, decimals) function call
        if self._match(TokenType.L_PAREN):
            self._retreat(self._index - 2)
            return self._parse_function()

        # Clickhouse supports TRUNCATE DATABASE as well
        is_database = self._match(TokenType.DATABASE)

        self._match(TokenType.TABLE)

        exists = self._parse_exists(not_=False)

        expressions = self._parse_csv(
            lambda: self._parse_table(schema=True, is_db_reference=is_database)
        )

        cluster = self._parse_on_property() if self._match(TokenType.ON) else None

        if self._match_text_seq("RESTART", "IDENTITY"):
            identity = "RESTART"
        elif self._match_text_seq("CONTINUE", "IDENTITY"):
            identity = "CONTINUE"
        else:
            identity = None

        if self._match_text_seq("CASCADE") or self._match_text_seq("RESTRICT"):
            option = self._prev.text
        else:
            option = None

        partition = self._parse_partition()

        # Fallback case
        if self._curr:
            return self._parse_as_command(start)

        return self.expression(
            exp.TruncateTable,
            expressions=expressions,
            is_database=is_database,
            exists=exists,
            cluster=cluster,
            identity=identity,
            option=option,
            partition=partition,
        )

    def _parse_with_operator(self) -> t.Optional[exp.Expression]:
        this = self._parse_ordered(self._parse_opclass)

        if not self._match(TokenType.WITH):
            return this

        op = self._parse_var(any_token=True)

        return self.expression(exp.WithOperator, this=this, op=op)

    def _parse_wrapped_options(self) -> t.List[t.Optional[exp.Expression]]:
        self._match(TokenType.EQ)
        self._match(TokenType.L_PAREN)

        opts: t.List[t.Optional[exp.Expression]] = []
        while self._curr and not self._match(TokenType.R_PAREN):
            if self._match_text_seq("FORMAT_NAME", "="):
                # The FORMAT_NAME can be set to an identifier for Snowflake and T-SQL,
                # so we parse it separately to use _parse_field()
                prop = self.expression(
                    exp.Property, this=exp.var("FORMAT_NAME"), value=self._parse_field()
                )
                opts.append(prop)
            else:
                opts.append(self._parse_property())

            self._match(TokenType.COMMA)

        return opts

    def _parse_copy_parameters(self) -> t.List[exp.CopyParameter]:
        sep = TokenType.COMMA if self.dialect.COPY_PARAMS_ARE_CSV else None

        options = []
        while self._curr and not self._match(TokenType.R_PAREN, advance=False):
            option = self._parse_var(any_token=True)
            prev = self._prev.text.upper()

            # Different dialects might separate options and values by white space, "=" and "AS"
            self._match(TokenType.EQ)
            self._match(TokenType.ALIAS)

            param = self.expression(exp.CopyParameter, this=option)

            if prev in self.COPY_INTO_VARLEN_OPTIONS and self._match(
                TokenType.L_PAREN, advance=False
            ):
                # Snowflake FILE_FORMAT case, Databricks COPY & FORMAT options
                param.set("expressions", self._parse_wrapped_options())
            elif prev == "FILE_FORMAT":
                # T-SQL's external file format case
                param.set("expression", self._parse_field())
            else:
                param.set("expression", self._parse_unquoted_field())

            options.append(param)
            self._match(sep)

        return options

    def _parse_credentials(self) -> t.Optional[exp.Credentials]:
        expr = self.expression(exp.Credentials)

        if self._match_text_seq("STORAGE_INTEGRATION", "="):
            expr.set("storage", self._parse_field())
        if self._match_text_seq("CREDENTIALS"):
            # Snowflake case: CREDENTIALS = (...), Redshift case: CREDENTIALS <string>
            creds = (
                self._parse_wrapped_options() if self._match(TokenType.EQ) else self._parse_field()
            )
            expr.set("credentials", creds)
        if self._match_text_seq("ENCRYPTION"):
            expr.set("encryption", self._parse_wrapped_options())
        if self._match_text_seq("IAM_ROLE"):
            expr.set("iam_role", self._parse_field())
        if self._match_text_seq("REGION"):
            expr.set("region", self._parse_field())

        return expr

    def _parse_file_location(self) -> t.Optional[exp.Expression]:
        return self._parse_field()

    def _parse_copy(self) -> exp.Copy | exp.Command:
        start = self._prev

        self._match(TokenType.INTO)

        this = (
            self._parse_select(nested=True, parse_subquery_alias=False)
            if self._match(TokenType.L_PAREN, advance=False)
            else self._parse_table(schema=True)
        )

        kind = self._match(TokenType.FROM) or not self._match_text_seq("TO")

        files = self._parse_csv(self._parse_file_location)
        credentials = self._parse_credentials()

        self._match_text_seq("WITH")

        params = self._parse_wrapped(self._parse_copy_parameters, optional=True)

        # Fallback case
        if self._curr:
            return self._parse_as_command(start)

        return self.expression(
            exp.Copy,
            this=this,
            kind=kind,
            credentials=credentials,
            files=files,
            params=params,
        )

    def _parse_normalize(self) -> exp.Normalize:
        return self.expression(
            exp.Normalize,
            this=self._parse_bitwise(),
            form=self._match(TokenType.COMMA) and self._parse_var(),
        )

    def _parse_star_ops(self) -> t.Optional[exp.Expression]:
        if self._match_text_seq("COLUMNS", "(", advance=False):
            this = self._parse_function()
            if isinstance(this, exp.Columns):
                this.set("unpack", True)
            return this

        return self.expression(
            exp.Star,
            **{  # type: ignore
                "except": self._parse_star_op("EXCEPT", "EXCLUDE"),
                "replace": self._parse_star_op("REPLACE"),
                "rename": self._parse_star_op("RENAME"),
            },
        )

    def _parse_grant_privilege(self) -> t.Optional[exp.GrantPrivilege]:
        privilege_parts = []

        # Keep consuming consecutive keywords until comma (end of this privilege) or ON
        # (end of privilege list) or L_PAREN (start of column list) are met
        while self._curr and not self._match_set(self.PRIVILEGE_FOLLOW_TOKENS, advance=False):
            privilege_parts.append(self._curr.text.upper())
            self._advance()

        this = exp.var(" ".join(privilege_parts))
        expressions = (
            self._parse_wrapped_csv(self._parse_column)
            if self._match(TokenType.L_PAREN, advance=False)
            else None
        )

        return self.expression(exp.GrantPrivilege, this=this, expressions=expressions)

    def _parse_grant_principal(self) -> t.Optional[exp.GrantPrincipal]:
        kind = self._match_texts(("ROLE", "GROUP")) and self._prev.text.upper()
        principal = self._parse_id_var()

        if not principal:
            return None

        return self.expression(exp.GrantPrincipal, this=principal, kind=kind)

    def _parse_grant(self) -> exp.Grant | exp.Command:
        start = self._prev

        privileges = self._parse_csv(self._parse_grant_privilege)

        self._match(TokenType.ON)
        kind = self._match_set(self.CREATABLES) and self._prev.text.upper()

        # Attempt to parse the securable e.g. MySQL allows names
        # such as "foo.*", "*.*" which are not easily parseable yet
        securable = self._try_parse(self._parse_table_parts)

        if not securable or not self._match_text_seq("TO"):
            return self._parse_as_command(start)

        principals = self._parse_csv(self._parse_grant_principal)

        grant_option = self._match_text_seq("WITH", "GRANT", "OPTION")

        if self._curr:
            return self._parse_as_command(start)

        return self.expression(
            exp.Grant,
            privileges=privileges,
            kind=kind,
            securable=securable,
            principals=principals,
            grant_option=grant_option,
        )

    def _parse_overlay(self) -> exp.Overlay:
        return self.expression(
            exp.Overlay,
            **{  # type: ignore
                "this": self._parse_bitwise(),
                "expression": self._match_text_seq("PLACING") and self._parse_bitwise(),
                "from": self._match_text_seq("FROM") and self._parse_bitwise(),
                "for": self._match_text_seq("FOR") and self._parse_bitwise(),
            },
        )
