"""MDL processing utilities backed by wren-core-py."""

from functools import cache

import wren_core


@cache
def get_session_context(
    manifest_str: str | None,
    function_path: str | None,
    properties: frozenset | None = None,
    data_source: str | None = None,
) -> wren_core.SessionContext:
    return wren_core.SessionContext(
        manifest_str, function_path, properties, data_source
    )


def get_manifest_extractor(manifest_str: str) -> wren_core.ManifestExtractor:
    return wren_core.ManifestExtractor(manifest_str)


def to_json_base64(manifest) -> str:
    return wren_core.to_json_base64(manifest)


def transform_sql(
    manifest_str: str,
    sql: str,
    data_source: str | None = None,
    function_path: str | None = None,
    properties: dict | None = None,
) -> str:
    """Transform SQL through wren-core MDL processing.

    Returns the planned SQL string (dialect-neutral DataFusion SQL).
    """
    processed = None
    if properties:
        processed = frozenset(properties.items())

    session = get_session_context(manifest_str, function_path, processed, data_source)
    return session.transform_sql(sql)
