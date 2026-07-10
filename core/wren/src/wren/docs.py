"""Generate documentation for Wren connection info models."""

from __future__ import annotations

import json
from typing import Any, Union

from pydantic import SecretStr

from wren.model import BaseConnectionInfo
from wren.model.field_registry import DATASOURCE_MODELS  # noqa: F401


def _resolve_sources(
    datasource: str | None,
) -> dict[str, list[type[BaseConnectionInfo]]]:
    """Resolve datasource filter to a subset of DATASOURCE_MODELS.

    Raises ValueError for unknown data source names.
    """
    if datasource is None:
        return DATASOURCE_MODELS
    key = datasource.lower()
    if key not in DATASOURCE_MODELS:
        available = ", ".join(sorted(DATASOURCE_MODELS))
        raise ValueError(f"Unknown data source: {datasource}\nAvailable: {available}")
    return {key: DATASOURCE_MODELS[key]}


def _union_args(annotation) -> tuple | None:
    """Return the type args if annotation is a Union/UnionType, else None."""
    import types  # noqa: PLC0415

    if isinstance(annotation, types.UnionType):
        return annotation.__args__
    origin = getattr(annotation, "__origin__", None)
    if origin is Union:
        return annotation.__args__
    return None


def _is_sensitive(field_info) -> bool:
    """Check if a field uses SecretStr (i.e. holds sensitive data)."""
    annotation = field_info.annotation
    args = _union_args(annotation)
    if args:
        return any(a is SecretStr for a in args)
    return annotation is SecretStr


def _friendly_type(annotation) -> str:
    """Convert a single type annotation to a readable string."""
    if annotation is SecretStr:
        return "string"
    if annotation is bool:
        return "boolean"
    if annotation is int:
        return "integer"
    if annotation is float:
        return "number"
    if annotation is str:
        return "string"
    # dict[str, str] etc.
    origin = getattr(annotation, "__origin__", None)
    if origin is dict:
        return "object"
    if origin is list:
        return "array"
    if hasattr(annotation, "__name__"):
        return annotation.__name__
    return str(annotation).replace("typing.", "")


def _type_label(field_info) -> str:
    """Return a human-readable type label for a field."""
    annotation = field_info.annotation
    args = _union_args(annotation)
    if args:
        non_none = [a for a in args if a is not type(None)]
        if len(non_none) == 1:
            return _friendly_type(non_none[0])
        return " | ".join(_friendly_type(a) for a in non_none)
    return _friendly_type(annotation)


def _field_default(field_info) -> str:
    """Return a display string for the field's default value."""
    if field_info.is_required():
        return ""
    default = field_info.default
    if default is None:
        return "null"
    if isinstance(default, SecretStr):
        return f'"{default.get_secret_value()}"'
    if isinstance(default, bool):
        return str(default).lower()
    if isinstance(default, str):
        return f'"{default}"'
    return str(default)


def _escape_md_cell(value: str) -> str:
    """Escape pipe and newline characters for safe Markdown table cells."""
    return value.replace("\\", "\\\\").replace("|", "\\|").replace("\n", "<br>")


def _format_model_markdown(model: type[BaseConnectionInfo]) -> str:
    """Format a single ConnectionInfo model as a Markdown section."""
    lines: list[str] = []
    lines.append(f"### {model.__name__}")
    lines.append("")

    # Build table
    lines.append("| Field | Type | Required | Default | Sensitive | Alias | Example |")
    lines.append("|-------|------|----------|---------|-----------|-------|---------|")

    for name, field_info in model.model_fields.items():
        type_label = _type_label(field_info)
        required = "yes" if field_info.is_required() else "no"
        default = _field_default(field_info)
        sensitive = "yes" if _is_sensitive(field_info) else "no"
        alias = (
            field_info.alias if field_info.alias and field_info.alias != name else ""
        )
        examples = field_info.examples or []
        example_str = ", ".join(f"`{e}`" for e in examples)
        lines.append(
            f"| `{_escape_md_cell(name)}` | {_escape_md_cell(type_label)} | {required} | {_escape_md_cell(default)} | {sensitive} | {_escape_md_cell(alias)} | {_escape_md_cell(example_str)} |"
        )

    lines.append("")

    # JSON example
    example = _build_example(model)
    if example:
        lines.append("**Example:**")
        lines.append("```json")
        lines.append(json.dumps(example, indent=2))
        lines.append("```")
        lines.append("")

    return "\n".join(lines)


