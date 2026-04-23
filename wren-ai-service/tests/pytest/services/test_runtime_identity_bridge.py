from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.web.v1.routers.semantics_preparation import delete_semantics
from src.web.v1.services.ask import AskRequest, AskResultRequest, AskService
from src.web.v1.services.ask_feedback import AskFeedbackRequest, AskFeedbackService
from src.web.v1.services.chart import ChartRequest, ChartService
from src.web.v1.services.chart_adjustment import (
    ChartAdjustmentRequest,
    ChartAdjustmentService,
)
from src.web.v1.services.instructions import InstructionsService
from src.web.v1.services.question_recommendation import QuestionRecommendation
from src.core.runtime_identity import DEPRECATED_BRIDGE_ALIAS_WARNING
from src.web.v1.services.runtime_models import resolve_request_bridge_scope_id
from src.web.v1.services.semantics_preparation import (
    DeleteSemanticsRequest,
    SemanticsPreparationRequest,
    SemanticsPreparationService,
    SemanticsPreparationStatusRequest,
)
from src.web.v1.services.sql_corrections import SqlCorrectionService
from src.web.v1.services.sql_pairs import SqlPairsService


class PipelineStub(SimpleNamespace):
    def __init__(self, result=None):
        super().__init__(run=AsyncMock(return_value=result if result is not None else {}))


class CleanablePipelineStub(SimpleNamespace):
    def __init__(self, run_result=None):
        super().__init__(
            run=AsyncMock(return_value=run_result if run_result is not None else {}),
            clean=AsyncMock(return_value=None),
        )


def make_ask_service():
    return AskService(
        {
            "historical_question": PipelineStub({"formatted_output": {"documents": []}}),
            "sql_pairs_retrieval": PipelineStub({"formatted_output": {"documents": []}}),
            "instructions_retrieval": PipelineStub({"formatted_output": {"documents": []}}),
            "intent_classification": PipelineStub(
                {
                    "post_process": {
                        "intent": "TEXT_TO_SQL",
                        "db_schemas": [],
                        "reasoning": "needs sql",
                    }
                }
            ),
            "db_schema_retrieval": PipelineStub(
                {
                    "construct_retrieval_results": {
                        "retrieval_results": [
                            {
                                "table_name": "orders",
                                "table_ddl": "CREATE TABLE orders (id bigint);",
                            }
                        ],
                        "has_calculated_field": False,
                        "has_metric": False,
                        "has_json_field": False,
                    }
                }
            ),
            "sql_generation_reasoning": PipelineStub({"post_process": "reasoning"}),
            "sql_generation": PipelineStub(
                {
                    "post_process": {
                        "valid_generation_result": {"sql": "SELECT 1"},
                        "invalid_generation_result": None,
                    }
                }
            ),
            "sql_functions_retrieval": PipelineStub([]),
            "sql_knowledge_retrieval": PipelineStub([]),
        }
    )


def make_semantics_service():
    return SemanticsPreparationService(
        {
            "db_schema": PipelineStub(),
            "historical_question": PipelineStub(),
            "table_description": PipelineStub(),
            "sql_pairs": PipelineStub(),
            "project_meta": PipelineStub(),
        }
    )


class DeleteSemanticsRecorder:
    def __init__(self):
        self.request = None

    async def delete_semantics(self, request):
        self.request = request


def make_chart_service():
    return ChartService(
        {
            "sql_executor": PipelineStub({"execute_sql": {"results": [{"gmv": 1}]}}),
            "chart_generation": PipelineStub(
                {
                    "post_process": {
                        "results": {
                            "reasoning": "chart reasoning",
                            "chart_type": "bar",
                            "chart_schema": {"mark": "bar"},
                        }
                    }
                }
            ),
        }
    )


