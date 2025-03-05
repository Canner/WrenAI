from __future__ import annotations

import os
import typing as t
from enum import auto

from sqlglot.errors import SqlglotError, TokenError
from sqlglot.helper import AutoName
from sqlglot.trie import TrieResult, in_trie, new_trie

if t.TYPE_CHECKING:
    from sqlglot.dialects.dialect import DialectType


try:
    from sqlglotrs import (  # type: ignore
        Tokenizer as RsTokenizer,
        TokenizerDialectSettings as RsTokenizerDialectSettings,
        TokenizerSettings as RsTokenizerSettings,
        TokenTypeSettings as RsTokenTypeSettings,
    )

    USE_RS_TOKENIZER = os.environ.get("SQLGLOTRS_TOKENIZER", "1") == "1"
except ImportError:
    USE_RS_TOKENIZER = False


class TokenType(AutoName):
    L_PAREN = auto()
    R_PAREN = auto()
    L_BRACKET = auto()
    R_BRACKET = auto()
    L_BRACE = auto()
    R_BRACE = auto()
    COMMA = auto()
    DOT = auto()
    DASH = auto()
    PLUS = auto()
    COLON = auto()
    DCOLON = auto()
    DQMARK = auto()
    SEMICOLON = auto()
    STAR = auto()
    BACKSLASH = auto()
    SLASH = auto()
    LT = auto()
    LTE = auto()
    GT = auto()
    GTE = auto()
    NOT = auto()
    EQ = auto()
    NEQ = auto()
    NULLSAFE_EQ = auto()
    COLON_EQ = auto()
    AND = auto()
    OR = auto()
    AMP = auto()
    DPIPE = auto()
    PIPE = auto()
    PIPE_SLASH = auto()
    DPIPE_SLASH = auto()
    CARET = auto()
    CARET_AT = auto()
    TILDA = auto()
    ARROW = auto()
    DARROW = auto()
    FARROW = auto()
    HASH = auto()
    HASH_ARROW = auto()
    DHASH_ARROW = auto()
    LR_ARROW = auto()
    DAT = auto()
    LT_AT = auto()
    AT_GT = auto()
    DOLLAR = auto()
    PARAMETER = auto()
    SESSION_PARAMETER = auto()
    DAMP = auto()
    XOR = auto()
    DSTAR = auto()

    BLOCK_START = auto()
    BLOCK_END = auto()

    SPACE = auto()
    BREAK = auto()

    STRING = auto()
    NUMBER = auto()
    IDENTIFIER = auto()
    DATABASE = auto()
    COLUMN = auto()
    COLUMN_DEF = auto()
    SCHEMA = auto()
    TABLE = auto()
    WAREHOUSE = auto()
    STREAMLIT = auto()
    VAR = auto()
    BIT_STRING = auto()
    HEX_STRING = auto()
    BYTE_STRING = auto()
    NATIONAL_STRING = auto()
    RAW_STRING = auto()
    HEREDOC_STRING = auto()
    UNICODE_STRING = auto()

    # types
    BIT = auto()
    BOOLEAN = auto()
    TINYINT = auto()
    UTINYINT = auto()
    SMALLINT = auto()
    USMALLINT = auto()
    MEDIUMINT = auto()
    UMEDIUMINT = auto()
    INT = auto()
    UINT = auto()
    BIGINT = auto()
    UBIGINT = auto()
    INT128 = auto()
    UINT128 = auto()
    INT256 = auto()
    UINT256 = auto()
    FLOAT = auto()
    DOUBLE = auto()
    DECIMAL = auto()
    DECIMAL32 = auto()
    DECIMAL64 = auto()
    DECIMAL128 = auto()
    DECIMAL256 = auto()
    UDECIMAL = auto()
    BIGDECIMAL = auto()
    CHAR = auto()
    NCHAR = auto()
    VARCHAR = auto()
    NVARCHAR = auto()
    BPCHAR = auto()
    TEXT = auto()
    MEDIUMTEXT = auto()
    LONGTEXT = auto()
    MEDIUMBLOB = auto()
    LONGBLOB = auto()
    TINYBLOB = auto()
    TINYTEXT = auto()
    NAME = auto()
    BINARY = auto()
    VARBINARY = auto()
    JSON = auto()
    JSONB = auto()
    TIME = auto()
    TIMETZ = auto()
    TIMESTAMP = auto()
    TIMESTAMPTZ = auto()
    TIMESTAMPLTZ = auto()
    TIMESTAMPNTZ = auto()
    TIMESTAMP_S = auto()
    TIMESTAMP_MS = auto()
    TIMESTAMP_NS = auto()
    DATETIME = auto()
    DATETIME64 = auto()
    DATE = auto()
    DATE32 = auto()
    INT4RANGE = auto()
    INT4MULTIRANGE = auto()
    INT8RANGE = auto()
    INT8MULTIRANGE = auto()
    NUMRANGE = auto()
    NUMMULTIRANGE = auto()
    TSRANGE = auto()
    TSMULTIRANGE = auto()
    TSTZRANGE = auto()
    TSTZMULTIRANGE = auto()
    DATERANGE = auto()
    DATEMULTIRANGE = auto()
    UUID = auto()
    GEOGRAPHY = auto()
    NULLABLE = auto()
    GEOMETRY = auto()
    POINT = auto()
    RING = auto()
    LINESTRING = auto()
    MULTILINESTRING = auto()
    POLYGON = auto()
    MULTIPOLYGON = auto()
    HLLSKETCH = auto()
    HSTORE = auto()
    SUPER = auto()
    SERIAL = auto()
    SMALLSERIAL = auto()
    BIGSERIAL = auto()
    XML = auto()
    YEAR = auto()
    UNIQUEIDENTIFIER = auto()
    USERDEFINED = auto()
    MONEY = auto()
    SMALLMONEY = auto()
    ROWVERSION = auto()
    IMAGE = auto()
    VARIANT = auto()
    OBJECT = auto()
    INET = auto()
    IPADDRESS = auto()
    IPPREFIX = auto()
    IPV4 = auto()
    IPV6 = auto()
    ENUM = auto()
    ENUM8 = auto()
    ENUM16 = auto()
    FIXEDSTRING = auto()
    LOWCARDINALITY = auto()
    NESTED = auto()
    AGGREGATEFUNCTION = auto()
    SIMPLEAGGREGATEFUNCTION = auto()
    TDIGEST = auto()
    UNKNOWN = auto()
    VECTOR = auto()

    # keywords
    ALIAS = auto()
    ALTER = auto()
    ALWAYS = auto()
    ALL = auto()
    ANTI = auto()
    ANY = auto()
    APPLY = auto()
    ARRAY = auto()
    ASC = auto()
    ASOF = auto()
    ATTACH = auto()
    AUTO_INCREMENT = auto()
    BEGIN = auto()
    BETWEEN = auto()
    BULK_COLLECT_INTO = auto()
    CACHE = auto()
    CASE = auto()
    CHARACTER_SET = auto()
    CLUSTER_BY = auto()
    COLLATE = auto()
    COMMAND = auto()
    COMMENT = auto()
    COMMIT = auto()
    CONNECT_BY = auto()
    CONSTRAINT = auto()
    COPY = auto()
    CREATE = auto()
    CROSS = auto()
    CUBE = auto()
    CURRENT_DATE = auto()
    CURRENT_DATETIME = auto()
    CURRENT_TIME = auto()
    CURRENT_TIMESTAMP = auto()
    CURRENT_USER = auto()
    DECLARE = auto()
    DEFAULT = auto()
    DELETE = auto()
    DESC = auto()
    DESCRIBE = auto()
    DETACH = auto()
    DICTIONARY = auto()
    DISTINCT = auto()
    DISTRIBUTE_BY = auto()
    DIV = auto()
    DROP = auto()
    ELSE = auto()
    END = auto()
    ESCAPE = auto()
    EXCEPT = auto()
    EXECUTE = auto()
    EXISTS = auto()
    FALSE = auto()
    FETCH = auto()
    FILTER = auto()
    FINAL = auto()
    FIRST = auto()
    FOR = auto()
    FORCE = auto()
    FOREIGN_KEY = auto()
    FORMAT = auto()
    FROM = auto()
    FULL = auto()
    FUNCTION = auto()
    GLOB = auto()
    GLOBAL = auto()
    GRANT = auto()
    GROUP_BY = auto()
    GROUPING_SETS = auto()
    HAVING = auto()
    HINT = auto()
    IGNORE = auto()
    ILIKE = auto()
    ILIKE_ANY = auto()
    IN = auto()
    INDEX = auto()
    INNER = auto()
    INSERT = auto()
    INTERSECT = auto()
    INTERVAL = auto()
    INTO = auto()
    INTRODUCER = auto()
    IRLIKE = auto()
    IS = auto()
    ISNULL = auto()
    JOIN = auto()
    JOIN_MARKER = auto()
    KEEP = auto()
    KEY = auto()
    KILL = auto()
    LANGUAGE = auto()
    LATERAL = auto()
    LEFT = auto()
    LIKE = auto()
    LIKE_ANY = auto()
    LIMIT = auto()
    LIST = auto()
    LOAD = auto()
    LOCK = auto()
    MAP = auto()
    MATCH_CONDITION = auto()
    MATCH_RECOGNIZE = auto()
    MEMBER_OF = auto()
    MERGE = auto()
    MOD = auto()
    MODEL = auto()
    NATURAL = auto()
    NEXT = auto()
    NOTNULL = auto()
    NULL = auto()
    OBJECT_IDENTIFIER = auto()
    OFFSET = auto()
    ON = auto()
    ONLY = auto()
    OPERATOR = auto()
    ORDER_BY = auto()
    ORDER_SIBLINGS_BY = auto()
    ORDERED = auto()
    ORDINALITY = auto()
    OUTER = auto()
    OVER = auto()
    OVERLAPS = auto()
    OVERWRITE = auto()
    PARTITION = auto()
    PARTITION_BY = auto()
    PERCENT = auto()
    PIVOT = auto()
    PLACEHOLDER = auto()
    POSITIONAL = auto()
    PRAGMA = auto()
    PREWHERE = auto()
    PRIMARY_KEY = auto()
    PROCEDURE = auto()
    PROPERTIES = auto()
    PSEUDO_TYPE = auto()
    QUALIFY = auto()
    QUOTE = auto()
    RANGE = auto()
    RECURSIVE = auto()
    REFRESH = auto()
    RENAME = auto()
    REPLACE = auto()
    RETURNING = auto()
    REFERENCES = auto()
    RIGHT = auto()
    RLIKE = auto()
    ROLLBACK = auto()
    ROLLUP = auto()
    ROW = auto()
    ROWS = auto()
    SELECT = auto()
    SEMI = auto()
    SEPARATOR = auto()
    SEQUENCE = auto()
    SERDE_PROPERTIES = auto()
    SET = auto()
    SETTINGS = auto()
    SHOW = auto()
    SIMILAR_TO = auto()
    SOME = auto()
    SORT_BY = auto()
    START_WITH = auto()
    STORAGE_INTEGRATION = auto()
    STRAIGHT_JOIN = auto()
    STRUCT = auto()
    SUMMARIZE = auto()
    TABLE_SAMPLE = auto()
    TAG = auto()
    TEMPORARY = auto()
    TOP = auto()
    THEN = auto()
    TRUE = auto()
    TRUNCATE = auto()
    UNCACHE = auto()
    UNION = auto()
    UNNEST = auto()
    UNPIVOT = auto()
    UPDATE = auto()
    USE = auto()
    USING = auto()
    VALUES = auto()
    VIEW = auto()
    VOLATILE = auto()
    WHEN = auto()
    WHERE = auto()
    WINDOW = auto()
    WITH = auto()
    UNIQUE = auto()
    VERSION_SNAPSHOT = auto()
    TIMESTAMP_SNAPSHOT = auto()
    OPTION = auto()
    SINK = auto()
    SOURCE = auto()


