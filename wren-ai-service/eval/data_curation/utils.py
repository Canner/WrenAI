import os
from typing import Any, Optional, Tuple

import orjson
import streamlit as st
from dotenv import load_dotenv
from openai import AsyncClient
from pydantic import BaseModel, ValidationError
from streamlit.runtime.uploaded_file_manager import UploadedFile

load_dotenv()


# only brief validation is provided
class MDLModel(BaseModel):
    catalog: str
    schema: str
    models: Optional[list[dict]] = []
    relationships: Optional[list[dict]] = []
    enumDefinitions: Optional[list[dict]] = []
    metrics: Optional[list[dict]] = []
    cumulativeMetrics: Optional[list[dict]] = []
    views: Optional[list[dict]] = []
    macros: Optional[list[dict]] = []
    dateSpine: Optional[dict] = {}


def is_valid_mdl_file(file: UploadedFile) -> Tuple[bool, Any]:
    try:
        file_data = file.getvalue().decode("utf-8")
        MDLModel.model_validate_json(file_data)

        return True, orjson.loads(file_data)
    except orjson.JSONDecodeError as e:
        print(f"Error parsing JSON: {e}")
        return False, None
    except ValidationError as e:
        print(f"Error validating JSON: {e}")
        return False, None


def get_llm_client() -> AsyncClient:
    return AsyncClient(
        api_key=os.getenv("OPENAI_API_KEY"),
    )


async def get_question_sql_pairs(
    llm_client: AsyncClient, mdl_json: dict, num_pairs: int = 10
) -> list[dict]:
    messages = [
        {
            "role": "system",
            "content": f"""### TASK ###
Given the MDL file, generate {num_pairs} of the questions and corresponding SQL queries

### Output Format ###
{{
    "results": [
        {{
            "question": <question_string>,
            "sql_query": <sql_query_string>
        }},
        {{
            "question": <question_string>,
            "sql_query": <sql_query_string>
        }},
        ...
    ]
}}
""",
        },
        {
            "role": "user",
            "content": f"""
MDL File: {mdl_json}

Generate {num_pairs} of the questions and corresponding SQL queries according to the Output Format in JSON
Think step by step
""",
        },
    ]

    try:
        response = await llm_client.chat.completions.create(
            model=os.getenv("OPENAI_GENERATION_MODEL", "gpt-3.5-turbo"),
            messages=messages,
            response_format={"type": "json_object"},
            max_tokens=4096,
            temperature=0.5,
        )

        return orjson.loads(response.choices[0].message.content)["results"]
    except Exception as e:
        st.error(f"Error generating question-sql-pairs: {e}")
        return []
