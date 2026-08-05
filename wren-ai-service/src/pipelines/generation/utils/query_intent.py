import re
from dataclasses import dataclass


WORD_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9]*")

STOP_TERMS = {
    "a",
    "all",
    "an",
    "and",
    "are",
    "as",
    "at",
    "by",
    "each",
    "for",
    "from",
    "give",
    "has",
    "have",
    "in",
    "is",
    "me",
    "of",
    "on",
    "per",
    "show",
    "the",
    "their",
    "this",
    "to",
    "with",
}

DETAIL_TERMS = {"display", "find", "get", "list", "show"}
RANKING_TERMS = {"bottom", "highest", "least", "lowest", "most", "top"}
COUNT_TERMS = {"count", "counts", "number", "order", "orders", "row", "rows"}
COUNT_AGGREGATE_TERMS = {"count", "counts", "number", "row", "rows"}
SUM_TERMS = {
    "amount",
    "cost",
    "quantity",
    "qty",
    "revenue",
    "sales",
    "sold",
    "sum",
    "total",
    "value",
}
AVG_TERMS = {"average", "avg", "mean"}
MIN_TERMS = {"minimum", "min"}
MAX_TERMS = {"maximum", "max"}

AGGREGATE_TERMS = (
    RANKING_TERMS | COUNT_TERMS | SUM_TERMS | AVG_TERMS | MIN_TERMS | MAX_TERMS
)

GENERIC_BUSINESS_TERMS = {
    "business",
    "data",
    "record",
    "records",
    "table",
    "tables",
}


@dataclass(frozen=True)
class QueryIntent:
    terms: set[str]
    requested_dimension_terms: set[str]
    requests_aggregate: bool
    requests_ranking: bool
    requests_detail: bool


def normalize_term(term: str) -> set[str]:
    normalized = term.lower()
    terms = {normalized}
    if normalized.endswith("ies") and len(normalized) > 4:
        terms.add(f"{normalized[:-3]}y")
    elif normalized.endswith("s") and len(normalized) > 3:
        terms.add(normalized[:-1])
    return terms


def canonical_term(term: str) -> str:
    normalized = term.lower()
    if normalized.endswith("ies") and len(normalized) > 4:
        return f"{normalized[:-3]}y"
    if normalized.endswith("s") and len(normalized) > 3:
        return normalized[:-1]
    return normalized


def terms(value: str) -> set[str]:
    normalized_terms: set[str] = set()
    for token in WORD_PATTERN.findall(value or ""):
        normalized_terms.update(normalize_term(token))
    return normalized_terms


def identifier_terms(value: str) -> set[str]:
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", value or "")
    spaced = spaced.replace("_", " ").replace("-", " ")
    return terms(spaced)


def analyze_query(query: str) -> QueryIntent:
    query_terms = terms(query)
    requested_dimension_terms = _requested_dimension_terms(query)
    return QueryIntent(
        terms=query_terms,
        requested_dimension_terms=requested_dimension_terms,
        requests_aggregate=bool(
            query_terms
            & (
                RANKING_TERMS
                | COUNT_AGGREGATE_TERMS
                | SUM_TERMS
                | AVG_TERMS
                | MIN_TERMS
                | MAX_TERMS
            )
        )
        or bool(query_terms & {"breakdown", "compare", "trend"}),
        requests_ranking=bool(query_terms & RANKING_TERMS),
        requests_detail=bool(query_terms & DETAIL_TERMS),
    )


def semantic_terms(value: str) -> set[str]:
    return {
        term
        for term in terms(value)
        if term not in STOP_TERMS and term not in GENERIC_BUSINESS_TERMS
    }


def _requested_dimension_terms(query: str) -> set[str]:
    raw_tokens = WORD_PATTERN.findall(query or "")
    normalized_tokens = [canonical_term(token) for token in raw_tokens]
    requested: set[str] = set()

    first_aggregate_index = next(
        (
            index
            for index, token in enumerate(normalized_tokens)
            if token in AGGREGATE_TERMS
        ),
        len(normalized_tokens),
    )

    for token in normalized_tokens[:first_aggregate_index]:
        if _is_business_dimension_term(token):
            requested.add(token)

    for index, token in enumerate(normalized_tokens):
        if token not in {"by", "per"} and not (
            token == "each" and index > 0 and normalized_tokens[index - 1] == "for"
        ):
            continue

        for following in normalized_tokens[index + 1 :]:
            if following in AGGREGATE_TERMS:
                break
            if following in STOP_TERMS:
                continue
            if _is_business_dimension_term(following):
                requested.add(following)

    return requested


def _is_business_dimension_term(term: str) -> bool:
    return (
        term not in STOP_TERMS
        and term not in AGGREGATE_TERMS
        and term not in DETAIL_TERMS
        and term not in GENERIC_BUSINESS_TERMS
        and len(term) >= 3
    )
