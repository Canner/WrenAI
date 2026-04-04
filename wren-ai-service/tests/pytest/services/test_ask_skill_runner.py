import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.core import (
    DeepAgentsAskOrchestrator,
    SkillExecutionResult,
    SkillRunnerExecutionResponse,
    ToolRouter,
)
from src.web.v1.services.ask import (
    AskRequest,
    AskResultRequest,
    AskService,
    AskShadowCompare,
)


class PipelineStub(SimpleNamespace):
    def __init__(self, result=None):
        super().__init__(run=AsyncMock(return_value=result if result is not None else {}))


class SkillRunnerClientStub:
    def __init__(self, *, enabled=True, run_response=None, result_response=None, run_error=None):
        self.enabled = enabled
        self.run = AsyncMock()
        self.get_result = AsyncMock()

        if run_error is not None:
            self.run.side_effect = run_error
        else:
            self.run.return_value = run_response

        if result_response is not None:
            self.get_result.return_value = result_response


class DeepAgentsOrchestratorStub:
    def __init__(self, result=None):
        self.run_skill_first = AsyncMock(return_value=result)
        self.run = AsyncMock()

        async def _run(**kwargs):
            if result is not None:
                kwargs['set_result'](
                    status='finished',
                    type='SKILL',
                    skill_result=result,
                    trace_id=kwargs['trace_id'],
                    is_followup=kwargs['is_followup'],
                )
                return {
                    'ask_result': {},
                    'skill_result': result.model_dump(mode='json', by_alias=True),
                    'metadata': {
                        'type': 'SKILL',
                        'ask_path': 'skill',
                        'error_type': '',
                        'error_message': '',
                        'request_from': kwargs['request_from'],
                    },
                }
            return await kwargs['fallback_runner']()

        self.run.side_effect = _run


class MixedAnswerComposerStub:
    def __init__(self):
        self.start_calls = []
        self.compose_skill_calls = []
        self.compose_general_calls = []
        self.compose_text_to_sql_success_calls = []
        self.compose_text_to_sql_failure_calls = []

    def start(self, *, request_from):
        self.start_calls.append({"request_from": request_from})
        return {
            "ask_result": {},
            "metadata": {
                "type": "",
                "error_type": "",
                "error_message": "",
                "request_from": request_from,
            },
        }

    def compose_skill(self, result, *, skill_result):
        self.compose_skill_calls.append({"skill_result": skill_result})
        result["skill_result"] = skill_result.model_dump(mode="json", by_alias=True)
        result["metadata"]["type"] = "SKILL"
        return result

    def compose_general(self, result, *, metadata_type="GENERAL"):
        self.compose_general_calls.append({"metadata_type": metadata_type})
        result["metadata"]["type"] = metadata_type
        return result

    def compose_text_to_sql_success(self, result, *, api_results):
        self.compose_text_to_sql_success_calls.append({"api_results": api_results})
        result["ask_result"] = api_results
        result["metadata"]["type"] = "TEXT_TO_SQL"
        return result

    def compose_text_to_sql_failure(self, result, *, error_type, error_message=None):
        self.compose_text_to_sql_failure_calls.append(
            {"error_type": error_type, "error_message": error_message}
        )
        result["metadata"]["type"] = "TEXT_TO_SQL"
        result["metadata"]["error_type"] = error_type
        result["metadata"]["error_message"] = error_message
        return result


class ToolRouterStub:
    def __init__(self, result):
        self.run_ask = AsyncMock(return_value=result)


class LegacyAskToolStub:
    def __init__(self, result):
        self.run = AsyncMock(return_value=result)


@pytest.fixture
def base_pipelines():
    return {
        'historical_question': PipelineStub(
            {'formatted_output': {'documents': []}},
        ),
        'sql_pairs_retrieval': PipelineStub(
            {'formatted_output': {'documents': []}},
        ),
        'instructions_retrieval': PipelineStub(
            {'formatted_output': {'documents': []}},
        ),
        'intent_classification': PipelineStub(
            {
                'post_process': {
                    'intent': 'TEXT_TO_SQL',
                    'db_schemas': [],
                    'reasoning': 'needs sql',
                }
            },
        ),
        'db_schema_retrieval': PipelineStub(
            {
                'construct_retrieval_results': {
                    'retrieval_results': [
                        {
                            'table_name': 'orders',
                            'table_ddl': 'CREATE TABLE orders (id bigint);',
                        }
                    ],
                    'has_calculated_field': False,
                    'has_metric': False,
                    'has_json_field': False,
                }
            },
        ),
        'sql_generation_reasoning': PipelineStub({'post_process': 'reasoning'}),
        'sql_generation': PipelineStub(
            {
                'post_process': {
                    'valid_generation_result': {'sql': 'SELECT 1'},
                    'invalid_generation_result': None,
                }
            },
        ),
        'sql_functions_retrieval': PipelineStub([]),
        'sql_knowledge_retrieval': PipelineStub([]),
    }



def make_service(
    pipelines,
    skill_runner_client=None,
    ask_runtime_mode="legacy",
    ask_shadow_compare_enabled=False,
    deepagents_orchestrator=None,
    mixed_answer_composer=None,
    tool_router=None,
    legacy_ask_tool=None,
):
    return AskService(
        pipelines=pipelines,
        ask_runtime_mode=ask_runtime_mode,
        ask_shadow_compare_enabled=ask_shadow_compare_enabled,
        skill_runner_client=skill_runner_client,
        deepagents_orchestrator=deepagents_orchestrator,
        mixed_answer_composer=mixed_answer_composer,
        tool_router=tool_router,
        legacy_ask_tool=legacy_ask_tool,
    )



