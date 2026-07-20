"""SQL policy validation for strict query mode.

Validates that a parsed SQL AST only references tables defined in the MDL
manifest and does not use any denied functions.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Iterable

import sqlglot
from sqlglot import exp, parse_one
from sqlglot.errors import SqlglotError

from wren.config import WrenConfig
from wren.model.error import ErrorCode, ErrorPhase, WrenError

# Row-expansion operators (UNNEST / FLATTEN / EXPLODE) are not data sources —
# they restructure an array/struct expression that is already in query scope
# (e.g. a governed model column like ``orders.items``), so they never read data
# outside the manifest and must not be treated as a disallowed table-valued
# function. The class mapping is stable across dialects: ``UNNEST`` ->
# ``exp.Unnest`` (trino/postgres/duckdb), Snowflake ``FLATTEN`` -> ``exp.Explode``,
# so no per-dialect name matching is needed.
#
# Note: ``UNNEST(read_csv(...))`` used to be allowed because the data-reader
# guard only governed the top-level source position. As of the all-positions
# data-reader check below (issue #2409 section C), the inner ``read_csv`` is now
# blocked regardless of being wrapped by UNNEST — the reader scan walks every
# AST position, so it sees the nested reader before the row-expansion allow-list
# is ever consulted.
_ROW_EXPANSION_FUNCS: tuple[type[exp.Func], ...] = (exp.Unnest, exp.Explode)

# ── Category C: data/file readers (issue #2409) ─────────────────────────────
#
# Data-reading table-valued functions read bytes from *outside* the MDL
# manifest: local files (``read_csv('/etc/passwd')`` → path traversal), object
# storage / URLs (``read_parquet('s3://...')`` → SSRF / exfiltration), or other
# databases (``dblink`` / ``postgres_scan`` → lateral movement). Allowing any of
# them defeats strict-mode governance (RLAC/CLAC), so they are ALWAYS blocked
# under strict mode, in EVERY AST position — not just the FROM/JOIN source slot
# (which is all PR #2405 covered).
#
# IMPORTANT — for non-source positions this is a *blocklist*, not a fail-closed
# allowlist. The source position (FROM/JOIN) is genuinely fail-closed:
# ``_check_tables`` rejects ANY unknown TVF there. But you cannot allowlist
# every scalar function that may appear in a projection or WHERE clause, so for
# non-source positions this named list is the security boundary: a reader that
# is not enumerated here will pass in a projection / subquery / nested-arg
# position. The list must therefore be MAINTAINED PER-CONNECTOR as new
# file/remote readers land upstream, and operators who need to guard a reader
# not covered here should add it to ``denied_functions`` as a defense-in-depth
# backstop. Matching is by both the raw function name (for ``exp.Anonymous``
# parses like ``glob`` / ``dblink``) and by the canonical sqlglot class key
# (e.g. ``read_csv`` → ``exp.ReadCSV`` → ``"readcsv"``), via the same
# dialect-probe used for the denylist.
_DATA_READER_NAMES: frozenset[str] = frozenset(
    {
        # duckdb file readers
        "read_csv",
        "read_csv_auto",
        "read_parquet",
        "read_json",
        "read_json_auto",
        "read_ndjson",
        "read_ndjson_auto",
        "read_json_objects",
        "read_text",
        "read_blob",
        "read_xlsx",
        "parquet_scan",
        "glob",
        # duckdb extension scanners (lakehouse / external db)
        "iceberg_scan",
        "delta_scan",
        "postgres_scan",
        "postgres_query",
        "mysql_scan",
        "mysql_query",
        "sqlite_scan",
        "sqlite_query",
        # postgres file / remote readers
        "pg_read_file",
        "pg_read_binary_file",
        "pg_ls_dir",
        "pg_ls_logdir",
        "pg_ls_waldir",
        "pg_ls_tmpdir",
        "pg_ls_archive_statusdir",
        "pg_stat_file",
        "lo_import",
        "lo_get",
        "dblink",
        "dblink_exec",
        # mysql file reader (same arbitrary-file-read primitive as read_csv,
        # just via a first-class connector)
        "load_file",
        # duckdb spatial / sniffing / metadata scanners over arbitrary paths
        "sniff_csv",
        "st_read",
        "st_readosm",
        "st_read_meta",
        "parquet_metadata",
        "parquet_file_metadata",
        "parquet_kv_metadata",
        "parquet_schema",
        "iceberg_metadata",
        "iceberg_snapshots",
        # generic external fetch
        "url",
    }
)

# ── Category B: synthetic generators (issue #2409) ──────────────────────────
#
# Generators (``generate_series`` / ``sequence`` / ``range``) read nothing
# outside the manifest, so they are not an exfiltration risk — but an unbounded
# range is a denial-of-service vector (``generate_series(1, 1e12)`` materialises
# a trillion rows). They are therefore blocked by default in source position and
# only allowed when the operator explicitly opts a name in via
# ``allowed_source_functions``. Matching goes through the shared canonicalizer
# so an opt-in of ``generate_series`` matches whether sqlglot lands it on
# ``exp.GenerateSeries`` / ``exp.ExplodingGenerateSeries`` or ``exp.Anonymous``.
_GENERATOR_NAMES: frozenset[str] = frozenset({"generate_series", "sequence", "range"})

# Dialects we probe when canonicalising the user's denylist. sqlglot can map
# the same function name (e.g. ``version()``) onto different concrete AST
# subclasses depending on the dialect — postgres/mysql/duckdb/trino/clickhouse
# normalise to ``CurrentVersion`` while tsql/oracle/bigquery/snowflake keep it
# as ``Anonymous``. Probing each dialect ensures the canonical class key is
# captured regardless of which one the user's SQL ends up parsed with.
_CANONICALISE_DIALECTS: tuple[str | None, ...] = (
    None,
    "postgres",
    "mysql",
    "tsql",
    "oracle",
    "bigquery",
    "snowflake",
    "clickhouse",
    "trino",
    "duckdb",
)


def resolve_model_name(
    name: str,
    quoted: bool,
    model_names: Iterable[str],
) -> str | None:
    """Resolve a SQL table identifier to a manifest model name.

    Follows the SQL convention used across Wren's CTE rewriter, policy check,
    and manifest extractor: a quoted identifier must match a model name
    case-sensitively; an unquoted identifier prefers an exact case match but
    falls back to a case-insensitive scan. Returns ``None`` if no model
    matches.
    """
    model_set = (
        model_names if isinstance(model_names, (set, frozenset)) else set(model_names)
    )
    if name in model_set:
        return name
    if quoted:
        return None
    name_lower = name.lower()
    for candidate in model_set:
        if candidate.lower() == name_lower:
            return candidate
    return None


def basic_safety_check(sql: str) -> None:
    """Run BEFORE any SQL execution, regardless of strict_mode.

    Rejects empty SQL, multi-statement SQL, DDL, DML, and file-reading
    operations (COPY). This is a fundamental safety gate — not a replacement
    for strict-mode policy validation.
    """
    if not sql.strip():
        raise WrenError(
            ErrorCode.POLICY_VIOLATION,
            "Empty SQL statement",
            phase=ErrorPhase.SQL_POLICY_CHECK,
        )

    try:
        stmts = list(sqlglot.parse(sql))
    except SqlglotError as e:
        raise WrenError(
            ErrorCode.INVALID_SQL,
            f"Could not parse SQL: {e}",
            phase=ErrorPhase.SQL_POLICY_CHECK,
        ) from e

    if len(stmts) > 1:
        raise WrenError(
            ErrorCode.POLICY_VIOLATION,
            "Multi-statement SQL is not allowed",
            phase=ErrorPhase.SQL_POLICY_CHECK,
        )

    if not stmts or stmts[0] is None:
        raise WrenError(
            ErrorCode.INVALID_SQL,
            "Could not parse SQL statement",
            phase=ErrorPhase.SQL_POLICY_CHECK,
        )
    stmt = stmts[0]

    if isinstance(stmt, (exp.Create, exp.Drop, exp.Alter, exp.Truncate, exp.Rename)):
        raise WrenError(
            ErrorCode.POLICY_VIOLATION,
            f"DDL not allowed: {type(stmt).__name__}",
            phase=ErrorPhase.SQL_POLICY_CHECK,
        )

    if isinstance(stmt, (exp.Insert, exp.Update, exp.Delete, exp.Merge)):
        raise WrenError(
            ErrorCode.POLICY_VIOLATION,
            f"DML not allowed: {type(stmt).__name__}",
            phase=ErrorPhase.SQL_POLICY_CHECK,
        )

    if isinstance(stmt, exp.Copy):
        raise WrenError(
            ErrorCode.POLICY_VIOLATION,
            "COPY statement is not allowed",
            phase=ErrorPhase.SQL_POLICY_CHECK,
        )


def validate_sql_policy(
    ast: exp.Expression,
    model_names: set[str],
    config: WrenConfig,
) -> None:
    """Raise ``WrenError`` if the SQL violates strict-mode policies.

    Parameters
    ----------
    ast:
        Parsed sqlglot AST of the user query.
    model_names:
        Set of model names defined in the MDL manifest.
    config:
        Wren configuration with strict_mode and denied_functions settings.
    """
    if config.strict_mode:
        # Data-reading TVFs (read_csv / dblink / postgres_scan / ...) are
        # blocked in EVERY position first (issue #2409 section C) so a reader
        # smuggled into a projection or subquery can't slip past the
        # source-only table scan below.
        _check_data_readers(ast)
        _check_tables(ast, model_names, config.allowed_source_functions)
    if config.denied_functions:
        _check_functions(ast, config.denied_functions)


def _visible_cte_names(node: exp.Expression) -> set[str]:
    """Return CTE names visible at *node*'s scope by walking up the AST."""
    names: set[str] = set()
    cursor = node.parent
    while cursor is not None:
        # A WITH clause is visible to its parent SELECT and siblings.
        with_clause = cursor.args.get("with_") if hasattr(cursor, "args") else None
        if isinstance(with_clause, exp.With):
            for cte in with_clause.expressions:
                alias = cte.args.get("alias")
                if alias:
                    cte_name = (
                        alias.this.name
                        if isinstance(alias.this, exp.Identifier)
                        else str(alias.this)
                    )
                    names.add(cte_name.lower())
        cursor = cursor.parent
    return names


