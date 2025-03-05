import base64
import os
import uuid
from copy import deepcopy
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional, Tuple, get_args

import aiohttp
import orjson
import requests
import sqlglot
import tomlkit
from dotenv import load_dotenv
from openai import AsyncClient
from tomlkit import parse

load_dotenv(".env", override=True)


def add_quotes(sql: str) -> Tuple[str, bool]:
    try:
        quoted_sql = sqlglot.transpile(sql, read="trino", identify=True)[0]
        return quoted_sql, True
    except Exception:
        return sql, False


async def get_data_from_wren_engine(
    sql: str,
    data_source: str,
    mdl_json: dict,
    connection_info: dict,
    api_endpoint: str,
    timeout: float = 300,
    limit: Optional[int] = None,
):
    quoted_sql, no_error = add_quotes(sql)
    assert no_error, f"Error in quoting SQL: {sql}"

    if data_source == "duckdb":
        async with aiohttp.request(
            "GET",
            f"{api_endpoint}/v1/mdl/preview",
            json={
                "sql": quoted_sql,
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
        url = f"{api_endpoint}/v2/connector/{data_source}/query"
        if limit is not None:
            url += f"?limit={limit}"

        async with aiohttp.request(
            "POST",
            url,
            json={
                "sql": quoted_sql,
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
    api_endpoint: str,
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
        quoted_sql, no_error = add_quotes(sql)
        assert no_error, f"Error in quoting SQL: {sql}"

        manifest_str = base64.b64encode(orjson.dumps(mdl_json)).decode()

        async with aiohttp.request(
            "GET",
            f"{api_endpoint}/v2/analysis/sql",
            json={
                "sql": quoted_sql,
                "manifestStr": manifest_str,
            },
            timeout=aiohttp.ClientTimeout(total=timeout),
        ) as response:
            return await response.json()

    sql_analysis_results = await _get_sql_analysis(sql, mdl_json, api_endpoint, timeout)
    contexts = _get_contexts_from_sql_analysis_results(sql_analysis_results)
    return contexts


def parse_toml(path: str) -> Dict[str, Any]:
    with open(path) as file:
        return parse(file.read())


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


def engine_config(mdl: dict, pipe_components: dict[str, Any] = {}) -> dict:
    engine = pipe_components.get("sql_generation", {}).get("engine")

    if engine is None:
        raise ValueError(
            "SQL Generation engine not found in pipe_components. Ensure 'sql_generation' key exists and contains 'engine' configuration."
        )

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
    session_sql = "INSTALL sqlite;"

    response = requests.put(
        f"{api_endpoint}/v1/data-source/duckdb/settings/session-sql",
        data=session_sql,
    )

    assert response.status_code == 200, response.text


def prepare_duckdb_init_sql(api_endpoint: str, db: str):
    init_sql = (
        f"ATTACH 'etc/spider1.0/database/{db}/{db}.sqlite' AS {db} (TYPE sqlite);"
    )

    response = requests.put(
        f"{api_endpoint}/v1/data-source/duckdb/settings/init-sql",
        data=init_sql,
    )

    assert response.status_code == 200, response.text


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