def make_request(**overrides):
    request = AskRequest.model_validate(
        {
            'query': '本月 GMV',
            'project_id': 'project-1',
            'mdl_hash': 'mdl-1',
            **overrides,
        }
    )
    request.query_id = str(uuid.uuid4())
    return request


def record_shadow_compare(ask_service: AskService, **overrides):
    ask_service._record_shadow_compare(
        AskShadowCompare.model_validate(
            {
                "enabled": True,
                "executed": True,
                "comparable": True,
                "matched": True,
                "primary_ask_path": "skill",
                "shadow_ask_path": "nl2sql",
                **overrides,
            }
        )
    )


@pytest.mark.asyncio
async def test_ask_falls_back_to_nl2sql_when_skill_runner_disabled(base_pipelines):
    skill_runner_client = SkillRunnerClientStub(enabled=False)
    ask_service = make_service(
        base_pipelines,
        skill_runner_client=skill_runner_client,
        ask_runtime_mode="deepagents",
    )
    ask_request = make_request(
        runtimeIdentity={
            'workspaceId': 'workspace-1',
            'knowledgeBaseId': 'kb-1',
        },
        skills=[
            {
                'skillId': 'skill-1',
                'skillName': 'sales_skill',
                'sourceType': 'inline',
            }
        ],
    )

    result = await ask_service.ask(ask_request)
    ask_result = ask_service.get_ask_result(AskResultRequest(query_id=ask_request.query_id))

    assert result['metadata']['type'] == 'TEXT_TO_SQL'
    assert result['metadata']['fallback_reason'] == 'skill_runner_disabled'
    assert result['metadata']['deepagents_routing_reason'] == 'skill_runner_disabled'
    assert result['metadata']['deepagents_skill_candidate_count'] == 1
    assert result['metadata']['deepagents_skill_attempt_count'] == 0
    assert result['metadata']['deepagents_skill_failure_count'] == 0
    assert result['metadata']['ask_runtime_mode'] == 'deepagents'
    assert result['metadata']['primary_runtime'] == 'deepagents'
    assert result['metadata']['resolved_runtime'] == 'legacy'
    assert result['metadata']['deepagents_fallback'] is True
    assert ask_result.status == 'finished'
    assert ask_result.type == 'TEXT_TO_SQL'
    assert ask_result.response is not None
    assert ask_result.response[0].sql == 'SELECT 1'
    assert skill_runner_client.run.await_count == 0
    assert base_pipelines['db_schema_retrieval'].run.await_count == 1


@pytest.mark.asyncio
async def test_ask_returns_skill_result_before_nl2sql(base_pipelines):
    skill_runner_client = SkillRunnerClientStub(
        enabled=True,
        run_response=SkillRunnerExecutionResponse.model_validate(
            {
                'execution_id': 'exec-1',
                'status': 'accepted',
            }
        ),
        result_response=SkillRunnerExecutionResponse.model_validate(
            {
                'execution_id': 'exec-1',
                'status': 'succeeded',
                'result': {
                    'result_type': 'text',
                    'text': '本月 GMV 为 128 万',
                    'trace': {'skill_run_id': 'run-1'},
                },
            }
        ),
    )
    ask_service = make_service(
        base_pipelines,
        skill_runner_client=skill_runner_client,
        ask_runtime_mode="deepagents",
    )
    ask_request = make_request(
        runtimeIdentity={
            'workspaceId': 'workspace-1',
            'knowledgeBaseId': 'kb-1',
        },
        actorClaims={'userId': 'user-1'},
        skillConfig={'mode': 'skill-first'},
        skills=[
            {
                'skillId': 'skill-1',
                'skillName': 'sales_skill',
                'runtimeKind': 'isolated_python',
                'sourceType': 'inline',
                'entrypoint': 'main.py',
            }
        ],
    )

    result = await ask_service.ask(ask_request)
    ask_result = ask_service.get_ask_result(AskResultRequest(query_id=ask_request.query_id))

    assert result['metadata']['type'] == 'SKILL'
    assert result['metadata']['deepagents_skill_candidate_count'] == 1
    assert result['metadata']['deepagents_skill_attempt_count'] == 1
    assert result['metadata']['deepagents_skill_failure_count'] == 0
    assert result['metadata']['deepagents_selected_skill_id'] == 'skill-1'
    assert result['metadata']['ask_runtime_mode'] == 'deepagents'
    assert result['metadata']['primary_runtime'] == 'deepagents'
    assert result['metadata']['resolved_runtime'] == 'deepagents'
    assert result['metadata']['deepagents_fallback'] is False
    assert ask_result.status == 'finished'
    assert ask_result.type == 'SKILL'
    assert ask_result.skill_result is not None
    assert ask_result.skill_result.result_type == 'text'
    assert ask_result.skill_result.text == '本月 GMV 为 128 万'
    assert ask_result.skill_result.trace.skill_run_id == 'run-1'
    assert ask_result.skill_result.trace.runner_job_id == 'exec-1'
    assert ask_result.skill_result.metadata['execution_id'] == 'exec-1'
    assert ask_result.skill_result.metadata['skill_id'] == 'skill-1'
    assert base_pipelines['db_schema_retrieval'].run.await_count == 0
    assert base_pipelines['sql_generation'].run.await_count == 0
    assert skill_runner_client.run.await_count == 1
    assert skill_runner_client.get_result.await_count == 1


