import logging
import re
from abc import ABCMeta, abstractmethod
from typing import Any, Dict, Optional, Tuple

import aiohttp
import sqlparse
from pydantic import BaseModel
from sqlglot.tokens import Token, Tokenizer, TokenType

logger = logging.getLogger("wren-ai-service")


class EngineConfig(BaseModel):
    provider: str = "wren_ui"
    config: dict = {}


class Engine(metaclass=ABCMeta):
    @abstractmethod
    async def execute_sql(
        self,
        sql: str,
        session: aiohttp.ClientSession,
        dry_run: bool = True,
        **kwargs,
    ) -> Tuple[bool, Optional[Dict[str, Any]]]:
        ...


def clean_generation_result(result: str) -> str:
    def _normalize_whitespace(s: str) -> str:
        return re.sub(r"\s+", " ", s).strip()

    return (
        _normalize_whitespace(result)
        .replace("```sql", "")
        .replace("```json", "")
        .replace('"""', "")
        .replace("'''", "")
        .replace("```", "")
        .replace(";", "")
    )


def remove_limit_statement(sql: str) -> str:
    pattern = r"\s*LIMIT\s+\d+(\s*;?\s*--.*|\s*;?\s*)$"
    modified_sql = re.sub(pattern, "", sql, flags=re.IGNORECASE)

    return modified_sql


def squish_sql(sql: str) -> str:
    return (
        sqlparse.format(
            sql,
            strip_comments=False,
            reindent=False,  # don't add newlines/indent
            keyword_case=None,  # don't change case
        )
        .replace("\n", " ")
        .replace("\r", " ")
        .strip()
    )


def add_quotes(sql: str) -> Tuple[str, str]:
    def _quote_sql_identifiers_by_tokens(sql: str, quote_char: str = '"') -> str:
        """
        Add quotes around identifiers using SQLGlot's tokenizer positions.
        """

        def is_sql_keyword(text: str) -> bool:
            """Check if the text is a SQL keyword that should not be quoted."""
            # Common SQL keywords that should never be quoted
            sql_keywords = {
                # Basic SQL keywords
                "SELECT",
                "FROM",
                "WHERE",
                "JOIN",
                "LEFT",
                "RIGHT",
                "INNER",
                "OUTER",
                "ON",
                "AND",
                "OR",
                "NOT",
                "IN",
                "EXISTS",
                "BETWEEN",
                "LIKE",
                "IS",
                "NULL",
                "ORDER",
                "BY",
                "GROUP",
                "HAVING",
                "LIMIT",
                "OFFSET",
                "UNION",
                "INTERSECT",
                "EXCEPT",
                "AS",
                "DISTINCT",
                "ALL",
                "TOP",
                "WITH",
                "RECURSIVE",
                # Data types
                "INTEGER",
                "INT",
                "BIGINT",
                "SMALLINT",
                "DECIMAL",
                "NUMERIC",
                "FLOAT",
                "REAL",
                "DOUBLE",
                "PRECISION",
                "VARCHAR",
                "CHAR",
                "TEXT",
                "BOOLEAN",
                "BOOL",
                "DATE",
                "TIME",
                "TIMESTAMP",
                "TIMESTAMPTZ",
                "INTERVAL",
                "WITH",
                "WITHOUT",
                # Time/date keywords
                "YEAR",
                "MONTH",
                "DAY",
                "HOUR",
                "MINUTE",
                "SECOND",
                "TIMEZONE",
                "EPOCH",
                "AT",
                "ZONE",
                "CURRENT_DATE",
                "CURRENT_TIME",
                "CURRENT_TIMESTAMP",
                # Other common keywords
                "CASE",
                "WHEN",
                "THEN",
                "ELSE",
                "END",
                "DESC",
                "ASC",
                "TRUE",
                "FALSE",
            }
            return text.upper() in sql_keywords

        def is_ident(tok: Token):
            # SQLGlot uses VAR for identifiers, but also treats SQL keywords as identifiers in some contexts
            if tok.token_type not in (
                TokenType.VAR,
                TokenType.SCHEMA,
                TokenType.TABLE,
                TokenType.COLUMN,
                TokenType.DATABASE,
                TokenType.INDEX,
                TokenType.VIEW,
            ):
                return False

            # Don't quote SQL keywords
            token_text = sql[tok.start : tok.end + 1]
            if is_sql_keyword(token_text):
                return False

            return True

        def is_already_quoted_text(text: str) -> bool:
            text = text.strip()
            return (
                (len(text) >= 2 and text[0] == '"' and text[-1] == '"')
                or (len(text) >= 2 and text[0] == "`" and text[-1] == "`")
                or (len(text) >= 2 and text[0] == "[" and text[-1] == "]")
            )

        toks = Tokenizer().tokenize(sql)
        n = len(toks)
        edits = []  # (start, end_exclusive, replacement)

        i = 0
        while i < n:
            t = toks[i]

            if not is_ident(t):
                i += 1
                continue

            # Check for wildcard pattern: IDENT DOT STAR (e.g., t.*)
            if (
                i + 2 < n
                and toks[i + 1].token_type == TokenType.DOT
                and toks[i + 2].token_type == TokenType.STAR
            ):
                i += 3  # Skip the entire wildcard pattern
                continue

            # Check if this is part of a dotted chain
            j = i
            chain_tokens = [t]  # Start with current identifier

            # Collect all tokens in the dotted chain: IDENT (DOT IDENT)*
            while (
                j + 2 < n
                and toks[j + 1].token_type == TokenType.DOT
                and is_ident(toks[j + 2])
            ):
                chain_tokens.append(toks[j + 1])  # DOT
                chain_tokens.append(toks[j + 2])  # IDENT
                j += 2

            # If the next token after the chain is '(', it's a function call -> skip
            if j + 1 < n and toks[j + 1].token_type == TokenType.L_PAREN:
                i = j + 1
                continue

            # Process each identifier in the chain separately to ensure all are quoted
            for k in range(
                0, len(chain_tokens), 2
            ):  # Process only identifiers (skip dots)
                ident_token = chain_tokens[k]
                token_text = sql[ident_token.start : ident_token.end + 1]

                if not is_already_quoted_text(token_text):
                    replacement = f"{quote_char}{token_text}{quote_char}"
                    edits.append((ident_token.start, ident_token.end + 1, replacement))

            i = j + 1

        # Apply edits right-to-left to keep offsets valid
        out = sql
        for start, end, repl in sorted(edits, key=lambda x: x[0], reverse=True):
            out = out[:start] + repl + out[end:]
        return out

    try:
        sql = squish_sql(sql)
        quoted_sql = _quote_sql_identifiers_by_tokens(sql)
    except Exception as e:
        logger.exception(f"Error in adding quotes to {sql}: {e}")

        return "", str(e)

    return quoted_sql, ""