_ALL_TOKEN_TYPES = list(TokenType)
_TOKEN_TYPE_TO_INDEX = {token_type: i for i, token_type in enumerate(_ALL_TOKEN_TYPES)}


class Token:
    __slots__ = ("token_type", "text", "line", "col", "start", "end", "comments")

    @classmethod
    def number(cls, number: int) -> Token:
        """Returns a NUMBER token with `number` as its text."""
        return cls(TokenType.NUMBER, str(number))

    @classmethod
    def string(cls, string: str) -> Token:
        """Returns a STRING token with `string` as its text."""
        return cls(TokenType.STRING, string)

    @classmethod
    def identifier(cls, identifier: str) -> Token:
        """Returns an IDENTIFIER token with `identifier` as its text."""
        return cls(TokenType.IDENTIFIER, identifier)

    @classmethod
    def var(cls, var: str) -> Token:
        """Returns an VAR token with `var` as its text."""
        return cls(TokenType.VAR, var)

    def __init__(
        self,
        token_type: TokenType,
        text: str,
        line: int = 1,
        col: int = 1,
        start: int = 0,
        end: int = 0,
        comments: t.Optional[t.List[str]] = None,
    ) -> None:
        """Token initializer.

        Args:
            token_type: The TokenType Enum.
            text: The text of the token.
            line: The line that the token ends on.
            col: The column that the token ends on.
            start: The start index of the token.
            end: The ending index of the token.
            comments: The comments to attach to the token.
        """
        self.token_type = token_type
        self.text = text
        self.line = line
        self.col = col
        self.start = start
        self.end = end
        self.comments = [] if comments is None else comments

    def __repr__(self) -> str:
        attributes = ", ".join(f"{k}: {getattr(self, k)}" for k in self.__slots__)
        return f"<Token {attributes}>"