@pytest.mark.asyncio
async def test_ask_falls_back_when_skill_runner_returns_failure(base_pipelines):
    skill_runner_client = SkillRunnerClientStub(
        enabled=True,
        run_response=SkillRunnerExecutionResponse.model_validate(
            {
                'execution_id': 'exec-1',
                'status': 'failed',
                'error': {
                    'code': 'EXECUTION_ERROR',
                    'message': 'boom',
                },
            }
        ),
    )
    ask_service = make_service(
        base_pipelines,
        skill_runner_client=skill_runner_client,
        ask_runtime_mode="deepagents",
    )
    ask_request = make_request(
        runtimeIdentity={
            'workspaceId': 'workspace-1',
            'knowledgeBaseId': 'kb-1',
        },
        skills=[
            {
                'skillId': 'skill-1',
                'skillName': 'sales_skill',
                'sourceType': 'inline',
            }
        ],
    )

    result = await ask_service.ask(ask_request)
    ask_result = ask_service.get_ask_result(AskResultRequest(query_id=ask_request.query_id))

    assert result['metadata']['type'] == 'TEXT_TO_SQL'
    assert result['metadata']['fallback_reason'] == 'skill_candidates_exhausted'
    assert result['metadata']['deepagents_routing_reason'] == 'skill_candidates_exhausted'
    assert result['metadata']['deepagents_skill_candidate_count'] == 1
    assert result['metadata']['deepagents_skill_attempt_count'] == 1
    assert result['metadata']['deepagents_skill_failure_count'] == 1
    assert result['metadata']['deepagents_last_error'] == 'boom'
    assert result['metadata']['resolved_runtime'] == 'legacy'
    assert ask_result.status == 'finished'
    assert ask_result.type == 'TEXT_TO_SQL'
    assert ask_result.response is not None
    assert ask_result.response[0].sql == 'SELECT 1'
    assert skill_runner_client.run.await_count == 1
    assert skill_runner_client.get_result.await_count == 0
    assert base_pipelines['db_schema_retrieval'].run.await_count == 1


@pytest.mark.asyncio
async def test_ask_skips_skill_runner_without_runtime_identity(base_pipelines):
    skill_runner_client = SkillRunnerClientStub(
        enabled=True,
        run_response=SkillRunnerExecutionResponse.model_validate(
            {
                'execution_id': 'exec-1',
                'status': 'succeeded',
                'result': {
                    'result_type': 'text',
                    'text': 'should not be used',
                },
            }
        ),
    )
    ask_service = make_service(
        base_pipelines,
        skill_runner_client=skill_runner_client,
        ask_runtime_mode="deepagents",
    )
    ask_request = make_request(
        skills=[
            {
                'skillId': 'skill-1',
                'skillName': 'sales_skill',
                'sourceType': 'inline',
            }
        ],
    )

    result = await ask_service.ask(ask_request)
    ask_result = ask_service.get_ask_result(AskResultRequest(query_id=ask_request.query_id))

    assert result['metadata']['type'] == 'TEXT_TO_SQL'
    assert result['metadata']['fallback_reason'] == 'runtime_identity_missing'
    assert result['metadata']['deepagents_routing_reason'] == 'runtime_identity_missing'
    assert result['metadata']['deepagents_skill_candidate_count'] == 1
    assert result['metadata']['deepagents_skill_attempt_count'] == 0
    assert result['metadata']['deepagents_skill_failure_count'] == 0
    assert ask_result.status == 'finished'
    assert ask_result.type == 'TEXT_TO_SQL'
    assert ask_result.response is not None
    assert ask_result.response[0].sql == 'SELECT 1'
    assert skill_runner_client.run.await_count == 0
    assert base_pipelines['db_schema_retrieval'].run.await_count == 1


@pytest.mark.asyncio
async def test_ask_legacy_mode_skips_skill_runner_even_when_enabled(base_pipelines):
    skill_runner_client = SkillRunnerClientStub(
        enabled=True,
        run_response=SkillRunnerExecutionResponse.model_validate(
            {
                'execution_id': 'exec-1',
                'status': 'succeeded',
                'result': {
                    'result_type': 'text',
                    'text': 'should not be used',
                },
            }
        ),
    )
    ask_service = make_service(
        base_pipelines,
        skill_runner_client=skill_runner_client,
        ask_runtime_mode='legacy',
    )
    ask_request = make_request(
        runtimeIdentity={
            'workspaceId': 'workspace-1',
            'knowledgeBaseId': 'kb-1',
        },
        skills=[
            {
                'skillId': 'skill-1',
                'skillName': 'sales_skill',
                'sourceType': 'inline',
            }
        ],
    )

    result = await ask_service.ask(ask_request)
    ask_result = ask_service.get_ask_result(AskResultRequest(query_id=ask_request.query_id))

    assert result['metadata']['type'] == 'TEXT_TO_SQL'
    assert result['metadata']['ask_runtime_mode'] == 'legacy'
    assert result['metadata']['primary_runtime'] == 'legacy'
    assert result['metadata']['resolved_runtime'] == 'legacy'
    assert result['metadata']['deepagents_fallback'] is False
    assert ask_result.status == 'finished'
    assert ask_result.type == 'TEXT_TO_SQL'
    assert ask_result.response is not None
    assert ask_result.response[0].sql == 'SELECT 1'
    assert skill_runner_client.run.await_count == 0
    assert base_pipelines['db_schema_retrieval'].run.await_count == 1


