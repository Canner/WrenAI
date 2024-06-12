import logging
import re
from typing import Dict

import aiohttp
import sqlglot

logger = logging.getLogger("wren-ai-service")


async def dry_run_sql(
    sql: str,
    session: aiohttp.ClientSession,
    endpoint: str,
) -> Dict[str, str]:
    async with session.post(
        f"{endpoint}/api/graphql",
        json={
            "query": "mutation PreviewSql($data: PreviewSQLDataInput) { previewSql(data: $data) }",
            "variables": {
                "data": {
                    "dryRun": True,
                    "limit": 1,
                    "sql": _remove_limit_statement(add_quotes(sql)),
                }
            },
        },
    ) as response:
        return {"status": response.status, "body": await response.json()}


def clean_generation_result(result: str) -> str:
    def _normalize_whitespace(s: str) -> str:
        return re.sub(r"\s+", " ", s).strip()

    return (
        _normalize_whitespace(result)
        .replace("\\n", " ")
        .replace("```sql", "")
        .replace('"""', "")
        .replace("'''", "")
        .replace("```", "")
        .replace(";", "")
    )


def _remove_limit_statement(sql: str) -> str:
    pattern = r"\s*LIMIT\s+\d+(\s*;?\s*--.*|\s*;?\s*)$"
    modified_sql = re.sub(pattern, "", sql, flags=re.IGNORECASE)

    return modified_sql


def add_quotes(sql: str) -> str:
    logger.debug(f"Original SQL: {sql}")

    quoted_sql = sqlglot.transpile(sql, read="trino", identify=True)[0]

    logger.debug(f"Quoted SQL: {quoted_sql}")

    return quoted_sql
