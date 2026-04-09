import base64
import os
import re
import uuid
from copy import deepcopy
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional, get_args
from urllib.parse import parse_qsl, quote, urlencode, urlparse, urlunparse

import aiohttp
import orjson
import requests
import tomlkit
import yaml
from dotenv import load_dotenv
from openai import AsyncClient
from tomlkit import parse

try:
    import psycopg2
except ModuleNotFoundError:  # pragma: no cover - exercised only in newer local envs
    import psycopg as psycopg2

import docker
from eval import WREN_ENGINE_API_URL, EvalSettings, resolve_host_eval_data_db_path
from src.providers.engine.wren import WrenEngine

load_dotenv(".env", override=True)


async def get_data_from_wren_engine(
    sql: str,
    mdl_json: dict,
    api_endpoint: str,
    data_source: Optional[str] = None,
    connection_info: Optional[dict] = None,
    timeout: float = 300,
    limit: Optional[int] = None,
):
    if data_source == "duckdb":
        async with aiohttp.request(
            "GET",
            f"{api_endpoint}/v1/mdl/preview",
            json={
                "sql": sql,
                "manifest": mdl_json,
                "limit": 500 if limit is None else limit,
            },
        ) as response:
            data = await response.json()

            if response.status != 200:
                return {"data": [], "columns": []}

            column_names = [col["name"] for col in data["columns"]]
            return {"data": data["data"], "columns": column_names}
    else:
        url = f"{api_endpoint}/v3/connector/{data_source}/query"
        if limit is not None:
            url += f"?limit={limit}"

        async with aiohttp.request(
            "POST",
            url,
            json={
                "sql": sql,
                "manifestStr": base64.b64encode(orjson.dumps(mdl_json)).decode(),
                "connectionInfo": connection_info,
            },
            timeout=aiohttp.ClientTimeout(total=timeout),
        ) as response:
            if response.status != 200:
                return {"data": [], "columns": []}

            data = await response.json()
            column_names = [col for col in data["columns"]]

            return {"data": data["data"], "columns": column_names}


async def get_contexts_from_sql(
    sql: str,
    mdl_json: dict,
    api_endpoint: str = WREN_ENGINE_API_URL,
    timeout: float = 300,
    **kwargs,
) -> list[str]:
    def _get_contexts_from_sql_analysis_results(sql_analysis_results: list[dict]):
        def _compose_contexts_of_select_type(select_items: list[dict]):
            return [
                f"{expr_source['sourceDataset']}.{expr_source['sourceColumn']}"
                for select_item in select_items
                for expr_source in select_item["exprSources"]
            ]

        def _compose_contexts_of_filter_type(filter: dict):
            contexts = []
            if filter["type"] == "EXPR":
                contexts += [
                    f"{expr_source['sourceDataset']}.{expr_source['sourceColumn']}"
                    for expr_source in filter["exprSources"]
                ]
            elif filter["type"] in ("AND", "OR"):
                contexts += _compose_contexts_of_filter_type(filter["left"])
                contexts += _compose_contexts_of_filter_type(filter["right"])

            return contexts

        def _compose_contexts_of_groupby_type(groupby_keys: list[list[dict]]):
            contexts = []
            for groupby_key_list in groupby_keys:
                contexts += [
                    f"{expr_source['sourceDataset']}.{expr_source['sourceColumn']}"
                    for groupby_key in groupby_key_list
                    for expr_source in groupby_key["exprSources"]
                ]
            return contexts

        def _compose_contexts_of_sorting_type(sortings: list[dict]):
            return [
                f"{expr_source['sourceDataset']}.{expr_source['sourceColumn']}"
                for sorting in sortings
                for expr_source in sorting["exprSources"]
            ]

        def _compose_contexts_of_relation_type(relation: dict):
            contexts = []
            if relation["type"] != "TABLE" and relation["type"] != "SUBQUERY":
                contexts += [
                    f"{expr_source['sourceDataset']}.{expr_source['sourceColumn']}"
                    for expr_source in relation["exprSources"]
                ]

                contexts += _compose_contexts_of_relation_type(relation["left"])
                contexts += _compose_contexts_of_relation_type(relation["right"])

            return contexts

        contexts = []
        for result in sql_analysis_results:
            if "selectItems" in result:
                contexts += _compose_contexts_of_select_type(result["selectItems"])
            if "filter" in result:
                contexts += _compose_contexts_of_filter_type(result["filter"])
            if "groupByKeys" in result:
                contexts += _compose_contexts_of_groupby_type(result["groupByKeys"])
            if "sortings" in result:
                contexts += _compose_contexts_of_sorting_type(result["sortings"])
            if "relation" in result:
                contexts += _compose_contexts_of_relation_type(result["relation"])

        return sorted(set(contexts))

    async def _get_sql_analysis(
        sql: str,
        mdl_json: dict,
        api_endpoint: str,
        timeout: float = 300,
    ) -> List[dict]:
        sql = sql.rstrip(";") if sql.endswith(";") else sql
        manifest_str = base64.b64encode(orjson.dumps(mdl_json)).decode()

        async with aiohttp.request(
            "GET",
            f"{api_endpoint}/v2/analysis/sql",
            json={
                "sql": sql,
                "manifestStr": manifest_str,
            },
            timeout=aiohttp.ClientTimeout(total=timeout),
        ) as response:
            return await response.json()

    sql_analysis_results = await _get_sql_analysis(
        sql, mdl_json, api_endpoint, timeout=timeout
    )
    contexts = _get_contexts_from_sql_analysis_results(sql_analysis_results)
    return contexts