def make_chart_adjustment_service():
    return ChartAdjustmentService(
        {
            "sql_executor": PipelineStub({"execute_sql": {"results": [{"gmv": 1}]}}),
            "chart_adjustment": PipelineStub(
                {
                    "post_process": {
                        "results": {
                            "reasoning": "chart reasoning",
                            "chart_type": "bar",
                            "chart_schema": {"mark": "bar"},
                        }
                    }
                }
            ),
        }
    )


def make_ask_feedback_service():
    return AskFeedbackService(
        {
            "db_schema_retrieval": PipelineStub(
                {
                    "construct_retrieval_results": {
                        "retrieval_results": [
                            {"table_ddl": "CREATE TABLE orders (id bigint);"}
                        ],
                        "has_calculated_field": False,
                        "has_metric": False,
                        "has_json_field": False,
                    }
                }
            ),
            "sql_pairs_retrieval": PipelineStub({"formatted_output": {"documents": []}}),
            "instructions_retrieval": PipelineStub(
                {"formatted_output": {"documents": []}}
            ),
            "sql_functions_retrieval": PipelineStub([]),
            "sql_knowledge_retrieval": PipelineStub([]),
            "sql_regeneration": PipelineStub(
                {
                    "post_process": {
                        "valid_generation_result": {"sql": "SELECT 1"},
                        "invalid_generation_result": None,
                    }
                }
            ),
        }
    )


def make_sql_correction_service():
    return SqlCorrectionService(
        {
            "db_schema_retrieval": PipelineStub(
                {
                    "construct_retrieval_results": {
                        "retrieval_results": [
                            {"table_ddl": "CREATE TABLE orders (id bigint);"}
                        ]
                    }
                }
            ),
            "sql_knowledge_retrieval": PipelineStub([]),
            "sql_correction": PipelineStub(
                {
                    "post_process": {
                        "valid_generation_result": {"sql": "SELECT 1"},
                        "invalid_generation_result": None,
                    }
                }
            ),
            "sql_tables_extraction": PipelineStub({"post_process": ["orders"]}),
        }
    )


def make_question_recommendation_service():
    service = QuestionRecommendation(
        {
            "db_schema_retrieval": PipelineStub(
                {
                    "construct_retrieval_results": {
                        "retrieval_results": [
                            {"table_ddl": "CREATE TABLE orders (id bigint);"}
                        ],
                        "has_calculated_field": False,
                        "has_metric": False,
                        "has_json_field": False,
                    }
                }
            ),
            "question_recommendation": PipelineStub(
                {
                    "normalized": {
                        "questions": [
                            {"question": "本月 GMV 是多少", "category": "销售"}
                        ]
                    }
                }
            ),
            "sql_pairs_retrieval": PipelineStub({"formatted_output": {"documents": []}}),
            "instructions_retrieval": PipelineStub(
                {"formatted_output": {"instructions": []}}
            ),
            "sql_functions_retrieval": PipelineStub([]),
            "sql_knowledge_retrieval": PipelineStub([]),
            "sql_generation": PipelineStub(
                {
                    "post_process": {
                        "valid_generation_result": {"sql": "SELECT 1"},
                    }
                }
            ),
        }
    )
    return service


@pytest.mark.asyncio
async def test_ask_uses_runtime_deploy_hash_when_project_id_is_missing():
    service = make_ask_service()
    request = AskRequest.model_validate(
        {
            "query": "本月 GMV",
            "mdl_hash": "mdl-1",
            "project_id": None,
            "runtimeIdentity": {
                "workspaceId": "workspace-1",
                "knowledgeBaseId": "kb-1",
                "deployHash": "deploy-1",
            },
        }
    )
    request.query_id = "query-1"

    await service.ask(request)
    result = service.get_ask_result(AskResultRequest(query_id=request.query_id))

    assert result.status == "finished"
    assert (
        service._pipelines["historical_question"].run.await_args.kwargs["runtime_scope_id"]
        == "deploy-1"
    )
    assert (
        service._pipelines["db_schema_retrieval"].run.await_args.kwargs["runtime_scope_id"]
        == "deploy-1"
    )


