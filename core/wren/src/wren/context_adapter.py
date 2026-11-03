"""Shared Wren context for agents: run the Rust loader, validate its output, project it.

The serve agent never keeps its own copy of a project's structure or rules. It asks the
``wren-context-loader`` binary for two documents (the Warble prepared context, used to
compile profiles, and the capability catalog, used for everything an agent reads at run
time) and treats a loader that cannot be found, answers in an unknown shape, or reports an
unparseable project as a startup failure. There is no fallback to a hand-written copy.

``Snapshot`` is one validated loader run. ``ContextReader`` is the run-time view of it
(``list`` -> ``select`` -> ``read``) plus two category views for an external planner
(``structure`` and ``rules``). Every projection drops the project's denied columns first.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from wren.agent_sql import model_schema, read_view_bodies, view_output_columns
from wren.declared_defaults import (
    DeclarationError,
    ExcludeRows,
    RequireRateJoin,
    SaleStatuses,
    read_declared_defaults,
    split_front_matter,
)

LOADER_ENV = "WREN_CONTEXT_LOADER_BIN"
LOADER_NAME = "wren-context-loader"
PREPARED_VERSION = 2
CATALOG_VERSION = 1
MAX_LOADER_OUTPUT_BYTES = 16 * 1024 * 1024
LOADER_TIMEOUT_S = 60
MAX_IDS = 16
MIN_BUDGET_BYTES = 512
RULE_PREFIX = "rule:"
DENIED_KEY = "denied_columns"

_DIGEST_ROOT_FILES = (
    "wren_project.yml",
    "relationships.yml",
    "cubes.yml",
    "dashboards.yml",
    "instructions.md",
)
_DIGEST_DIRS = ("models", "cubes", "views", "knowledge")


class ContextError(ValueError):
    """A context failure with a stable ``code``; ``str(exc)`` is the code plus any detail."""

    code = "context_error"

    def __init__(self, detail: str = ""):
        self.detail = detail
        super().__init__(f"{self.code}: {detail}" if detail else self.code)


class ContextLoaderUnavailable(ContextError):
    code = "context_loader_unavailable"


class ContextLoaderFailed(ContextError):
    code = "context_loader_failed"


class ContextLoaderIncompatible(ContextError):
    code = "context_loader_incompatible"


class ContextUnparseable(ContextError):
    code = "context_unparseable"

    def __init__(self, parse_error: str = ""):
        self.parse_error = parse_error
        super().__init__(parse_error[:300])


class ContextInconsistent(ContextError):
    code = "context_inconsistent"


class ContextNotBuilt(ContextError):
    code = "context_not_built"


class DeniedColumnsInvalid(ContextError):
    code = "denied_columns_invalid"


class DeclaredDefaultsInvalid(ContextError):
    code = "declared_defaults_invalid"


class SemanticsInvalid(ContextError):
    code = "semantics_invalid"


class ViewColumnsInvalid(ContextError):
    code = "view_columns_invalid"


class ContextChanged(ContextError):
    code = "context_changed"


# --- locating and running the loader ---------------------------------------------------------


def resolve_loader(env: dict | None = None) -> Path:
    """The loader binary: ``WREN_CONTEXT_LOADER_BIN``, else the in-repo cargo build.

    An explicit environment value that does not name an executable file is an error, not a
    reason to look elsewhere. Nothing here falls back to project metadata copies.
    """
    env = os.environ if env is None else env
    explicit = env.get(LOADER_ENV)
    if explicit:
        path = Path(explicit).expanduser()
        if path.is_file() and os.access(path, os.X_OK):
            return path.resolve()
        raise ContextLoaderUnavailable(f"{LOADER_ENV} does not name an executable file")
    for parent in Path(__file__).resolve().parents:
        crate = parent / "core" / "wren-context-loader"
        if (crate / "Cargo.toml").is_file():
            for profile in ("release", "debug"):
                candidate = crate / "target" / profile / LOADER_NAME
                if candidate.is_file() and os.access(candidate, os.X_OK):
                    return candidate
            break
    raise ContextLoaderUnavailable(
        f"set {LOADER_ENV} or build core/wren-context-loader with cargo"
    )


_identity_cache: dict[tuple[str, int, int], str] = {}


def loader_identity(path: Path) -> str:
    """``sha256:<hex>`` of the loader binary (memoised by path, size and mtime)."""
    stat = path.stat()
    key = (str(path), stat.st_size, stat.st_mtime_ns)
    if key not in _identity_cache:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                digest.update(chunk)
        _identity_cache[key] = f"sha256:{digest.hexdigest()}"
    return _identity_cache[key]


def project_digest(root: Path) -> str:
    """The loader's ``digest``, computed in Python so a running service can detect change.

    Same definition as ``wren_context_loader::project_digest``: SHA-256 over, for each
    covered file in path order, ``<path> NUL <byte length> NUL <bytes>``. Covered files are
    the root files ``wren_project.yml``, ``relationships.yml``, ``cubes.yml``,
    ``dashboards.yml`` and ``instructions.md`` plus everything under ``models/``,
    ``cubes/``, ``views/`` and ``knowledge/``; ``target/``, data files and dotfiles are
    not covered. Source directories and nested directory symlinks (including
    unresolved links) are refused; file symlinks remain covered by their path and
    target bytes. ``load_snapshot`` asserts the two implementations agree.
    """
    files: dict[str, Path] = {}
    for name in _DIGEST_ROOT_FILES:
        if (root / name).is_file():
            files[name] = root / name
    for name in _DIGEST_DIRS:
        base = root / name
        if base.is_symlink():
            raise OSError("directory_symlink_unsupported", str(base))
        if base.is_dir():
            _collect(base, name, files)
    digest = hashlib.sha256()
    for relative in sorted(files, key=lambda r: r.encode()):
        data = files[relative].read_bytes()
        digest.update(relative.encode() + b"\0" + str(len(data)).encode() + b"\0")
        digest.update(data)
    return digest.hexdigest()


def _collect(directory: Path, relative: str, files: dict[str, Path]) -> None:
    for entry in directory.iterdir():
        if entry.name.startswith("."):
            continue
        child = f"{relative}/{entry.name}"
        if entry.is_symlink() and not entry.is_file():
            raise OSError("directory_symlink_unsupported", str(entry))
        if entry.is_dir():
            _collect(entry, child, files)
        elif entry.is_file():
            files[child] = entry


def _read_json(path: Path, what: str):
    try:
        if path.stat().st_size > MAX_LOADER_OUTPUT_BYTES:
            raise ContextLoaderIncompatible(f"{what} is too large")
        value = json.loads(path.read_text(encoding="utf-8"))
    except ContextError:
        raise
    except (OSError, ValueError):
        raise ContextLoaderIncompatible(
            f"{what} is missing or not valid JSON"
        ) from None
    if not isinstance(value, dict):
        raise ContextLoaderIncompatible(f"{what} is not an object")
    return value


@dataclass(frozen=True)
class Snapshot:
    """One validated loader run over one project."""

    root: Path
    prepared: dict
    catalog: dict
    digest: str
    loader_identity: str
    denied: frozenset
    declarations: tuple
    manifest: dict = field(default_factory=dict)
    unverified_views: tuple = ()


def load_snapshot(project_root: Path, loader: Path | None = None) -> Snapshot:
    """Run the loader and validate everything about its answer.

    A zero exit code means only that the loader ran: ``parseable`` and the document
    versions are read from the output, and an old loader (no ``digest``) is refused.
    """
    root = Path(project_root).resolve(strict=True)
    loader = Path(loader) if loader is not None else resolve_loader()
    before = project_digest(root)
    with tempfile.TemporaryDirectory(prefix="wren-context-") as temp:
        prepared_path = Path(temp) / "prepared.json"
        catalog_path = Path(temp) / "catalog.json"
        try:
            run = subprocess.run(
                [
                    str(loader),
                    str(root),
                    "-o",
                    str(prepared_path),
                    "--catalog-out",
                    str(catalog_path),
                ],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=LOADER_TIMEOUT_S,
                env={"PATH": os.environ.get("PATH", "")},
            )
        except subprocess.TimeoutExpired:
            raise ContextLoaderFailed("the loader timed out") from None
        except OSError as exc:
            raise ContextLoaderUnavailable(
                f"cannot run the loader: {exc.strerror}"
            ) from None
        if run.returncode != 0:
            tail = run.stderr.decode("utf-8", "replace").strip().splitlines()[-1:]
            raise ContextLoaderFailed(
                f"exit {run.returncode}" + (f": {tail[0][:200]}" if tail else "")
            )
        prepared = _read_json(prepared_path, "prepared context")
        catalog = _read_json(catalog_path, "capability catalog")
    if prepared.get("context_version") != PREPARED_VERSION:
        raise ContextLoaderIncompatible("unexpected prepared context version")
    if prepared.get("parseable") is not True:
        raise ContextUnparseable(str(prepared.get("parse_error") or "unparseable"))
    if catalog.get("catalog_version") != CATALOG_VERSION:
        raise ContextLoaderIncompatible("unexpected catalog version")
    digest = catalog.get("digest")
    if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ContextLoaderIncompatible("the loader reports no content digest")
    if catalog.get("denied_columns_invalid") is True:
        raise DeniedColumnsInvalid(_denied_problems(catalog))
    if catalog.get("semantics_invalid") is True:
        raise SemanticsInvalid(_semantics_problems(catalog))
    if catalog.get("view_columns_invalid") is True:
        raise ViewColumnsInvalid(_view_columns_problems(catalog))
    after = project_digest(root)
    if before != after:
        raise ContextChanged("the project changed while it was being read")
    if digest != after:
        raise ContextLoaderIncompatible("the loader digest does not match the project")
    denied = _denied(catalog)
    manifest = _read_manifest(root)
    _check_consistent(catalog, manifest)
    unverified_views = _check_view_columns(catalog, manifest)
    _check_denied_exist(denied, catalog)
    _check_semantics(catalog, denied)
    try:
        declarations = tuple(
            read_declared_defaults(root, manifest, _catalog_enums(catalog))
        )
    except DeclarationError as exc:
        problems = "; ".join(f"{path}: {message}" for path, message in exc.errors)
        raise DeclaredDefaultsInvalid(problems[:400]) from None
    return Snapshot(
        root=root,
        prepared=prepared,
        catalog=catalog,
        digest=digest,
        loader_identity=loader_identity(loader),
        denied=denied,
        declarations=declarations,
        manifest=manifest,
        unverified_views=unverified_views,
    )


def _catalog_enums(catalog: dict) -> dict:
    """``(model, column) -> values`` for every catalog column that lists ``enum_values``."""
    return {
        (m["name"], c["name"]): tuple(str(v["value"]) for v in c["enum_values"])
        for m in catalog.get("models") or []
        for c in m.get("columns") or []
        if c.get("enum_values")
    }


def _semantics_problems(catalog: dict) -> str:
    entries = [
        f"{d.get('path')}: {d.get('entry')}"
        for d in catalog.get("diagnostics") or []
        if isinstance(d, dict) and d.get("kind") == "semantics_invalid"
    ]
    return "; ".join(entries)[:400] or "unreadable semantics declaration"


def _check_semantics(catalog: dict, denied: frozenset) -> None:
    """Every semantics entry must name something the project has and no denied column.

    An entry that names an unknown model or view never fires, which would read as "nothing is
    unverified here"; an entry whose text names a denied column would carry it into the
    ``unverified`` list. Neither is served.
    """
    known = {m["name"] for m in catalog.get("models") or []} | {
        v["name"] for v in catalog.get("views") or []
    }
    anywhere = frozenset(owner for owner, _ in denied)
    for entry in catalog.get("semantics") or []:
        unknown = sorted(set(entry["models"]) - known)
        if unknown:
            raise SemanticsInvalid(f"{entry['id']}: unknown model or view {unknown[0]}")
        if _mentions_denied(f"{entry['id']} {entry['note']}", anywhere, denied):
            raise SemanticsInvalid(f"{entry['id']}: names a denied column")


def _view_columns_problems(catalog: dict) -> str:
    entries = [
        f"{d.get('path')}: {d.get('entry')}"
        for d in catalog.get("diagnostics") or []
        if isinstance(d, dict) and d.get("kind") == "view_columns_invalid"
    ]
    return "; ".join(entries)[:400] or "unreadable view columns declaration"


def _check_view_columns(catalog: dict, manifest: dict) -> tuple:
    """Every declared view column list must be exactly what the view's statement outputs.

    The names are compared with the statement parsed the way a query reads it. A view the
    host cannot read, or whose output has no stable names (``COLUMNS(...)``, an unaliased
    expression, a repeated name), is not checked: it is returned so the start-up audit says
    so. Messages name columns, never the statement.
    """
    declared = {
        v["name"]: [c["name"] for c in v["columns"]]
        for v in catalog.get("views") or []
        if v.get("columns")
    }
    if not declared:
        return ()
    schema = model_schema(catalog.get("models") or [])
    usable, _ = read_view_bodies(schema, catalog, manifest)
    unverified = []
    for name, names in declared.items():
        body = usable.get(name.lower())
        actual = view_output_columns(body, schema) if body is not None else None
        if actual is None:
            unverified.append(name)
            continue
        if {n.lower() for n in names} != set(actual):
            only_declared = sorted({n.lower() for n in names} - set(actual))
            only_output = sorted(set(actual) - {n.lower() for n in names})
            raise ContextInconsistent(
                f"view {name} declares columns that differ from what its statement "
                f"outputs (declared only: {only_declared}; statement only: {only_output})"
            )
    return tuple(unverified)


def _denied_problems(catalog: dict) -> str:
    entries = [
        f"{d.get('path')}: {d.get('entry')}"
        for d in catalog.get("diagnostics") or []
        if isinstance(d, dict) and d.get("kind") == "denied_columns_invalid"
    ]
    return "; ".join(entries)[:400] or "unreadable denied_columns declaration"


def _denied(catalog: dict) -> frozenset:
    pairs = set()
    for entry in catalog.get("denied_columns") or []:
        if not isinstance(entry, str) or entry.count(".") != 1:
            raise ContextLoaderIncompatible("malformed denied_columns entry")
        model, column = entry.split(".")
        pairs.add((model, column))
    return frozenset(pairs)


def _read_manifest(root: Path) -> dict:
    path = root / "target" / "mdl.json"
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise ContextNotBuilt(
            "target/mdl.json is missing; run `wren context build`"
        ) from None
    if not isinstance(manifest, dict):
        raise ContextNotBuilt("target/mdl.json is not an object")
    return manifest


def _check_consistent(catalog: dict, manifest: dict) -> None:
    """The engine runs ``target/mdl.json``; the agent reads the catalog. They must agree."""
    manifest_views = {
        v["name"]
        for v in manifest.get("views") or []
        if isinstance(v, dict) and "name" in v
    }
    catalog_views = {v["name"] for v in catalog.get("views") or []}
    if manifest_views != catalog_views:
        raise ContextInconsistent(
            "target/mdl.json differs from the project sources in its views; run "
            f"`wren context build` (only built: {sorted(manifest_views - catalog_views)}; "
            f"only in sources: {sorted(catalog_views - manifest_views)})"
        )
    built = {
        m["name"]: {c["name"] for c in m.get("columns") or []}
        for m in manifest.get("models") or []
        if isinstance(m, dict) and "name" in m
    }
    described = {
        m["name"]: {c["name"] for c in m.get("columns") or []}
        for m in catalog.get("models") or []
    }
    if built != described:
        only_built = sorted(set(built) - set(described))
        only_described = sorted(set(described) - set(built))
        changed = sorted(
            n for n in built.keys() & described.keys() if built[n] != described[n]
        )
        raise ContextInconsistent(
            "target/mdl.json differs from the project sources; run `wren context build` "
            f"(only built: {only_built}; only in sources: {only_described}; "
            f"columns differ: {changed})"
        )


def _check_denied_exist(denied: frozenset, catalog: dict) -> None:
    columns = {
        (m["name"], c["name"])
        for m in catalog.get("models") or []
        for c in m.get("columns") or []
    }
    missing = sorted(f"{m}.{c}" for m, c in denied - columns)
    if missing:
        raise DeniedColumnsInvalid(", ".join(missing))


# --- text helpers ------------------------------------------------------------------------------


def _one_line(text: str | None) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _clip(text: str, limit: int) -> str:
    """``text`` cut to at most ``limit`` UTF-8 bytes (with an ellipsis when cut)."""
    raw = text.encode()
    if len(raw) <= limit:
        return text
    cut = raw[: max(0, limit - 3)].decode("utf-8", "ignore")
    return cut + "..."


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]


def _mentions_denied(
    sentence: str, model: str | frozenset | None, denied: frozenset
) -> bool:
    """Whether ``sentence`` names a denied column.

    The qualified ``model.column`` is always a match. A bare column name matches only for a
    column of ``model`` (one model name, or a set of them); ``None`` means no owner is known.
    """
    owners = {model} if isinstance(model, str) else (model or frozenset())
    lowered = sentence.lower()
    for owner, column in denied:
        if f"{owner}.{column}".lower() in lowered:
            return True
        if owner in owners and re.search(
            rf"\b{re.escape(column)}\b", sentence, re.IGNORECASE
        ):
            return True
    return False


def _prose(
    text: str | None, model: str | frozenset | None, denied: frozenset
) -> str | None:
    """A description with every sentence that names a denied column removed."""
    kept = [
        s for s in _sentences(_one_line(text)) if not _mentions_denied(s, model, denied)
    ]
    return " ".join(kept) or None


def _redact_rule_body(text: str, denied: frozenset) -> str:
    """A rule file whose body keeps no sentence that names a denied ``model.column``.

    The front-matter is carried verbatim (``strip_denied_declaration`` has already checked
    it); the body is cut line by line so lists, headings and blank lines survive, and each
    line loses the sentences ``_prose`` would drop from a description. A body left with no
    text at all is empty.
    """
    if not denied:
        return text
    try:
        front, _ = split_front_matter(text)
    except ValueError:
        front = None
    lines = text.splitlines(keepends=True)
    head = 0
    if front is not None:
        fences = 0
        for index, line in enumerate(lines):
            if line.strip("\ufeff").rstrip() == "---":
                fences += 1
                if fences == 2:
                    head = index + 1
                    break
    body = []
    for line in lines[head:]:
        content = line.rstrip("\r\n")
        if not content.strip() or not any(
            _mentions_denied(s, None, denied) for s in _sentences(_one_line(content))
        ):
            body.append(line)
            continue
        kept = _prose(content, None, denied)
        if kept:
            indent = content[: len(content) - len(content.lstrip())]
            body.append(indent + kept + line[len(content) :])
    if not any(line.strip() for line in body):
        body = []
    return "".join(lines[:head] + body)


def strip_denied_declaration(text: str, denied: frozenset = frozenset()) -> str:
    """A rule file without its ``denied_columns`` front-matter key.

    The declaration is configuration, not a business rule, and it names the very columns
    that must not be disclosed. The front-matter is parsed as YAML, the key dropped and the
    rest re-emitted, so every spelling the loader honours is removed; the body is returned as
    written. Fail closed: when the front-matter cannot be parsed but mentions the key, or when
    a denied ``model.column`` still occurs in the front-matter that remains, this raises
    ``DeniedColumnsInvalid`` rather than serve text that may disclose it.
    """
    import yaml  # noqa: PLC0415

    try:
        front, body = split_front_matter(text)
    except ValueError:
        return text
    if front is None:
        return text
    try:
        data = yaml.safe_load(front)
    except yaml.YAMLError:
        if DENIED_KEY in front.lower():
            raise DeniedColumnsInvalid("front-matter is unreadable") from None
        data = None
        remaining = front
        stripped = text
    else:
        remaining = front
        stripped = text
        if isinstance(data, dict) and DENIED_KEY in data:
            data = {k: v for k, v in data.items() if k != DENIED_KEY}
            rest = data
            if rest:
                remaining = yaml.safe_dump(
                    rest, sort_keys=False, allow_unicode=True, default_flow_style=None
                ).rstrip("\n")
                stripped = "---\n" + remaining + "\n---\n" + body
            else:
                remaining = ""
                stripped = body.lstrip("\n")
            if text.endswith("\n") and not stripped.endswith("\n"):
                stripped += "\n"
    # The raw text catches a name in a comment; the parsed data, dumped again, catches a spelling
    # the raw text hides (``"customers\x2eemail"``). Both run on every rule file, declaring or not.
    served = [remaining]
    if data is not None:
        served.append(yaml.safe_dump(data, allow_unicode=True, default_flow_style=None))
    lowered = "\n".join(served).lower()
    for owner, column in denied:
        if f"{owner}.{column}".lower() in lowered:
            raise DeniedColumnsInvalid(f"{owner}.{column} remains in the front-matter")
    return stripped


def _front_ids(content: str) -> list[str]:
    import yaml  # noqa: PLC0415

    try:
        front, _ = split_front_matter(content)
        data = yaml.safe_load(front) if front else None
    except (ValueError, yaml.YAMLError):
        return []
    entries = data.get("defaults") if isinstance(data, dict) else None
    return [
        e["id"]
        for e in entries or []
        if isinstance(e, dict) and isinstance(e.get("id"), str)
    ]


def _declaration_columns(declaration) -> set:
    if isinstance(declaration, (ExcludeRows, SaleStatuses)):
        return {(declaration.column.model, declaration.column.column)}
    if isinstance(declaration, RequireRateJoin):
        refs = [declaration.rate_currency, declaration.rate_date]
        for group in declaration.amounts:
            refs += [*group.columns, group.currency, *group.dates]
        return {(r.model, r.column) for r in refs}
    return set()


def _declaration_models(declaration) -> set:
    if isinstance(declaration, ExcludeRows):
        return set(declaration.covered)
    if isinstance(declaration, SaleStatuses):
        return {declaration.column.model}
    models = {m for m, _ in _declaration_columns(declaration)}
    if isinstance(declaration, RequireRateJoin):
        models.add(declaration.rate_model)
    return models


# --- the run-time reader -----------------------------------------------------------------------


class ContextReader:
    """``list`` -> ``select`` -> ``read`` over a snapshot, plus the planner category views.

    ``budget_bytes`` bounds the first page of ``list`` (which also carries the rules summary):
    that page is the worker's initial input. Later pages are as large as the budget allows. A
    project too big for one page is paged, never truncated and never refused.
    """

    def __init__(self, snapshot: Snapshot, denied, budget_bytes: int):
        if budget_bytes < MIN_BUDGET_BYTES:
            raise ValueError("invalid_context_budget")
        self.snapshot = snapshot
        self.denied = frozenset(denied)
        self.budget = budget_bytes
        catalog = snapshot.catalog
        self._models = {m["name"]: m for m in catalog.get("models") or []}
        self._cubes = {c["name"]: c for c in catalog.get("cubes") or []}
        self._views = {v["name"]: v for v in catalog.get("views") or []}
        self._relationships = [
            r
            for r in catalog.get("relationships") or []
            if not self._relationship_denied(r)
        ]
        self._rules = [
            {
                "path": r["path"],
                "content": self._stripped(r),
                "ids": _front_ids(r["content"]),
            }
            for r in catalog.get("knowledge_rules") or []
        ]
        by_id = {d.id: d for d in snapshot.declarations}
        for rule in self._rules:
            rule["declarations"] = [by_id[i] for i in rule["ids"] if i in by_id]
        self._lines = self._item_lines()
        self._pages = self._paginate()

    # -- items

    def _stripped(self, rule: dict) -> str:
        try:
            return _redact_rule_body(
                strip_denied_declaration(rule["content"], self.denied), self.denied
            )
        except DeniedColumnsInvalid as exc:
            raise DeniedColumnsInvalid(f"{rule['path']}: {exc.detail}") from None

    def _scope(self, kind: str, item: dict) -> frozenset:
        """The models whose denied columns a bare name in ``item``'s text may refer to.

        A model refers to itself and a cube to its base object. A view carries no definition
        the adapter can resolve, so any denied column may be the one it describes.
        """
        if kind == "model":
            return frozenset({item["name"]})
        if kind == "cube":
            return frozenset({item["base_object"]})
        return frozenset(owner for owner, _ in self.denied)

    def _relationship_denied(self, relationship: dict) -> bool:
        return _mentions_denied(
            str(relationship.get("condition") or ""), None, self.denied
        )

    def _columns(self, model: dict) -> list[dict]:
        return [
            c
            for c in model.get("columns") or []
            if not c.get("is_hidden") and (model["name"], c["name"]) not in self.denied
        ]

    def _view_columns(self, view: dict) -> list[dict]:
        """The view's declared columns, minus any whose name is a denied column of any model.

        A view has no owner model the adapter can resolve, so a denied name is dropped
        wherever it appears; descriptions lose sentences that name a denied column likewise.
        """
        names = {column.lower() for _, column in self.denied}
        scope = self._scope("view", view)
        out = []
        for column in view.get("columns") or []:
            if column["name"].lower() in names:
                continue
            entry = {"name": column["name"], "type": column["type"]}
            if description := _prose(column.get("description"), scope, self.denied):
                entry["description"] = description
            out.append(entry)
        return out

    def _defaults_for(self, model: str) -> list[str]:
        ids = []
        for declaration in self.snapshot.declarations:
            if model in _declaration_models(declaration) and declaration.id not in ids:
                ids.append(declaration.id)
        return ids

    def _item_lines(self) -> list[tuple[str, str, str]]:
        lines = []
        tables = (("model", self._models), ("cube", self._cubes), ("view", self._views))
        for kind, items in tables:
            for name, item in items.items():
                description = _prose(
                    item.get("description"), self._scope(kind, item), self.denied
                )
                tag = ""
                if kind == "model" and (ids := self._defaults_for(name)):
                    tag = f" [defaults: {','.join(ids)}]"
                if kind == "view" and item.get("guarantees"):
                    tag = f" [guarantees: {','.join(item['guarantees'])}]"
                lines.append(
                    (f"{kind} {name}: ", description or "(no description)", tag)
                )
        return lines

    def _rules_block(self) -> list[str]:
        if not self._rules:
            return []
        lines = [f'rules (read_context ids "{RULE_PREFIX}<path>" for the full text):']
        limit = self.budget // 4
        used = len(lines[0]) + 1
        for index, rule in enumerate(self._rules):
            parts = []
            if rule["ids"]:
                parts.append(f"defaults: {','.join(rule['ids'])}")
            columns = sorted(
                f"{m}.{c}"
                for declaration in rule["declarations"]
                for m, c in _declaration_columns(declaration)
                if (m, c) not in self.denied
            )
            if columns:
                parts.append(f"columns: {','.join(columns)}")
            line = f"rule {rule['path']}" + (": " + "; ".join(parts) if parts else "")
            if used + len(line.encode()) + 1 > limit:
                lines.append(
                    f"... {len(self._rules) - index} more rule file(s) not listed"
                )
                break
            lines.append(line)
            used += len(line.encode()) + 1
        return lines

    def _paginate(self) -> list[str]:
        rules = self._rules_block()
        rules_bytes = sum(len(x.encode()) + 1 for x in rules)
        header_room = 160
        pages: list[list[str]] = [[]]
        used = rules_bytes + header_room
        for prefix, description, tag in self._lines:
            line = prefix + description + tag
            size = len(line.encode()) + 1
            if used + size > self.budget and pages[-1]:
                pages.append([])
                used = header_room
            if used + size > self.budget:
                room = self.budget - used - len((prefix + tag).encode()) - 1
                line = prefix + _clip(description, max(16, room)) + tag
                size = len(line.encode()) + 1
            pages[-1].append(line)
            used += size
        total = len(pages)
        counts = f"{len(self._models)} models, {len(self._cubes)} cubes, {len(self._views)} views"
        texts = []
        for number, lines in enumerate(pages, start=1):
            body = [f"context index (page {number}/{total}): {counts}", *lines]
            if number == 1:
                body += rules
            if number < total:
                body.append(f"more: call list_context with page={number + 1}")
            texts.append("\n".join(body))
        return texts

    # -- the three worker operations

    @property
    def pages(self) -> int:
        return len(self._pages)

    @property
    def model_count(self) -> int:
        return len(self._models)

    def first_page_bytes(self) -> int:
        return len(self._pages[0].encode())

    def list(self, page: int = 1) -> dict:
        if (
            not isinstance(page, int)
            or isinstance(page, bool)
            or not 1 <= page <= self.pages
        ):
            return {"error": "page_out_of_range", "pages": self.pages}
        return {"page": page, "pages": self.pages, "text": self._pages[page - 1]}

    def _resolve(self, ident: str):
        if not isinstance(ident, str):
            return None
        if ident.startswith(RULE_PREFIX):
            path = ident[len(RULE_PREFIX) :]
            return next((("rule", r) for r in self._rules if r["path"] == path), None)
        tables = (("model", self._models), ("cube", self._cubes), ("view", self._views))
        hits = [(kind, table[ident]) for kind, table in tables if ident in table]
        return hits[0] if len(hits) == 1 else None

    def _check_ids(self, ids) -> dict | None:
        if not isinstance(ids, list) or not ids or len(ids) > MAX_IDS:
            return {
                "error": "invalid_ids",
                "hint": f"pass 1 to {MAX_IDS} ids from the context index",
            }
        unknown = [i for i in ids if self._resolve(i) is None]
        if unknown:
            return {
                "error": "unknown_context_id",
                "unknown": [str(i)[:64] for i in unknown],
                "hint": "use a model, cube or view name from the context index, or rule:<path>",
            }
        return None

    def select(self, ids) -> dict:
        """Record which items the worker intends to use. Nothing is read or granted by it."""
        if (problem := self._check_ids(ids)) is not None:
            return problem
        return {"selected": list(dict.fromkeys(ids))}

    def read(self, ids) -> dict:
        """The named items in full: columns, enum meanings and the rule files that concern them."""
        if (problem := self._check_ids(ids)) is not None:
            return problem
        items, rule_paths = [], []
        for ident in dict.fromkeys(ids):
            kind, value = self._resolve(ident)
            if kind == "rule":
                self._add_rule(rule_paths, value["path"])
            elif kind == "model":
                items.append(self._model_item(value))
                for rule in self._rules_about(value["name"]):
                    self._add_rule(rule_paths, rule["path"])
            elif kind == "cube":
                items.append(self._cube_item(value))
            else:
                items.append(self._view_item(value))
        by_path = {r["path"]: r for r in self._rules}
        return {
            "items": items,
            "rules": [
                {"path": p, "content": by_path[p]["content"]} for p in rule_paths
            ],
        }

    @staticmethod
    def _add_rule(paths: list, path: str) -> None:
        if path not in paths:
            paths.append(path)

    def _rules_about(self, model: str) -> list[dict]:
        pattern = re.compile(rf"(?<![A-Za-z0-9_]){re.escape(model)}(?![A-Za-z0-9_])")
        about = []
        for rule in self._rules:
            declared = any(
                model in _declaration_models(d) for d in rule["declarations"]
            )
            try:
                _, body = split_front_matter(rule["content"])
            except ValueError:
                body = rule["content"]
            if declared or pattern.search(body):
                about.append(rule)
        return about

    def _model_item(self, model: dict) -> dict:
        name = model["name"]
        visible = {c["name"] for c in self._columns(model)}
        relationships = [
            r for r in self._relationships if name in (r.get("models") or [])
        ]
        kept_relationships = {r["name"] for r in relationships}
        columns = []
        for column in self._columns(model):
            entry = {"name": column["name"], "type": column["type"]}
            if description := _prose(column.get("description"), name, self.denied):
                entry["description"] = description
            for flag in ("not_null", "is_calculated"):
                if column.get(flag):
                    entry[flag] = True
            if column.get("enum_values"):
                entry["enum_values"] = column["enum_values"]
            if column.get("relationship") in kept_relationships:
                entry["relationship"] = column["relationship"]
            columns.append(entry)
        item = {
            "kind": "model",
            "name": name,
            "description": _prose(model.get("description"), name, self.denied),
            "primary_key": [k for k in model.get("primary_key") or [] if k in visible],
            "columns": columns,
        }
        if relationships:
            item["relationships"] = [
                {k: r[k] for k in ("name", "models", "join_type", "condition")}
                for r in relationships
            ]
        return {k: v for k, v in item.items() if v not in (None, [])}

    def _cube_item(self, cube: dict) -> dict:
        base = cube["base_object"]
        scope = self._scope("cube", cube)

        def members(key: str) -> list[dict]:
            return [
                member(m)
                for m in cube.get(key) or []
                if (base, str(m["name"]).lower()) not in self.denied
            ]

        def member(m: dict) -> dict:
            out = {"name": m["name"], "type": m["type"]}
            if description := _prose(m.get("description"), scope, self.denied):
                out["description"] = description
            for key in ("granularities", "date_range"):
                if m.get(key):
                    out[key] = m[key]
            return out

        return {
            "kind": "cube",
            "name": cube["name"],
            "base_object": base,
            "description": _prose(cube.get("description"), scope, self.denied),
            "measures": members("measures"),
            "dimensions": members("dimensions"),
            "time_dimensions": members("time_dimensions"),
        }

    def _view_item(self, view: dict) -> dict:
        item = {
            "kind": "view",
            "name": view["name"],
            "description": _prose(
                view.get("description"), self._scope("view", view), self.denied
            ),
            "guarantees": list(view.get("guarantees") or []),
            "columns": self._view_columns(view),
        }
        return {k: v for k, v in item.items() if v not in (None, [])}

    # -- host-generated summaries and the planner category views

    def describe(self) -> str:
        """One business line per model; any sentence that names an identifier is dropped.

        No columns, types, relationships or physical tables. The private model can request it
        but never rewrite it.
        """
        lines = [
            "Data available for analysis (business summary; technical names omitted):"
        ]
        for name, model in self._models.items():
            label = name.replace("_", " ")
            raw = _prose(model.get("description"), name, self.denied) or ""
            kept = [
                s for s in _sentences(raw) if not re.search(r"\b\w+(?:_\w+|\.\w+)\b", s)
            ]
            lines.append(f"- {label}: {' '.join(kept)}" if kept else f"- {label}")
        return "\n".join(lines)

    def structure_document(self) -> str:
        """``schema.structure``: every item line and the column table of each model and of each view
        that declares columns. No SQL, no rules."""
        out = ["# Structure", ""]
        for prefix, description, tag in self._lines:
            out.append(f"- {prefix}{description}{tag}")
        for name, model in self._models.items():
            out += [
                "",
                f"## {name}",
                "",
                "| column | type | description |",
                "| --- | --- | --- |",
            ]
            for column in self._columns(model):
                text = _prose(column.get("description"), name, self.denied) or ""
                out.append(
                    f"| {column['name']} | {column['type']} | {text.replace('|', '/')} |"
                )
        for name, view in self._views.items():
            if not (columns := self._view_columns(view)):
                continue
            out += [
                "",
                f"## {name}",
                "",
                "| column | type | description |",
                "| --- | --- | --- |",
            ]
            for column in columns:
                text = column.get("description", "")
                out.append(
                    f"| {column['name']} | {column['type']} | {text.replace('|', '/')} |"
                )
        if self._relationships:
            out += ["", "## Relationships", ""]
            for r in self._relationships:
                out.append(f"- {r['name']} ({r['join_type']}): {r['condition']}")
        return "\n".join(out) + "\n"

    def rules_document(self) -> str:
        """``knowledge.rules``: the rule files in full. ``knowledge/sql`` is never carried."""
        text = "\n\n".join(f"## {r['path']}\n\n{r['content']}" for r in self._rules)
        return text + "\n" if text else ""

    def documents(self) -> dict:
        return {
            "structure": {
                "id": "structure",
                "kind": "schema.structure",
                "content": self.structure_document(),
            },
            "rules": {
                "id": "rules",
                "kind": "knowledge.rules",
                "content": self.rules_document(),
            },
        }

    def loaded_event(self) -> dict:
        return {
            "event": "context_loaded",
            "digest": self.snapshot.digest,
            "loader_identity": self.snapshot.loader_identity,
            "models": self.model_count,
            "pages": self.pages,
            "budget_bytes": self.budget,
            "first_page_bytes": self.first_page_bytes(),
        }