def parse_toml(path: str) -> Dict[str, Any]:
    with open(path) as file:
        return parse(file.read())


def parse_db_name(path: str) -> str:
    match = re.search(
        r"bird_(.+?)_eval_dataset\.toml|spider_(.+?)_eval_dataset\.toml", path
    )
    if match:
        return match.group(1) or match.group(2)
    else:
        raise ValueError(
            f"Invalid path format: {path}. Expected format: bird_<db_name>_eval_dataset.toml or spider_<db_name>_eval_dataset.toml"
        )


TRACE_TYPES = Literal["execution", "shallow", "summary"]


def trace_metadata(
    meta: dict,
    type: TRACE_TYPES,
) -> dict:
    if type not in get_args(TRACE_TYPES):
        raise ValueError(
            f"Invalid type: {type}, should be one of {get_args(TRACE_TYPES)}"
        )
    return {
        "commit": meta["commit"],
        "dataset_id": meta["dataset_id"],
        "column_indexing_batch_size": meta["column_indexing_batch_size"],
        "table_retrieval_size": meta["table_retrieval_size"],
        "table_column_retrieval_size": meta["table_column_retrieval_size"],
        "type": type,
        "pipeline": meta["pipeline"],
    }


def engine_config(
    mdl: dict, pipe_components: dict[str, Any] = {}, path: str = ""
) -> dict:
    engine = pipe_components.get("sql_generation", {}).get("engine")

    if engine is None:
        raise ValueError(
            "SQL Generation engine not found in pipe_components. Ensure 'sql_generation' key exists and contains 'engine' configuration."
        )

    if isinstance(engine, WrenEngine):
        print("datasource is duckdb")
        prepare_duckdb_session_sql(engine._endpoint)
        prepare_duckdb_init_sql(engine._endpoint, mdl["catalog"], path)
        return {
            "mdl_json": mdl,
            "api_endpoint": engine._endpoint,
            "timeout": 10,
            "data_source": "duckdb",
        }

    return {
        "mdl_json": mdl,
        "data_source": engine._source,
        "api_endpoint": engine._endpoint,
        "connection_info": engine._connection_info,
        "timeout": 10,
    }


