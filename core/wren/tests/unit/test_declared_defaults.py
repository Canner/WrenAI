"""Parse and validate declared default rules (front-matter in knowledge/rules)."""

import shutil
from pathlib import Path

import pytest
from typer.testing import CliRunner

from wren.cli import app
from wren.context import build_json, load_rules, validate_project
from wren.declared_defaults import (
    ID_PATTERN,
    DeclarationError,
    ExcludeRows,
    RequireRateJoin,
    SaleStatuses,
    covered_models,
    load_declarations,
    many_to_one_edges,
    read_declared_defaults,
    split_front_matter,
)

pytestmark = pytest.mark.unit

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "declared_defaults"

EXCLUDE = """\
  - id: exclude-test-accounts
    kind: exclude_rows
    column: customers.is_test
    exclude: true
    covers: {reaching: customers, via: many_to_one}
"""

RATE = """\
  - id: usd-at-transaction-date
    kind: require_rate_join
    amounts:
      - {columns: [payments.amount], currency: payments.currency, dates: [payments.captured_at]}
    rate: {model: fx_rates, currency: fx_rates.currency, date: fx_rates.date, match: on_or_before}
"""


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "project"
    shutil.copytree(FIXTURE, root)
    for rules in (root / "knowledge" / "rules").glob("*.md"):
        rules.unlink()
    return root


def declare(project: Path, front: str, name: str = "rules.md") -> None:
    rules = project / "knowledge" / "rules"
    rules.mkdir(parents=True, exist_ok=True)
    (rules / name).write_text(f"---\ndefaults:\n{front}---\n# Prose\n")


def parse(project: Path):
    return load_declarations(project, build_json(project))


def test_the_fixture_declares_both_kinds_over_the_closure():
    declarations = read_declared_defaults(FIXTURE, build_json(FIXTURE))
    by_id = {declaration.id: declaration for declaration in declarations}
    assert list(by_id) == ["usd-at-transaction-date", "exclude-test-accounts"]
    exclude = by_id["exclude-test-accounts"]
    assert isinstance(exclude, ExcludeRows)
    assert exclude.covered == {
        "customers",
        "orders",
        "order_items",
        "payments",
        "returns",
    }
    assert exclude.exclude is True and exclude.aggregated_only
    assert exclude.addresses_column
    assert exclude.filtered_by == ("orders.legacy_ord_id IS NOT NULL",)
    rate = by_id["usd-at-transaction-date"]
    assert isinstance(rate, RequireRateJoin)
    assert rate.rate_model == "fx_rates"
    assert rate.groups_by_currency and rate.filters_currency_literal
    assert [group.currency.column for group in rate.amounts] == ["currency", "currency"]


def test_the_closure_follows_many_to_one_chains_only():
    manifest = build_json(FIXTURE)
    edges = many_to_one_edges(manifest)
    assert ("returns", "order_items") in edges
    # one_to_one (orders <-> legacy_orders) and the one side (products) stay out
    assert not any("legacy_orders" in edge for edge in edges)
    covered = covered_models("customers", edges)
    assert covered == {"customers", "orders", "order_items", "payments", "returns"}
    assert covered_models("orders", edges) == {
        "orders",
        "order_items",
        "payments",
        "returns",
    }


def test_an_excepted_model_is_neither_covered_nor_traversed():
    edges = many_to_one_edges(build_json(FIXTURE))
    assert covered_models("customers", edges, frozenset({"order_items"})) == {
        "customers",
        "orders",
        "payments",
    }


def test_a_project_without_front_matter_declares_nothing(project):
    (project / "knowledge" / "rules" / "plain.md").write_text("# Rules\n\nBe kind.\n")
    (project / "instructions.md").write_text("Legacy prose only.\n")
    assert parse(project) == ([], [])


def test_a_project_without_any_rules_declares_nothing(project):
    shutil.rmtree(project / "knowledge")
    assert parse(project) == ([], [])


def test_front_matter_without_defaults_is_not_a_declaration(project):
    (project / "knowledge" / "rules" / "titled.md").write_text(
        "---\ntitle: Conventions\n---\n# Prose\n"
    )
    assert parse(project) == ([], [])


def test_the_legacy_instructions_file_may_declare(project):
    (project / "instructions.md").write_text(f"---\ndefaults:\n{EXCLUDE}---\nProse\n")
    declarations, errors = parse(project)
    assert errors == []
    assert [declaration.id for declaration in declarations] == ["exclude-test-accounts"]