def _check_tables(
    ast: exp.Expression,
    model_names: set[str],
    allowed_source_functions: frozenset[str] = frozenset(),
) -> None:
    for table in ast.find_all(exp.Table):
        name = table.name
        if not name:
            # Table nodes with no name are table-valued functions
            # (e.g. read_csv(), generate_series()). A TVF written WITH an alias
            # (``generate_series(1,10) AS t(x)``) parses as an exp.Table whose
            # ``this`` is the inner func, so the category checks must look at
            # the wrapped func here too. Data readers are already blocked
            # globally by _check_data_readers; a generator may be opted in.
            inner = table.this
            if isinstance(inner, exp.Func) and _is_allowed_generator(
                inner, allowed_source_functions
            ):
                continue
            sql_text = table.sql()
            if sql_text:
                raise WrenError(
                    ErrorCode.MODEL_NOT_FOUND,
                    f"Table-valued function '{sql_text}' is not allowed. "
                    "In strict mode, all table references must correspond to MDL models.",
                    phase=ErrorPhase.SQL_POLICY_CHECK,
                )
            continue
        quoted = (
            bool(table.this.quoted) if isinstance(table.this, exp.Identifier) else False
        )
        if resolve_model_name(name, quoted, model_names) is not None:
            continue
        if name.lower() in _visible_cte_names(table):
            continue
        raise WrenError(
            ErrorCode.MODEL_NOT_FOUND,
            f"Table '{name}' is not defined in the MDL manifest. "
            "In strict mode, all table references must correspond to MDL models.",
            phase=ErrorPhase.SQL_POLICY_CHECK,
        )

    # Func subclasses used as query sources (e.g. UNNEST, generate_series)
    # produce no exp.Table node at all. They can appear both as the FROM
    # source AND as a JOIN source (e.g. ``orders CROSS JOIN UNNEST(items)``),
    # so scan both — checking only FROM let a table-valued function slip
    # through strict mode whenever it was reached via a JOIN.
    for clause in ast.find_all(exp.From, exp.Join):
        source = clause.this
        if isinstance(source, exp.Alias):
            source = source.this
        # LATERAL-wrapped TVFs (e.g. ``LATERAL FLATTEN(...)`` /
        # ``LATERAL generate_series(...)``) parse to an exp.Lateral node that
        # *wraps* the function rather than being an exp.Func itself, so the
        # bare-Func check below would miss them. Unwrap to inspect the inner
        # source — this is the same "TVF reached via JOIN" bug class.
        if isinstance(source, exp.Lateral):
            source = source.this
            if isinstance(source, exp.Alias):
                source = source.this
        if isinstance(source, _ROW_EXPANSION_FUNCS):
            # Category A — row-expansion over an in-scope expression (e.g. a
            # governed model column) reads nothing outside the manifest: allow.
            continue
        if isinstance(source, exp.Func):
            # Category C readers are already blocked everywhere by
            # _check_data_readers; reaching here means the source func is a
            # generator (category B) or some other non-model source func.
            # Category B — synthetic generators are blocked by default (DoS via
            # unbounded ranges) but may be opted in by the operator per name.
            if _is_allowed_generator(source, allowed_source_functions):
                continue
            raise WrenError(
                ErrorCode.MODEL_NOT_FOUND,
                f"Table-valued function '{source.sql()}' is not allowed. "
                "In strict mode, all table references must correspond to MDL models.",
                phase=ErrorPhase.SQL_POLICY_CHECK,
            )