class _Tokenizer(type):
    def __new__(cls, clsname, bases, attrs):
        klass = super().__new__(cls, clsname, bases, attrs)

        def _convert_quotes(arr: t.List[str | t.Tuple[str, str]]) -> t.Dict[str, str]:
            return dict(
                (item, item) if isinstance(item, str) else (item[0], item[1]) for item in arr
            )

        def _quotes_to_format(
            token_type: TokenType, arr: t.List[str | t.Tuple[str, str]]
        ) -> t.Dict[str, t.Tuple[str, TokenType]]:
            return {k: (v, token_type) for k, v in _convert_quotes(arr).items()}

        klass._QUOTES = _convert_quotes(klass.QUOTES)
        klass._IDENTIFIERS = _convert_quotes(klass.IDENTIFIERS)

        klass._FORMAT_STRINGS = {
            **{
                p + s: (e, TokenType.NATIONAL_STRING)
                for s, e in klass._QUOTES.items()
                for p in ("n", "N")
            },
            **_quotes_to_format(TokenType.BIT_STRING, klass.BIT_STRINGS),
            **_quotes_to_format(TokenType.BYTE_STRING, klass.BYTE_STRINGS),
            **_quotes_to_format(TokenType.HEX_STRING, klass.HEX_STRINGS),
            **_quotes_to_format(TokenType.RAW_STRING, klass.RAW_STRINGS),
            **_quotes_to_format(TokenType.HEREDOC_STRING, klass.HEREDOC_STRINGS),
            **_quotes_to_format(TokenType.UNICODE_STRING, klass.UNICODE_STRINGS),
        }

        klass._STRING_ESCAPES = set(klass.STRING_ESCAPES)
        klass._IDENTIFIER_ESCAPES = set(klass.IDENTIFIER_ESCAPES)
        klass._COMMENTS = {
            **dict(
                (comment, None) if isinstance(comment, str) else (comment[0], comment[1])
                for comment in klass.COMMENTS
            ),
            "{#": "#}",  # Ensure Jinja comments are tokenized correctly in all dialects
        }
        if klass.HINT_START in klass.KEYWORDS:
            klass._COMMENTS[klass.HINT_START] = "*/"

        klass._KEYWORD_TRIE = new_trie(
            key.upper()
            for key in (
                *klass.KEYWORDS,
                *klass._COMMENTS,
                *klass._QUOTES,
                *klass._FORMAT_STRINGS,
            )
            if " " in key or any(single in key for single in klass.SINGLE_TOKENS)
        )

        if USE_RS_TOKENIZER:
            settings = RsTokenizerSettings(
                white_space={k: _TOKEN_TYPE_TO_INDEX[v] for k, v in klass.WHITE_SPACE.items()},
                single_tokens={k: _TOKEN_TYPE_TO_INDEX[v] for k, v in klass.SINGLE_TOKENS.items()},
                keywords={k: _TOKEN_TYPE_TO_INDEX[v] for k, v in klass.KEYWORDS.items()},
                numeric_literals=klass.NUMERIC_LITERALS,
                identifiers=klass._IDENTIFIERS,
                identifier_escapes=klass._IDENTIFIER_ESCAPES,
                string_escapes=klass._STRING_ESCAPES,
                quotes=klass._QUOTES,
                format_strings={
                    k: (v1, _TOKEN_TYPE_TO_INDEX[v2])
                    for k, (v1, v2) in klass._FORMAT_STRINGS.items()
                },
                has_bit_strings=bool(klass.BIT_STRINGS),
                has_hex_strings=bool(klass.HEX_STRINGS),
                comments=klass._COMMENTS,
                var_single_tokens=klass.VAR_SINGLE_TOKENS,
                commands={_TOKEN_TYPE_TO_INDEX[v] for v in klass.COMMANDS},
                command_prefix_tokens={
                    _TOKEN_TYPE_TO_INDEX[v] for v in klass.COMMAND_PREFIX_TOKENS
                },
                heredoc_tag_is_identifier=klass.HEREDOC_TAG_IS_IDENTIFIER,
                string_escapes_allowed_in_raw_strings=klass.STRING_ESCAPES_ALLOWED_IN_RAW_STRINGS,
                nested_comments=klass.NESTED_COMMENTS,
                hint_start=klass.HINT_START,
                tokens_preceding_hint={
                    _TOKEN_TYPE_TO_INDEX[v] for v in klass.TOKENS_PRECEDING_HINT
                },
            )
            token_types = RsTokenTypeSettings(
                bit_string=_TOKEN_TYPE_TO_INDEX[TokenType.BIT_STRING],
                break_=_TOKEN_TYPE_TO_INDEX[TokenType.BREAK],
                dcolon=_TOKEN_TYPE_TO_INDEX[TokenType.DCOLON],
                heredoc_string=_TOKEN_TYPE_TO_INDEX[TokenType.HEREDOC_STRING],
                raw_string=_TOKEN_TYPE_TO_INDEX[TokenType.RAW_STRING],
                hex_string=_TOKEN_TYPE_TO_INDEX[TokenType.HEX_STRING],
                identifier=_TOKEN_TYPE_TO_INDEX[TokenType.IDENTIFIER],
                number=_TOKEN_TYPE_TO_INDEX[TokenType.NUMBER],
                parameter=_TOKEN_TYPE_TO_INDEX[TokenType.PARAMETER],
                semicolon=_TOKEN_TYPE_TO_INDEX[TokenType.SEMICOLON],
                string=_TOKEN_TYPE_TO_INDEX[TokenType.STRING],
                var=_TOKEN_TYPE_TO_INDEX[TokenType.VAR],
                heredoc_string_alternative=_TOKEN_TYPE_TO_INDEX[klass.HEREDOC_STRING_ALTERNATIVE],
                hint=_TOKEN_TYPE_TO_INDEX[TokenType.HINT],
            )
            klass._RS_TOKENIZER = RsTokenizer(settings, token_types)
        else:
            klass._RS_TOKENIZER = None

        return klass


