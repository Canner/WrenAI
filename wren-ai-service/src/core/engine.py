import logging
import re
from abc import ABCMeta, abstractmethod
from typing import Any, Dict, Optional, Tuple

import aiohttp
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


def add_quotes(sql: str) -> Tuple[str, str]:
    def _quote_sql_identifiers_by_tokens(sql: str, quote_char: str = '"') -> str:
        """
        Add quotes around identifiers using SQLGlot's tokenizer positions.
        """

        def is_ident(tok: Token):
            # SQLGlot uses VAR for identifiers, not IDENTIFIER
            return tok.token_type == TokenType.VAR

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

            # Merge dotted chains: IDENT (DOT IDENT)*  (e.g., db.schema.table or t.col)
            j = i
            last_ident = t
            while (
                j + 2 < n
                and toks[j + 1].token_type == TokenType.DOT
                and is_ident(toks[j + 2])
            ):
                j += 2
                last_ident = toks[j]

            # If the next token after the chain is '(', it's a function call -> skip
            if j + 1 < n and toks[j + 1].token_type == TokenType.L_PAREN:
                i = j + 1
                continue

            # Build a replacement that preserves original spacing and punctuation inside the chain.
            start_pos = t.start
            end_pos_excl = last_ident.end + 1
            piece_tokens = toks[i : j + 1]

            out_parts = []
            cursor = start_pos
            for pt in piece_tokens:
                # Copy any text before this token (whitespace/comments between tokens)
                if cursor < pt.start:
                    out_parts.append(sql[cursor : pt.start])

                token_text = sql[pt.start : pt.end + 1]
                if is_ident(pt):
                    if is_already_quoted_text(token_text):
                        out_parts.append(token_text)  # keep existing quoting style
                    else:
                        out_parts.append(f"{quote_char}{token_text}{quote_char}")
                else:
                    # DOT or other punctuation inside the chain
                    out_parts.append(token_text)

                cursor = pt.end + 1

            # Copy trailing part within the chain range
            if cursor < end_pos_excl:
                out_parts.append(sql[cursor:end_pos_excl])

            replacement = "".join(out_parts)
            edits.append((start_pos, end_pos_excl, replacement))
            i = j + 1

        # Apply edits right-to-left to keep offsets valid
        out = sql
        for start, end, repl in sorted(edits, key=lambda x: x[0], reverse=True):
            out = out[:start] + repl + out[end:]
        return out

    try:
        quoted_sql = _quote_sql_identifiers_by_tokens(sql)
    except Exception as e:
        logger.exception(f"Error in adding quotes to {sql}: {e}")

        return "", str(e)

    return quoted_sql, ""