@pytest.mark.asyncio
async def test_ask_retrieval_scope_ids_expand_only_retrieval_pipelines():
    service = make_ask_service()
    request = AskRequest.model_validate(
        {
            "query": "本月 GMV",
            "mdl_hash": "mdl-1",
            "runtimeScopeId": "deploy-1",
            "retrievalScopeIds": ["kb-2", "kb-3", "deploy-1"],
        }
    )
    request.query_id = "query-retrieval-scope-1"

    await service.ask(request)

    assert (
        service._pipelines["historical_question"].run.await_args.kwargs[
            "runtime_scope_id"
        ]
        == "deploy-1,kb-2,kb-3"
    )
    assert (
        service._pipelines["sql_pairs_retrieval"].run.await_args.kwargs[
            "runtime_scope_id"
        ]
        == "deploy-1,kb-2,kb-3"
    )
    assert (
        service._pipelines["instructions_retrieval"].run.await_args.kwargs[
            "runtime_scope_id"
        ]
        == "deploy-1,kb-2,kb-3"
    )
    assert (
        service._pipelines["db_schema_retrieval"].run.await_args.kwargs[
            "runtime_scope_id"
        ]
        == "deploy-1"
    )


@pytest.mark.asyncio
async def test_ask_result_includes_backend_thinking_steps():
    service = make_ask_service()
    service._pipelines["sql_pairs_retrieval"].run.return_value = {
        "formatted_output": {"documents": [{"question": "历史问题", "sql": "SELECT 1"}]}
    }
    service._pipelines["instructions_retrieval"].run.return_value = {
        "formatted_output": {"documents": [{"instruction": "优先统计已支付订单"}]}
    }
    request = AskRequest.model_validate(
        {
            "query": "本月 GMV",
            "mdl_hash": "mdl-thinking-1",
            "runtimeScopeId": "deploy-1",
        }
    )
    request.query_id = "query-thinking-1"

    await service.ask(request)

    result = service.get_ask_result(AskResultRequest(query_id=request.query_id))

    assert result.status == "finished"
    assert result.thinking is not None
    assert [step.key for step in result.thinking.steps] == [
        "ask.sql_pairs_retrieved",
        "ask.sql_instructions_retrieved",
        "ask.intent_recognized",
        "ask.candidate_models_selected",
        "ask.sql_reasoned",
        "ask.sql_generated",
    ]
    assert result.thinking.steps[0].message_params == {"count": 1}
    assert result.thinking.steps[1].message_params == {"count": 1}
    assert result.thinking.steps[3].message_params == {"count": 1}
    assert result.thinking.steps[4].detail == "reasoning"


@pytest.mark.asyncio
async def test_prepare_semantics_prefers_runtime_identity_over_explicit_project_id():
    service = make_semantics_service()
    request = SemanticsPreparationRequest.model_validate(
        {
            "mdl": "{}",
            "mdl_hash": "mdl-1",
            "project_id": "project-1",
            "runtimeIdentity": {
                "workspaceId": "workspace-1",
                "knowledgeBaseId": "kb-1",
                "deployHash": "deploy-1",
            },
        }
    )

    await service.prepare_semantics(request)

    for pipeline in service._pipelines.values():
        assert pipeline.run.await_args.kwargs["runtime_scope_id"] == "deploy-1"


@pytest.mark.asyncio
async def test_prepare_semantics_falls_back_to_deploy_hash_then_mdl_hash():
    runtime_service = make_semantics_service()
    runtime_request = SemanticsPreparationRequest.model_validate(
        {
            "mdl": "{}",
            "mdl_hash": "mdl-1",
            "runtimeIdentity": {
                "workspaceId": "workspace-1",
                "knowledgeBaseId": "kb-1",
                "deployHash": "deploy-1",
            },
        }
    )

    await runtime_service.prepare_semantics(runtime_request)

    for pipeline in runtime_service._pipelines.values():
        assert pipeline.run.await_args.kwargs["runtime_scope_id"] == "deploy-1"

    mdl_service = make_semantics_service()
    mdl_request = SemanticsPreparationRequest.model_validate(
        {
            "mdl": "{}",
            "mdl_hash": "mdl-2",
        }
    )

    await mdl_service.prepare_semantics(mdl_request)

    for pipeline in mdl_service._pipelines.values():
        assert pipeline.run.await_args.kwargs["runtime_scope_id"] == "mdl-2"