class Tokenizer(metaclass=_Tokenizer):
    SINGLE_TOKENS = {
        "(": TokenType.L_PAREN,
        ")": TokenType.R_PAREN,
        "[": TokenType.L_BRACKET,
        "]": TokenType.R_BRACKET,
        "{": TokenType.L_BRACE,
        "}": TokenType.R_BRACE,
        "&": TokenType.AMP,
        "^": TokenType.CARET,
        ":": TokenType.COLON,
        ",": TokenType.COMMA,
        ".": TokenType.DOT,
        "-": TokenType.DASH,
        "=": TokenType.EQ,
        ">": TokenType.GT,
        "<": TokenType.LT,
        "%": TokenType.MOD,
        "!": TokenType.NOT,
        "|": TokenType.PIPE,
        "+": TokenType.PLUS,
        ";": TokenType.SEMICOLON,
        "/": TokenType.SLASH,
        "\\": TokenType.BACKSLASH,
        "*": TokenType.STAR,
        "~": TokenType.TILDA,
        "?": TokenType.PLACEHOLDER,
        "@": TokenType.PARAMETER,
        "#": TokenType.HASH,
        # Used for breaking a var like x'y' but nothing else the token type doesn't matter
        "'": TokenType.UNKNOWN,
        "`": TokenType.UNKNOWN,
        '"': TokenType.UNKNOWN,
    }

    BIT_STRINGS: t.List[str | t.Tuple[str, str]] = []
    BYTE_STRINGS: t.List[str | t.Tuple[str, str]] = []
    HEX_STRINGS: t.List[str | t.Tuple[str, str]] = []
    RAW_STRINGS: t.List[str | t.Tuple[str, str]] = []
    HEREDOC_STRINGS: t.List[str | t.Tuple[str, str]] = []
    UNICODE_STRINGS: t.List[str | t.Tuple[str, str]] = []
    IDENTIFIERS: t.List[str | t.Tuple[str, str]] = ['"']
    QUOTES: t.List[t.Tuple[str, str] | str] = ["'"]
    STRING_ESCAPES = ["'"]
    VAR_SINGLE_TOKENS: t.Set[str] = set()

    # The strings in this list can always be used as escapes, regardless of the surrounding
    # identifier delimiters. By default, the closing delimiter is assumed to also act as an
    # identifier escape, e.g. if we use double-quotes, then they also act as escapes: "x"""
    IDENTIFIER_ESCAPES: t.List[str] = []

    # Whether the heredoc tags follow the same lexical rules as unquoted identifiers
    HEREDOC_TAG_IS_IDENTIFIER = False

    # Token that we'll generate as a fallback if the heredoc prefix doesn't correspond to a heredoc
    HEREDOC_STRING_ALTERNATIVE = TokenType.VAR

    # Whether string escape characters function as such when placed within raw strings
    STRING_ESCAPES_ALLOWED_IN_RAW_STRINGS = True

    NESTED_COMMENTS = True

    HINT_START = "/*+"

    TOKENS_PRECEDING_HINT = {TokenType.SELECT, TokenType.INSERT, TokenType.UPDATE, TokenType.DELETE}

    # Autofilled
    _COMMENTS: t.Dict[str, str] = {}
    _FORMAT_STRINGS: t.Dict[str, t.Tuple[str, TokenType]] = {}
    _IDENTIFIERS: t.Dict[str, str] = {}
    _IDENTIFIER_ESCAPES: t.Set[str] = set()
    _QUOTES: t.Dict[str, str] = {}
    _STRING_ESCAPES: t.Set[str] = set()
    _KEYWORD_TRIE: t.Dict = {}
    _RS_TOKENIZER: t.Optional[t.Any] = None

    KEYWORDS: t.Dict[str, TokenType] = {
        **{f"{{%{postfix}": TokenType.BLOCK_START for postfix in ("", "+", "-")},
        **{f"{prefix}%}}": TokenType.BLOCK_END for prefix in ("", "+", "-")},
        **{f"{{{{{postfix}": TokenType.BLOCK_START for postfix in ("+", "-")},
        **{f"{prefix}}}}}": TokenType.BLOCK_END for prefix in ("+", "-")},
        HINT_START: TokenType.HINT,
        "==": TokenType.EQ,
        "::": TokenType.DCOLON,
        "||": TokenType.DPIPE,
        ">=": TokenType.GTE,
        "<=": TokenType.LTE,
        "<>": TokenType.NEQ,
        "!=": TokenType.NEQ,
        ":=": TokenType.COLON_EQ,
        "<=>": TokenType.NULLSAFE_EQ,
        "->": TokenType.ARROW,
        "->>": TokenType.DARROW,
        "=>": TokenType.FARROW,
        "#>": TokenType.HASH_ARROW,
        "#>>": TokenType.DHASH_ARROW,
        "<->": TokenType.LR_ARROW,
        "&&": TokenType.DAMP,
        "??": TokenType.DQMARK,
        "~~~": TokenType.GLOB,
        "~~": TokenType.LIKE,
        "~~*": TokenType.ILIKE,
        "~*": TokenType.IRLIKE,
        "ALL": TokenType.ALL,
        "ALWAYS": TokenType.ALWAYS,
        "AND": TokenType.AND,
        "ANTI": TokenType.ANTI,
        "ANY": TokenType.ANY,
        "ASC": TokenType.ASC,
        "AS": TokenType.ALIAS,
        "ASOF": TokenType.ASOF,
        "AUTOINCREMENT": TokenType.AUTO_INCREMENT,
        "AUTO_INCREMENT": TokenType.AUTO_INCREMENT,
        "BEGIN": TokenType.BEGIN,
        "BETWEEN": TokenType.BETWEEN,
        "CACHE": TokenType.CACHE,
        "UNCACHE": TokenType.UNCACHE,
        "CASE": TokenType.CASE,
        "CHARACTER SET": TokenType.CHARACTER_SET,
        "CLUSTER BY": TokenType.CLUSTER_BY,
        "COLLATE": TokenType.COLLATE,
        "COLUMN": TokenType.COLUMN,
        "COMMIT": TokenType.COMMIT,
        "CONNECT BY": TokenType.CONNECT_BY,
        "CONSTRAINT": TokenType.CONSTRAINT,
        "COPY": TokenType.COPY,
        "CREATE": TokenType.CREATE,
        "CROSS": TokenType.CROSS,
        "CUBE": TokenType.CUBE,
        "CURRENT_DATE": TokenType.CURRENT_DATE,
        "CURRENT_TIME": TokenType.CURRENT_TIME,
        "CURRENT_TIMESTAMP": TokenType.CURRENT_TIMESTAMP,
        "CURRENT_USER": TokenType.CURRENT_USER,
        "DATABASE": TokenType.DATABASE,
        "DEFAULT": TokenType.DEFAULT,
        "DELETE": TokenType.DELETE,
        "DESC": TokenType.DESC,
        "DESCRIBE": TokenType.DESCRIBE,
        "DISTINCT": TokenType.DISTINCT,
        "DISTRIBUTE BY": TokenType.DISTRIBUTE_BY,
        "DIV": TokenType.DIV,
        "DROP": TokenType.DROP,
        "ELSE": TokenType.ELSE,
        "END": TokenType.END,
        "ENUM": TokenType.ENUM,
        "ESCAPE": TokenType.ESCAPE,
        "EXCEPT": TokenType.EXCEPT,
        "EXECUTE": TokenType.EXECUTE,
        "EXISTS": TokenType.EXISTS,
        "FALSE": TokenType.FALSE,
        "FETCH": TokenType.FETCH,
        "FILTER": TokenType.FILTER,
        "FIRST": TokenType.FIRST,
        "FULL": TokenType.FULL,
        "FUNCTION": TokenType.FUNCTION,
        "FOR": TokenType.FOR,
        "FOREIGN KEY": TokenType.FOREIGN_KEY,
        "FORMAT": TokenType.FORMAT,
        "FROM": TokenType.FROM,
        "GEOGRAPHY": TokenType.GEOGRAPHY,
        "GEOMETRY": TokenType.GEOMETRY,
        "GLOB": TokenType.GLOB,
        "GROUP BY": TokenType.GROUP_BY,
        "GROUPING SETS": TokenType.GROUPING_SETS,
        "HAVING": TokenType.HAVING,
        "ILIKE": TokenType.ILIKE,
        "IN": TokenType.IN,
        "INDEX": TokenType.INDEX,
        "INET": TokenType.INET,
        "INNER": TokenType.INNER,
        "INSERT": TokenType.INSERT,
        "INTERVAL": TokenType.INTERVAL,
        "INTERSECT": TokenType.INTERSECT,
        "INTO": TokenType.INTO,
        "IS": TokenType.IS,
        "ISNULL": TokenType.ISNULL,
        "JOIN": TokenType.JOIN,
        "KEEP": TokenType.KEEP,
        "KILL": TokenType.KILL,
        "LATERAL": TokenType.LATERAL,
        "LEFT": TokenType.LEFT,
        "LIKE": TokenType.LIKE,
        "LIMIT": TokenType.LIMIT,
        "LOAD": TokenType.LOAD,
        "LOCK": TokenType.LOCK,
        "MERGE": TokenType.MERGE,
        "NATURAL": TokenType.NATURAL,
        "NEXT": TokenType.NEXT,
        "NOT": TokenType.NOT,
        "NOTNULL": TokenType.NOTNULL,
        "NULL": TokenType.NULL,
        "OBJECT": TokenType.OBJECT,
        "OFFSET": TokenType.OFFSET,
        "ON": TokenType.ON,
        "OR": TokenType.OR,
        "XOR": TokenType.XOR,
        "ORDER BY": TokenType.ORDER_BY,
        "ORDINALITY": TokenType.ORDINALITY,
        "OUTER": TokenType.OUTER,
        "OVER": TokenType.OVER,
        "OVERLAPS": TokenType.OVERLAPS,
        "OVERWRITE": TokenType.OVERWRITE,
        "PARTITION": TokenType.PARTITION,
        "PARTITION BY": TokenType.PARTITION_BY,
        "PARTITIONED BY": TokenType.PARTITION_BY,
        "PARTITIONED_BY": TokenType.PARTITION_BY,
        "PERCENT": TokenType.PERCENT,
        "PIVOT": TokenType.PIVOT,
        "PRAGMA": TokenType.PRAGMA,
        "PRIMARY KEY": TokenType.PRIMARY_KEY,
        "PROCEDURE": TokenType.PROCEDURE,
        "QUALIFY": TokenType.QUALIFY,
        "RANGE": TokenType.RANGE,
        "RECURSIVE": TokenType.RECURSIVE,
        "REGEXP": TokenType.RLIKE,
        "RENAME": TokenType.RENAME,
        "REPLACE": TokenType.REPLACE,
        "RETURNING": TokenType.RETURNING,
        "REFERENCES": TokenType.REFERENCES,
        "RIGHT": TokenType.RIGHT,
        "RLIKE": TokenType.RLIKE,
        "ROLLBACK": TokenType.ROLLBACK,
        "ROLLUP": TokenType.ROLLUP,
        "ROW": TokenType.ROW,
        "ROWS": TokenType.ROWS,
        "SCHEMA": TokenType.SCHEMA,
        "SELECT": TokenType.SELECT,
        "SEMI": TokenType.SEMI,
        "SET": TokenType.SET,
        "SETTINGS": TokenType.SETTINGS,
        "SHOW": TokenType.SHOW,
        "SIMILAR TO": TokenType.SIMILAR_TO,
        "SOME": TokenType.SOME,
        "SORT BY": TokenType.SORT_BY,
        "START WITH": TokenType.START_WITH,
        "STRAIGHT_JOIN": TokenType.STRAIGHT_JOIN,
        "TABLE": TokenType.TABLE,
        "TABLESAMPLE": TokenType.TABLE_SAMPLE,
        "TEMP": TokenType.TEMPORARY,
        "TEMPORARY": TokenType.TEMPORARY,
        "THEN": TokenType.THEN,
        "TRUE": TokenType.TRUE,
        "TRUNCATE": TokenType.TRUNCATE,
        "UNION": TokenType.UNION,
        "UNKNOWN": TokenType.UNKNOWN,
        "UNNEST": TokenType.UNNEST,
        "UNPIVOT": TokenType.UNPIVOT,
        "UPDATE": TokenType.UPDATE,
        "USE": TokenType.USE,
        "USING": TokenType.USING,
        "UUID": TokenType.UUID,
        "VALUES": TokenType.VALUES,
        "VIEW": TokenType.VIEW,
        "VOLATILE": TokenType.VOLATILE,
        "WHEN": TokenType.WHEN,
        "WHERE": TokenType.WHERE,
        "WINDOW": TokenType.WINDOW,
        "WITH": TokenType.WITH,
        "APPLY": TokenType.APPLY,
        "ARRAY": TokenType.ARRAY,
        "BIT": TokenType.BIT,
        "BOOL": TokenType.BOOLEAN,
        "BOOLEAN": TokenType.BOOLEAN,
        "BYTE": TokenType.TINYINT,
        "MEDIUMINT": TokenType.MEDIUMINT,
        "INT1": TokenType.TINYINT,
        "TINYINT": TokenType.TINYINT,
        "INT16": TokenType.SMALLINT,
        "SHORT": TokenType.SMALLINT,
        "SMALLINT": TokenType.SMALLINT,
        "INT128": TokenType.INT128,
        "HUGEINT": TokenType.INT128,
        "UHUGEINT": TokenType.UINT128,
        "INT2": TokenType.SMALLINT,
        "INTEGER": TokenType.INT,
        "INT": TokenType.INT,
        "INT4": TokenType.INT,
        "INT32": TokenType.INT,
        "INT64": TokenType.BIGINT,
        "LONG": TokenType.BIGINT,
        "BIGINT": TokenType.BIGINT,
        "INT8": TokenType.TINYINT,
        "UINT": TokenType.UINT,
        "DEC": TokenType.DECIMAL,
        "DECIMAL": TokenType.DECIMAL,
        "DECIMAL32": TokenType.DECIMAL32,
        "DECIMAL64": TokenType.DECIMAL64,
        "DECIMAL128": TokenType.DECIMAL128,
        "DECIMAL256": TokenType.DECIMAL256,
        "BIGDECIMAL": TokenType.BIGDECIMAL,
        "BIGNUMERIC": TokenType.BIGDECIMAL,
        "LIST": TokenType.LIST,
        "MAP": TokenType.MAP,
        "NULLABLE": TokenType.NULLABLE,
        "NUMBER": TokenType.DECIMAL,
        "NUMERIC": TokenType.DECIMAL,
        "FIXED": TokenType.DECIMAL,
        "REAL": TokenType.FLOAT,
        "FLOAT": TokenType.FLOAT,
        "FLOAT4": TokenType.FLOAT,
        "FLOAT8": TokenType.DOUBLE,
        "DOUBLE": TokenType.DOUBLE,
        "DOUBLE PRECISION": TokenType.DOUBLE,
        "JSON": TokenType.JSON,
        "JSONB": TokenType.JSONB,
        "CHAR": TokenType.CHAR,
        "CHARACTER": TokenType.CHAR,
        "NCHAR": TokenType.NCHAR,
        "VARCHAR": TokenType.VARCHAR,
        "VARCHAR2": TokenType.VARCHAR,
        "NVARCHAR": TokenType.NVARCHAR,
        "NVARCHAR2": TokenType.NVARCHAR,
        "BPCHAR": TokenType.BPCHAR,
        "STR": TokenType.TEXT,
        "STRING": TokenType.TEXT,
        "TEXT": TokenType.TEXT,
        "LONGTEXT": TokenType.LONGTEXT,
        "MEDIUMTEXT": TokenType.MEDIUMTEXT,
        "TINYTEXT": TokenType.TINYTEXT,
        "CLOB": TokenType.TEXT,
        "LONGVARCHAR": TokenType.TEXT,
        "BINARY": TokenType.BINARY,
        "BLOB": TokenType.VARBINARY,
        "LONGBLOB": TokenType.LONGBLOB,
        "MEDIUMBLOB": TokenType.MEDIUMBLOB,
        "TINYBLOB": TokenType.TINYBLOB,
        "BYTEA": TokenType.VARBINARY,
        "VARBINARY": TokenType.VARBINARY,
        "TIME": TokenType.TIME,
        "TIMETZ": TokenType.TIMETZ,
        "TIMESTAMP": TokenType.TIMESTAMP,
        "TIMESTAMPTZ": TokenType.TIMESTAMPTZ,
        "TIMESTAMPLTZ": TokenType.TIMESTAMPLTZ,
        "TIMESTAMP_LTZ": TokenType.TIMESTAMPLTZ,
        "TIMESTAMPNTZ": TokenType.TIMESTAMPNTZ,
        "TIMESTAMP_NTZ": TokenType.TIMESTAMPNTZ,
        "DATE": TokenType.DATE,
        "DATETIME": TokenType.DATETIME,
        "INT4RANGE": TokenType.INT4RANGE,
        "INT4MULTIRANGE": TokenType.INT4MULTIRANGE,
        "INT8RANGE": TokenType.INT8RANGE,
        "INT8MULTIRANGE": TokenType.INT8MULTIRANGE,
        "NUMRANGE": TokenType.NUMRANGE,
        "NUMMULTIRANGE": TokenType.NUMMULTIRANGE,
        "TSRANGE": TokenType.TSRANGE,
        "TSMULTIRANGE": TokenType.TSMULTIRANGE,
        "TSTZRANGE": TokenType.TSTZRANGE,
        "TSTZMULTIRANGE": TokenType.TSTZMULTIRANGE,
        "DATERANGE": TokenType.DATERANGE,
        "DATEMULTIRANGE": TokenType.DATEMULTIRANGE,
        "UNIQUE": TokenType.UNIQUE,
        "VECTOR": TokenType.VECTOR,
        "STRUCT": TokenType.STRUCT,
        "SEQUENCE": TokenType.SEQUENCE,
        "VARIANT": TokenType.VARIANT,
        "ALTER": TokenType.ALTER,
        "ANALYZE": TokenType.COMMAND,
        "CALL": TokenType.COMMAND,
        "COMMENT": TokenType.COMMENT,
        "EXPLAIN": TokenType.COMMAND,
        "GRANT": TokenType.GRANT,
        "OPTIMIZE": TokenType.COMMAND,
        "PREPARE": TokenType.COMMAND,
        "VACUUM": TokenType.COMMAND,
        "USER-DEFINED": TokenType.USERDEFINED,
        "FOR VERSION": TokenType.VERSION_SNAPSHOT,
        "FOR TIMESTAMP": TokenType.TIMESTAMP_SNAPSHOT,
    }

    WHITE_SPACE: t.Dict[t.Optional[str], TokenType] = {
        " ": TokenType.SPACE,
        "\t": TokenType.SPACE,
        "\n": TokenType.BREAK,
        "\r": TokenType.BREAK,
    }

    COMMANDS = {
        TokenType.COMMAND,
        TokenType.EXECUTE,
        TokenType.FETCH,
        TokenType.SHOW,
        TokenType.RENAME,
    }

    COMMAND_PREFIX_TOKENS = {TokenType.SEMICOLON, TokenType.BEGIN}

    # Handle numeric literals like in hive (3L = BIGINT)
    NUMERIC_LITERALS: t.Dict[str, str] = {}

    COMMENTS = ["--", ("/*", "*/")]

    __slots__ = (
        "sql",
        "size",
        "tokens",
        "dialect",
        "_start",
        "_current",
        "_line",
        "_col",
        "_comments",
        "_char",
        "_end",
        "_peek",
        "_prev_token_line",
        "_rs_dialect_settings",
    )

    def __init__(self, dialect: DialectType = None) -> None:
        from sqlglot.dialects import Dialect

        self.dialect = Dialect.get_or_raise(dialect)

        if USE_RS_TOKENIZER:
            self._rs_dialect_settings = RsTokenizerDialectSettings(
                unescaped_sequences=self.dialect.UNESCAPED_SEQUENCES,
                identifiers_can_start_with_digit=self.dialect.IDENTIFIERS_CAN_START_WITH_DIGIT,
            )

        self.reset()

    def reset(self) -> None:
        self.sql = ""
        self.size = 0
        self.tokens: t.List[Token] = []
        self._start = 0
        self._current = 0
        self._line = 1
        self._col = 0
        self._comments: t.List[str] = []

        self._char = ""
        self._end = False
        self._peek = ""
        self._prev_token_line = -1

    def tokenize(self, sql: str) -> t.List[Token]:
        """Returns a list of tokens corresponding to the SQL string `sql`."""
        if USE_RS_TOKENIZER:
            return self.tokenize_rs(sql)

        self.reset()
        self.sql = sql
        self.size = len(sql)

        try:
            self._scan()
        except Exception as e:
            start = max(self._current - 50, 0)
            end = min(self._current + 50, self.size - 1)
            context = self.sql[start:end]
            raise TokenError(f"Error tokenizing '{context}'") from e

        return self.tokens

    def _scan(self, until: t.Optional[t.Callable] = None) -> None:
        while self.size and not self._end:
            current = self._current

            # Skip spaces here rather than iteratively calling advance() for performance reasons
            while current < self.size:
                char = self.sql[current]

                if char.isspace() and (char == " " or char == "\t"):
                    current += 1
                else:
                    break

            offset = current - self._current if current > self._current else 1

            self._start = current
            self._advance(offset)

            if not self._char.isspace():
                if self._char.isdigit():
                    self._scan_number()
                elif self._char in self._IDENTIFIERS:
                    self._scan_identifier(self._IDENTIFIERS[self._char])
                else:
                    self._scan_keywords()

            if until and until():
                break

        if self.tokens and self._comments:
            self.tokens[-1].comments.extend(self._comments)

    def _chars(self, size: int) -> str:
        if size == 1:
            return self._char

        start = self._current - 1
        end = start + size

        return self.sql[start:end] if end <= self.size else ""

    def _advance(self, i: int = 1, alnum: bool = False) -> None:
        if self.WHITE_SPACE.get(self._char) is TokenType.BREAK:
            # Ensures we don't count an extra line if we get a \r\n line break sequence
            if not (self._char == "\r" and self._peek == "\n"):
                self._col = 1
                self._line += 1
        else:
            self._col += i

        self._current += i
        self._end = self._current >= self.size
        self._char = self.sql[self._current - 1]
        self._peek = "" if self._end else self.sql[self._current]

        if alnum and self._char.isalnum():
            # Here we use local variables instead of attributes for better performance
            _col = self._col
            _current = self._current
            _end = self._end
            _peek = self._peek

            while _peek.isalnum():
                _col += 1
                _current += 1
                _end = _current >= self.size
                _peek = "" if _end else self.sql[_current]

            self._col = _col
            self._current = _current
            self._end = _end
            self._peek = _peek
            self._char = self.sql[_current - 1]

    @property
    def _text(self) -> str:
        return self.sql[self._start : self._current]

    def _add(self, token_type: TokenType, text: t.Optional[str] = None) -> None:
        self._prev_token_line = self._line

        if self._comments and token_type == TokenType.SEMICOLON and self.tokens:
            self.tokens[-1].comments.extend(self._comments)
            self._comments = []

        self.tokens.append(
            Token(
                token_type,
                text=self._text if text is None else text,
                line=self._line,
                col=self._col,
                start=self._start,
                end=self._current - 1,
                comments=self._comments,
            )
        )
        self._comments = []

        # If we have either a semicolon or a begin token before the command's token, we'll parse
        # whatever follows the command's token as a string
        if (
            token_type in self.COMMANDS
            and self._peek != ";"
            and (len(self.tokens) == 1 or self.tokens[-2].token_type in self.COMMAND_PREFIX_TOKENS)
        ):
            start = self._current
            tokens = len(self.tokens)
            self._scan(lambda: self._peek == ";")
            self.tokens = self.tokens[:tokens]
            text = self.sql[start : self._current].strip()
            if text:
                self._add(TokenType.STRING, text)

    def _scan_keywords(self) -> None:
        size = 0
        word = None
        chars = self._text
        char = chars
        prev_space = False
        skip = False
        trie = self._KEYWORD_TRIE
        single_token = char in self.SINGLE_TOKENS

        while chars:
            if skip:
                result = TrieResult.PREFIX
            else:
                result, trie = in_trie(trie, char.upper())

            if result == TrieResult.FAILED:
                break
            if result == TrieResult.EXISTS:
                word = chars

            end = self._current + size
            size += 1

            if end < self.size:
                char = self.sql[end]
                single_token = single_token or char in self.SINGLE_TOKENS
                is_space = char.isspace()

                if not is_space or not prev_space:
                    if is_space:
                        char = " "
                    chars += char
                    prev_space = is_space
                    skip = False
                else:
                    skip = True
            else:
                char = ""
                break

        if word:
            if self._scan_string(word):
                return
            if self._scan_comment(word):
                return
            if prev_space or single_token or not char:
                self._advance(size - 1)
                word = word.upper()
                self._add(self.KEYWORDS[word], text=word)
                return

        if self._char in self.SINGLE_TOKENS:
            self._add(self.SINGLE_TOKENS[self._char], text=self._char)
            return

        self._scan_var()

    def _scan_comment(self, comment_start: str) -> bool:
        if comment_start not in self._COMMENTS:
            return False

        comment_start_line = self._line
        comment_start_size = len(comment_start)
        comment_end = self._COMMENTS[comment_start]

        if comment_end:
            # Skip the comment's start delimiter
            self._advance(comment_start_size)

            comment_count = 1
            comment_end_size = len(comment_end)

            while not self._end:
                if self._chars(comment_end_size) == comment_end:
                    comment_count -= 1
                    if not comment_count:
                        break

                self._advance(alnum=True)

                # Nested comments are allowed by some dialects, e.g. databricks, duckdb, postgres
                if (
                    self.NESTED_COMMENTS
                    and not self._end
                    and self._chars(comment_end_size) == comment_start
                ):
                    self._advance(comment_start_size)
                    comment_count += 1

            self._comments.append(self._text[comment_start_size : -comment_end_size + 1])
            self._advance(comment_end_size - 1)
        else:
            while not self._end and self.WHITE_SPACE.get(self._peek) is not TokenType.BREAK:
                self._advance(alnum=True)
            self._comments.append(self._text[comment_start_size:])

        if (
            comment_start == self.HINT_START
            and self.tokens
            and self.tokens[-1].token_type in self.TOKENS_PRECEDING_HINT
        ):
            self._add(TokenType.HINT)

        # Leading comment is attached to the succeeding token, whilst trailing comment to the preceding.
        # Multiple consecutive comments are preserved by appending them to the current comments list.
        if comment_start_line == self._prev_token_line:
            self.tokens[-1].comments.extend(self._comments)
            self._comments = []
            self._prev_token_line = self._line

        return True

    def _scan_number(self) -> None:
        if self._char == "0":
            peek = self._peek.upper()
            if peek == "B":
                return self._scan_bits() if self.BIT_STRINGS else self._add(TokenType.NUMBER)
            elif peek == "X":
                return self._scan_hex() if self.HEX_STRINGS else self._add(TokenType.NUMBER)

        decimal = False
        scientific = 0

        while True:
            if self._peek.isdigit():
                self._advance()
            elif self._peek == "." and not decimal:
                if self.tokens and self.tokens[-1].token_type == TokenType.PARAMETER:
                    return self._add(TokenType.NUMBER)
                decimal = True
                self._advance()
            elif self._peek in ("-", "+") and scientific == 1:
                scientific += 1
                self._advance()
            elif self._peek.upper() == "E" and not scientific:
                scientific += 1
                self._advance()
            elif self._peek.isidentifier():
                number_text = self._text
                literal = ""

                while self._peek.strip() and self._peek not in self.SINGLE_TOKENS:
                    literal += self._peek
                    self._advance()

                token_type = self.KEYWORDS.get(self.NUMERIC_LITERALS.get(literal.upper(), ""))

                if token_type:
                    self._add(TokenType.NUMBER, number_text)
                    self._add(TokenType.DCOLON, "::")
                    return self._add(token_type, literal)
                elif self.dialect.IDENTIFIERS_CAN_START_WITH_DIGIT:
                    return self._add(TokenType.VAR)

                self._advance(-len(literal))
                return self._add(TokenType.NUMBER, number_text)
            else:
                return self._add(TokenType.NUMBER)

    def _scan_bits(self) -> None:
        self._advance()
        value = self._extract_value()
        try:
            # If `value` can't be converted to a binary, fallback to tokenizing it as an identifier
            int(value, 2)
            self._add(TokenType.BIT_STRING, value[2:])  # Drop the 0b
        except ValueError:
            self._add(TokenType.IDENTIFIER)

    def _scan_hex(self) -> None:
        self._advance()
        value = self._extract_value()
        try:
            # If `value` can't be converted to a hex, fallback to tokenizing it as an identifier
            int(value, 16)
            self._add(TokenType.HEX_STRING, value[2:])  # Drop the 0x
        except ValueError:
            self._add(TokenType.IDENTIFIER)

    def _extract_value(self) -> str:
        while True:
            char = self._peek.strip()
            if char and char not in self.SINGLE_TOKENS:
                self._advance(alnum=True)
            else:
                break

        return self._text

    def _scan_string(self, start: str) -> bool:
        base = None
        token_type = TokenType.STRING

        if start in self._QUOTES:
            end = self._QUOTES[start]
        elif start in self._FORMAT_STRINGS:
            end, token_type = self._FORMAT_STRINGS[start]

            if token_type == TokenType.HEX_STRING:
                base = 16
            elif token_type == TokenType.BIT_STRING:
                base = 2
            elif token_type == TokenType.HEREDOC_STRING:
                self._advance()

                if self._char == end:
                    tag = ""
                else:
                    tag = self._extract_string(
                        end,
                        raw_string=True,
                        raise_unmatched=not self.HEREDOC_TAG_IS_IDENTIFIER,
                    )

                if tag and self.HEREDOC_TAG_IS_IDENTIFIER and (self._end or not tag.isidentifier()):
                    if not self._end:
                        self._advance(-1)

                    self._advance(-len(tag))
                    self._add(self.HEREDOC_STRING_ALTERNATIVE)
                    return True

                end = f"{start}{tag}{end}"
        else:
            return False

        self._advance(len(start))
        text = self._extract_string(end, raw_string=token_type == TokenType.RAW_STRING)

        if base:
            try:
                int(text, base)
            except Exception:
                raise TokenError(
                    f"Numeric string contains invalid characters from {self._line}:{self._start}"
                )

        self._add(token_type, text)
        return True

    def _scan_identifier(self, identifier_end: str) -> None:
        self._advance()
        text = self._extract_string(
            identifier_end, escapes=self._IDENTIFIER_ESCAPES | {identifier_end}
        )
        self._add(TokenType.IDENTIFIER, text)

    def _scan_var(self) -> None:
        while True:
            char = self._peek.strip()
            if char and (char in self.VAR_SINGLE_TOKENS or char not in self.SINGLE_TOKENS):
                self._advance(alnum=True)
            else:
                break

        self._add(
            TokenType.VAR
            if self.tokens and self.tokens[-1].token_type == TokenType.PARAMETER
            else self.KEYWORDS.get(self._text.upper(), TokenType.VAR)
        )

    def _extract_string(
        self,
        delimiter: str,
        escapes: t.Optional[t.Set[str]] = None,
        raw_string: bool = False,
        raise_unmatched: bool = True,
    ) -> str:
        text = ""
        delim_size = len(delimiter)
        escapes = self._STRING_ESCAPES if escapes is None else escapes

        while True:
            if (
                not raw_string
                and self.dialect.UNESCAPED_SEQUENCES
                and self._peek
                and self._char in self.STRING_ESCAPES
            ):
                unescaped_sequence = self.dialect.UNESCAPED_SEQUENCES.get(self._char + self._peek)
                if unescaped_sequence:
                    self._advance(2)
                    text += unescaped_sequence
                    continue
            if (
                (self.STRING_ESCAPES_ALLOWED_IN_RAW_STRINGS or not raw_string)
                and self._char in escapes
                and (self._peek == delimiter or self._peek in escapes)
                and (self._char not in self._QUOTES or self._char == self._peek)
            ):
                if self._peek == delimiter:
                    text += self._peek
                else:
                    text += self._char + self._peek

                if self._current + 1 < self.size:
                    self._advance(2)
                else:
                    raise TokenError(f"Missing {delimiter} from {self._line}:{self._current}")
            else:
                if self._chars(delim_size) == delimiter:
                    if delim_size > 1:
                        self._advance(delim_size - 1)
                    break

                if self._end:
                    if not raise_unmatched:
                        return text + self._char

                    raise TokenError(f"Missing {delimiter} from {self._line}:{self._start}")

                current = self._current - 1
                self._advance(alnum=True)
                text += self.sql[current : self._current - 1]

        return text

    def tokenize_rs(self, sql: str) -> t.List[Token]:
        if not self._RS_TOKENIZER:
            raise SqlglotError("Rust tokenizer is not available")

        try:
            tokens = self._RS_TOKENIZER.tokenize(sql, self._rs_dialect_settings)
            for token in tokens:
                token.token_type = _ALL_TOKEN_TYPES[token.token_type_index]
            return tokens
        except Exception as e:
            raise TokenError(str(e))