def get_ddl_commands(mdl: Dict[str, Any]) -> List[str]:
    def _convert_models_and_relationships(
        models: List[Dict[str, Any]], relationships: List[Dict[str, Any]]
    ) -> List[str]:
        ddl_commands = []

        # A map to store model primary keys for foreign key relationships
        primary_keys_map = {model["name"]: model["primaryKey"] for model in models}

        for model in models:
            table_name = model["name"]
            columns_ddl = []
            for column in model["columns"]:
                if "relationship" not in column:
                    if "properties" in column:
                        column["properties"]["alias"] = column["properties"].pop(
                            "displayName", ""
                        )
                        comment = f"-- {orjson.dumps(column['properties']).decode('utf-8')}\n  "
                    else:
                        comment = ""
                    if "isCalculated" in column and column["isCalculated"]:
                        comment = (
                            comment
                            + f"-- This column is a Calculated Field\n  -- column expression: {column['expression']}\n  "
                        )
                    column_name = column["name"]
                    column_type = column["type"]
                    column_ddl = f"{comment}{column_name} {column_type}"

                    # If column is a primary key
                    if column_name == model.get("primaryKey", ""):
                        column_ddl += " PRIMARY KEY"

                    columns_ddl.append(column_ddl)

            # Add foreign key constraints based on relationships
            for relationship in relationships:
                comment = f'-- {{"condition": {relationship["condition"]}, "joinType": {relationship["joinType"]}}}\n  '
                if (
                    table_name == relationship["models"][0]
                    and relationship["joinType"].upper() == "MANY_TO_ONE"
                ):
                    related_table = relationship["models"][1]
                    fk_column = relationship["condition"].split(" = ")[0].split(".")[1]
                    fk_constraint = f"FOREIGN KEY ({fk_column}) REFERENCES {related_table}({primary_keys_map[related_table]})"
                    columns_ddl.append(f"{comment}{fk_constraint}")
                elif (
                    table_name == relationship["models"][1]
                    and relationship["joinType"].upper() == "ONE_TO_MANY"
                ):
                    related_table = relationship["models"][0]
                    fk_column = relationship["condition"].split(" = ")[1].split(".")[1]
                    fk_constraint = f"FOREIGN KEY ({fk_column}) REFERENCES {related_table}({primary_keys_map[related_table]})"
                    columns_ddl.append(f"{comment}{fk_constraint}")
                elif (
                    table_name in relationship["models"]
                    and relationship["joinType"].upper() == "ONE_TO_ONE"
                ):
                    index = relationship["models"].index(table_name)
                    related_table = [
                        m for m in relationship["models"] if m != table_name
                    ][0]
                    fk_column = (
                        relationship["condition"].split(" = ")[index].split(".")[1]
                    )
                    fk_constraint = f"FOREIGN KEY ({fk_column}) REFERENCES {related_table}({primary_keys_map[related_table]})"
                    columns_ddl.append(f"{comment}{fk_constraint}")

            if "properties" in model:
                model["properties"]["alias"] = model["properties"].pop(
                    "displayName", ""
                )
                comment = (
                    f"\n/* {orjson.dumps(model['properties']).decode('utf-8')} */\n"
                )
            else:
                comment = ""

            create_table_ddl = (
                f"{comment}CREATE TABLE {table_name} (\n  "
                + ",\n  ".join(columns_ddl)
                + "\n);"
            )
            ddl_commands.append(create_table_ddl)

        return ddl_commands

    def _convert_views(views: List[Dict[str, Any]]) -> List[str]:
        def _format(view: Dict[str, Any]) -> str:
            properties = view["properties"] if "properties" in view else ""
            return f"/* {properties} */\nCREATE VIEW {view['name']}\nAS ({view['statement']})"

        return [_format(view) for view in views]

    def _convert_metrics(metrics: List[Dict[str, Any]]) -> List[str]:
        ddl_commands = []

        for metric in metrics:
            table_name = metric["name"]
            columns_ddl = []
            for dimension in metric["dimension"]:
                column_name = dimension["name"]
                column_type = dimension["type"]
                comment = "-- This column is a dimension\n  "
                column_ddl = f"{comment}{column_name} {column_type}"
                columns_ddl.append(column_ddl)

            for measure in metric["measure"]:
                column_name = measure["name"]
                column_type = measure["type"]
                comment = f"-- This column is a measure\n  -- expression: {measure['expression']}\n  "
                column_ddl = f"{comment}{column_name} {column_type}"
                columns_ddl.append(column_ddl)

            comment = f"\n/* This table is a metric */\n/* Metric Base Object: {metric['baseObject']} */\n"
            create_table_ddl = (
                f"{comment}CREATE TABLE {table_name} (\n  "
                + ",\n  ".join(columns_ddl)
                + "\n);"
            )

            ddl_commands.append(create_table_ddl)

        return ddl_commands

    semantics = {
        "models": [],
        "relationships": mdl["relationships"],
        "views": mdl["views"],
        "metrics": mdl["metrics"],
    }

    for model in mdl["models"]:
        columns = []
        for column in model["columns"]:
            ddl_column = {
                "name": column["name"],
                "type": column["type"],
            }
            if "properties" in column:
                ddl_column["properties"] = column["properties"]
            if "relationship" in column:
                ddl_column["relationship"] = column["relationship"]
            if "expression" in column:
                ddl_column["expression"] = column["expression"]
            if "isCalculated" in column:
                ddl_column["isCalculated"] = column["isCalculated"]

            columns.append(ddl_column)

        semantics["models"].append(
            {
                "type": "model",
                "name": model["name"],
                "properties": model["properties"] if "properties" in model else {},
                "columns": columns,
                "primaryKey": model["primaryKey"],
            }
        )

    return (
        _convert_models_and_relationships(
            semantics["models"], semantics["relationships"]
        )
        + _convert_metrics(semantics["metrics"])
        + _convert_views(semantics["views"])
    )


