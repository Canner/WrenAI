# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb", "pyyaml", "pytest"]
# ///
"""
pytest companion to `generate.py --verify`. Same 5 checks, as importable
assertions rather than a print-and-exit CLI. Run directly (this script
carries its own PEP 723 header, same convention as generate.py):

    uv run test_generate.py
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
import random
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

import generate as gen  # noqa: E402

SEED = gen.SEED


def test_clean_generation_is_reproducible():
    d1 = gen.generate(random.Random(SEED))
    d2 = gen.generate(random.Random(SEED))
    assert d1.keys() == d2.keys()
    for table in d1:
        assert d1[table] == d2[table], f"table {table} differs across two fresh Random(SEED) runs"


@pytest.mark.parametrize("scenario", gen.SCENARIO_NAMES)
def test_injection_is_reproducible(scenario):
    base1 = gen.generate(random.Random(SEED))
    base2 = gen.generate(random.Random(SEED))
    mutated1, inj1 = gen.SCENARIOS[scenario](base1)
    mutated2, inj2 = gen.SCENARIOS[scenario](base2)
    assert mutated1.keys() == mutated2.keys()
    for table in mutated1:
        assert mutated1[table] == mutated2[table], f"table {table} differs across two independent {scenario} runs"
    assert gen._plain(inj1) == gen._plain(inj2)


@pytest.mark.parametrize("scenario", gen.SCENARIO_NAMES)
def test_diff_matches_manifest(scenario):
    ok, detail = gen._check_diff_matches_manifest(scenario)
    assert ok, detail


@pytest.mark.parametrize("scenario", gen.SCENARIO_NAMES)
def test_manifest_well_formed(scenario):
    base = gen.generate(random.Random(SEED))
    _, injections = gen.SCENARIOS[scenario](base)
    manifest = gen.build_manifest(scenario, "driftwood.duckdb", f"driftwood-{scenario}.duckdb", injections)
    ok, detail = gen._check_manifest_well_formed(manifest)
    assert ok, detail


def test_oracle_sanity_stopped_updates():
    ok, detail = gen._check_oracle_sanity()
    assert ok, detail


def test_oracle_hand_computed_numbers():
    """
    Hand-computed expectations (stopped_updates manifest: 1 real injection,
    3 clean entities checked — orders, web_events, fx_rates):

    perfect   = flags the real one correctly, calls all 3 clean ones clean
                -> recall 1/1, precision 1/1, false_alarm 0/3, attribution 1/1
    imperfect = misses the real one, false-alarms on 1 of the 3 clean ones
                -> recall 0/1, precision 0/1, false_alarm 1/3, attribution 0/0 -> 0.0
    """
    base = gen.generate(random.Random(SEED))
    _, injections = gen.SCENARIOS["stopped_updates"](base)
    manifest = gen.build_manifest(
        "stopped_updates", "driftwood.duckdb", "driftwood-stopped_updates.duckdb", injections
    )
    sets = gen._hand_authored_detection_sets(manifest)

    perfect = gen.score_detections(manifest, sets["perfect"])
    assert perfect["recall"] == 1.0
    assert perfect["precision"] == 1.0
    assert perfect["false_alarm_rate"] == 0.0
    assert perfect["attribution_accuracy"] == 1.0

    imperfect = gen.score_detections(manifest, sets["imperfect"])
    assert imperfect["recall"] == 0.0
    assert imperfect["precision"] == 0.0
    assert abs(imperfect["false_alarm_rate"] - (1 / 3)) < 1e-9
    assert imperfect["attribution_accuracy"] == 0.0


def test_attribution_paraphrase_all_scenarios():
    ok, detail = gen._check_attribution_paraphrase()
    assert ok, detail


@pytest.mark.parametrize("scenario", gen.SCENARIO_NAMES)
def test_attribution_scores_per_injection(scenario):
    """Per-injection attribution scores for every scenario (not just
    stopped_updates): the injection's own expected_cause must self-match at
    1.0, a realistic paraphrase (never the manifest's verbatim sentence,
    no ids/dates) must clear the 0.5 threshold, and an unrelated cause must
    fall below it — proving the fuzzy match works for real paraphrasing
    rather than only for a verbatim quote of the manifest."""
    base = gen.generate(random.Random(SEED))
    _, injections = gen.SCENARIOS[scenario](base)
    assert injections, f"{scenario} produced no injections"
    for inj in injections:
        verbatim_score = gen._attribution_score(inj["expected_cause"], inj)
        assert verbatim_score == 1.0, f"{inj['id']}: verbatim scored {verbatim_score}"

        paraphrase = gen.PARAPHRASE_CAUSES[inj["id"]]
        paraphrase_score = gen._attribution_score(paraphrase, inj)
        assert paraphrase_score >= 0.5, f"{inj['id']}: paraphrase scored {paraphrase_score}"

        unrelated_score = gen._attribution_score(gen.UNRELATED_CAUSE, inj)
        assert unrelated_score < 0.5, f"{inj['id']}: unrelated cause scored {unrelated_score}"


def test_manifest_serializes_the_canonical_attribution_oracle():
    injection = {
        "id": "stopped_updates_subscription_snapshots",
        "kind": "stopped_updates",
        "entity": "subscription_snapshots",
    }
    manifest = gen.build_manifest(
        "stopped_updates", "driftwood.duckdb", "driftwood-stopped_updates.duckdb", [injection]
    )
    serialized = manifest["injections"][0]

    assert serialized["attribution_keywords"] == ["snapshots", "stopped", "subscription"]
    assert gen._attribution_score("stopped updates", serialized) == pytest.approx(1 / 3)
    assert not gen._cause_matches("stopped updates", serialized)


def test_score_detections_rejects_duplicate_entities():
    base = gen.generate(random.Random(SEED))
    _, injections = gen.SCENARIOS["stopped_updates"](base)
    manifest = gen.build_manifest(
        "stopped_updates", "driftwood.duckdb", "driftwood-stopped_updates.duckdb", injections
    )
    dup_detections = [
        {"entity": "orders", "verdict": "no_anomaly", "cause": ""},
        {"entity": "orders", "verdict": "anomaly", "cause": "duplicate row"},
    ]
    with pytest.raises(ValueError):
        gen.score_detections(manifest, dup_detections)


def test_stopped_updates_can_inject_from_a_clean_duckdb(tmp_path):
    base = tmp_path / "clean.duckdb"
    injected = tmp_path / "injected.duckdb"
    rows = [
        (date(2026, 3, 31), 1, Decimal("10.00"), "active"),
        (date(2026, 4, 30), 1, Decimal("10.00"), "active"),
        (date(2026, 5, 31), 1, Decimal("10.00"), "active"),
        (date(2026, 6, 30), 1, Decimal("10.00"), "active"),
    ]
    con = gen.duckdb.connect(str(base))
    con.execute(
        "CREATE TABLE subscription_snapshots "
        "(snapshot_date DATE, subscription_id INTEGER, mrr_amount DECIMAL(12,2), status VARCHAR)"
    )
    con.executemany(gen.INSERT_SQL["subscription_snapshots"], rows)
    con.close()

    gen.run_injection_from_base("stopped_updates", str(base), str(injected))

    clean_con = gen.duckdb.connect(str(base), read_only=True)
    injected_con = gen.duckdb.connect(str(injected), read_only=True)
    assert clean_con.execute("SELECT max(snapshot_date) FROM subscription_snapshots").fetchone()[0] == gen.TODAY
    assert injected_con.execute("SELECT max(snapshot_date) FROM subscription_snapshots").fetchone()[0] == date(2026, 3, 31)
    clean_con.close()
    injected_con.close()

    manifest = gen.yaml.safe_load(injected.with_suffix(".manifest.yaml").read_text())
    assert manifest["base"] == "clean.duckdb"
    assert manifest["scenario"] == "stopped_updates"
    assert manifest["injections"][0]["expected_severity"] == "critical"


def test_injection_from_base_refuses_to_overwrite_the_fixture(tmp_path):
    base = tmp_path / "clean.duckdb"
    base.write_bytes(b"not opened because paths are rejected first")
    with pytest.raises(ValueError, match="different files"):
        gen.run_injection_from_base("stopped_updates", str(base), str(base))


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"] + sys.argv[1:]))