@pytest.mark.asyncio
async def test_ask_deepagents_mode_delegates_to_orchestrator(base_pipelines):
    orchestrator = DeepAgentsOrchestratorStub(
        result=SkillExecutionResult.model_validate(
            {
                'result_type': 'text',
                'text': '本月 GMV 为 128 万',
                'trace': {'skill_run_id': 'run-1', 'runner_job_id': 'exec-1'},
            }
        )
    )
    ask_service = make_service(
        base_pipelines,
        ask_runtime_mode='deepagents',
        deepagents_orchestrator=orchestrator,
    )
    ask_request = make_request(
        runtimeIdentity={
            'workspaceId': 'workspace-1',
            'knowledgeBaseId': 'kb-1',
        },
        skills=[
            {
                'skillId': 'skill-1',
                'skillName': 'sales_skill',
                'sourceType': 'inline',
            }
        ],
    )

    result = await ask_service.ask(ask_request)
    ask_result = ask_service.get_ask_result(
        AskResultRequest(query_id=ask_request.query_id)
    )

    assert result['metadata']['type'] == 'SKILL'
    assert ask_result.status == 'finished'
    assert ask_result.type == 'SKILL'
    assert ask_result.skill_result is not None
    assert ask_result.skill_result.text == '本月 GMV 为 128 万'
    assert ask_result.ask_path == 'skill'
    assert orchestrator.run.await_count == 1
    assert base_pipelines['db_schema_retrieval'].run.await_count == 0


@pytest.mark.asyncio
async def test_ask_uses_mixed_answer_composer_for_skill_terminal(base_pipelines):
    composer = MixedAnswerComposerStub()
    skill_runner_client = SkillRunnerClientStub(
        enabled=True,
        run_response=SkillRunnerExecutionResponse.model_validate(
            {
                'execution_id': 'exec-1',
                'status': 'accepted',
            }
        ),
        result_response=SkillRunnerExecutionResponse.model_validate(
            {
                'execution_id': 'exec-1',
                'status': 'succeeded',
                'result': {
                    'result_type': 'text',
                    'text': '本月 GMV 为 128 万',
                    'trace': {'skill_run_id': 'run-1', 'runner_job_id': 'exec-1'},
                },
            }
        ),
    )
    orchestrator = DeepAgentsAskOrchestrator(
        skill_runner_client=skill_runner_client,
        mixed_answer_composer=composer,
    )
    ask_service = make_service(
        base_pipelines,
        ask_runtime_mode='deepagents',
        deepagents_orchestrator=orchestrator,
        mixed_answer_composer=composer,
    )
    ask_request = make_request(
        runtimeIdentity={
            'workspaceId': 'workspace-1',
            'knowledgeBaseId': 'kb-1',
        },
        skills=[
            {
                'skillId': 'skill-1',
                'skillName': 'sales_skill',
                'sourceType': 'inline',
            }
        ],
    )

    result = await ask_service.ask(ask_request)

    assert result['metadata']['type'] == 'SKILL'
    assert len(composer.start_calls) == 1
    assert len(composer.compose_skill_calls) == 1
    assert len(composer.compose_text_to_sql_success_calls) == 0


@pytest.mark.asyncio
async def test_ask_uses_mixed_answer_composer_for_text_to_sql_terminal(base_pipelines):
    composer = MixedAnswerComposerStub()
    ask_service = make_service(
        base_pipelines,
        ask_runtime_mode='legacy',
        mixed_answer_composer=composer,
    )
    ask_request = make_request()

    result = await ask_service.ask(ask_request)

    assert result['metadata']['type'] == 'TEXT_TO_SQL'
    assert len(composer.start_calls) == 1
    assert len(composer.compose_text_to_sql_success_calls) == 1
    assert len(composer.compose_skill_calls) == 0


@pytest.mark.asyncio
async def test_ask_service_delegates_to_tool_router(base_pipelines):
    router = ToolRouterStub(
        {
            'ask_result': {},
            'metadata': {
                'type': 'TEXT_TO_SQL',
                'error_type': '',
                'error_message': '',
                'request_from': 'ui',
            },
        }
    )
    ask_service = make_service(
        base_pipelines,
        ask_runtime_mode='deepagents',
        tool_router=router,
    )
    ask_request = make_request(
        runtimeIdentity={
            'workspaceId': 'workspace-1',
            'knowledgeBaseId': 'kb-1',
        }
    )

    result = await ask_service.ask(ask_request)

    assert result['metadata']['type'] == 'TEXT_TO_SQL'
    assert router.run_ask.await_count == 1
    assert router.run_ask.await_args.kwargs['ask_runtime_mode'] == 'deepagents'
    assert router.run_ask.await_args.kwargs['runtime_scope_id'] == 'project-1'