def get_documents_given_contexts(
    contexts_list: list[list[str]], mdl_json: dict
) -> list[list[dict]]:
    mdl_json_cloned = deepcopy(mdl_json)

    def _build_partial_mdl_json(
        contexts_list: list[list[str]], mdl_json: dict
    ) -> list[dict]:
        mdj_json_model_lookup_table = {
            model["name"]: {
                **model,
                "column_lookup": {
                    column["name"]: column
                    for column in model["columns"]
                    if "relationship" not in column
                },
                "relationship_lookup": {
                    column["relationship"]: column
                    for column in model["columns"]
                    if "relationship" in column
                },
            }
            for model in mdl_json["models"]
        }

        new_mdl_jsons = []
        for contexts in contexts_list:
            model_candidates = {}
            relationship_candidates = []
            for context in contexts:
                table_name, column_name = context.split(".")
                model = mdj_json_model_lookup_table.get(table_name)
                if model:
                    if table_name not in model_candidates:
                        model_candidates[table_name] = {
                            "name": model["name"],
                            "properties": model["properties"],
                            "tableReference": model["tableReference"],
                            "primaryKey": model["primaryKey"],
                            "columns": [],
                        }

                    # add column info
                    column = mdj_json_model_lookup_table[table_name]["column_lookup"][
                        column_name
                    ]
                    model_candidates[table_name]["columns"].append(column)

            contexts_in_set = set(contexts)
            for relationship in mdl_json["relationships"]:
                relationship_name = relationship["name"]
                condition_str = "".join(
                    relationship["condition"].split()
                )  # remove all whitespaces
                conditions = condition_str.split("=")
                if (
                    conditions[0] in contexts_in_set
                    and conditions[1] in contexts_in_set
                ):
                    table_name_first_condition = conditions[0].split(".")[0]
                    table_name_second_condition = conditions[1].split(".")[0]
                    # add relationship column info
                    if (
                        relationship_column := mdj_json_model_lookup_table.get(
                            table_name_first_condition, {}
                        )
                        .get("relationship_lookup", {})
                        .get(relationship_name, {})
                    ):
                        model_candidates[table_name_first_condition]["columns"].append(
                            relationship_column
                        )
                    elif (
                        relationship_column := mdj_json_model_lookup_table.get(
                            table_name_second_condition, {}
                        )
                        .get("relationship_lookup", {})
                        .get(relationship_name, {})
                    ):
                        model_candidates[table_name_second_condition]["columns"].append(
                            relationship_column
                        )

                    # add relationship info
                    relationship_candidates.append(relationship)

            new_mdl_jsons.append(
                {
                    "models": list(model_candidates.values()),
                    "relationships": relationship_candidates,
                    "views": [],
                    "metrics": [],
                }
            )

        return new_mdl_jsons

    new_mdl_jsons = _build_partial_mdl_json(contexts_list, mdl_json_cloned)

    return [
        {
            "id": str(i),
            "meta": {"id": str(i)},
            "content": ddl_command,
        }
        for new_mdl_json in new_mdl_jsons
        for i, ddl_command in enumerate(get_ddl_commands(new_mdl_json))
    ]