@lru_cache(maxsize=128)
def _canonical_names(names: frozenset[str]) -> frozenset[str]:
    """Expand a set of function names to also cover sqlglot's canonical keys.

    sqlglot >=29 maps several common functions onto concrete subclasses —
    e.g. ``version()`` becomes ``exp.CurrentVersion`` in
    postgres/mysql/duckdb/trino/clickhouse (with ``type(node).key ==
    "currentversion"``), while in tsql/oracle/bigquery/snowflake it stays
    as ``exp.Anonymous(name="version")``. A plain name entry of ``"version"``
    would only match the anonymous case without this expansion. Probing each
    known dialect collects every class key the name might land on at parse
    time and adds them all to the result.

    Used for the denylist, the data-reader blocklist, and the generator
    opt-in allowlist so all three match a function whether sqlglot keeps it
    anonymous or reclassifies it to a concrete subclass.
    """
    expanded: set[str] = {d.lower() for d in names}
    for name in list(expanded):
        for dialect in _CANONICALISE_DIALECTS:
            # Probe both arity-0 and arity-1 forms: some functions only parse to
            # their concrete subclass when given an argument (e.g. duckdb
            # ``read_csv('x')`` -> exp.ReadCSV, while ``read_csv()`` fails to
            # parse), so an args-less probe alone would miss the class key.
            for probe in (
                f"SELECT {name}()",
                f"SELECT {name}('x')",
                f"SELECT {name}(1, 2)",
            ):
                try:
                    ast = parse_one(probe, dialect=dialect)
                except SqlglotError:
                    # A malformed entry can fail tokenizing or parsing on some
                    # dialects; skip it rather than crashing validation
                    # (SqlglotError covers ParseError and TokenError).
                    continue
                first_func = next(ast.find_all(exp.Func), None)
                if first_func is not None and not isinstance(first_func, exp.Anonymous):
                    expanded.add(type(first_func).key.lower())
    return frozenset(expanded)