@pytest.mark.asyncio
async def test_prepare_semantics_skips_missing_optional_pipelines():
    service = SemanticsPreparationService(
        {
            "db_schema": PipelineStub(),
            "historical_question": PipelineStub(),
            "table_description": PipelineStub(),
        }
    )
    request = SemanticsPreparationRequest.model_validate(
        {
            "mdl": "{}",
            "mdl_hash": "mdl-3",
        }
    )

    result = await service.prepare_semantics(request)
    status = service.get_prepare_semantics_status(
        SemanticsPreparationStatusRequest(mdl_hash="mdl-3")
    )

    assert result["metadata"]["error_type"] == ""
    assert status.status == "finished"
    for pipeline in service._pipelines.values():
        assert pipeline.run.await_count == 1


@pytest.mark.asyncio
async def test_delete_semantics_route_uses_runtime_identity_when_body_provided():
    recorder = DeleteSemanticsRecorder()

    await delete_semantics(
        delete_semantics_request=DeleteSemanticsRequest.model_validate(
            {
                "runtimeIdentity": {
                    "workspaceId": "workspace-1",
                    "knowledgeBaseId": "kb-1",
                    "deployHash": "deploy-1",
                }
            }
        ),
        runtime_scope_id=None,
        runtimeScopeId=None,
        project_id=None,
        projectId=None,
        service_container=SimpleNamespace(semantics_preparation_service=recorder),
    )

    assert recorder.request.resolve_runtime_scope_id() == "deploy-1"


@pytest.mark.asyncio
async def test_delete_semantics_route_prefers_runtime_scope_query_param():
    recorder = DeleteSemanticsRecorder()

    await delete_semantics(
        delete_semantics_request=None,
        runtime_scope_id="deploy-query",
        runtimeScopeId=None,
        project_id="project-1",
        projectId=None,
        service_container=SimpleNamespace(semantics_preparation_service=recorder),
    )

    assert recorder.request.resolve_runtime_scope_id() == "deploy-query"
    assert recorder.request.resolve_bridge_scope_id() is None


@pytest.mark.asyncio
async def test_delete_semantics_route_keeps_query_param_compatibility():
    recorder = DeleteSemanticsRecorder()

    await delete_semantics(
        delete_semantics_request=None,
        runtime_scope_id=None,
        runtimeScopeId=None,
        project_id="project-1",
        projectId=None,
        service_container=SimpleNamespace(semantics_preparation_service=recorder),
    )

    assert recorder.request.resolve_runtime_scope_id() == "project-1"


@pytest.mark.asyncio
async def test_chart_uses_runtime_deploy_hash_when_project_id_is_missing():
    service = make_chart_service()
    request = ChartRequest.model_validate(
        {
            "query": "本月 GMV",
            "sql": "SELECT 1",
            "runtimeIdentity": {
                "workspaceId": "workspace-1",
                "knowledgeBaseId": "kb-1",
                "deployHash": "deploy-1",
            },
        }
    )
    request.query_id = "chart-1"

    await service.chart(request)

    assert (
        service._pipelines["sql_executor"].run.await_args.kwargs["runtime_scope_id"]
        == "deploy-1"
    )


@pytest.mark.asyncio
async def test_chart_adjustment_uses_runtime_deploy_hash_when_project_id_is_missing():
    service = make_chart_adjustment_service()
    request = ChartAdjustmentRequest.model_validate(
        {
            "query": "本月 GMV",
            "sql": "SELECT 1",
            "adjustment_option": {"chart_type": "bar"},
            "chart_schema": {"mark": "bar"},
            "runtimeIdentity": {
                "workspaceId": "workspace-1",
                "knowledgeBaseId": "kb-1",
                "deployHash": "deploy-1",
            },
        }
    )
    request.query_id = "chart-adjustment-1"

    await service.chart_adjustment(request)

    assert (
        service._pipelines["sql_executor"].run.await_args.kwargs["runtime_scope_id"]
        == "deploy-1"
    )


