import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.core import SkillRunnerExecutionResponse
from src.web.v1.services.ask import AskRequest, AskResultRequest, AskService


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



def make_service(pipelines, skill_runner_client=None):
    return AskService(
        pipelines=pipelines,
        skill_runner_client=skill_runner_client,
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


@pytest.mark.asyncio
async def test_ask_falls_back_to_nl2sql_when_skill_runner_disabled(base_pipelines):
    skill_runner_client = SkillRunnerClientStub(enabled=False)
    ask_service = make_service(base_pipelines, skill_runner_client=skill_runner_client)
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
    ask_service = make_service(base_pipelines, skill_runner_client=skill_runner_client)
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
    ask_service = make_service(base_pipelines, skill_runner_client=skill_runner_client)
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
    ask_service = make_service(base_pipelines, skill_runner_client=skill_runner_client)
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
    assert ask_result.status == 'finished'
    assert ask_result.type == 'TEXT_TO_SQL'
    assert ask_result.response is not None
    assert ask_result.response[0].sql == 'SELECT 1'
    assert skill_runner_client.run.await_count == 0
    assert base_pipelines['db_schema_retrieval'].run.await_count == 1