@pytest.mark.asyncio
async def test_tool_router_uses_deepagents_as_primary_and_legacy_as_fallback():
    deepagents_orchestrator = DeepAgentsOrchestratorStub(
        result=SkillExecutionResult.model_validate(
            {
                'result_type': 'text',
                'text': '本月 GMV 为 128 万',
            }
        )
    )
    legacy_tool = LegacyAskToolStub(
        {
            'ask_result': {},
            'metadata': {
                'type': 'TEXT_TO_SQL',
                'error_type': '',
                'error_message': '',
                'request_from': 'ui',
            },
        }
    )
    router = ToolRouter(
        legacy_ask_tool=legacy_tool,
        deepagents_orchestrator=deepagents_orchestrator,
    )
    ask_request = make_request(
        runtimeIdentity={
            'workspaceId': 'workspace-1',
            'knowledgeBaseId': 'kb-1',
        },
        skills=[
            {
                'skillId': 'skill-1',
                'skillName': 'sales_skill',
                'sourceType': 'inline',
            }
        ],
    )

    await router.run_ask(
        ask_runtime_mode='deepagents',
        ask_request=ask_request,
        query_id=ask_request.query_id,
        trace_id='trace-1',
        histories=[],
        runtime_scope_id='project-1',
        is_followup=False,
        is_stopped=lambda: False,
        set_result=lambda **_: None,
        build_ask_result=lambda **payload: payload,
        build_ask_error=lambda **payload: payload,
    )

    assert deepagents_orchestrator.run.await_count == 1
    assert legacy_tool.run.await_count == 0

    await router.run_ask(
        ask_runtime_mode='legacy',
        ask_request=ask_request,
        query_id=ask_request.query_id,
        trace_id='trace-2',
        histories=[],
        runtime_scope_id='project-1',
        is_followup=False,
        is_stopped=lambda: False,
        set_result=lambda **_: None,
        build_ask_result=lambda **payload: payload,
        build_ask_error=lambda **payload: payload,
    )

    assert legacy_tool.run.await_args.kwargs['run_skill_first'] is None


@pytest.mark.asyncio
async def test_tool_router_shadow_compare_disabled_skips_legacy_shadow():
    deepagents_orchestrator = DeepAgentsOrchestratorStub(
        result=SkillExecutionResult.model_validate(
            {
                'result_type': 'text',
                'text': '本月 GMV 为 128 万',
            }
        )
    )
    legacy_tool = LegacyAskToolStub(
        {
            'ask_result': {},
            'metadata': {
                'type': 'TEXT_TO_SQL',
                'error_type': '',
                'error_message': '',
                'request_from': 'ui',
            },
        }
    )
    router = ToolRouter(
        legacy_ask_tool=legacy_tool,
        deepagents_orchestrator=deepagents_orchestrator,
        ask_shadow_compare_enabled=False,
    )
    ask_request = make_request(
        runtimeIdentity={
            'workspaceId': 'workspace-1',
            'knowledgeBaseId': 'kb-1',
        },
        skills=[
            {
                'skillId': 'skill-1',
                'skillName': 'sales_skill',
                'sourceType': 'inline',
            }
        ],
    )

    result = await router.run_ask(
        ask_runtime_mode='deepagents',
        ask_request=ask_request,
        query_id=ask_request.query_id,
        trace_id='trace-1',
        histories=[],
        runtime_scope_id='project-1',
        is_followup=False,
        is_stopped=lambda: False,
        set_result=lambda **_: None,
        build_ask_result=lambda **payload: payload,
        build_ask_error=lambda **payload: payload,
    )

    assert result['metadata']['type'] == 'SKILL'
    assert 'shadow_compare' not in result['metadata']
    assert legacy_tool.run.await_count == 0


@pytest.mark.asyncio
async def test_tool_router_falls_back_to_legacy_when_deepagents_primary_errors():
    deepagents_orchestrator = DeepAgentsOrchestratorStub()
    deepagents_orchestrator.run.side_effect = RuntimeError('deepagents exploded')
    legacy_tool = LegacyAskToolStub(
        {
            'ask_result': [
                {
                    'sql': 'SELECT 1',
                    'type': 'llm',
                }
            ],
            'metadata': {
                'type': 'TEXT_TO_SQL',
                'ask_path': 'nl2sql',
                'error_type': '',
                'error_message': '',
                'request_from': 'ui',
            },
        }
    )
    router = ToolRouter(
        legacy_ask_tool=legacy_tool,
        deepagents_orchestrator=deepagents_orchestrator,
        ask_shadow_compare_enabled=False,
    )
    ask_request = make_request(
        runtimeIdentity={
            'workspaceId': 'workspace-1',
            'knowledgeBaseId': 'kb-1',
        }
    )

    result = await router.run_ask(
        ask_runtime_mode='deepagents',
        ask_request=ask_request,
        query_id=ask_request.query_id,
        trace_id='trace-1',
        histories=[],
        runtime_scope_id='project-1',
        is_followup=False,
        is_stopped=lambda: False,
        set_result=lambda **_: None,
        build_ask_result=lambda **payload: payload,
        build_ask_error=lambda **payload: payload,
    )

    assert result['metadata']['type'] == 'TEXT_TO_SQL'
    assert result['metadata']['fallback_reason'] == 'deepagents_error'
    assert result['metadata']['deepagents_error'] == 'deepagents exploded'
    assert legacy_tool.run.await_count == 1