def get_eval_dataset_in_toml_string(mdl: dict, dataset: list) -> str:
    doc = tomlkit.document()

    doc.add("dataset_id", str(uuid.uuid4()))
    doc.add("date", datetime.today().strftime("%Y_%m_%d"))
    doc.add("mdl", mdl)
    doc.add("eval_dataset", dataset)

    return tomlkit.dumps(doc, sort_keys=True)


def prepare_duckdb_session_sql(api_endpoint: str):
    # Spider/BIRD benchmark assets are distributed as SQLite files, so DuckDB
    # needs the sqlite extension for benchmark-backed eval flows.
    session_sql = "INSTALL sqlite;"

    response = requests.put(
        f"{api_endpoint}/v1/data-source/duckdb/settings/session-sql",
        data=session_sql,
    )

    assert response.status_code == 200, response.text


def prepare_duckdb_init_sql(api_endpoint: str, db: str, path: str):
    # Attach the upstream benchmark SQLite database so eval preparation can read it.
    init_sql = f"ATTACH '{path}/{db}/{db}.sqlite' AS {db} (TYPE sqlite);"

    response = requests.put(
        f"{api_endpoint}/v1/data-source/duckdb/settings/init-sql",
        data=init_sql,
    )

    assert response.status_code == 200, response.text


LOCALHOST_HOSTNAMES = {"localhost", "127.0.0.1", "::1"}
HEX_CONTAINER_ID_RE = re.compile(r"^[0-9a-f]{12,}$")


def _quote_postgres_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _parse_postgres_target(target: str) -> dict[str, Any]:
    parsed = urlparse(target)
    query_items = parse_qsl(parsed.query, keep_blank_values=True)
    schema = "public"

    for key, value in query_items:
        if key == "schema" and value:
            schema = value
            break

    return {
        "scheme": parsed.scheme or "postgresql",
        "host": parsed.hostname or "localhost",
        "port": parsed.port or 5432,
        "user": parsed.username or "postgres",
        "password": parsed.password or "",
        "database": parsed.path.lstrip("/") or "",
        "schema": schema,
        "query_items": query_items,
    }


def _build_postgres_uri(
    target_info: dict[str, Any],
    *,
    scheme: Optional[str] = None,
    host: Optional[str] = None,
    port: Optional[int] = None,
    database: Optional[str] = None,
    include_schema: bool = True,
) -> str:
    user = quote(str(target_info["user"]), safe="")
    password = quote(str(target_info["password"]), safe="")
    hostname = host or str(target_info["host"])
    target_port = port or int(target_info["port"])
    db_name = database or str(target_info["database"])
    query_items = (
        target_info["query_items"]
        if include_schema
        else [
            (key, value) for key, value in target_info["query_items"] if key != "schema"
        ]
    )
    query = urlencode(query_items)

    return urlunparse(
        (
            scheme or str(target_info["scheme"]),
            f"{user}:{password}@{hostname}:{target_port}",
            f"/{db_name}",
            "",
            query,
            "",
        )
    )


def _iter_container_port_bindings(
    container: Any,
) -> list[tuple[int, str]]:
    ports = container.attrs.get("NetworkSettings", {}).get("Ports") or {}
    bindings: list[tuple[int, str]] = []

    for container_port, published_ports in ports.items():
        try:
            internal_port = int(str(container_port).split("/", 1)[0])
        except ValueError:
            continue

        for published in published_ports or []:
            host_port = published.get("HostPort")
            if host_port:
                bindings.append((internal_port, str(host_port)))

    return bindings


