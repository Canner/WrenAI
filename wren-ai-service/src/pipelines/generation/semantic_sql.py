from __future__ import annotations

import logging
import json
import re
from ast import literal_eval
from collections import deque
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Literal

import sqlparse

logger = logging.getLogger("wren-ai-service")


Aggregate = Literal["COUNT", "SUM", "AVG", "MIN", "MAX"]
JoinType = Literal["INNER JOIN", "LEFT JOIN"]


@dataclass(frozen=True)
class Intent:
    question_type: str
    chart_requested: bool = False
    chart_type: str = "auto"
    ranking: bool = False
    top_n: int | None = None
    bottom_n: int | None = None
    distinct: bool = False
    aggregation: Aggregate | None = None
    needs_sql: bool = True


@dataclass(frozen=True)
class ColumnRef:
    table: str
    column: str
    data_type: str = ""
    description: str = ""

    @property
    def sql(self) -> str:
        return f'{quote_identifier(self.table)}.{quote_identifier(self.column)}'

    @property
    def object_name(self) -> str:
        return f"{self.table}.{self.column}"


@dataclass(frozen=True)
class Relationship:
    left_table: str
    left_column: str
    right_table: str
    right_column: str
    join_type: JoinType = "INNER JOIN"
    cardinality: str = ""
    source: str = "schema"


@dataclass(frozen=True)
class MetricDefinition:
    name: str
    column: ColumnRef
    aggregation: Aggregate
    description: str = ""
    synonyms: tuple[str, ...] = ()
    allowed_dimensions: tuple[str, ...] = ()
    formula: str | None = None
    grain: str | None = None
    join_requirements: tuple[str, ...] = ()


@dataclass(frozen=True)
class FilterDefinition:
    column: ColumnRef
    operator: str
    value: Any = None
    end_value: Any = None


@dataclass(frozen=True)
class SortDefinition:
    expression: str
    direction: Literal["ASC", "DESC"] = "DESC"


@dataclass
class SemanticPlan:
    intent: Intent
    entities: list[str] = field(default_factory=list)
    metrics: list[MetricDefinition] = field(default_factory=list)
    aggregation: Aggregate | None = None
    filters: list[FilterDefinition] = field(default_factory=list)
    group_by: list[ColumnRef] = field(default_factory=list)
    sort: list[SortDefinition] = field(default_factory=list)
    limit: int | None = None
    base_table: str | None = None
    joins: list[Relationship] = field(default_factory=list)
    chart_type: str = ""
    warnings: list[str] = field(default_factory=list)

    @property
    def is_complete(self) -> bool:
        if not self.base_table:
            return False
        if self.intent.aggregation and not self.metrics and self.intent.aggregation != "COUNT":
            return False
        required_tables = {
            ref.table
            for ref in [
                *[metric.column for metric in self.metrics],
                *self.group_by,
                *[filter_.column for filter_ in self.filters],
            ]
        }
        connected_tables = {self.base_table}
        for join in self.joins:
            connected_tables.add(join.left_table)
            connected_tables.add(join.right_table)
        return required_tables.issubset(connected_tables)


@dataclass
class SQLValidationResult:
    valid: bool
    errors: list[str] = field(default_factory=list)


@dataclass
class CompileResult:
    sql: str
    plan: SemanticPlan
    validation: SQLValidationResult


@dataclass
class SchemaCatalog:
    tables: dict[str, list[ColumnRef]] = field(default_factory=dict)
    relationships: list[Relationship] = field(default_factory=list)

    def columns(self) -> list[ColumnRef]:
        return [column for columns in self.tables.values() for column in columns]

    def table_for_column(self, column: ColumnRef) -> str:
        return column.table

    def get_column(self, table: str, column: str) -> ColumnRef | None:
        for candidate in self.tables.get(table, []):
            if candidate.column.lower() == column.lower():
                return candidate
        return None


_STOPWORDS = {
    "a",
    "an",
    "and",
    "as",
    "at",
    "by",
    "chart",
    "for",
    "from",
    "give",
    "graph",
    "in",
    "last",
    "me",
    "of",
    "on",
    "per",
    "show",
    "the",
    "this",
    "to",
    "with",
}
_GENERIC_COLUMN_TOKENS = {
    "amount",
    "at",
    "code",
    "date",
    "day",
    "id",
    "key",
    "month",
    "name",
    "no",
    "number",
    "time",
    "total",
    "type",
    "value",
    "year",
}
_SYNONYMS = {
    "acct": {"account", "customer", "client"},
    "account": {"acct", "customer", "client"},
    "amount": {"amt", "value", "total"},
    "avg": {"average", "mean"},
    "bill": {"invoice"},
    "billing": {"invoice"},
    "client": {"customer", "account"},
    "cost": {"expense", "spend"},
    "cust": {"customer", "client", "account"},
    "customer": {"cust", "client", "account"},
    "gmv": {"revenue", "sales", "amount"},
    "invoice": {"inv", "bill", "billing"},
    "profit": {"margin", "income", "earnings"},
    "qty": {"quantity", "units"},
    "quantity": {"qty", "units"},
    "revenue": {"sales", "amount", "value", "gmv"},
    "sale": {"sales", "revenue", "amount"},
    "sales": {"sale", "revenue", "amount", "gmv"},
    "total": {"sum", "amount", "value"},
    "value": {"amount", "total"},
}
_NUMERIC_TYPES = {
    "bigint",
    "decimal",
    "double",
    "float",
    "int",
    "integer",
    "numeric",
    "real",
    "smallint",
}
_TEMPORAL_TYPES = {"date", "datetime", "timestamp", "time"}
_TEXT_TYPES = {"char", "string", "text", "varchar"}