@pytest.mark.asyncio
async def test_ask_shadow_compare_runs_legacy_without_overwriting_primary_result(
    base_pipelines,
):
    orchestrator = DeepAgentsOrchestratorStub(
        result=SkillExecutionResult.model_validate(
            {
                'result_type': 'text',
                'text': '本月 GMV 为 128 万',
                'trace': {'skill_run_id': 'run-1', 'runner_job_id': 'exec-1'},
            }
        )
    )
    legacy_tool = LegacyAskToolStub(
        {
            'ask_result': [
                {
                    'sql': 'SELECT 1',
                    'type': 'llm',
                }
            ],
            'metadata': {
                'type': 'TEXT_TO_SQL',
                'ask_path': 'nl2sql',
                'error_type': '',
                'error_message': '',
                'request_from': 'ui',
            },
        }
    )
    ask_service = make_service(
        base_pipelines,
        ask_runtime_mode='deepagents',
        ask_shadow_compare_enabled=True,
        deepagents_orchestrator=orchestrator,
        legacy_ask_tool=legacy_tool,
    )
    ask_request = make_request(
        runtimeIdentity={
            'workspaceId': 'workspace-1',
            'knowledgeBaseId': 'kb-1',
        },
        skills=[
            {
                'skillId': 'skill-1',
                'skillName': 'sales_skill',
                'sourceType': 'inline',
            }
        ],
    )

    result = await ask_service.ask(ask_request)
    ask_result = ask_service.get_ask_result(
        AskResultRequest(query_id=ask_request.query_id)
    )

    assert result['metadata']['type'] == 'SKILL'
    assert result['metadata']['shadow_compare'] == {
        'enabled': True,
        'executed': True,
        'comparable': False,
        'primary_type': 'SKILL',
        'shadow_type': 'TEXT_TO_SQL',
        'primary_ask_path': 'skill',
        'shadow_ask_path': 'nl2sql',
        'primary_error_type': '',
        'shadow_error_type': '',
        'primary_sql': None,
        'shadow_sql': 'SELECT 1',
        'primary_result_count': 0,
        'shadow_result_count': 1,
        'matched': False,
        'shadow_error': None,
        'reason': None,
    }
    assert legacy_tool.run.await_count == 1
    assert ask_result.status == 'finished'
    assert ask_result.type == 'SKILL'
    assert ask_result.skill_result is not None
    assert ask_result.skill_result.text == '本月 GMV 为 128 万'
    assert ask_result.ask_path == 'skill'
    assert ask_result.shadow_compare is not None
    assert ask_result.shadow_compare.primary_type == 'SKILL'
    assert ask_result.shadow_compare.shadow_type == 'TEXT_TO_SQL'
    assert ask_result.shadow_compare.shadow_sql == 'SELECT 1'
    assert ask_result.shadow_compare.shadow_result_count == 1
    assert ask_result.shadow_compare.matched is False
    stats = ask_service.get_shadow_compare_stats()
    assert stats.total_count == 1
    assert stats.executed_count == 1
    assert stats.skipped_count == 0
    assert stats.matched_count == 0
    assert stats.mismatched_count == 1
    assert stats.error_count == 0
    assert stats.comparable_count == 0
    assert stats.non_comparable_count == 1
    assert stats.comparable_match_count == 0
    assert stats.comparable_mismatch_count == 0
    assert stats.by_primary_ask_path == {'skill': 1}
    assert stats.by_shadow_ask_path == {'nl2sql': 1}
    assert stats.by_shadow_error_type == {}
    assert stats.by_reason == {}
    readiness = ask_service.get_shadow_compare_rollout_readiness()
    assert readiness.status == 'waiting_for_comparable_samples'
    assert readiness.recommended_mode == 'keep_legacy'
    assert readiness.comparable_count == 0
    assert readiness.comparable_match_rate == 0.0
    assert readiness.comparable_mismatch_rate == 0.0
    assert readiness.error_rate == 0.0


@pytest.mark.asyncio
async def test_ask_shadow_compare_records_deepagents_error_primary_fallback_reason(
    base_pipelines,
):
    orchestrator = DeepAgentsOrchestratorStub()
    orchestrator.run.side_effect = RuntimeError('deepagents exploded')
    legacy_tool = LegacyAskToolStub(
        {
            'ask_result': [
                {
                    'sql': 'SELECT 1',
                    'type': 'llm',
                }
            ],
            'metadata': {
                'type': 'TEXT_TO_SQL',
                'ask_path': 'nl2sql',
                'error_type': '',
                'error_message': '',
                'request_from': 'ui',
            },
        }
    )
    ask_service = make_service(
        base_pipelines,
        ask_runtime_mode='deepagents',
        ask_shadow_compare_enabled=True,
        deepagents_orchestrator=orchestrator,
        legacy_ask_tool=legacy_tool,
    )
    ask_request = make_request(
        runtimeIdentity={
            'workspaceId': 'workspace-1',
            'knowledgeBaseId': 'kb-1',
        }
    )

    result = await ask_service.ask(ask_request)

    assert result['metadata']['fallback_reason'] == 'deepagents_error'
    assert result['metadata']['deepagents_error'] == 'deepagents exploded'
    assert result['metadata']['shadow_compare']['reason'] == 'deepagents_error'

    stats = ask_service.get_shadow_compare_stats()
    assert stats.total_count == 1
    assert stats.executed_count == 0
    assert stats.skipped_count == 1
    assert stats.by_reason == {'deepagents_error': 1}


