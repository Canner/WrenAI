import json
from typing import Any, AnyStr, Dict, List

from haystack import Pipeline
from pydantic import BaseModel


# POST /v1/semantics-descriptions
class BulkGenerateDescriptionRequest(BaseModel):
    mdl: Dict[AnyStr, Any]
    model: str
    identifiers: List[str]

    def __iter__(self):
        for identifier in self.identifiers:
            yield GenerateDescriptionRequest(
                mdl=self.mdl,
                model=self.model,
                identifier=identifier,
            )


class GenerateDescriptionRequest(BaseModel):
    mdl: Dict[AnyStr, Any]
    model: str
    identifier: str


class GenerateDescriptionResponse(BaseModel):
    identifier: str
    display_name: str
    description: str


class SemanticsService:
    def __init__(self, pipelines: dict[str, Pipeline]):
        self._pipelines = pipelines

    def generate_description(
        self, request: GenerateDescriptionRequest
    ) -> GenerateDescriptionResponse:
        response = self._pipelines["generate_description"].run(
            **{
                "mdl": request.mdl,
                "model": request.model,
                "identifier": request.identifier,
            }
        )
        content = json.loads(response["llm"]["replies"][0])

        return GenerateDescriptionResponse(
            identifier=request.identifier,
            display_name=content.get("display_name"),
            description=content.get("description"),
        )