def test_front_matter_stays_in_the_rule_text_the_model_reads(project):
    declare(project, EXCLUDE)
    content, _ = load_rules(project)
    assert content.startswith("---\ndefaults:\n  - id: exclude-test-accounts")
    assert content.endswith("# Prose")


def test_declarations_are_read_in_file_then_declaration_order(project):
    declare(project, RATE, "b.md")
    declare(project, EXCLUDE, "a.md")
    declarations, errors = parse(project)
    assert errors == []
    assert [declaration.id for declaration in declarations] == [
        "exclude-test-accounts",
        "usd-at-transaction-date",
    ]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("# Just prose", (None, "# Just prose")),
        ("---\na: 1\n---\nbody", ("a: 1", "body")),
        ("﻿---\na: 1\n---\nbody", ("a: 1", "body")),
        ("---  \na: 1\n---  \nbody", ("a: 1", "body")),
        ("text\n---\na: 1\n---\n", (None, "text\n---\na: 1\n---\n")),
    ],
)
def test_split_front_matter(text, expected):
    assert split_front_matter(text) == expected


def test_an_unclosed_fence_is_an_error_not_a_silent_skip(project):
    (project / "knowledge" / "rules" / "broken.md").write_text("---\ndefaults: []\n")
    declarations, errors = parse(project)
    assert declarations == []
    assert errors == [
        ("knowledge/rules/broken.md", "front-matter is not closed by a '---' line")
    ]


@pytest.mark.parametrize(
    "text",
    [
        "---\n# Rules\n\nAlways filter test accounts.\n",
        "---\ntitle: Rules\n---\n# Prose\n",
        "---\nNote: filter test accounts: always.\n---\nMore prose.\n",
        "---\nthe id: 5 kind: of thing\n---\nMore prose.\n",
    ],
    ids=[
        "horizontal rule, no closing fence",
        "yaml without keys",
        "prose with colon",
        "prose naming id and kind",
    ],
)
def test_a_fence_without_declaration_keys_is_prose(project, text):
    (project / "knowledge" / "rules" / "prose.md").write_text(text)
    assert parse(project) == ([], [])


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("---\n# Rules\ndefaults:\n", "front-matter is not closed by a '---' line"),
        ("---\ndefaults:\n  lang: en\n---\n", "'defaults' must be a list"),
        (
            "---\nrules:\n  - id: x\n    kind: exclude_rows\n---\n",
            "declarations must be under the 'defaults' key",
        ),
        ('---\n"defaults": {lang: en}\n---\n', "'defaults' must be a list"),
        (
            "---\n- {id: x, kind: exclude_rows}\n",
            "front-matter is not closed by a '---' line",
        ),
    ],
    ids=[
        "unclosed with defaults",
        "defaults mapping",
        "id and kind",
        "quoted key",
        "unclosed flow-style declaration",
    ],
)
def test_a_fence_with_declaration_keys_still_fails_loudly(project, text, message):
    (project / "knowledge" / "rules" / "broken.md").write_text(text)
    assert parse(project) == ([], [("knowledge/rules/broken.md", message)])


def test_validate_project_accepts_a_prose_rule_opening_with_a_rule_line(project):
    (project / "knowledge" / "rules" / "prose.md").write_text(
        "---\n# Rules\n\nAlways filter test accounts.\n"
    )
    assert validate_project(project) == []


def mutate(front: str, old: str, new: str) -> str:
    assert old in front
    return front.replace(old, new)