def quote_identifier(identifier: str) -> str:
    return f'"{str(identifier).replace(chr(34), chr(34) + chr(34))}"'


def tokenize(value: Any) -> set[str]:
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", str(value or ""))
    raw_tokens = {
        token.lower()
        for token in re.findall(r"[A-Za-z0-9]+", text)
        if len(token) > 1 and token.lower() not in _STOPWORDS
    }
    tokens = set(raw_tokens)
    for token in list(raw_tokens):
        if len(token) > 4 and token.endswith("ies"):
            tokens.add(f"{token[:-3]}y")
        elif len(token) > 3 and token.endswith("s"):
            tokens.add(token[:-1])
    for token in list(tokens):
        tokens.update(_SYNONYMS.get(token, set()))
    return tokens


def compact(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def is_numeric_type(data_type: str) -> bool:
    normalized = data_type.lower()
    return any(type_name in normalized for type_name in _NUMERIC_TYPES)


def is_temporal_type(data_type: str) -> bool:
    normalized = data_type.lower()
    return any(type_name in normalized for type_name in _TEMPORAL_TYPES)


def is_text_type(data_type: str) -> bool:
    normalized = data_type.lower()
    return any(type_name in normalized for type_name in _TEXT_TYPES)


class IntentDetector:
    def detect(self, query: str) -> Intent:
        normalized = query.lower()
        top_match = re.search(r"\btop\s+(\d+)\b", normalized)
        bottom_match = re.search(r"\bbottom\s+(\d+)\b", normalized)
        aggregation = self._detect_aggregation(normalized)
        chart_type = self._detect_chart_type(normalized)
        question_type = "retrieval"
        if aggregation:
            question_type = "aggregation"
        if re.search(r"\btrend|over time|monthly|weekly|daily|yearly\b", normalized):
            question_type = "trend"
        if top_match or bottom_match or re.search(
            r"\b(highest|lowest|largest|smallest|rank|ranking)\b", normalized
        ):
            question_type = "ranking"
        if "dashboard" in normalized or "kpi" in normalized:
            question_type = "dashboard"

        return Intent(
            question_type=question_type,
            chart_requested=bool(chart_type),
            chart_type=chart_type or "auto",
            ranking=question_type == "ranking",
            top_n=(
                int(top_match.group(1))
                if top_match
                else 10
                if re.search(r"\btop\b", normalized)
                else None
            ),
            bottom_n=int(bottom_match.group(1)) if bottom_match else None,
            distinct=bool(re.search(r"\bdistinct|unique\b", normalized)),
            aggregation=aggregation,
        )

    def _detect_aggregation(self, normalized_query: str) -> Aggregate | None:
        if re.search(r"\b(avg|average|mean)\b", normalized_query):
            return "AVG"
        if re.search(r"\b(count|number of|how many)\b", normalized_query):
            return "COUNT"
        if re.search(r"\b(min|minimum)\b", normalized_query):
            return "MIN"
        if re.search(r"\b(max|maximum)\b", normalized_query):
            return "MAX"
        if re.search(r"\b(sum|total)\b", normalized_query):
            return "SUM"
        return None

    def _detect_chart_type(self, normalized_query: str) -> str:
        checks = (
            ("line", ("line chart", "line graph", "trend")),
            ("pie", ("pie chart", "donut chart", "part to whole")),
            ("scatter", ("scatter", "correlation")),
            ("bar", ("bar chart", "bar graph", "column chart")),
            ("card", ("kpi", "single kpi")),
        )
        for chart_type, terms in checks:
            if any(term in normalized_query for term in terms):
                return chart_type
        if re.search(r"\b(chart|graph|plot|visuali[sz]e)\b", normalized_query):
            return "auto"
        return ""


class SchemaParser:
    def parse(self, documents: list[str]) -> SchemaCatalog:
        catalog = SchemaCatalog()
        for document in documents or []:
            text = str(document)
            self._parse_create_table(text, catalog)
            self._parse_metadata_document(text, catalog)
        return catalog

    def _parse_create_table(self, ddl: str, catalog: SchemaCatalog) -> None:
        table_match = re.search(
            r'\bCREATE\s+TABLE\s+(?:"(?P<quoted>[^"]+)"|`(?P<backticked>[^`]+)`|'
            r"\[(?P<bracketed>[^\]]+)\]|(?P<bare>[A-Za-z_][A-Za-z0-9_.$]*))\s*\(",
            ddl,
            flags=re.IGNORECASE,
        )
        if not table_match:
            return
        table_name = next(value for value in table_match.groupdict().values() if value)
        body = self._table_body(ddl, table_match.end())
        columns: list[ColumnRef] = []
        for definition in self._split_definitions(body):
            stripped = definition.strip().rstrip(",")
            if not stripped:
                continue
            fk = re.search(
                r"FOREIGN\s+KEY\s*\((?P<left>[^\)]+)\)\s+REFERENCES\s+"
                r'(?:"(?P<rq>[^"]+)"|`(?P<rb>[^`]+)`|\[(?P<rs>[^\]]+)\]|'
                r"(?P<rbare>[A-Za-z_][A-Za-z0-9_.$]*))\s*\((?P<right>[^\)]+)\)",
                stripped,
                flags=re.IGNORECASE,
            )
            if fk:
                right_table = next(
                    value
                    for value in (
                        fk.group("rq"),
                        fk.group("rb"),
                        fk.group("rs"),
                        fk.group("rbare"),
                    )
                    if value
                )
                catalog.relationships.append(
                    Relationship(
                        left_table=table_name,
                        left_column=self._clean_identifier(fk.group("left")),
                        right_table=right_table,
                        right_column=self._clean_identifier(fk.group("right")),
                    )
                )
                continue
            if re.match(
                r"^(?:PRIMARY|FOREIGN|CONSTRAINT|UNIQUE|KEY|INDEX)\b",
                stripped,
                flags=re.IGNORECASE,
            ):
                continue
            column_match = re.match(
                r'(?:"(?P<quoted>[^"]+)"|`(?P<backticked>[^`]+)`|'
                r"\[(?P<bracketed>[^\]]+)\]|(?P<bare>[A-Za-z_][A-Za-z0-9_$]*))"
                r"\s+(?P<type>[A-Za-z_][A-Za-z0-9_]*(?:\([^\)]*\))?)",
                stripped,
            )
            if column_match:
                column_name = next(
                    value
                    for key, value in column_match.groupdict().items()
                    if key != "type" and value
                )
                columns.append(
                    ColumnRef(
                        table=table_name,
                        column=column_name,
                        data_type=column_match.group("type") or "",
                    )
                )
        if columns:
            catalog.tables[table_name] = columns

    def _parse_metadata_document(self, text: str, catalog: SchemaCatalog) -> None:
        metadata = self._literal_document(text)
        if not isinstance(metadata, dict):
            return
        for model in [
            *(metadata.get("models") or []),
            *(metadata.get("views") or []),
        ]:
            if not isinstance(model, dict) or not model.get("name"):
                continue
            table_name = str(model["name"])
            columns: list[ColumnRef] = []
            for column in [
                *(model.get("columns") or []),
                *(model.get("calculatedFields") or []),
            ]:
                if not isinstance(column, dict) or not column.get("name"):
                    continue
                columns.append(
                    ColumnRef(
                        table=table_name,
                        column=str(column["name"]),
                        data_type=str(
                            column.get("data_type")
                            or column.get("type")
                            or column.get("dataType")
                            or ""
                        ),
                        description=str(column.get("comment") or column.get("description") or ""),
                    )
                )
            if columns:
                catalog.tables[table_name] = columns
            reference_name = model.get("referenceName")
            if reference_name and columns:
                catalog.tables[str(reference_name)] = [
                    ColumnRef(
                        table=str(reference_name),
                        column=column.column,
                        data_type=column.data_type,
                        description=column.description,
                    )
                    for column in columns
                ]
        for relationship in metadata.get("relationships") or []:
            parsed = self._relationship_from_metadata(relationship)
            if parsed:
                catalog.relationships.append(parsed)

    def _literal_document(self, text: str) -> Any:
        stripped = text.strip()
        if not stripped.startswith("{"):
            return None
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            pass
        try:
            return literal_eval(stripped)
        except (SyntaxError, ValueError):
            return None

    def _relationship_from_metadata(self, relationship: Any) -> Relationship | None:
        if not isinstance(relationship, dict):
            return None
        condition = str(relationship.get("condition") or "")
        match = re.search(
            r'(?P<left_table>[A-Za-z_][A-Za-z0-9_.$]*)\.(?P<left_column>[A-Za-z_][A-Za-z0-9_$]*)\s*=\s*'
            r'(?P<right_table>[A-Za-z_][A-Za-z0-9_.$]*)\.(?P<right_column>[A-Za-z_][A-Za-z0-9_$]*)',
            condition,
        )
        if not match:
            return None
        return Relationship(
            left_table=match.group("left_table"),
            left_column=match.group("left_column"),
            right_table=match.group("right_table"),
            right_column=match.group("right_column"),
            cardinality=str(relationship.get("joinType") or relationship.get("type") or ""),
            source="semantic_metadata",
        )

    def _table_body(self, ddl: str, start: int) -> str:
        depth = 1
        cursor = start
        while cursor < len(ddl) and depth > 0:
            if ddl[cursor] == "(":
                depth += 1
            elif ddl[cursor] == ")":
                depth -= 1
            cursor += 1
        return ddl[start : cursor - 1]

    def _split_definitions(self, body: str) -> list[str]:
        definitions: list[str] = []
        depth = 0
        start = 0
        for index, char in enumerate(body):
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
            elif char == "," and depth == 0:
                definitions.append(body[start:index])
                start = index + 1
        definitions.append(body[start:])
        return definitions

    def _clean_identifier(self, value: str) -> str:
        return str(value or "").strip().strip('"`[]')


class MetricRegistry:
    def __init__(self, catalog: SchemaCatalog, semantic_analysis: dict[str, Any] | None):
        self.catalog = catalog
        self.semantic_analysis = semantic_analysis or {}
        self.metrics = self._build_metrics()

    def resolve_metric(self, query: str, intent: Intent) -> MetricDefinition | None:
        mappings = self.semantic_analysis.get("concept_mappings") or []
        for mapping in mappings:
            if not isinstance(mapping, dict):
                continue
            if str(mapping.get("concept_type", "")).lower() != "metric":
                continue
            for schema_object in mapping.get("schema_objects") or []:
                column = self._column_from_schema_object(str(schema_object))
                if column:
                    return MetricDefinition(
                        name=str(mapping.get("request_concept") or column.column),
                        column=column,
                        aggregation=intent.aggregation or self._default_aggregation(column),
                        synonyms=tuple(tokenize(mapping.get("request_concept"))),
                    )

        query_tokens = tokenize(query)
        scored = [
            (self._score_metric(metric, query_tokens), metric)
            for metric in self.metrics
        ]
        scored = [(score, metric) for score, metric in scored if score > 0]
        if not scored:
            return None
        scored.sort(key=lambda item: item[0], reverse=True)
        metric = scored[0][1]
        if intent.aggregation:
            return MetricDefinition(
                name=metric.name,
                column=metric.column,
                aggregation=intent.aggregation,
                description=metric.description,
                synonyms=metric.synonyms,
                allowed_dimensions=metric.allowed_dimensions,
                formula=metric.formula,
                grain=metric.grain,
                join_requirements=metric.join_requirements,
            )
        return metric

    def _build_metrics(self) -> list[MetricDefinition]:
        metrics: list[MetricDefinition] = []
        for column in self.catalog.columns():
            if not is_numeric_type(column.data_type):
                continue
            tokens = tokenize(f"{column.table} {column.column}")
            if not tokens.intersection(
                {
                    "amount",
                    "balance",
                    "cost",
                    "gmv",
                    "margin",
                    "price",
                    "profit",
                    "quantity",
                    "rate",
                    "revenue",
                    "sale",
                    "sales",
                    "score",
                    "total",
                    "value",
                }
            ):
                continue
            metrics.append(
                MetricDefinition(
                    name=humanize(column.column),
                    column=column,
                    aggregation=self._default_aggregation(column),
                    synonyms=tuple(tokens),
                )
            )
        return metrics

    def _column_from_schema_object(self, schema_object: str) -> ColumnRef | None:
        parts = [part.strip().strip('"`[]') for part in schema_object.split(".")]
        if len(parts) < 2:
            return None
        table = ".".join(parts[:-1])
        column = parts[-1]
        direct = self.catalog.get_column(table, column)
        if direct:
            return direct
        for table_name in self.catalog.tables:
            if table_name.lower().endswith(table.lower()):
                candidate = self.catalog.get_column(table_name, column)
                if candidate:
                    return candidate
        return None

    def _default_aggregation(self, column: ColumnRef) -> Aggregate:
        tokens = tokenize(column.column)
        if tokens.intersection({"avg", "average", "mean", "rate", "ratio", "percent"}):
            return "AVG"
        return "SUM"

    def _score_metric(self, metric: MetricDefinition, query_tokens: set[str]) -> int:
        metric_tokens = set(metric.synonyms) | tokenize(metric.name)
        score = len(metric_tokens.intersection(query_tokens)) * 10
        compact_query = compact(" ".join(query_tokens))
        compact_metric = compact(metric.name)
        if compact_metric and compact_metric in compact_query:
            score += 40
        return score


class EntityResolver:
    def __init__(self, catalog: SchemaCatalog, semantic_analysis: dict[str, Any] | None):
        self.catalog = catalog
        self.semantic_analysis = semantic_analysis or {}
        self._metric_registry = MetricRegistry(catalog, {})

    def resolve_dimensions(self, query: str, metric: MetricDefinition | None) -> list[ColumnRef]:
        mapped = self._dimensions_from_semantic_analysis()
        if mapped:
            return mapped
        requested_terms = self._requested_grouping_terms(query)
        if not requested_terms and metric:
            return []
        if not requested_terms:
            requested_terms = tokenize(query)
        scored: list[tuple[int, ColumnRef]] = []
        for column in self.catalog.columns():
            if metric and column == metric.column:
                continue
            if is_numeric_type(column.data_type):
                if self._looks_identifier(column) and not requested_terms.intersection(
                    {"id", "key", "number", "no"}
                ):
                    continue
                if not self._looks_identifier(column):
                    continue
            column_tokens = tokenize(f"{column.table} {column.column}")
            score = len(column_tokens.intersection(requested_terms)) * 10
            if is_text_type(column.data_type):
                score += 5
            if compact(column.column) in compact(" ".join(requested_terms)):
                score += 20
            if requested_terms and score:
                scored.append((score, column))
        scored.sort(key=lambda item: item[0], reverse=True)
        if not scored:
            return []
        best_score = scored[0][0]
        return [column for score, column in scored[:3] if score == best_score]

    def resolve_temporal_column(self, query: str, preferred_table: str | None) -> ColumnRef | None:
        if not self._requests_date_filter(query):
            return None
        candidates = [
            column
            for column in self.catalog.columns()
            if is_temporal_type(column.data_type)
            or tokenize(column.column).intersection(
                {"date", "time", "created", "updated", "month", "year"}
            )
        ]
        if preferred_table:
            candidates.sort(key=lambda column: column.table != preferred_table)
        return candidates[0] if candidates else None

    def _dimensions_from_semantic_analysis(self) -> list[ColumnRef]:
        dimensions: list[ColumnRef] = []
        mappings = self.semantic_analysis.get("concept_mappings") or []
        for mapping in mappings:
            if not isinstance(mapping, dict):
                continue
            if str(mapping.get("concept_type", "")).lower() not in {
                "dimension",
                "entity",
                "identifier",
            }:
                continue
            for schema_object in mapping.get("schema_objects") or []:
                column = self._metric_registry._column_from_schema_object(str(schema_object))
                if column and column not in dimensions:
                    dimensions.append(column)
        return dimensions

    def _requested_grouping_terms(self, query: str) -> set[str]:
        normalized = query.lower()
        terms: set[str] = set()
        for match in re.finditer(
            r"\b(?:by|per|for each|group(?:ed)? by)\s+([A-Za-z0-9_ ]+)",
            normalized,
        ):
            phrase = re.split(
                r"\b(?:and|with|where|order|sort|top|bottom|last|this|limit)\b",
                match.group(1),
                maxsplit=1,
            )[0]
            terms.update(tokenize(phrase))
        ranking_entity = re.search(
            r"\b(?:top|bottom)\s+(?:\d+\s+)?([A-Za-z0-9_ ]+?)\s+by\b",
            normalized,
        )
        if ranking_entity:
            terms.update(tokenize(ranking_entity.group(1)))
        return terms

    def _requests_date_filter(self, query: str) -> bool:
        return bool(
            re.search(
                r"\b(today|yesterday|this|last|rolling|past|previous)\s+"
                r"(?:\d+\s+)?(?:day|week|month|quarter|year)s?\b",
                query.lower(),
            )
        )

    def _looks_identifier(self, column: ColumnRef) -> bool:
        return bool(tokenize(column.column).intersection({"id", "key", "number", "no"}))


class RelationshipGraph:
    def __init__(self, catalog: SchemaCatalog):
        self.catalog = catalog

    def join_path(self, required_tables: set[str], base_table: str) -> list[Relationship] | None:
        joins: list[Relationship] = []
        connected = {base_table}
        for table in sorted(required_tables - connected):
            path = self._shortest_path(connected, table)
            if not path:
                return None
            joins.extend(path)
            for relationship in path:
                connected.add(relationship.left_table)
                connected.add(relationship.right_table)
        return self._dedupe(joins)

    def _shortest_path(self, sources: set[str], target: str) -> list[Relationship] | None:
        queue: deque[tuple[str, list[Relationship]]] = deque(
            (source, []) for source in sources
        )
        seen = set(sources)
        while queue:
            table, path = queue.popleft()
            if table == target:
                return path
            for relationship in self._neighbors(table):
                next_table = (
                    relationship.right_table
                    if relationship.left_table == table
                    else relationship.left_table
                )
                if next_table in seen:
                    continue
                seen.add(next_table)
                queue.append((next_table, [*path, relationship]))
        return None

    def _neighbors(self, table: str) -> list[Relationship]:
        return [
            relationship
            for relationship in self.catalog.relationships
            if relationship.left_table == table or relationship.right_table == table
        ]

    def _dedupe(self, relationships: list[Relationship]) -> list[Relationship]:
        deduped: list[Relationship] = []
        seen: set[tuple[str, str, str, str]] = set()
        for relationship in relationships:
            key = (
                relationship.left_table,
                relationship.left_column,
                relationship.right_table,
                relationship.right_column,
            )
            if key in seen:
                continue
            seen.add(key)
            deduped.append(relationship)
        return deduped


class SemanticPlanner:
    def __init__(self, catalog: SchemaCatalog, semantic_analysis: dict[str, Any] | None):
        self.catalog = catalog
        self.semantic_analysis = semantic_analysis or {}
        self.metric_registry = MetricRegistry(catalog, semantic_analysis)
        self.entity_resolver = EntityResolver(catalog, semantic_analysis)
        self.relationship_graph = RelationshipGraph(catalog)

    def build_plan(self, query: str, now: datetime | None = None) -> SemanticPlan | None:
        intent = IntentDetector().detect(query)
        metric = self.metric_registry.resolve_metric(query, intent)
        aggregation = intent.aggregation or (metric.aggregation if metric else None)
        dimensions = self.entity_resolver.resolve_dimensions(query, metric)
        if aggregation == "COUNT" and not self._has_explicit_grouping(query):
            dimensions = []
        temporal_column = self.entity_resolver.resolve_temporal_column(
            query,
            metric.column.table if metric else (dimensions[0].table if dimensions else None),
        )
        filters = []
        if temporal_column:
            date_filter = DateResolver(now or datetime.now()).resolve(query, temporal_column)
            if date_filter:
                filters.append(date_filter)

        required_refs = [
            *([metric.column] if metric else []),
            *dimensions,
            *[filter_.column for filter_ in filters],
        ]
        base_table = self._choose_base_table(required_refs)
        if not base_table and aggregation == "COUNT":
            base_table = self._resolve_table_from_query(query)
        if not base_table:
            return None
        required_tables = {ref.table for ref in required_refs}
        joins = self.relationship_graph.join_path(required_tables, base_table)
        if joins is None:
            return None

        metric_expression = self._metric_expression(metric, aggregation)
        sort = []
        if intent.ranking and metric_expression:
            sort.append(SortDefinition(metric_expression, "ASC" if intent.bottom_n else "DESC"))
        limit = intent.top_n or intent.bottom_n
        chart_type = ChartRuleEngine().select_chart(intent, dimensions, [metric] if metric else [])

        plan = SemanticPlan(
            intent=intent,
            entities=[humanize(dimension.column) for dimension in dimensions],
            metrics=[metric] if metric else [],
            aggregation=aggregation,
            filters=filters,
            group_by=dimensions,
            sort=sort,
            limit=limit,
            base_table=base_table,
            joins=joins,
            chart_type=chart_type,
        )
        return plan if plan.is_complete else None

    def _choose_base_table(self, refs: list[ColumnRef]) -> str | None:
        if not refs:
            return None
        table_counts: dict[str, int] = {}
        for ref in refs:
            table_counts[ref.table] = table_counts.get(ref.table, 0) + 1
        return sorted(table_counts.items(), key=lambda item: item[1], reverse=True)[0][0]

    def _resolve_table_from_query(self, query: str) -> str | None:
        query_tokens = tokenize(query)
        scored: list[tuple[int, str]] = []
        for table in self.catalog.tables:
            table_tokens = tokenize(table)
            score = len(table_tokens.intersection(query_tokens)) * 10
            if compact(table) in compact(query):
                score += 30
            if score:
                scored.append((score, table))
        if not scored and len(self.catalog.tables) == 1:
            return next(iter(self.catalog.tables))
        scored.sort(key=lambda item: item[0], reverse=True)
        return scored[0][1] if scored else None

    def _has_explicit_grouping(self, query: str) -> bool:
        return bool(
            re.search(
                r"\b(?:by|per|for each|group(?:ed)? by|top|bottom|rank|ranking)\b",
                query.lower(),
            )
        )

    def _metric_expression(
        self,
        metric: MetricDefinition | None,
        aggregation: Aggregate | None,
    ) -> str:
        if aggregation == "COUNT" and not metric:
            return "COUNT(*)"
        if not metric or not aggregation:
            return ""
        return f"{aggregation}({metric.column.sql})"


class DateResolver:
    def __init__(self, now: datetime):
        self.today = now.date()

    def resolve(self, query: str, column: ColumnRef) -> FilterDefinition | None:
        normalized = query.lower()
        start: date | None = None
        end: date | None = None
        if "today" in normalized:
            start = self.today
            end = self.today + timedelta(days=1)
        elif "yesterday" in normalized:
            start = self.today - timedelta(days=1)
            end = self.today
        elif "last month" in normalized:
            current_month = self.today.replace(day=1)
            end = current_month
            start = add_months(current_month, -1)
        elif "this month" in normalized:
            start = self.today.replace(day=1)
            end = add_months(start, 1)
        elif "last year" in normalized:
            start = date(self.today.year - 1, 1, 1)
            end = date(self.today.year, 1, 1)
        elif "this year" in normalized:
            start = date(self.today.year, 1, 1)
            end = date(self.today.year + 1, 1, 1)
        elif "last week" in normalized:
            this_week = self.today - timedelta(days=self.today.weekday())
            start = this_week - timedelta(days=7)
            end = this_week
        elif "this week" in normalized:
            start = self.today - timedelta(days=self.today.weekday())
            end = start + timedelta(days=7)
        elif "last quarter" in normalized or "this quarter" in normalized:
            quarter_month = ((self.today.month - 1) // 3) * 3 + 1
            this_quarter = date(self.today.year, quarter_month, 1)
            if "last quarter" in normalized:
                end = this_quarter
                start = add_months(this_quarter, -3)
            else:
                start = this_quarter
                end = add_months(this_quarter, 3)
        else:
            rolling_match = re.search(
                r"\b(?:last|past|rolling)\s+(\d+)\s+(day|week|month|year)s?\b",
                normalized,
            )
            if rolling_match:
                amount = int(rolling_match.group(1))
                unit = rolling_match.group(2)
                end = self.today + timedelta(days=1)
                if unit == "day":
                    start = self.today - timedelta(days=amount)
                elif unit == "week":
                    start = self.today - timedelta(days=amount * 7)
                elif unit == "month":
                    start = add_months(self.today, -amount)
                elif unit == "year":
                    start = add_months(self.today, -amount * 12)
        if not start or not end:
            return None
        return FilterDefinition(
            column=column,
            operator="BETWEEN_CLOSED_OPEN",
            value=start.isoformat(),
            end_value=end.isoformat(),
        )


class SQLCompiler:
    def compile(self, plan: SemanticPlan, data_source: str = "") -> str:
        if not plan.base_table:
            raise ValueError("Semantic plan has no base table")
        select_items = self._select_items(plan)
        from_clause = f"FROM {quote_identifier(plan.base_table)}"
        join_clause = self._join_clause(plan)
        where_clause = self._where_clause(plan)
        group_clause = self._group_clause(plan)
        order_clause = self._order_clause(plan)
        limit_clause = self._limit_clause(plan, data_source)
        top_clause = ""
        if normalize_data_source(data_source) == "MSSQL" and plan.limit:
            top_clause = f" TOP {plan.limit}"
            limit_clause = ""
        return " ".join(
            part
            for part in (
                f"SELECT{top_clause} {', '.join(select_items)}",
                from_clause,
                join_clause,
                where_clause,
                group_clause,
                order_clause,
                limit_clause,
            )
            if part
        )

    def _select_items(self, plan: SemanticPlan) -> list[str]:
        items = [
            f"{dimension.sql} AS {quote_identifier(safe_alias(dimension.column))}"
            for dimension in plan.group_by
        ]
        if plan.metrics:
            for metric in plan.metrics:
                aggregation = plan.aggregation or metric.aggregation
                alias = safe_alias(f"{aggregation.lower()}_{metric.column.column}")
                items.append(f"{aggregation}({metric.column.sql}) AS {quote_identifier(alias)}")
        elif plan.aggregation == "COUNT":
            items.append('COUNT(*) AS "count"')
        if plan.intent.distinct and not plan.aggregation and not plan.metrics:
            return [
                f"DISTINCT {dimension.sql} AS {quote_identifier(safe_alias(dimension.column))}"
                for dimension in plan.group_by
            ]
        return items

    def _join_clause(self, plan: SemanticPlan) -> str:
        clauses = []
        joined = {plan.base_table}
        for relationship in plan.joins:
            if relationship.left_table in joined:
                join_table = relationship.right_table
                on_left = f"{quote_identifier(relationship.left_table)}.{quote_identifier(relationship.left_column)}"
                on_right = f"{quote_identifier(relationship.right_table)}.{quote_identifier(relationship.right_column)}"
            else:
                join_table = relationship.left_table
                on_left = f"{quote_identifier(relationship.left_table)}.{quote_identifier(relationship.left_column)}"
                on_right = f"{quote_identifier(relationship.right_table)}.{quote_identifier(relationship.right_column)}"
            clauses.append(
                f"{relationship.join_type} {quote_identifier(join_table)} ON {on_left} = {on_right}"
            )
            joined.add(join_table)
        return " ".join(clauses)

    def _where_clause(self, plan: SemanticPlan) -> str:
        conditions = []
        for filter_ in plan.filters:
            if filter_.operator == "BETWEEN_CLOSED_OPEN":
                conditions.append(
                    f"{filter_.column.sql} >= '{filter_.value}' AND {filter_.column.sql} < '{filter_.end_value}'"
                )
        return f"WHERE {' AND '.join(conditions)}" if conditions else ""

    def _group_clause(self, plan: SemanticPlan) -> str:
        if not plan.group_by or not plan.aggregation:
            return ""
        return "GROUP BY " + ", ".join(dimension.sql for dimension in plan.group_by)

    def _order_clause(self, plan: SemanticPlan) -> str:
        if not plan.sort:
            return ""
        return "ORDER BY " + ", ".join(
            f"{sort.expression} {sort.direction}" for sort in plan.sort
        )

    def _limit_clause(self, plan: SemanticPlan, data_source: str) -> str:
        if not plan.limit or normalize_data_source(data_source) == "MSSQL":
            return ""
        return f"LIMIT {plan.limit}"


class SQLAstValidator:
    def validate(self, sql: str, plan: SemanticPlan) -> SQLValidationResult:
        errors: list[str] = []
        parsed = sqlparse.parse(sql)
        if len(parsed) != 1:
            errors.append("SQL must contain exactly one statement")
        if not sqlparse.tokens.DML:
            errors.append("SQL parser unavailable")
        if not re.match(r"^\s*SELECT\b", sql, flags=re.IGNORECASE):
            errors.append("SQL must be a SELECT statement")
        if "*" in sql and plan.metrics:
            errors.append("Metric queries must not use SELECT *")
        if plan.joins and not re.search(r"\b(?:ON|USING)\b", sql, flags=re.IGNORECASE):
            errors.append("Joins must include ON or USING")
        if plan.aggregation and plan.group_by:
            group_text = self._clause(sql, "GROUP BY", ["HAVING", "ORDER BY", "LIMIT", "FETCH"])
            for dimension in plan.group_by:
                if quote_identifier(dimension.column) not in group_text:
                    errors.append(f"Missing GROUP BY column: {dimension.object_name}")
        if plan.limit and not re.search(
            r"\b(?:LIMIT\s+\d+|TOP\s+\d+|FETCH\s+FIRST\s+\d+)\b",
            sql,
            flags=re.IGNORECASE,
        ):
            errors.append("Missing limit/TOP for ranked plan")
        if plan.filters and not re.search(r"\bWHERE\b", sql, flags=re.IGNORECASE):
            errors.append("Missing WHERE for filtered plan")
        return SQLValidationResult(valid=not errors, errors=errors)

    def _clause(self, sql: str, clause: str, terminators: list[str]) -> str:
        terminator_pattern = "|".join(rf"\b{terminator}\b" for terminator in terminators)
        match = re.search(
            rf"\b{clause}\b(?P<body>.*?)(?={terminator_pattern}|$)",
            sql,
            flags=re.IGNORECASE | re.DOTALL,
        )
        return match.group("body") if match else ""


class ExecutionValidator:
    def validate_result_shape(
        self,
        plan: SemanticPlan,
        rows: list[dict[str, Any]],
    ) -> SQLValidationResult:
        if not rows:
            return SQLValidationResult(valid=True)
        expected_columns = {safe_alias(dimension.column) for dimension in plan.group_by}
        for metric in plan.metrics:
            aggregation = plan.aggregation or metric.aggregation
            expected_columns.add(safe_alias(f"{aggregation.lower()}_{metric.column.column}"))
        actual_columns = set(rows[0].keys())
        missing = expected_columns - actual_columns
        errors = [f"Missing result column: {column}" for column in sorted(missing)]
        return SQLValidationResult(valid=not errors, errors=errors)


class ChartRuleEngine:
    def select_chart(
        self,
        intent: Intent,
        dimensions: list[ColumnRef],
        metrics: list[MetricDefinition],
    ) -> str:
        if intent.chart_type and intent.chart_type != "auto":
            return intent.chart_type
        if intent.ranking:
            return "bar"
        if len(metrics) >= 2:
            return "scatter"
        if len(metrics) == 1 and not dimensions:
            return "card"
        if any(is_temporal_type(dimension.data_type) for dimension in dimensions):
            return "line"
        if "percent" in " ".join(tokenize(" ".join(d.column for d in dimensions))):
            return "pie"
        if dimensions and metrics:
            return "bar"
        return ""


def add_months(value: date, months: int) -> date:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, month_days(year, month))
    return date(year, month, day)


def month_days(year: int, month: int) -> int:
    if month == 2:
        return 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28
    return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]