def _choose_container_alias(network_info: dict[str, Any], fallback_name: str) -> str:
    aliases = [
        alias
        for alias in network_info.get("Aliases") or []
        if alias and not HEX_CONTAINER_ID_RE.fullmatch(alias)
    ]
    preferred_aliases = [
        alias
        for alias in aliases
        if alias not in {fallback_name, fallback_name.lstrip("/")}
    ]

    if preferred_aliases:
        return sorted(preferred_aliases, key=lambda alias: (len(alias), alias))[0]
    if aliases:
        return sorted(aliases, key=lambda alias: (len(alias), alias))[0]
    return fallback_name.lstrip("/")


def _resolve_target_container_route(
    docker_client: Any,
    host: str,
    port: int,
) -> Optional[tuple[str, str, int]]:
    containers = docker_client.containers.list()

    if host in LOCALHOST_HOSTNAMES:
        for container in containers:
            for internal_port, published_host_port in _iter_container_port_bindings(
                container
            ):
                if published_host_port != str(port):
                    continue

                networks = (
                    container.attrs.get("NetworkSettings", {}).get("Networks") or {}
                )
                if not networks:
                    continue

                network_name, network_info = sorted(networks.items())[0]
                return (
                    network_name,
                    _choose_container_alias(network_info, container.name),
                    internal_port,
                )

        return None

    for container in containers:
        networks = container.attrs.get("NetworkSettings", {}).get("Networks") or {}
        for network_name, network_info in sorted(networks.items()):
            aliases = set(network_info.get("Aliases") or [])
            aliases.update({container.name, container.name.lstrip("/")})
            if host not in aliases:
                continue

            internal_ports = {
                internal for internal, _ in _iter_container_port_bindings(container)
            }
            if internal_ports and port not in internal_ports:
                for internal_port, published_host_port in _iter_container_port_bindings(
                    container
                ):
                    if published_host_port == str(port):
                        return (
                            network_name,
                            _choose_container_alias(network_info, container.name),
                            internal_port,
                        )
                continue

            return (
                network_name,
                _choose_container_alias(network_info, container.name),
                port,
            )

    return None


def _build_pgloader_destination(
    docker_client: Any,
    benchmark_target: str,
) -> tuple[str, dict[str, Any]]:
    target_info = _parse_postgres_target(benchmark_target)
    run_options: dict[str, Any] = {}
    route = _resolve_target_container_route(
        docker_client,
        str(target_info["host"]),
        int(target_info["port"]),
    )

    if route is not None:
        network_name, host_alias, container_port = route
        run_options["network"] = network_name
        return (
            _build_postgres_uri(
                target_info,
                scheme="pgsql",
                host=host_alias,
                port=container_port,
                include_schema=False,
            ),
            run_options,
        )

    if str(target_info["host"]) in LOCALHOST_HOSTNAMES:
        run_options["extra_hosts"] = {"host.docker.internal": "host-gateway"}
        return (
            _build_postgres_uri(
                target_info,
                scheme="pgsql",
                host="host.docker.internal",
                include_schema=False,
            ),
            run_options,
        )

    return (
        _build_postgres_uri(target_info, scheme="pgsql", include_schema=False),
        run_options,
    )


def _ensure_postgres_benchmark_database(target_info: dict[str, Any]) -> None:
    admin_connection = psycopg2.connect(
        host=target_info["host"],
        port=target_info["port"],
        dbname="postgres",
        user=target_info["user"],
        password=target_info["password"],
    )
    admin_connection.autocommit = True
    admin_cursor = admin_connection.cursor()

    try:
        admin_cursor.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s",
            (target_info["database"],),
        )
        if admin_cursor.fetchone() is None:
            admin_cursor.execute(
                f"CREATE DATABASE {_quote_postgres_identifier(str(target_info['database']))}"
            )
    finally:
        admin_cursor.close()
        admin_connection.close()