# Backwards-compatible alias: the denylist canonicalizer is the generic one.
_canonical_denied = _canonical_names


def _func_match_keys(func: exp.Func) -> tuple[str, str]:
    """Return the (raw-name, class-key) pair used to match *func* against a set.

    Anonymous funcs carry the user-written name (e.g. ``glob``, ``dblink``);
    concrete subclasses carry a stable class key (e.g. ``read_csv`` ->
    ``"readcsv"``). Checking both against a canonicalized name set means a
    single source-of-truth name list matches regardless of how sqlglot parsed
    the call on a given dialect.
    """
    return (func.name or "").lower(), type(func).key.lower()


def _is_data_reader(func: exp.Func) -> bool:
    """True if *func* is a known data/file/remote reader (issue #2409 cat. C)."""
    raw, key = _func_match_keys(func)
    canonical = _canonical_names(_DATA_READER_NAMES)
    return raw in canonical or key in canonical


def _is_allowed_generator(
    func: exp.Func, allowed_source_functions: frozenset[str]
) -> bool:
    """True if *func* is a generator the operator explicitly opted in.

    Generators are only relevant in the source position; the opt-in is matched
    through the shared canonicalizer so ``generate_series`` matches whether it
    parsed to ``exp.GenerateSeries`` / ``exp.ExplodingGenerateSeries`` or
    ``exp.Anonymous``. Only names that are *both* known generators and present
    in the operator allowlist are permitted — never readers.
    """
    if not allowed_source_functions:
        return False
    raw, key = _func_match_keys(func)
    generators = _canonical_names(_GENERATOR_NAMES)
    if raw not in generators and key not in generators:
        return False
    allowed = _canonical_names(allowed_source_functions)
    return raw in allowed or key in allowed