def humanize(value: str) -> str:
    return re.sub(r"[_\s]+", " ", str(value or "")).strip().title()


def safe_alias(value: str) -> str:
    alias = re.sub(r"[^A-Za-z0-9_]+", "_", str(value or "").strip()).strip("_")
    return alias.lower() or "value"


def normalize_data_source(data_source: str | None) -> str:
    normalized = (data_source or "").strip().upper().replace("-", "_").replace(" ", "_")
    if normalized in {"SQLSERVER", "SQL_SERVER", "MS_SQL", "MSSQLSERVER"}:
        return "MSSQL"
    return normalized


def compile_semantic_sql(
    query: str,
    documents: list[str],
    semantic_analysis: dict[str, Any] | None = None,
    data_source: str = "",
    now: datetime | None = None,
) -> CompileResult | None:
    catalog = SchemaParser().parse(documents)
    if not catalog.tables:
        return None
    plan = SemanticPlanner(catalog, semantic_analysis).build_plan(query, now=now)
    if not plan:
        return None
    sql = SQLCompiler().compile(plan, data_source=data_source)
    validation = SQLAstValidator().validate(sql, plan)
    if not validation.valid:
        logger.info("deterministic_semantic_sql_validation_failed errors=%s", validation.errors)
        return None
    return CompileResult(sql=sql, plan=plan, validation=validation)