def _reset_postgres_benchmark_schema(target_info: dict[str, Any]) -> None:
    connection = psycopg2.connect(
        host=target_info["host"],
        port=target_info["port"],
        dbname=target_info["database"],
        user=target_info["user"],
        password=target_info["password"],
    )

    schema = _quote_postgres_identifier(str(target_info["schema"]))
    schema_name = str(target_info["schema"])
    cursor = connection.cursor()
    try:
        cursor.execute(
            'DROP SCHEMA IF EXISTS "public" CASCADE; CREATE SCHEMA "public";'
        )
        if schema_name != "public":
            cursor.execute(
                f"DROP SCHEMA IF EXISTS {schema} CASCADE; CREATE SCHEMA {schema};"
            )
        connection.commit()
    finally:
        cursor.close()
        connection.close()


def _finalize_postgres_benchmark_schema(target_info: dict[str, Any]) -> None:
    connection = psycopg2.connect(
        host=target_info["host"],
        port=target_info["port"],
        dbname=target_info["database"],
        user=target_info["user"],
        password=target_info["password"],
    )

    schema_name = str(target_info["schema"])
    schema = _quote_postgres_identifier(schema_name)
    database = _quote_postgres_identifier(str(target_info["database"]))
    cursor = connection.cursor()
    try:
        if schema_name != "public":
            cursor.execute(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
            )
            for (table_name,) in cursor.fetchall():
                cursor.execute(
                    f'ALTER TABLE "public".{_quote_postgres_identifier(str(table_name))} SET SCHEMA {schema};'
                )

            cursor.execute(
                f'ALTER DATABASE {database} SET search_path TO {schema}, "public";'
            )
        else:
            cursor.execute(f'ALTER DATABASE {database} SET search_path TO "public";')
        connection.commit()
    finally:
        cursor.close()
        connection.close()


def load_eval_data_db_to_postgres(
    db: str,
    path: str,
    benchmark_target: str = "",
):
    abs_path = os.path.abspath(resolve_host_eval_data_db_path(path))
    resolved_target = benchmark_target
    if not resolved_target:
        resolved_target = EvalSettings().default_spider_postgres_benchmark_db_target
    resolved_target = (
        resolved_target.format(db_name=db, catalog=db)
        if "{" in resolved_target
        else resolved_target
    )
    target_info = _parse_postgres_target(resolved_target)

    _ensure_postgres_benchmark_database(target_info)
    _reset_postgres_benchmark_schema(target_info)

    sqlite_path = f"sqlite:///data/{db}/{db}.sqlite"
    docker_client = docker.from_env()
    pgloader_target, run_options = _build_pgloader_destination(
        docker_client,
        resolved_target,
    )

    docker_client.containers.run(
        "dimitri/pgloader:latest",
        volumes={abs_path: {"bind": "/data", "mode": "ro"}},
        command=f"pgloader {sqlite_path} {pgloader_target}",
        remove=True,
        **run_options,
    )
    _finalize_postgres_benchmark_schema(target_info)


def get_next_few_items_circular(items: list, i: int, few: int = 5):
    list_length = len(items)
    if list_length < few + 1:
        few = list_length - 1
    return [items[(i + j) % list_length] for j in range(1, few + 1)]


def get_openai_client(
    api_key: str = os.getenv("OPENAI_API_KEY"), timeout: float = 60
) -> AsyncClient:
    return AsyncClient(
        api_key=api_key,
        timeout=timeout,
    )


def replace_wren_engine_env_variables(engine_type: str, data: dict, config_path: str):
    assert engine_type in ("wren_engine", "wren_ibis")

    with open(config_path, "r") as f:
        configs = list(yaml.safe_load_all(f))

        for config in configs:
            if config.get("type") == "engine" and config.get("provider") == engine_type:
                for key, value in data.items():
                    config[key] = value
            if "pipes" in config:
                for i, pipe in enumerate(config["pipes"]):
                    if "engine" in pipe and pipe["name"] != "sql_functions_retrieval":
                        config["pipes"][i]["engine"] = engine_type

    with open(config_path, "w") as f:
        yaml.safe_dump_all(configs, f, default_flow_style=False)