@pytest.mark.asyncio
async def test_tool_router_shadow_compare_skips_second_run_after_primary_fallback():
    deepagents_orchestrator = DeepAgentsOrchestratorStub(result=None)
    legacy_tool = LegacyAskToolStub(
        {
            'ask_result': [
                {
                    'sql': 'SELECT 1',
                    'type': 'llm',
                }
            ],
            'metadata': {
                'type': 'TEXT_TO_SQL',
                'ask_path': 'nl2sql',
                'error_type': '',
                'error_message': '',
                'request_from': 'ui',
            },
        }
    )
    router = ToolRouter(
        legacy_ask_tool=legacy_tool,
        deepagents_orchestrator=deepagents_orchestrator,
        ask_shadow_compare_enabled=True,
    )
    ask_request = make_request(
        runtimeIdentity={
            'workspaceId': 'workspace-1',
            'knowledgeBaseId': 'kb-1',
        }
    )

    result = await router.run_ask(
        ask_runtime_mode='deepagents',
        ask_request=ask_request,
        query_id=ask_request.query_id,
        trace_id='trace-1',
        histories=[],
        runtime_scope_id='project-1',
        is_followup=False,
        is_stopped=lambda: False,
        set_result=lambda **_: None,
        build_ask_result=lambda **payload: payload,
        build_ask_error=lambda **payload: payload,
    )

    assert result['metadata']['type'] == 'TEXT_TO_SQL'
    assert result['metadata']['shadow_compare'] == {
        'enabled': True,
        'executed': False,
        'comparable': False,
        'primary_type': 'TEXT_TO_SQL',
        'primary_ask_path': 'nl2sql',
        'shadow_ask_path': None,
        'primary_error_type': '',
        'shadow_error_type': None,
        'primary_sql': 'SELECT 1',
        'shadow_sql': None,
        'primary_result_count': 1,
        'shadow_result_count': 0,
        'shadow_type': None,
        'matched': False,
        'shadow_error': None,
        'reason': 'primary_fallback',
    }
    assert legacy_tool.run.await_count == 1


@pytest.mark.asyncio
async def test_tool_router_shadow_compare_captures_shadow_failure_details():
    deepagents_orchestrator = DeepAgentsOrchestratorStub(
        result=SkillExecutionResult.model_validate(
            {
                'result_type': 'text',
                'text': '本月 GMV 为 128 万',
            }
        )
    )
    legacy_tool = LegacyAskToolStub(
        {
            'ask_result': [],
            'metadata': {
                'type': 'TEXT_TO_SQL',
                'ask_path': 'correction',
                'error_type': 'NO_RELEVANT_SQL',
                'error_message': 'No relevant SQL',
                'request_from': 'ui',
            },
        }
    )
    router = ToolRouter(
        legacy_ask_tool=legacy_tool,
        deepagents_orchestrator=deepagents_orchestrator,
        ask_shadow_compare_enabled=True,
    )
    ask_request = make_request(
        runtimeIdentity={
            'workspaceId': 'workspace-1',
            'knowledgeBaseId': 'kb-1',
        },
        skills=[
            {
                'skillId': 'skill-1',
                'skillName': 'sales_skill',
                'sourceType': 'inline',
            }
        ],
    )

    result = await router.run_ask(
        ask_runtime_mode='deepagents',
        ask_request=ask_request,
        query_id=ask_request.query_id,
        trace_id='trace-1',
        histories=[],
        runtime_scope_id='project-1',
        is_followup=False,
        is_stopped=lambda: False,
        set_result=lambda **_: None,
        build_ask_result=lambda **payload: payload,
        build_ask_error=lambda **payload: payload,
    )

    assert result['metadata']['shadow_compare']['shadow_error_type'] == 'NO_RELEVANT_SQL'
    assert result['metadata']['shadow_compare']['shadow_sql'] is None
    assert result['metadata']['shadow_compare']['shadow_result_count'] == 0
    assert result['metadata']['shadow_compare']['shadow_ask_path'] == 'correction'


@pytest.mark.asyncio
async def test_ask_shadow_compare_stats_track_skip_and_error_buckets(base_pipelines):
    orchestrator = DeepAgentsOrchestratorStub(
        result=SkillExecutionResult.model_validate(
            {
                'result_type': 'text',
                'text': '本月 GMV 为 128 万',
            }
        )
    )
    legacy_tool = LegacyAskToolStub(
        {
            'ask_result': [],
            'metadata': {
                'type': 'TEXT_TO_SQL',
                'ask_path': 'correction',
                'error_type': 'NO_RELEVANT_SQL',
                'error_message': 'No relevant SQL',
                'request_from': 'ui',
            },
        }
    )
    ask_service = make_service(
        base_pipelines,
        ask_runtime_mode='deepagents',
        ask_shadow_compare_enabled=True,
        deepagents_orchestrator=orchestrator,
        legacy_ask_tool=legacy_tool,
    )

    request1 = make_request(
        runtimeIdentity={
            'workspaceId': 'workspace-1',
            'knowledgeBaseId': 'kb-1',
        },
        skills=[
            {
                'skillId': 'skill-1',
                'skillName': 'sales_skill',
                'sourceType': 'inline',
            }
        ],
    )
    await ask_service.ask(request1)

    async def _fallback_only(**kwargs):
        return await kwargs['fallback_runner']()

    orchestrator.run.side_effect = _fallback_only

    request2 = make_request(
        runtimeIdentity={
            'workspaceId': 'workspace-1',
            'knowledgeBaseId': 'kb-1',
        }
    )
    await ask_service.ask(request2)

    stats = ask_service.get_shadow_compare_stats()
    assert stats.total_count == 2
    assert stats.executed_count == 1
    assert stats.skipped_count == 1
    assert stats.matched_count == 0
    assert stats.mismatched_count == 1
    assert stats.error_count == 1
    assert stats.comparable_count == 0
    assert stats.non_comparable_count == 1
    assert stats.comparable_match_count == 0
    assert stats.comparable_mismatch_count == 0
    assert stats.by_primary_ask_path == {'skill': 1, 'correction': 1}
    assert stats.by_shadow_ask_path == {'correction': 1}
    assert stats.by_shadow_error_type == {'NO_RELEVANT_SQL': 1}
    assert stats.by_reason == {'primary_fallback': 1}
    readiness = ask_service.get_shadow_compare_rollout_readiness()
    assert readiness.status == 'investigate_shadow_errors'
    assert readiness.recommended_mode == 'keep_legacy'
    assert readiness.total_count == 2
    assert readiness.executed_count == 1
    assert readiness.comparable_count == 0
    assert readiness.comparable_match_rate == 0.0
    assert readiness.comparable_mismatch_rate == 0.0
    assert readiness.error_rate == 1.0


