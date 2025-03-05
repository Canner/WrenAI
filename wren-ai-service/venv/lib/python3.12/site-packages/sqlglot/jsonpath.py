from __future__ import annotations

import typing as t

import sqlglot.expressions as exp
from sqlglot.errors import ParseError
from sqlglot.tokens import Token, Tokenizer, TokenType

if t.TYPE_CHECKING:
    from sqlglot._typing import Lit
    from sqlglot.dialects.dialect import DialectType


class JSONPathTokenizer(Tokenizer):
    SINGLE_TOKENS = {
        "(": TokenType.L_PAREN,
        ")": TokenType.R_PAREN,
        "[": TokenType.L_BRACKET,
        "]": TokenType.R_BRACKET,
        ":": TokenType.COLON,
        ",": TokenType.COMMA,
        "-": TokenType.DASH,
        ".": TokenType.DOT,
        "?": TokenType.PLACEHOLDER,
        "@": TokenType.PARAMETER,
        "'": TokenType.QUOTE,
        '"': TokenType.QUOTE,
        "$": TokenType.DOLLAR,
        "*": TokenType.STAR,
    }

    KEYWORDS = {
        "..": TokenType.DOT,
    }

    IDENTIFIER_ESCAPES = ["\\"]
    STRING_ESCAPES = ["\\"]


