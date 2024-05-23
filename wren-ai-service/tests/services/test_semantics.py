import pytest

from src.pipelines.semantics import description
from src.utils import init_providers
from src.web.v1.services.semantics import (
    GenerateDescriptionRequest,
    SemanticsService,
)


@pytest.fixture
def semantics_service():
    llm_provider, document_store_provider = init_providers()

    return SemanticsService(
        pipelines={
            "generate_description": description.Generation(
                llm_provider=llm_provider,
                document_store_provider=document_store_provider,
            ),
        }
    )


def test_generate_description(semantics_service: SemanticsService):
    actual = semantics_service.generate_description(
        GenerateDescriptionRequest(
            mdl={
                "name": "all_star",
                "properties": {},
                "refsql": 'select * from "wrenai".spider."baseball_1-all_star"',
                "columns": [
                    {
                        "name": "player_id",
                        "type": "varchar",
                        "notnull": False,
                        "iscalculated": False,
                        "expression": "player_id",
                        "properties": {},
                    }
                ],
                "primarykey": "",
            },
            model="all_star",
            identifier="column@player_id",
        )
    )

    assert actual is not None
    assert actual.identifier == "column@player_id"
    assert actual.display_name is not None and actual.display_name != ""
    assert actual.description is not None and actual.description != ""