INVALID = {
    "unknown model": (
        mutate(EXCLUDE, "customers.is_test", "ghosts.is_test"),
        "unknown model 'ghosts'",
    ),
    "unknown column": (
        mutate(EXCLUDE, "customers.is_test", "customers.nope"),
        "unknown column 'customers.nope'",
    ),
    "unknown kind": (mutate(EXCLUDE, "exclude_rows", "forbid_rows"), "unknown kind"),
    "bad id": (
        mutate(EXCLUDE, "exclude-test-accounts", "Exclude Test"),
        "'id' must match",
    ),
    "id too long": (
        mutate(EXCLUDE, "exclude-test-accounts", "a" * 65),
        "'id' must match",
    ),
    "unknown field": (EXCLUDE + "    unles: []\n", "unknown field 'unles'"),
    "non-boolean exclude": (
        mutate(EXCLUDE, "exclude: true", "exclude: 1"),
        "'exclude' must be true or false",
    ),
    "bad via": (
        mutate(EXCLUDE, "via: many_to_one", "via: one_to_many"),
        "covers.via must be 'many_to_one'",
    ),
    "anchor excepted": (
        mutate(
            EXCLUDE,
            "via: many_to_one}",
            "via: many_to_one, except_models: [customers]}",
        ),
        "must not list the anchor",
    ),
    "column not covered": (
        mutate(
            EXCLUDE,
            "reaching: customers",
            "reaching: orders",
        ),
        "is not covered",
    ),
    "unknown unless entry": (
        EXCLUDE + "    unless: [groups_by_currency]\n",
        "unsupported 'unless' entry",
    ),
    "unqualified filtered_by": (
        EXCLUDE + "    unless:\n      - filtered_by: legacy_ord_id IS NOT NULL\n",
        "must qualify every column",
    ),
    "filtered_by unknown column": (
        EXCLUDE + "    unless:\n      - filtered_by: orders.nope IS NULL\n",
        "unknown column 'orders.nope'",
    ),
    "bad when": (EXCLUDE + "    when: always\n", "'when' must be 'aggregated'"),
    "bad match": (
        mutate(RATE, "on_or_before", "same_day"),
        "rate.match must be 'on_or_before'",
    ),
    "rate column of another model": (
        mutate(RATE, "date: fx_rates.date", "date: payments.captured_at"),
        "rate.date must belong to the rate model",
    ),
    "unknown amount column": (
        mutate(RATE, "payments.amount]", "payments.nope]"),
        "unknown column 'payments.nope'",
    ),
    "empty amounts": (
        "  - id: r\n    kind: require_rate_join\n    amounts: []\n    rate: {model: fx_rates, currency: fx_rates.currency, date: fx_rates.date, match: on_or_before}\n",
        "'amounts' must be a non-empty list",
    ),
}


@pytest.mark.parametrize("front, message", INVALID.values(), ids=INVALID.keys())
def test_an_invalid_declaration_is_reported(project, front, message):
    declare(project, front)
    declarations, errors = parse(project)
    assert declarations == []
    assert any(message in text for _, text in errors), errors
    with pytest.raises(DeclarationError):
        read_declared_defaults(project, build_json(project))


def test_a_duplicate_id_is_reported_once(project):
    declare(project, EXCLUDE, "a.md")
    declare(project, EXCLUDE, "b.md")
    declarations, errors = parse(project)
    assert declarations == []
    assert len(errors) == 1 and "duplicate id" in errors[0][1]


def test_more_than_eight_declarations_are_refused(project):
    front = "".join(
        mutate(EXCLUDE, "exclude-test-accounts", f"rule-{i}") for i in range(9)
    )
    declare(project, front)
    _, errors = parse(project)
    assert any("at most 8" in message for _, message in errors)


def test_yaml_that_does_not_parse_is_an_error(project):
    (project / "knowledge" / "rules" / "bad.md").write_text(
        "---\ndefaults: [unclosed\n---\n"
    )
    _, errors = parse(project)
    assert errors == [("knowledge/rules/bad.md", "front-matter is not valid YAML")]


@pytest.mark.parametrize("good", ["a", "0a", "a_b-c", "a" * 64])
def test_the_id_pattern_accepts(good):
    assert ID_PATTERN.fullmatch(good)


@pytest.mark.parametrize("bad", ["", "_a", "-a", "A", "a b", "a.b", "a" * 65, "a\n"])
def test_the_id_pattern_rejects(bad):
    assert not ID_PATTERN.fullmatch(bad)


def test_validate_project_reports_declaration_errors_and_stays_quiet_otherwise(project):
    assert validate_project(project) == []
    declare(project, mutate(EXCLUDE, "customers.is_test", "customers.nope"))
    errors = validate_project(project)
    assert [error.level for error in errors] == ["error"]
    assert "declared default rule" in str(errors[0])
    assert "knowledge/rules/rules.md > defaults[0]" in str(errors[0])


def test_the_valid_fixture_validates_clean():
    assert validate_project(FIXTURE) == []


def test_context_validate_exits_non_zero_on_an_invalid_declaration(project):
    declare(project, mutate(EXCLUDE, "exclude_rows", "forbid_rows"))
    result = CliRunner().invoke(app, ["context", "validate", "--path", str(project)])
    assert result.exit_code == 1
    assert "declared default rule: unknown kind" in result.output


