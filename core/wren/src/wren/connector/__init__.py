from wren.connector.base import ConnectorABC
from wren.connector.factory import get_connector

__all__ = ["ConnectorABC", "get_connector", "smoke_test"]


def smoke_test(data_source, connection_info) -> None:
    """Run a trivial probe query through *data_source*'s connector.

    This exercises the same construction + dry-run path a real query would
    use (connector init — e.g. a DuckDB file attach — plus a ``SELECT 1``
    round trip), so a connection that is schema-valid but not actually
    queryable (wrong host, bad credentials, a DuckDB URL pointing at a file
    instead of its containing directory, ...) raises here instead of
    silently passing validation and only failing when a real question is
    asked.

    Data-source-agnostic: it goes through :func:`get_connector` and
    ``ConnectorABC.dry_run``, so it works for every registered connector.
    Raises whatever the connector/driver raises on failure — callers are
    expected to catch it and format a message naming the datasource.
    """
    from wren.connector.factory import get_connector  # noqa: PLC0415

    connector = get_connector(data_source, connection_info)
    connector.dry_run("SELECT 1")