@pytest.mark.asyncio
async def test_ask_feedback_uses_runtime_deploy_hash_when_project_id_is_missing():
    service = make_ask_feedback_service()
    request = AskFeedbackRequest.model_validate(
        {
            "question": "本月 GMV",
            "tables": ["orders"],
            "sql_generation_reasoning": "需要统计 GMV",
            "sql": "SELECT 1",
            "runtimeIdentity": {
                "workspaceId": "workspace-1",
                "knowledgeBaseId": "kb-1",
                "deployHash": "deploy-1",
            },
        }
    )
    request.query_id = "ask-feedback-1"

    await service.ask_feedback(request)

    assert (
        service._pipelines["db_schema_retrieval"].run.await_args.kwargs["runtime_scope_id"]
        == "deploy-1"
    )
    assert (
        service._pipelines["sql_pairs_retrieval"].run.await_args.kwargs["runtime_scope_id"]
        == "deploy-1"
    )
    assert (
        service._pipelines["instructions_retrieval"].run.await_args.kwargs[
            "runtime_scope_id"
        ]
        == "deploy-1"
    )
    assert (
        service._pipelines["sql_functions_retrieval"].run.await_args.kwargs[
            "runtime_scope_id"
        ]
        == "deploy-1"
    )
    assert (
        service._pipelines["sql_knowledge_retrieval"].run.await_args.kwargs[
            "runtime_scope_id"
        ]
        == "deploy-1"
    )
    assert (
        service._pipelines["sql_regeneration"].run.await_args.kwargs["runtime_scope_id"]
        == "deploy-1"
    )


@pytest.mark.asyncio
async def test_sql_correction_uses_runtime_deploy_hash_when_project_id_is_missing():
    service = make_sql_correction_service()
    request = SqlCorrectionService.CorrectionRequest.model_validate(
        {
            "event_id": "correction-1",
            "sql": "SELECT broken",
            "error": "syntax error",
            "retrieved_tables": ["orders"],
            "runtimeIdentity": {
                "workspaceId": "workspace-1",
                "knowledgeBaseId": "kb-1",
                "deployHash": "deploy-1",
            },
        }
    )

    await service.correct(request)

    assert (
        service._pipelines["db_schema_retrieval"].run.await_args.kwargs["runtime_scope_id"]
        == "deploy-1"
    )
    assert (
        service._pipelines["sql_knowledge_retrieval"].run.await_args.kwargs[
            "runtime_scope_id"
        ]
        == "deploy-1"
    )
    assert (
        service._pipelines["sql_correction"].run.await_args.kwargs["runtime_scope_id"]
        == "deploy-1"
    )


@pytest.mark.asyncio
async def test_question_recommendation_uses_runtime_deploy_hash_when_project_id_is_missing():
    service = make_question_recommendation_service()
    event_id = "recommendation-1"
    service[event_id] = QuestionRecommendation.Event(event_id=event_id)
    request = QuestionRecommendation.Request.model_validate(
        {
            "event_id": event_id,
            "mdl": '{"models":[{"name":"orders"}]}',
            "runtimeIdentity": {
                "workspaceId": "workspace-1",
                "knowledgeBaseId": "kb-1",
                "deployHash": "deploy-1",
            },
        }
    )

    await service.recommend(request)

    assert (
        service._pipelines["db_schema_retrieval"].run.await_args_list[0].kwargs[
            "runtime_scope_id"
        ]
        == "deploy-1"
    )
    assert (
        service._pipelines["sql_pairs_retrieval"].run.await_args.kwargs["runtime_scope_id"]
        == "deploy-1"
    )
    assert (
        service._pipelines["instructions_retrieval"].run.await_args.kwargs[
            "runtime_scope_id"
        ]
        == "deploy-1"
    )
    assert (
        service._pipelines["sql_functions_retrieval"].run.await_args.kwargs[
            "runtime_scope_id"
        ]
        == "deploy-1"
    )
    assert (
        service._pipelines["sql_knowledge_retrieval"].run.await_args.kwargs[
            "runtime_scope_id"
        ]
        == "deploy-1"
    )
    assert (
        service._pipelines["sql_generation"].run.await_args.kwargs["runtime_scope_id"]
        == "deploy-1"
    )