@pytest.mark.asyncio
async def test_tool_router_shadow_compare_uses_specific_deepagents_fallback_reason():
    skill_runner_client = SkillRunnerClientStub(enabled=False)
    orchestrator = DeepAgentsAskOrchestrator(skill_runner_client=skill_runner_client)
    legacy_tool = LegacyAskToolStub(
        {
            'ask_result': [
                {
                    'sql': 'SELECT 1',
                    'type': 'llm',
                }
            ],
            'metadata': {
                'type': 'TEXT_TO_SQL',
                'ask_path': 'nl2sql',
                'error_type': '',
                'error_message': '',
                'request_from': 'ui',
            },
        }
    )
    router = ToolRouter(
        legacy_ask_tool=legacy_tool,
        deepagents_orchestrator=orchestrator,
        ask_shadow_compare_enabled=True,
    )
    ask_request = make_request(
        runtimeIdentity={
            'workspaceId': 'workspace-1',
            'knowledgeBaseId': 'kb-1',
        },
        skills=[
            {
                'skillId': 'skill-1',
                'skillName': 'sales_skill',
                'sourceType': 'inline',
            }
        ],
    )

    result = await router.run_ask(
        ask_runtime_mode='deepagents',
        ask_request=ask_request,
        query_id=ask_request.query_id,
        trace_id='trace-1',
        histories=[],
        runtime_scope_id='project-1',
        is_followup=False,
        is_stopped=lambda: False,
        set_result=lambda **_: None,
        build_ask_result=lambda **payload: payload,
        build_ask_error=lambda **payload: payload,
    )

    assert result['metadata']['fallback_reason'] == 'skill_runner_disabled'
    assert result['metadata']['shadow_compare']['reason'] == 'skill_runner_disabled'
    assert result['metadata']['resolved_runtime'] == 'legacy'
    assert result['metadata']['deepagents_fallback'] is True


def test_shadow_compare_rollout_readiness_defaults_to_no_data(base_pipelines):
    ask_service = make_service(base_pipelines, ask_runtime_mode="deepagents")

    readiness = ask_service.get_shadow_compare_rollout_readiness()

    assert readiness.status == "no_data"
    assert readiness.recommended_mode == "keep_legacy"
    assert readiness.reason == "No shadow compare samples recorded yet."
    assert readiness.total_count == 0
    assert readiness.executed_count == 0
    assert readiness.comparable_count == 0
    assert readiness.comparable_match_rate == 0.0
    assert readiness.comparable_mismatch_rate == 0.0
    assert readiness.error_rate == 0.0


def test_shadow_compare_rollout_readiness_ready_for_canary_when_all_comparable_samples_match(
    base_pipelines,
):
    ask_service = make_service(base_pipelines, ask_runtime_mode="deepagents")

    record_shadow_compare(
        ask_service,
        primary_ask_path="skill",
        shadow_ask_path="skill",
    )
    record_shadow_compare(
        ask_service,
        primary_ask_path="followup",
        shadow_ask_path="followup",
    )

    stats = ask_service.get_shadow_compare_stats()
    readiness = ask_service.get_shadow_compare_rollout_readiness()

    assert stats.total_count == 2
    assert stats.executed_count == 2
    assert stats.comparable_count == 2
    assert stats.comparable_match_count == 2
    assert stats.comparable_mismatch_count == 0
    assert readiness.status == "ready_for_canary"
    assert readiness.recommended_mode == "canary_deepagents"
    assert readiness.reason == "Comparable shadow compare samples are matching."
    assert readiness.total_count == 2
    assert readiness.executed_count == 2
    assert readiness.comparable_count == 2
    assert readiness.comparable_match_rate == 1.0
    assert readiness.comparable_mismatch_rate == 0.0
    assert readiness.error_rate == 0.0


def test_shadow_compare_rollout_readiness_blocks_on_comparable_mismatches(
    base_pipelines,
):
    ask_service = make_service(base_pipelines, ask_runtime_mode="deepagents")

    record_shadow_compare(ask_service)
    record_shadow_compare(
        ask_service,
        matched=False,
        primary_ask_path="skill",
        shadow_ask_path="nl2sql",
    )

    stats = ask_service.get_shadow_compare_stats()
    readiness = ask_service.get_shadow_compare_rollout_readiness()

    assert stats.total_count == 2
    assert stats.executed_count == 2
    assert stats.comparable_count == 2
    assert stats.comparable_match_count == 1
    assert stats.comparable_mismatch_count == 1
    assert readiness.status == "blocked_on_comparable_mismatches"
    assert readiness.recommended_mode == "keep_legacy"
    assert readiness.reason == (
        "Comparable shadow compare samples still contain mismatches."
    )
    assert readiness.comparable_match_rate == 0.5
    assert readiness.comparable_mismatch_rate == 0.5
    assert readiness.error_rate == 0.0
