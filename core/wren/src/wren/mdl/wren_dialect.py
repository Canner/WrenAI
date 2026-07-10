"""Wren sqlglot dialect — mirrors wren-core's DataFusion-based output."""

from sqlglot import exp, parser
from sqlglot.dialects.dialect import Dialect, build_date_delta_with_interval


class Wren(Dialect):
    class Parser(parser.Parser):
        FUNCTIONS = {
            **parser.Parser.FUNCTIONS,
            "DATE_ADD": build_date_delta_with_interval(exp.DateAdd),
            "DATE_SUB": build_date_delta_with_interval(exp.DateSub),
            "DATETIME_ADD": build_date_delta_with_interval(exp.DatetimeAdd),
            "DATETIME_SUB": build_date_delta_with_interval(exp.DatetimeSub),
            "TIME_ADD": build_date_delta_with_interval(exp.TimeAdd),
            "TIME_SUB": build_date_delta_with_interval(exp.TimeSub),
            "TIMESTAMP_ADD": build_date_delta_with_interval(exp.TimestampAdd),
            "TIMESTAMP_SUB": build_date_delta_with_interval(exp.TimestampSub),
        }