def _check_data_readers(ast: exp.Expression) -> None:
    """Block data-reading TVFs in EVERY AST position under strict mode.

    PR #2405 only governed readers in the top-level FROM/JOIN source slot, so a
    reader smuggled into a projection (``SELECT read_csv('/etc/passwd')``), a
    WHERE/IN subquery, or a nested function argument
    (``UNNEST(read_csv(...))``) bypassed MDL governance entirely — a real
    path-traversal / SSRF / exfiltration hole. This walks the whole tree and
    fails closed on the first known reader, wherever it appears.
    """
    for func in ast.find_all(exp.Func):
        if _is_data_reader(func):
            # Report only the function name, never ``func.sql()`` — the full
            # expression would echo the argument (file paths, URLs, DSNs /
            # connection strings) back into the error message and logs, which
            # is a needless info-leak of exactly the sensitive target this
            # guard exists to block.
            # For exp.Anonymous the user-written name is authoritative; for
            # concrete subclasses ``func.name`` can return the *argument*
            # (e.g. exp.ReadCSV.name -> the file path), so use the stable class
            # key there to avoid leaking the target.
            reader_name = (
                func.name if isinstance(func, exp.Anonymous) else type(func).key
            )
            raise WrenError(
                ErrorCode.MODEL_NOT_FOUND,
                f"Data-reading function '{reader_name}' is not allowed. "
                "In strict mode, reading data outside the MDL manifest "
                "(files, URLs, or external databases) is forbidden in all "
                "query positions.",
                phase=ErrorPhase.SQL_POLICY_CHECK,
            )


def _check_functions(
    ast: exp.Expression,
    denied: frozenset[str],
) -> None:
    canonical = _canonical_denied(denied)
    for func in ast.find_all(exp.Func):
        if isinstance(func, exp.Anonymous):
            name = func.name
        else:
            name = type(func).key
        if name.lower() in canonical:
            raise WrenError(
                ErrorCode.BLOCKED_FUNCTION,
                f"Function '{name}' is not allowed "
                f"(matched denied function '{name.lower()}').",
                phase=ErrorPhase.SQL_POLICY_CHECK,
            )