def test_a_rate_rule_may_declare_a_base_currency_and_single_match(project):
    declare(project, RATE + "    base_currency: USD\n    match: single\n")
    declarations, errors = parse(project)
    assert errors == []
    (rule,) = declarations
    assert (rule.base_currency, rule.match) == ("USD", "single")


def test_a_rate_rule_without_the_new_keys_declares_neither(project):
    declare(project, RATE)
    (rule,) = parse(project)[0]
    assert (rule.base_currency, rule.match) == (None, None)


@pytest.mark.parametrize(
    ("extra", "message"),
    [
        ("    base_currency: [USD]\n", "'base_currency' must match"),
        ("    base_currency: 'US D'\n", "'base_currency' must match"),
        ("    base_currency: ''\n", "'base_currency' must match"),
        ("    match: many\n", "'match' must be 'single'"),
        ("    match: on_or_before\n", "'match' must be 'single'"),
    ],
)
def test_the_new_rate_keys_are_validated(project, extra, message):
    declare(project, RATE + extra)
    declarations, errors = parse(project)
    assert declarations == []
    assert len(errors) == 1 and errors[0][1].startswith(message)


def test_the_new_rate_keys_are_not_accepted_on_an_exclusion_rule(project):
    declare(project, EXCLUDE + "    base_currency: USD\n")
    _, errors = parse(project)
    assert [m for _, m in errors] == ["unknown field 'base_currency'"]


SALE = """\
  - id: paid-and-shipped
    kind: sale_statuses
    column: orders.status
    values: [paid, shipped]
    domain: [paid, shipped, cancelled, pending]
"""


def test_a_sale_statuses_rule_keeps_its_declared_case_and_defaults_to_not_overridable(
    project,
):
    declare(project, SALE)
    declarations, errors = parse(project)
    assert errors == []
    (rule,) = declarations
    assert isinstance(rule, SaleStatuses)
    assert (rule.column.model, rule.column.column) == ("orders", "status")
    assert rule.values == ("paid", "shipped")
    assert rule.domain == ("paid", "shipped", "cancelled", "pending")
    assert rule.overridable_by_caller is False and rule.aggregated_only is False


def test_a_sale_statuses_rule_may_be_overridable_and_aggregated_only(project):
    declare(project, SALE + "    overridable_by_caller: true\n    when: aggregated\n")
    (rule,) = parse(project)[0]
    assert rule.overridable_by_caller is True and rule.aggregated_only is True


def test_the_domain_defaults_to_the_enum_values_the_catalog_gives(project):
    declare(
        project, mutate(SALE, "    domain: [paid, shipped, cancelled, pending]\n", "")
    )
    declarations, errors = parse(project)
    assert declarations == []
    assert len(errors) == 1 and "no 'domain'" in errors[0][1]
    enums = {("orders", "status"): ("Paid", "Shipped", "Cancelled")}
    declarations, errors = load_declarations(project, build_json(project), enums)
    assert errors == []
    assert declarations[0].domain == ("Paid", "Shipped", "Cancelled")


def test_the_domain_falls_back_to_the_manifest_enum_values(project):
    metadata = project / "models" / "orders" / "metadata.yml"
    metadata.write_text(
        metadata.read_text().replace(
            "  - name: status\n    type: VARCHAR\n",
            "  - name: status\n    type: VARCHAR\n    properties:\n      enum_values: {paid: a, shipped: b, void: c}\n",
        )
    )
    declare(
        project, mutate(SALE, "    domain: [paid, shipped, cancelled, pending]\n", "")
    )
    (rule,) = parse(project)[0]
    assert rule.domain == ("paid", "shipped", "void")


SALE_INVALID = {
    "value outside the domain": (
        mutate(SALE, "values: [paid, shipped]", "values: [paid, refunded]"),
        "values must all belong to the domain",
    ),
    "case is ignored when checking the domain": (
        mutate(SALE, "values: [paid, shipped]", "values: [PAID, Shipped]"),
        None,
    ),
    "value listed twice": (
        mutate(SALE, "values: [paid, shipped]", "values: [paid, PAID]"),
        "lists a value twice",
    ),
    "domain value listed twice": (
        mutate(SALE, "[paid, shipped, cancelled, pending]", "[paid, Paid, shipped]"),
        "lists a value twice",
    ),
    "empty values": (
        mutate(SALE, "values: [paid, shipped]", "values: []"),
        "values must be a non-empty list",
    ),
    "number as a value": (
        mutate(SALE, "values: [paid, shipped]", "values: [1, 2]"),
        "values must be a non-empty list",
    ),
    "values not a list": (
        mutate(SALE, "values: [paid, shipped]", "values: paid"),
        "values must be a non-empty list",
    ),
    "unknown column": (
        mutate(SALE, "orders.status", "orders.nope"),
        "unknown column 'orders.nope'",
    ),
    "unknown model": (
        mutate(SALE, "orders.status", "ghosts.status"),
        "unknown model 'ghosts'",
    ),
    "overridable is not a boolean": (
        SALE + "    overridable_by_caller: yes please\n",
        "'overridable_by_caller' must be true or false",
    ),
    "unknown field": (SALE + "    unless: []\n", "unknown field 'unless'"),
    "bad when": (SALE + "    when: always\n", "'when' must be 'aggregated'"),
}


