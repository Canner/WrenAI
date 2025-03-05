from __future__ import annotations

from sqlglot import exp, generator, parser, tokens, transforms
from sqlglot.dialects.dialect import Dialect, rename_func


class Tableau(Dialect):
    LOG_BASE_FIRST = False

    class Tokenizer(tokens.Tokenizer):
        IDENTIFIERS = [("[", "]")]
        QUOTES = ["'", '"']

    class Generator(generator.Generator):
        JOIN_HINTS = False
        TABLE_HINTS = False
        QUERY_HINTS = False

        TRANSFORMS = {
            **generator.Generator.TRANSFORMS,
            exp.Coalesce: rename_func("IFNULL"),
            exp.Select: transforms.preprocess([transforms.eliminate_distinct_on]),
        }

        PROPERTIES_LOCATION = {
            **generator.Generator.PROPERTIES_LOCATION,
            exp.VolatileProperty: exp.Properties.Location.UNSUPPORTED,
        }

        def if_sql(self, expression: exp.If) -> str:
            this = self.sql(expression, "this")
            true = self.sql(expression, "true")
            false = self.sql(expression, "false")
            return f"IF {this} THEN {true} ELSE {false} END"

        def count_sql(self, expression: exp.Count) -> str:
            this = expression.this
            if isinstance(this, exp.Distinct):
                return self.func("COUNTD", *this.expressions)
            return self.func("COUNT", this)

    class Parser(parser.Parser):
        FUNCTIONS = {
            **parser.Parser.FUNCTIONS,
            "COUNTD": lambda args: exp.Count(this=exp.Distinct(expressions=args)),
        }
        NO_PAREN_IF_COMMANDS = False
