"""MDL drift detection for GenBI data apps.

A panel declares the cube + measures + dimensions it queries. As the MDL
evolves (cubes renamed, dimensions dropped), those declarations can go stale.
This module compares a panel's declaration against the current manifest so the
serve path can refuse a drifted app up front, naming exactly what is missing.

Pure functions: ``(spec, manifest) -> list[DriftIssue]``.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class PanelSpec:
    """A panel's declared cube query surface."""

    cube: str
    measures: list[str] = field(default_factory=list)
    dimensions: list[str] = field(default_factory=list)
    time_dimensions: list[str] = field(default_factory=list)


@dataclass
class DriftIssue:
    """One drift: a declared member that the manifest no longer provides."""

    kind: str  # missing_cube | missing_measure | missing_dimension | missing_time_dimension
    member: str
    cube: str
    message: str


def _names(items: object) -> set[str]:
    if not isinstance(items, list):
        return set()
    return {i.get("name") for i in items if isinstance(i, dict) and i.get("name")}


def check_spec(spec: PanelSpec, manifest: dict) -> list[DriftIssue]:
    """Return drift between *spec* and the cube it references in *manifest*."""
    cubes = manifest.get("cubes") or []
    cube = next(
        (c for c in cubes if isinstance(c, dict) and c.get("name") == spec.cube),
        None,
    )

    # If the whole cube is gone there is nothing to check member-by-member.
    if cube is None:
        return [
            DriftIssue(
                kind="missing_cube",
                member=spec.cube,
                cube=spec.cube,
                message=f"cube '{spec.cube}' no longer exists in the MDL",
            )
        ]

    measures = _names(cube.get("measures"))
    dimensions = _names(cube.get("dimensions"))
    time_dimensions = _names(cube.get("timeDimensions"))

    issues: list[DriftIssue] = []
    for m in spec.measures:
        if m not in measures:
            issues.append(
                DriftIssue(
                    kind="missing_measure",
                    member=m,
                    cube=spec.cube,
                    message=f"measure '{m}' not found in cube '{spec.cube}'",
                )
            )
    for d in spec.dimensions:
        if d not in dimensions:
            issues.append(
                DriftIssue(
                    kind="missing_dimension",
                    member=d,
                    cube=spec.cube,
                    message=f"dimension '{d}' not found in cube '{spec.cube}'",
                )
            )
    for t in spec.time_dimensions:
        if t not in time_dimensions:
            issues.append(
                DriftIssue(
                    kind="missing_time_dimension",
                    member=t,
                    cube=spec.cube,
                    message=f"time dimension '{t}' not found in cube '{spec.cube}'",
                )
            )
    return issues


def check_panels(specs: list[PanelSpec], manifest: dict) -> list[DriftIssue]:
    """Aggregate drift across every panel spec in an app."""
    issues: list[DriftIssue] = []
    for spec in specs:
        issues.extend(check_spec(spec, manifest))
    return issues