@pytest.mark.parametrize(
    ("front", "message"), SALE_INVALID.values(), ids=SALE_INVALID.keys()
)
def test_an_invalid_sale_statuses_declaration_is_reported(project, front, message):
    declare(project, front)
    declarations, errors = parse(project)
    if message is None:
        assert errors == [] and len(declarations) == 1
        return
    assert declarations == []
    assert any(message in text for _, text in errors), errors
    with pytest.raises(DeclarationError):
        read_declared_defaults(project, build_json(project))


def test_a_sale_statuses_error_voids_the_other_declarations_too(project):
    declare(project, EXCLUDE + mutate(SALE, "orders.status", "orders.nope"))
    declarations, errors = parse(project)
    assert declarations == [] and len(errors) == 1


def test_validate_project_reports_a_sale_statuses_error(project):
    declare(
        project, mutate(SALE, "values: [paid, shipped]", "values: [paid, refunded]")
    )
    errors = validate_project(project)
    assert [error.level for error in errors] == ["error"]
    assert "values must all belong to the domain" in str(errors[0])


def test_hidden_rules_do_not_add_unfingerprinted_declarations(project):
    declare(project, EXCLUDE, ".private.md")
    assert parse(project) == ([], [])
    declare(project, EXCLUDE, "public.md")
    assert [rule.id for rule in parse(project)[0]] == ["exclude-test-accounts"]


def test_duplicate_top_level_defaults_cannot_remove_enforced_rules(project):
    path = project / "knowledge/rules/duplicate.md"
    path.write_text(f"---\ndefaults:\n{EXCLUDE}defaults: []\n---\nProse.\n")
    declarations, errors = parse(project)
    assert not declarations
    assert errors and "duplicate" in str(errors).lower()


@pytest.mark.parametrize(
    "front",
    [
        "- {id: x, kind: exclude_rows, column: customers.is_test}\n",
        "- {id: 12, kind: not_a_valid_kind}\n",
        "- prose\n- {id: x, kind: sale_statuses}\n",
    ],
)
def test_declaration_shaped_sequence_front_matter_is_invalid(project, front):
    path = project / "knowledge/rules/sequence.md"
    path.write_text("---\n" + front + "---\nProse.\n")
    declarations, errors = parse(project)
    assert not declarations
    assert errors and "mapping" in str(errors).lower()


@pytest.mark.parametrize(
    "front",
    [
        "- prose\n- other prose\n",
        "- {id: prose}\n",
        "- {kind: exclude_rows}\n",
        "- {title: note, body: prose}\n",
    ],
)
def test_unrelated_sequence_front_matter_remains_prose(project, front):
    (project / "knowledge/rules/prose-sequence.md").write_text(
        "---\n" + front + "---\nProse.\n"
    )
    assert parse(project) == ([], [])


@pytest.mark.parametrize(
    "front",
    [
        "defauts:\n" + EXCLUDE,
        "Defaults:\n" + EXCLUDE,
    ],
)
def test_declaration_shaped_unknown_top_level_envelope_is_invalid(project, front):
    (project / "knowledge/rules/typo.md").write_text("---\n" + front + "---\nProse.\n")
    declarations, errors = parse(project)
    assert not declarations and errors
    assert "defaults" in str(errors)


def test_typo_envelope_voids_otherwise_valid_rules_instead_of_enforcing_a_subset(
    project,
):
    declare(project, EXCLUDE, "valid.md")
    (project / "knowledge/rules/typo.md").write_text("---\ndefauts:\n" + RATE + "---\n")
    declarations, errors = parse(project)
    assert declarations == [] and errors