def _build_example(model: type[BaseConnectionInfo]) -> dict[str, Any]:
    """Build an example JSON dict from field metadata (required + example-having fields)."""
    example: dict[str, Any] = {}
    for name, field_info in model.model_fields.items():
        key = (
            field_info.alias if field_info.alias and field_info.alias != name else name
        )
        if field_info.examples:
            example[key] = field_info.examples[0]
        elif not field_info.is_required():
            default = field_info.default
            if default is None:
                continue
            example[key] = (
                default.get_secret_value()
                if isinstance(default, SecretStr)
                else default
            )
        else:
            example[key] = f"<{name}>"
    return example


def _build_full_properties(model: type[BaseConnectionInfo]) -> dict[str, Any]:
    """Build a properties dict with all fields (including optional ones)."""
    props: dict[str, Any] = {}
    for name, field_info in model.model_fields.items():
        key = (
            field_info.alias if field_info.alias and field_info.alias != name else name
        )
        if field_info.examples:
            props[key] = field_info.examples[0]
        elif not field_info.is_required():
            default = field_info.default
            if isinstance(default, SecretStr):
                props[key] = default.get_secret_value()
            else:
                props[key] = default
        else:
            props[key] = f"<{name}>"
    return props


def generate_markdown(datasource: str | None = None) -> str:
    """Generate Markdown documentation for connection info models."""
    sources = _resolve_sources(datasource)

    lines: list[str] = []
    lines.append("# Wren Engine Connection Info Reference")
    lines.append("")

    for ds_name, models in sources.items():
        lines.append(f"## {ds_name}")
        lines.append("")
        for model in models:
            lines.append(_format_model_markdown(model))

    return "\n".join(lines)


def generate_json_schema(
    datasource: str | None = None, *, envelope: bool = False
) -> str:
    """Generate JSON Schema for connection info models.

    Args:
        datasource: If given, only generate schema for that data source.
                    If None, generate for all data sources.
        envelope: If True, wrap output in ``{"datasource": ..., "properties": ...}``
                  envelope format (one object per data source).
    """
    sources = _resolve_sources(datasource)

    if not envelope:
        return _format_raw_json_schema(sources, single=datasource is not None)

    results: list[dict[str, Any]] = []
    for ds_name, models in sources.items():
        for model in models:
            props = _build_full_properties(model)
            results.append({"datasource": ds_name, "properties": props})

    if len(results) == 1:
        return json.dumps(results[0], indent=2)
    return json.dumps(results, indent=2)


def _format_raw_json_schema(
    sources: dict[str, list[type[BaseConnectionInfo]]], *, single: bool
) -> str:
    """Format sources as JSON Schema output.

    When *single* is True and the source has exactly one model, return
    the schema directly without the datasource-name wrapper.
    """
    schemas: dict[str, Any] = {}
    for ds_name, models in sources.items():
        if single and len(models) == 1:
            return json.dumps(models[0].model_json_schema(), indent=2)
        if len(models) == 1:
            schemas[ds_name] = models[0].model_json_schema()
        else:
            if single:
                return json.dumps(
                    {"variants": {m.__name__: m.model_json_schema() for m in models}},
                    indent=2,
                )
            schemas[ds_name] = {
                "variants": {m.__name__: m.model_json_schema() for m in models}
            }

    return json.dumps(schemas, indent=2)
