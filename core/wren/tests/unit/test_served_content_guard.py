"""Guard: every `wren <cmd>` mentioned in bundled skill/docs/template content
must resolve to a real CLI command (and `--flags` mentioned must be real flags
on that command).

This catches the "forward reference" failure mode we hit during incremental
rollout — e.g., a lifted skill mentioning `wren docs get` before that command
exists. By the time the branch is ready to ship, every command and flag the
served content tells an agent to run must actually exist in the CLI.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import click
import pytest
import typer

from wren.cli import app

pytestmark = pytest.mark.unit

# ── Build the real command tree ─────────────────────────────────────────────


def _flags(cmd) -> set[str]:
    flags: set[str] = set()
    for param in getattr(cmd, "params", []):
        if isinstance(param, click.Option):
            for opt in param.opts + param.secondary_opts:
                if opt.startswith("--"):
                    flags.add(opt)
    return flags


def _walk(cmd, prefix: str = "") -> dict[str, set[str]]:
    """Map command-path-string -> set of long flags.

    Uses ``cmd.commands`` directly rather than ``cmd.list_commands(ctx=None)``
    because the latter passes a ``None`` context — Click 8.4+ tightened that
    path and started returning ``[]``, which would silently collapse this
    map to the root command and neuter the guard.
    """
    out: dict[str, set[str]] = {prefix.strip(): _flags(cmd)}
    if isinstance(cmd, click.Group):
        for name, sub in cmd.commands.items():
            out.update(_walk(sub, f"{prefix} {name}".strip()))
    return out


COMMANDS: dict[str, set[str]] = _walk(typer.main.get_command(app))

# ``wren memory`` is conditionally registered (needs `wrenai[memory]`
# extras). It's a real public surface; bundled content correctly references
# it. Allow-list its subcommands so this guard doesn't flag false positives
# when the test env lacks memory extras.
_MEMORY_SUBCOMMANDS = (
    "index",
    "describe",
    "fetch",
    "store",
    "recall",
    "status",
    "reset",
    "list",
    "forget",
    "dump",
    "load",
)
COMMANDS.setdefault("memory", set())
for _s in _MEMORY_SUBCOMMANDS:
    COMMANDS.setdefault(f"memory {_s}", set())

# Typer/Click adds these to every command implicitly.
_UNIVERSAL_FLAGS = {"--help"}

# The first token after `wren` must be one of these (commands or top-level
# flags) for the snippet to count as a CLI invocation worth validating. Otherwise
# it's prose ("the wren engine connects to ...", "in the wren project layout").
_TOP_LEVEL_COMMANDS: set[str] = {p.split()[0] for p in COMMANDS if p}

# Flags on `wren memory ...` cannot be introspected here without the memory
# extras installed (qdrant + Volcengine Ark embeddings). Skip flag validation for
# memory commands; the command path itself is still validated via the
# allow-list above.
_SKIP_FLAG_VALIDATION_FOR_GROUPS = {"memory"}


# ── Scan served content ─────────────────────────────────────────────────────

_REPO = Path(__file__).resolve().parents[4]
_SKILLS_CONTENT = _REPO / "core" / "wren" / "src" / "wren" / "skills_content"
_DOCS_CONTENT = _REPO / "core" / "wren" / "src" / "wren" / "docs_content"
_ASK_TEMPLATES = _REPO / "core" / "wren" / "src" / "wren" / "ask_templates"
# The discovery stub ships to users' local skill dirs via `npx skills add`,
# so any `wren <cmd>` it references must resolve to a real CLI command too.
_DISCOVERY_STUB = _REPO / "skills" / "wren" / "SKILL.md"

# Match `wren ` followed by content up to a newline, backtick, single/double
# quote (avoid consuming SQL strings), or closing paren.
_INVOCATION = re.compile(r"\bwren\s+(?P<rest>[^\n`'\"\)]+)")

# A valid command-name token: lowercase alphanumerics + hyphens.
_TOKEN = re.compile(r"^[a-z][a-z0-9-]*$")


def _iter_content_files() -> list[Path]:
    """Yield every served-content file the guard must validate.

    Covers the package-data roots (`skills_content`, `ask_templates`) plus
    the standalone discovery stub at `skills/wren/` that's distributed to
    users via `npx skills add`. (`docs_content` is kept in the scan list as
    a no-op — the dir no longer ships, so it's skipped when absent.)
    """
    files: list[Path] = []
    for root in (_SKILLS_CONTENT, _DOCS_CONTENT, _ASK_TEMPLATES):
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*")):
            if path.is_file() and path.suffix in (".md", ".tmpl"):
                files.append(path)
    if _DISCOVERY_STUB.is_file():
        files.append(_DISCOVERY_STUB)
    return files


def _enumerate_invocations() -> list[tuple[Path, str, list[str]]]:
    """Return (file, raw_snippet, tokens) for every wren invocation in served content."""
    out: list[tuple[Path, str, list[str]]] = []
    for path in _iter_content_files():
        text = path.read_text(encoding="utf-8")
        # Join shell backslash-newline continuations so flags on follow-up
        # lines (e.g. `wren cube query \\\n  --measures revenue`) are part
        # of the same captured invocation rather than silently dropped.
        text = re.sub(r"\\\s*\n[ \t]*", " ", text)
        for m in _INVOCATION.finditer(text):
            snippet = m.group("rest").strip()
            tokens = snippet.split()
            if not tokens:
                continue
            out.append((path, snippet, tokens))
    return out


def _resolve(tokens: list[str]) -> tuple[str, list[str]]:
    """Walk the command tree as long as the next token is a sub-command.
    Returns (command_path, remaining_tokens).
    """
    path = ""
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        # stop walking on placeholders, flags, quoted args
        if not _TOKEN.match(tok):
            break
        candidate = (path + " " + tok).strip() if path else tok
        # extend path if candidate is a registered command OR a prefix of one
        if candidate in COMMANDS or any(
            p == candidate or p.startswith(candidate + " ") for p in COMMANDS
        ):
            path = candidate
            i += 1
        else:
            break
    return path, tokens[i:]


def _findings() -> list[str]:
    problems: list[str] = []
    for path, snippet, tokens in _enumerate_invocations():
        first = tokens[0]
        # Only treat as a CLI invocation if first token is a known top-level
        # command/group OR a top-level flag (e.g. `wren --sql ...`). Otherwise
        # it's prose ("the wren engine", "in the wren project layout") — skip.
        if not first.startswith("-") and first not in _TOP_LEVEL_COMMANDS:
            continue

        cmd_path, leftover = _resolve(tokens)
        try:
            rel = path.relative_to(_REPO)
        except ValueError:
            rel = path

        # Unknown-subcommand check. If `cmd_path` resolved to a group node
        # (has at least one child registered in COMMANDS) and the first
        # leftover token is a plain word, that word is an unknown
        # subcommand the user typo'd — `wren docs typo`, `wren memory typo`.
        # On a leaf command (`skills get`, `docs get`) leftover words are
        # positional args, not typos, so the children gate skips them.
        # Runs before _SKIP_FLAG_VALIDATION_FOR_GROUPS so typos under
        # `memory` are caught even though we can't introspect memory flags.
        if (
            leftover
            and _TOKEN.match(leftover[0])
            and any(p.startswith(f"{cmd_path} ") for p in COMMANDS if cmd_path)
        ):
            problems.append(
                f"{rel}: unknown subcommand '{leftover[0]}' for 'wren {cmd_path}'"
                + f"  (in `wren {snippet}`)"
            )
            continue

        # Skip flag validation for groups we can't introspect (memory needs
        # extras installed); the command path is still validated above by the
        # allow-list — only flags are skipped.
        cmd_group = cmd_path.split()[0] if cmd_path else ""
        if cmd_group in _SKIP_FLAG_VALIDATION_FOR_GROUPS:
            continue

        for tok in leftover:
            if not tok.startswith("--"):
                continue
            flag = tok.rstrip(",.;:")
            if flag in _UNIVERSAL_FLAGS:
                continue
            allowed = COMMANDS.get(cmd_path, set())
            if flag not in allowed:
                problems.append(
                    f"{rel}: unknown flag '{flag}' for 'wren {cmd_path}'".rstrip()
                    + f"  (in `wren {snippet}`)"
                )
    return problems


# ── Test surface ────────────────────────────────────────────────────────────


def test_command_tree_loaded():
    """Sanity: introspection finds the commands we expect."""
    assert "skills get" in COMMANDS
    assert "docs connection-info" in COMMANDS
    assert "ask" in COMMANDS
    assert "--full" in COMMANDS["skills get"]
    assert "--script" in COMMANDS["skills get"]
    assert "--guided" in COMMANDS["ask"]
    assert "--direct" in COMMANDS["ask"]


def test_served_content_invocations_resolve():
    problems = _findings()
    if problems:
        msg = (
            "Served content references commands/flags that don't exist:\n  "
            + "\n  ".join(problems)
        )
        pytest.fail(msg)


def test_at_least_one_invocation_was_validated():
    """Sanity: ensure the scanner actually finds invocations to validate
    (so a regression in the regex doesn't silently pass)."""
    invocations = _enumerate_invocations()
    # Current served content yields ~400 invocations. A regression in the
    # scanner that silently dropped most matches would weaken the guard
    # without obviously failing — keep the floor tight enough to notice.
    assert len(invocations) >= 200, (
        f"only found {len(invocations)} wren invocations; regex may be broken"
    )


def test_unknown_subcommand_is_flagged(tmp_path, monkeypatch):
    """An unknown subcommand under a known group (`wren docs typo`) must
    be reported. Leaf commands taking positional args (`wren skills get
    usage`) must NOT be flagged. Typos under `memory` must also be caught
    even though flag validation is skipped for memory.
    """
    fake_skill = tmp_path / "skill.md"
    fake_skill.write_text(
        "Run `wren docs typo` to break stuff.\n"
        "Also `wren skills get usage` — this is legit (positional, not typo).\n"
        "And `wren memory typo` — should also be flagged.\n",
        encoding="utf-8",
    )

    module = sys.modules[__name__]
    monkeypatch.setattr(module, "_SKILLS_CONTENT", tmp_path)
    monkeypatch.setattr(module, "_DOCS_CONTENT", tmp_path / "_empty_docs")
    monkeypatch.setattr(module, "_ASK_TEMPLATES", tmp_path / "_empty_ask")
    monkeypatch.setattr(module, "_DISCOVERY_STUB", tmp_path / "_no_stub.md")

    problems = _findings()
    joined = "\n".join(problems)
    assert "unknown subcommand 'typo' for 'wren docs'" in joined, problems
    assert "unknown subcommand 'typo' for 'wren memory'" in joined, problems
    # leaf + positional should NOT appear
    assert "'usage'" not in joined, problems
