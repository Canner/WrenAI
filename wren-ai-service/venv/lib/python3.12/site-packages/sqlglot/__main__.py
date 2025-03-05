from __future__ import annotations

import argparse
import sys
import typing as t

import sqlglot

parser = argparse.ArgumentParser(description="Transpile SQL")
parser.add_argument(
    "sql",
    metavar="sql",
    type=str,
    help="SQL statement(s) to transpile, or - to parse stdin.",
)
parser.add_argument(
    "--read",
    dest="read",
    type=str,
    default=None,
    help="Dialect to read default is generic",
)
parser.add_argument(
    "--write",
    dest="write",
    type=str,
    default=None,
    help="Dialect to write default is generic",
)
parser.add_argument(
    "--no-identify",
    dest="identify",
    action="store_false",
    help="Don't auto identify fields",
)
parser.add_argument(
    "--no-pretty",
    dest="pretty",
    action="store_false",
    help="Compress sql",
)
parser.add_argument(
    "--parse",
    dest="parse",
    action="store_true",
    help="Parse and return the expression tree",
)
parser.add_argument(
    "--tokenize",
    dest="tokenize",
    action="store_true",
    help="Tokenize and return the tokens list",
)
parser.add_argument(
    "--error-level",
    dest="error_level",
    type=str,
    default="IMMEDIATE",
    help="IGNORE, WARN, RAISE, IMMEDIATE (default)",
)
parser.add_argument(
    "--version",
    action="version",
    version=sqlglot.__version__,
    help="Display the SQLGlot version",
)


args = parser.parse_args()
error_level = sqlglot.ErrorLevel[args.error_level.upper()]

sql = sys.stdin.read() if args.sql == "-" else args.sql

if args.parse:
    objs: t.Union[t.List[str], t.List[sqlglot.tokens.Token]] = [
        repr(expression)
        for expression in sqlglot.parse(
            sql,
            read=args.read,
            error_level=error_level,
        )
    ]
elif args.tokenize:
    objs = sqlglot.Dialect.get_or_raise(args.read).tokenize(sql)
else:
    objs = sqlglot.transpile(
        sql,
        read=args.read,
        write=args.write,
        identify=args.identify,
        pretty=args.pretty,
        error_level=error_level,
    )

for obj in objs:
    print(obj)