@pytest.mark.parametrize(
    "front",
    [
        "owner: analytics\nnotes: [prose, {id: note}, {kind: convention}]\n",
        "defaults: []\nmetadata: {id: note, description: words}\n",
        "metadata: {kind: guide, description: words}\n",
        "metadata: {id: note, kind: guide}\n",
        "defaults: []\nmetadata: [{id: note, kind: guide}]\n",
    ],
)
def test_unrelated_mapping_metadata_does_not_look_like_a_declaration(project, front):
    (project / "knowledge/rules/prose.md").write_text("---\n" + front + "---\nProse.\n")
    assert parse(project) == ([], [])


def test_valid_inherited_defaults_remain_enforced_with_the_merge_template(project):
    front = (
        "base: &base\n  defaults:\n"
        + "\n".join("  " + line for line in EXCLUDE.splitlines())
        + "\n<<: *base\n"
    )
    (project / "knowledge/rules/inherited.md").write_text(
        "---\n" + front + "---\nProse.\n"
    )
    declarations, errors = parse(project)
    assert not errors and len(declarations) == 1
    assert declarations[0].id == "exclude-test-accounts"


def test_yaml_merge_defaults_override_is_not_a_duplicate_key(project):
    (project / "knowledge/rules/merge.md").write_text(
        "---\nbase: &base\n  defaults: []\n<<: *base\ndefaults: []\nnote: earlier\nnote: later\n---\nProse.\n"
    )
    assert parse(project) == ([], [])


@pytest.mark.parametrize(
    "anchor", ["[customers]", "{name: customers}", "true", "null", "12"]
)
def test_non_string_covering_anchor_is_a_declaration_error(project, anchor):
    declare(project, EXCLUDE.replace("reaching: customers", "reaching: " + anchor))
    declarations, errors = parse(project)
    assert errors and not declarations
    assert any("covers.reaching must name a model" in error for error in errors)


@pytest.mark.parametrize(
    "value", ["[[orders]]", "[{name: orders}]", "[null]", "[true]"]
)
def test_non_string_excepted_models_are_controlled_errors(project, value):
    declare(
        project,
        EXCLUDE.replace(
            "via: many_to_one}", "via: many_to_one, except_models: " + value + "}"
        ),
    )
    declarations, errors = parse(project)
    assert not declarations
    assert any(
        "covers.except_models must list model names" in error for error in errors
    )


@pytest.mark.parametrize("value", ["[fx_rates]", "{name: fx_rates}", "null", "true"])
def test_non_string_rate_model_is_a_controlled_error(project, value):
    declare(project, RATE.replace("model: fx_rates", "model: " + value))
    declarations, errors = parse(project)
    assert not declarations
    assert any("rate.model must name a model" in error for error in errors)


@pytest.mark.parametrize(
    "before,after",
    [
        ("exclude: true", "exclude: true\n    exclude: false"),
        ("exclude: true", "exclude: 1\n    exclude: true"),
        ("kind: exclude_rows", "kind: invalid\n    kind: exclude_rows"),
        ("id: exclude-test-accounts", "id: ignored\n    id: exclude-test-accounts"),
        ("reaching: customers", "reaching: ignored, reaching: customers"),
    ],
)
def test_duplicate_declaration_mapping_keys_cannot_change_enforced_rules(
    project, before, after
):
    declare(project, EXCLUDE.replace(before, after))
    declarations, errors = parse(project)
    assert not declarations and errors
    assert "duplicate" in str(errors).lower()


def test_inherited_defaults_still_reject_duplicate_declaration_keys(project):
    front = (
        "base: &base\n  defaults:\n"
        + "\n".join(
            "  " + line
            for line in EXCLUDE.replace(
                "exclude: true", "exclude: false\n    exclude: true"
            ).splitlines()
        )
        + "\n<<: *base\n"
    )
    (project / "knowledge/rules/inherited.md").write_text(
        "---\n" + front + "---\nProse.\n"
    )
    declarations, errors = parse(project)
    assert not declarations and errors and "duplicate" in str(errors).lower()


def test_explicit_yaml_merge_override_inside_a_declaration_remains_valid(project):
    declare(
        project,
        "  - <<: {kind: exclude_rows, column: customers.is_test, exclude: false, covers: {reaching: customers, via: many_to_one}}\n    id: exclude-test-accounts\n    exclude: true\n",
    )
    declarations, errors = parse(project)
    assert errors == [] and len(declarations) == 1 and declarations[0].exclude is True