@pytest.mark.asyncio
async def test_instructions_index_delete_use_runtime_deploy_hash_when_project_id_is_missing():
    pipeline = CleanablePipelineStub()
    service = InstructionsService({"instructions_indexing": pipeline})
    runtime_identity = {
        "workspaceId": "workspace-1",
        "knowledgeBaseId": "kb-1",
        "deployHash": "deploy-1",
    }
    index_request = InstructionsService.IndexRequest.model_validate(
        {
            "event_id": "instruction-index-1",
            "instructions": [
                {
                    "id": "instruction-1",
                    "instruction": "只统计已支付订单",
                    "questions": ["本月订单"],
                }
            ],
            "runtimeIdentity": runtime_identity,
        }
    )
    delete_request = InstructionsService.DeleteRequest.model_validate(
        {
            "event_id": "instruction-delete-1",
            "instruction_ids": ["instruction-1"],
            "runtimeIdentity": runtime_identity,
        }
    )

    await service.index(index_request)
    await service.delete(delete_request)

    assert pipeline.run.await_args.kwargs["runtime_scope_id"] == "deploy-1"
    assert pipeline.clean.await_args.kwargs["runtime_scope_id"] == "deploy-1"


@pytest.mark.asyncio
async def test_sql_pairs_index_delete_use_runtime_deploy_hash_when_project_id_is_missing():
    pipeline = CleanablePipelineStub()
    service = SqlPairsService({"sql_pairs": pipeline})
    runtime_identity = {
        "workspaceId": "workspace-1",
        "knowledgeBaseId": "kb-1",
        "deployHash": "deploy-1",
    }
    index_request = SqlPairsService.IndexRequest.model_validate(
        {
            "id": "sql-pairs-index-1",
            "sql_pairs": [
                {
                    "id": "sql-pair-1",
                    "sql": "SELECT 1",
                    "question": "示例问题",
                }
            ],
            "runtimeIdentity": runtime_identity,
        }
    )
    delete_request = SqlPairsService.DeleteRequest.model_validate(
        {
            "id": "sql-pairs-delete-1",
            "sql_pair_ids": ["sql-pair-1"],
            "runtimeIdentity": runtime_identity,
        }
    )

    await service.index(index_request)
    await service.delete(delete_request)

    assert pipeline.run.await_args.kwargs["runtime_scope_id"] == "deploy-1"
    assert pipeline.clean.await_args.kwargs["runtime_scope_id"] == "deploy-1"


def test_request_project_bridge_alias_supports_project_bridge_id_keyword():
    assert (
        resolve_request_bridge_scope_id(bridge_scope_id="bridge-1")
        == "bridge-1"
    )


def test_base_request_ignores_project_bridge_aliases_after_wave_1_cutover():
    with pytest.warns(DeprecationWarning, match=DEPRECATED_BRIDGE_ALIAS_WARNING):
        request = DeleteSemanticsRequest.model_validate({"projectBridgeId": "bridge-2"})

    assert request.bridge_scope_id is None
    assert request.resolve_bridge_scope_id() is None


def test_base_request_prefers_bridge_scope_aliases():
    request = DeleteSemanticsRequest.model_validate({"bridgeScopeId": "bridge-3"})

    assert request.bridge_scope_id == "bridge-3"
    assert request.resolve_bridge_scope_id() == "bridge-3"
