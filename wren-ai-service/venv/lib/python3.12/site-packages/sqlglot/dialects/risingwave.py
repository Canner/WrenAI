from __future__ import annotations
from sqlglot.dialects.postgres import Postgres
from sqlglot.tokens import TokenType
import typing as t

from sqlglot import exp


class RisingWave(Postgres):
    class Tokenizer(Postgres.Tokenizer):
        KEYWORDS = {
            **Postgres.Tokenizer.KEYWORDS,
            "SINK": TokenType.SINK,
            "SOURCE": TokenType.SOURCE,
        }

    class Parser(Postgres.Parser):
        WRAPPED_TRANSFORM_COLUMN_CONSTRAINT = False

        PROPERTY_PARSERS = {
            **Postgres.Parser.PROPERTY_PARSERS,
            "ENCODE": lambda self: self._parse_encode_property(),
            "INCLUDE": lambda self: self._parse_include_property(),
            "KEY": lambda self: self._parse_encode_property(key=True),
        }

        def _parse_table_hints(self) -> t.Optional[t.List[exp.Expression]]:
            # There is no hint in risingwave.
            # Do nothing here to avoid WITH keywords conflict in CREATE SINK statement.
            return None

        def _parse_include_property(self) -> t.Optional[exp.Expression]:
            header: t.Optional[exp.Expression] = None
            coldef: t.Optional[exp.Expression] = None

            this = self._parse_var_or_string()

            if not self._match(TokenType.ALIAS):
                header = self._parse_field()
                if header:
                    coldef = self.expression(exp.ColumnDef, this=header, kind=self._parse_types())

            self._match(TokenType.ALIAS)
            alias = self._parse_id_var(tokens=self.ALIAS_TOKENS)

            return self.expression(exp.IncludeProperty, this=this, alias=alias, column_def=coldef)

        def _parse_encode_property(self, key: t.Optional[bool] = None) -> exp.EncodeProperty:
            self._match_text_seq("ENCODE")
            this = self._parse_var_or_string()

            if self._match(TokenType.L_PAREN, advance=False):
                properties = self.expression(
                    exp.Properties, expressions=self._parse_wrapped_properties()
                )
            else:
                properties = None

            return self.expression(exp.EncodeProperty, this=this, properties=properties, key=key)

    class Generator(Postgres.Generator):
        LOCKING_READS_SUPPORTED = False

        TRANSFORMS = {
            **Postgres.Generator.TRANSFORMS,
            exp.FileFormatProperty: lambda self, e: f"FORMAT {self.sql(e, 'this')}",
        }

        PROPERTIES_LOCATION = {
            **Postgres.Generator.PROPERTIES_LOCATION,
            exp.FileFormatProperty: exp.Properties.Location.POST_EXPRESSION,
        }

        EXPRESSION_PRECEDES_PROPERTIES_CREATABLES = {"SINK"}
