import re
from typing import Any

from haystack import Document


NOISY_METADATA_TERMS = (
    "archive",
    "audit",
    "backup",
    "cache",
    "copy",
    "debug",
    "dev",
    "duplicate",
    "etl",
    "import",
    "load",
    "log",
    "migration",
    "raw",
    "sample",
    "scratch",
    "sync",
    "sys",
    "technical",
    "temp",
    "test",
    "tmp",
)


EXPLICIT_NOISY_METADATA_TERMS = NOISY_METADATA_TERMS + (
    "temporary",
    "duplicates",
    "logs",
    "stage",
    "staging",
    "staged",
    "stages",
    "tests",
)


def normalize_metadata_token(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def metadata_terms(value: Any) -> set[str]:
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", str(value or ""))
    terms = {
        normalize_metadata_token(token)
        for token in re.split(r"[^A-Za-z0-9]+", text)
        if token
    }
    return {term for term in terms if term}


def query_requests_noisy_metadata(query: str) -> bool:
    query_terms = metadata_terms(query)
    return bool(query_terms.intersection(EXPLICIT_NOISY_METADATA_TERMS))


def is_noisy_metadata_name(value: Any) -> bool:
    terms = metadata_terms(value)
    if not terms:
        return False

    compact_value = normalize_metadata_token(value)
    if any(
        compact_value.startswith(prefix)
        for prefix in ("tmp", "temp", "test", "stg", "staging")
    ):
        return True

    return bool(terms.intersection(NOISY_METADATA_TERMS))


def is_noisy_metadata_text(value: Any) -> bool:
    terms = metadata_terms(value)
    if terms.intersection(NOISY_METADATA_TERMS):
        return True

    normalized = str(value or "").lower()
    return any(
        phrase in normalized
        for phrase in (
            "raw load",
            "load metadata",
            "staging rows",
            "temporary table",
            "technical table",
        )
    )


def is_noisy_document(document: Document) -> bool:
    name = document.meta.get("name", "")
    description = document.meta.get("description", "")
    return is_noisy_metadata_name(name) or is_noisy_metadata_text(description)


def filter_business_documents(query: str, documents: list[Document]) -> list[Document]:
    if not documents or query_requests_noisy_metadata(query):
        return documents

    filtered = [document for document in documents if not is_noisy_document(document)]
    return filtered or documents


def _extract_context_name(context: str) -> str:
    match = re.search(
        r"\bCREATE\s+(?:TABLE|VIEW)\s+([^\s(]+)",
        context or "",
        flags=re.IGNORECASE,
    )
    return match.group(1).strip("[]`\"") if match else ""


def is_noisy_schema_context(context: str) -> bool:
    name = _extract_context_name(context)
    return is_noisy_metadata_name(name) or is_noisy_metadata_text(context[:500])


def filter_business_schema_contexts(query: str, contexts: list[str]) -> list[str]:
    if not contexts or query_requests_noisy_metadata(query):
        return contexts

    filtered = [context for context in contexts if not is_noisy_schema_context(context)]
    return filtered or contexts