def parse(path: str, dialect: DialectType = None) -> exp.JSONPath:
    """Takes in a JSON path string and parses it into a JSONPath expression."""
    from sqlglot.dialects import Dialect

    jsonpath_tokenizer = Dialect.get_or_raise(dialect).jsonpath_tokenizer
    tokens = jsonpath_tokenizer.tokenize(path)
    size = len(tokens)

    i = 0

    def _curr() -> t.Optional[TokenType]:
        return tokens[i].token_type if i < size else None

    def _prev() -> Token:
        return tokens[i - 1]

    def _advance() -> Token:
        nonlocal i
        i += 1
        return _prev()

    def _error(msg: str) -> str:
        return f"{msg} at index {i}: {path}"

    @t.overload
    def _match(token_type: TokenType, raise_unmatched: Lit[True] = True) -> Token:
        pass

    @t.overload
    def _match(token_type: TokenType, raise_unmatched: Lit[False] = False) -> t.Optional[Token]:
        pass

    def _match(token_type, raise_unmatched=False):
        if _curr() == token_type:
            return _advance()
        if raise_unmatched:
            raise ParseError(_error(f"Expected {token_type}"))
        return None

    def _parse_literal() -> t.Any:
        token = _match(TokenType.STRING) or _match(TokenType.IDENTIFIER)
        if token:
            return token.text
        if _match(TokenType.STAR):
            return exp.JSONPathWildcard()
        if _match(TokenType.PLACEHOLDER) or _match(TokenType.L_PAREN):
            script = _prev().text == "("
            start = i

            while True:
                if _match(TokenType.L_BRACKET):
                    _parse_bracket()  # nested call which we can throw away
                if _curr() in (TokenType.R_BRACKET, None):
                    break
                _advance()

            expr_type = exp.JSONPathScript if script else exp.JSONPathFilter
            return expr_type(this=path[tokens[start].start : tokens[i].end])

        number = "-" if _match(TokenType.DASH) else ""

        token = _match(TokenType.NUMBER)
        if token:
            number += token.text

        if number:
            return int(number)

        return False

    def _parse_slice() -> t.Any:
        start = _parse_literal()
        end = _parse_literal() if _match(TokenType.COLON) else None
        step = _parse_literal() if _match(TokenType.COLON) else None

        if end is None and step is None:
            return start

        return exp.JSONPathSlice(start=start, end=end, step=step)

    def _parse_bracket() -> exp.JSONPathPart:
        literal = _parse_slice()

        if isinstance(literal, str) or literal is not False:
            indexes = [literal]
            while _match(TokenType.COMMA):
                literal = _parse_slice()

                if literal:
                    indexes.append(literal)

            if len(indexes) == 1:
                if isinstance(literal, str):
                    node: exp.JSONPathPart = exp.JSONPathKey(this=indexes[0])
                elif isinstance(literal, exp.JSONPathPart) and isinstance(
                    literal, (exp.JSONPathScript, exp.JSONPathFilter)
                ):
                    node = exp.JSONPathSelector(this=indexes[0])
                else:
                    node = exp.JSONPathSubscript(this=indexes[0])
            else:
                node = exp.JSONPathUnion(expressions=indexes)
        else:
            raise ParseError(_error("Cannot have empty segment"))

        _match(TokenType.R_BRACKET, raise_unmatched=True)

        return node

    def _parse_var_text() -> str:
        """
        Consumes & returns the text for a var. In BigQuery it's valid to have a key with spaces
        in it, e.g JSON_QUERY(..., '$. a b c ') should produce a single JSONPathKey(' a b c ').
        This is done by merging "consecutive" vars until a key separator is found (dot, colon etc)
        or the path string is exhausted.
        """
        prev_index = i - 2

        while _match(TokenType.VAR):
            pass

        start = 0 if prev_index < 0 else tokens[prev_index].end + 1

        if i >= len(tokens):
            # This key is the last token for the path, so it's text is the remaining path
            text = path[start:]
        else:
            text = path[start : tokens[i].start]

        return text

    # We canonicalize the JSON path AST so that it always starts with a
    # "root" element, so paths like "field" will be generated as "$.field"
    _match(TokenType.DOLLAR)
    expressions: t.List[exp.JSONPathPart] = [exp.JSONPathRoot()]

    while _curr():
        if _match(TokenType.DOT) or _match(TokenType.COLON):
            recursive = _prev().text == ".."

            if _match(TokenType.VAR):
                value: t.Optional[str | exp.JSONPathWildcard] = _parse_var_text()
            elif _match(TokenType.IDENTIFIER):
                value = _prev().text
            elif _match(TokenType.STAR):
                value = exp.JSONPathWildcard()
            else:
                value = None

            if recursive:
                expressions.append(exp.JSONPathRecursive(this=value))
            elif value:
                expressions.append(exp.JSONPathKey(this=value))
            else:
                raise ParseError(_error("Expected key name or * after DOT"))
        elif _match(TokenType.L_BRACKET):
            expressions.append(_parse_bracket())
        elif _match(TokenType.VAR):
            expressions.append(exp.JSONPathKey(this=_parse_var_text()))
        elif _match(TokenType.IDENTIFIER):
            expressions.append(exp.JSONPathKey(this=_prev().text))
        elif _match(TokenType.STAR):
            expressions.append(exp.JSONPathWildcard())
        else:
            raise ParseError(_error(f"Unexpected {tokens[i].token_type}"))

    return exp.JSONPath(expressions=expressions)


JSON_PATH_PART_TRANSFORMS: t.Dict[t.Type[exp.Expression], t.Callable[..., str]] = {
    exp.JSONPathFilter: lambda _, e: f"?{e.this}",
    exp.JSONPathKey: lambda self, e: self._jsonpathkey_sql(e),
    exp.JSONPathRecursive: lambda _, e: f"..{e.this or ''}",
    exp.JSONPathRoot: lambda *_: "$",
    exp.JSONPathScript: lambda _, e: f"({e.this}",
    exp.JSONPathSelector: lambda self, e: f"[{self.json_path_part(e.this)}]",
    exp.JSONPathSlice: lambda self, e: ":".join(
        "" if p is False else self.json_path_part(p)
        for p in [e.args.get("start"), e.args.get("end"), e.args.get("step")]
        if p is not None
    ),
    exp.JSONPathSubscript: lambda self, e: self._jsonpathsubscript_sql(e),
    exp.JSONPathUnion: lambda self,
    e: f"[{','.join(self.json_path_part(p) for p in e.expressions)}]",
    exp.JSONPathWildcard: lambda *_: "*",
}

ALL_JSON_PATH_PARTS = set(JSON_PATH_PART_TRANSFORMS)
