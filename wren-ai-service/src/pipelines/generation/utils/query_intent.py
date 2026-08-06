import re
from dataclasses import dataclass


WORD_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9]*")
SOURCE_TABLE_PATTERN = re.compile(
    r"\b(?:from|in)\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)",
    re.IGNORECASE,
)

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
    "using",
    "with",
    "monthly",
}

DETAIL_TERMS = {"display", "find", "get", "list", "show"}
RANKING_TERMS = {"bottom", "highest", "least", "lowest", "most", "top"}
RELATIONSHIP_TERMS = {
    "attach",
    "attached",
    "attachment",
    "associate",
    "associated",
    "connect",
    "connected",
    "join",
    "joined",
    "link",
    "linked",
    "map",
    "mapped",
    "mapping",
    "relate",
    "related",
}
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
    business_terms: set[str]
    requested_dimension_terms: set[str]
    requests_aggregate: bool
    requests_ranking: bool
    requests_detail: bool
    requests_relationship: bool


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
        spaced_token = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", token)
        for split_token in WORD_PATTERN.findall(spaced_token):
            normalized_terms.update(normalize_term(split_token))
    return normalized_terms


def identifier_terms(value: str) -> set[str]:
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", value or "")
    spaced = spaced.replace("_", " ").replace("-", " ")
    return terms(spaced)


def analyze_query(query: str) -> QueryIntent:
    query_terms = terms(query)
    business_terms = _business_terms(query)
    requested_dimension_terms = _requested_dimension_terms(query)
    requests_relationship = _requests_relationship(query, query_terms, business_terms)
    return QueryIntent(
        terms=query_terms,
        business_terms=business_terms,
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
        requests_relationship=requests_relationship,
    )


def explicit_table_name_candidates(query: str) -> set[str]:
    candidates: set[str] = set()
    for match in SOURCE_TABLE_PATTERN.finditer(query or ""):
        identifier = match.group(1).strip(".,;:()[]{}\"'")
        if not _looks_like_table_identifier(identifier):
            continue
        normalized = identifier.replace(".", "_")
        candidates.add(identifier)
        candidates.add(normalized)
        candidates.add(identifier.split(".")[-1])

    return {candidate for candidate in candidates if candidate}


def _looks_like_table_identifier(identifier: str) -> bool:
    if not identifier:
        return False
    if "." in identifier or "_" in identifier:
        return True
    return bool(re.search(r"[a-z][A-Z]", identifier))


def explicit_table_terms(query: str) -> set[str]:
    return {
        term
        for candidate in explicit_table_name_candidates(query)
        for term in (identifier_terms(candidate) | terms(candidate))
    }


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

    def add_requested(raw_token: str, token: str) -> None:
        if _is_business_dimension_term(token):
            requested.add(token)
            requested.update(
                term
                for term in identifier_terms(raw_token)
                if _is_business_dimension_term(term)
            )

    first_aggregate_index = next(
        (
            index
            for index, token in enumerate(normalized_tokens)
            if token in AGGREGATE_TERMS
        ),
        len(normalized_tokens),
    )

    for index, token in enumerate(normalized_tokens[:first_aggregate_index]):
        add_requested(raw_tokens[index], token)

    for index, token in enumerate(normalized_tokens):
        if token not in {"by", "per", "using"} and not (
            token == "each" and index > 0 and normalized_tokens[index - 1] == "for"
        ):
            continue

        for following_index, following in enumerate(
            normalized_tokens[index + 1 :], start=index + 1
        ):
            if following in AGGREGATE_TERMS:
                break
            if following in STOP_TERMS:
                continue
            add_requested(raw_tokens[following_index], following)

    return requested - explicit_table_terms(query)


def _business_terms(query: str) -> set[str]:
    table_terms = explicit_table_terms(query)
    return {
        token
        for token in (
            canonical_term(token) for token in WORD_PATTERN.findall(query or "")
        )
        if _is_business_dimension_term(token) and token not in RELATIONSHIP_TERMS
        and token not in table_terms
    }


def _requests_relationship(
    query: str,
    query_terms: set[str],
    business_terms: set[str],
) -> bool:
    normalized = " ".join(
        canonical_term(token) for token in WORD_PATTERN.findall(query or "")
    )
    if query_terms & RELATIONSHIP_TERMS:
        return True

    if len(business_terms) < 2:
        return False

    return bool(
        re.search(
            r"\b(with|having|against|between|across)\b",
            normalized,
            flags=re.IGNORECASE,
        )
    )


def _is_business_dimension_term(term: str) -> bool:
    return (
        term not in STOP_TERMS
        and term not in AGGREGATE_TERMS
        and term not in DETAIL_TERMS
        and term not in GENERIC_BUSINESS_TERMS
        and len(term) >= 3
    )
