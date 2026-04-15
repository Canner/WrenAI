import asyncio
import os
from dataclasses import asdict

import pytest
from pytest_mock import MockFixture

import src.utils as utils
from src.core.pipeline import PipelineComponent
from src.globals import ServiceMetadata, create_service_metadata
from src.pipelines.indexing import clean_display_name


def _mock(mocker: MockFixture) -> tuple:
    llm_provider = mocker.patch("src.core.provider.LLMProvider")
    mocker.patch(
        "src.core.provider.LLMProvider.get_model", return_value="mock-llm-model"
    )
    mocker.patch(
        "src.core.provider.LLMProvider.get_model_kwargs",
        return_value={},
    )

    embedder_provider = mocker.patch("src.core.provider.EmbedderProvider")
    mocker.patch(
        "src.core.provider.EmbedderProvider.get_model",
        return_value="mock-embedding-model",
    )
    mocker.patch(
        "src.core.provider.EmbedderProvider.get_model_dimension",
        return_value=768,
    )

    return llm_provider, embedder_provider


@pytest.fixture
def service_metadata(mocker: MockFixture):
    current_path = os.path.dirname(__file__)

    return create_service_metadata(
        pipe_components={"mock": PipelineComponent(*_mock(mocker))},
        pyproject_path=os.path.join(current_path, "../data/mock_pyproject.toml"),
    )


def test_service_metadata(service_metadata: ServiceMetadata):
    assert service_metadata.pipes_metadata == {
        "mock": {
            "llm_model": "mock-llm-model",
            "llm_model_kwargs": {},
            "embedding_model": "mock-embedding-model",
        },
    }

    assert service_metadata.service_version == "0.8.0-mock"


def test_trace_metadata(service_metadata: ServiceMetadata, mocker: MockFixture):
    function = mocker.patch(
        "src.utils.langfuse_context.update_current_trace", return_value=None
    )

    class Request:
        project_id = "mock-project-id"
        thread_id = "mock-thread-id"
        mdl_hash = "mock-mdl-hash"
        query = "mock-user-query"

    @utils.trace_metadata
    async def my_function(_: str, b: Request, **kwargs):
        return "Hello, World!"

    asyncio.run(my_function("", Request(), service_metadata=asdict(service_metadata)))

    function.assert_called_once_with(
        user_id=None,
        session_id="mock-thread-id",
        release=service_metadata.service_version,
        metadata={
            "mdl_hash": "mock-mdl-hash",
            "project_id": "mock-project-id",
            "query": "mock-user-query",
            **service_metadata.pipes_metadata,
        },
    )


def test_trace_metadata_flattens_shadow_compare(
    service_metadata: ServiceMetadata, mocker: MockFixture
):
    function = mocker.patch(
        "src.utils.langfuse_context.update_current_trace", return_value=None
    )

    class Request:
        project_id = "mock-project-id"
        thread_id = "mock-thread-id"
        mdl_hash = "mock-mdl-hash"
        query = "mock-user-query"

    @utils.trace_metadata
    async def my_function(_: str, b: Request, **kwargs):
        return {
            "metadata": {
                "type": "TEXT_TO_SQL",
                "ask_path": "nl2sql",
                "shadow_compare": {
                    "enabled": True,
                    "executed": True,
                    "comparable": True,
                    "matched": True,
                    "primary_type": "TEXT_TO_SQL",
                    "shadow_type": "TEXT_TO_SQL",
                    "primary_ask_path": "nl2sql",
                    "shadow_ask_path": "instructions",
                    "shadow_error_type": "",
                    "reason": None,
                },
            }
        }

    asyncio.run(my_function("", Request(), service_metadata=asdict(service_metadata)))

    function.assert_called_once_with(
        user_id=None,
        session_id="mock-thread-id",
        release=service_metadata.service_version,
        metadata={
            "mdl_hash": "mock-mdl-hash",
            "project_id": "mock-project-id",
            "query": "mock-user-query",
            "type": "TEXT_TO_SQL",
            "ask_path": "nl2sql",
            "shadow_compare": {
                "enabled": True,
                "executed": True,
                "comparable": True,
                "matched": True,
                "primary_type": "TEXT_TO_SQL",
                "shadow_type": "TEXT_TO_SQL",
                "primary_ask_path": "nl2sql",
                "shadow_ask_path": "instructions",
                "shadow_error_type": "",
                "reason": None,
            },
            "shadow_compare_enabled": True,
            "shadow_compare_executed": True,
            "shadow_compare_comparable": True,
            "shadow_compare_matched": True,
            "shadow_compare_primary_type": "TEXT_TO_SQL",
            "shadow_compare_shadow_type": "TEXT_TO_SQL",
            "shadow_compare_primary_ask_path": "nl2sql",
            "shadow_compare_shadow_ask_path": "instructions",
            "shadow_compare_shadow_error_type": "",
            "shadow_compare_reason": None,
            **service_metadata.pipes_metadata,
        },
    )


def test_trace_metadata_flattens_deepagents_runtime_metadata(
    service_metadata: ServiceMetadata, mocker: MockFixture
):
    function = mocker.patch(
        "src.utils.langfuse_context.update_current_trace", return_value=None
    )

    class Request:
        project_id = "mock-project-id"
        thread_id = "mock-thread-id"
        mdl_hash = "mock-mdl-hash"
        query = "mock-user-query"

    @utils.trace_metadata
    async def my_function(_: str, b: Request, **kwargs):
        return {
            "metadata": {
                "type": "TEXT_TO_SQL",
                "ask_path": "nl2sql",
                "ask_runtime_mode": "deepagents",
                "primary_runtime": "deepagents",
                "resolved_runtime": "legacy",
                "fallback_reason": "deepagents_error",
                "deepagents_error": "boom",
            }
        }

    asyncio.run(my_function("", Request(), service_metadata=asdict(service_metadata)))

    function.assert_called_once_with(
        user_id=None,
        session_id="mock-thread-id",
        release=service_metadata.service_version,
        metadata={
            "mdl_hash": "mock-mdl-hash",
            "project_id": "mock-project-id",
            "query": "mock-user-query",
            "type": "TEXT_TO_SQL",
            "ask_path": "nl2sql",
            "ask_runtime_mode": "deepagents",
            "primary_runtime": "deepagents",
            "resolved_runtime": "legacy",
            "fallback_reason": "deepagents_error",
            "deepagents_error": "boom",
            **service_metadata.pipes_metadata,
        },
    )


def test_trace_metadata_prefers_runtime_scope_id_for_base_request_like_objects(
    service_metadata: ServiceMetadata, mocker: MockFixture
):
    function = mocker.patch(
        "src.utils.langfuse_context.update_current_trace", return_value=None
    )

    class Request:
        runtime_scope_id = "deploy-1"
        project_id = "legacy-project-1"
        thread_id = "mock-thread-id"
        mdl_hash = "mock-mdl-hash"
        query = "mock-user-query"

        def resolve_runtime_scope_id(self):
            return self.runtime_scope_id

    @utils.trace_metadata
    async def my_function(_: str, b: Request, **kwargs):
        return "Hello, Runtime Scope!"

    asyncio.run(my_function("", Request(), service_metadata=asdict(service_metadata)))

    function.assert_called_once_with(
        user_id=None,
        session_id="mock-thread-id",
        release=service_metadata.service_version,
        metadata={
            "mdl_hash": "mock-mdl-hash",
            "runtime_scope_id": "deploy-1",
            "project_id": "legacy-project-1",
            "query": "mock-user-query",
            **service_metadata.pipes_metadata,
        },
    )


def test_trace_metadata_prefers_resolved_bridge_scope_id(
    service_metadata: ServiceMetadata, mocker: MockFixture
):
    function = mocker.patch(
        "src.utils.langfuse_context.update_current_trace", return_value=None
    )

    class Request:
        project_id = "raw-project-id"
        thread_id = "mock-thread-id"
        mdl_hash = "mock-mdl-hash"
        query = "mock-user-query"

        def resolve_runtime_scope_id(self):
            return "deploy-1"

        def resolve_bridge_scope_id(self):
            return "legacy-project-1"

    @utils.trace_metadata
    async def my_function(_: str, b: Request, **kwargs):
        return "Hello, Legacy Project Bridge!"

    asyncio.run(my_function("", Request(), service_metadata=asdict(service_metadata)))

    function.assert_called_once_with(
        user_id=None,
        session_id="mock-thread-id",
        release=service_metadata.service_version,
        metadata={
            "mdl_hash": "mock-mdl-hash",
            "runtime_scope_id": "deploy-1",
            "project_id": "legacy-project-1",
            "query": "mock-user-query",
            **service_metadata.pipes_metadata,
        },
    )


def test_clean_display_name():
    # Test empty and None cases
    assert clean_display_name("") == ""

    # Test simple valid names (should remain unchanged)
    assert clean_display_name("valid_name") == "valid_name"
    assert clean_display_name("ValidName") == "ValidName"
    assert clean_display_name("valid123") == "valid123"

    # Test prefix invalid characters - numbers and special chars
    assert clean_display_name("123name") == "_123name"
    assert clean_display_name("-name") == "_name"
    assert clean_display_name("&name") == "_name"
    assert clean_display_name("%name") == "_name"
    assert clean_display_name("=name") == "_name"
    assert clean_display_name("+name") == "_name"
    assert clean_display_name("'name") == "_name"
    assert clean_display_name('"name') == "_name"
    assert clean_display_name("<name") == "_name"
    assert clean_display_name(">name") == "_name"
    assert clean_display_name("#name") == "_name"
    assert clean_display_name("|name") == "_name"
    assert clean_display_name("!name") == "_name"
    assert clean_display_name("(name") == "_name"
    assert clean_display_name(")name") == "_name"
    assert clean_display_name("*name") == "_name"
    assert clean_display_name(",name") == "_name"
    assert clean_display_name("/name") == "_name"
    assert clean_display_name(".name") == "_name"
    assert clean_display_name(";name") == "_name"
    assert clean_display_name("[name") == "_name"
    assert clean_display_name("\\name") == "_name"
    assert clean_display_name("]name") == "_name"
    assert clean_display_name("^name") == "_name"
    assert clean_display_name("{name") == "_name"
    assert clean_display_name("}name") == "_name"
    assert clean_display_name("~name") == "_name"

    # Test middle invalid characters
    assert clean_display_name("na-me") == "na_me"
    assert clean_display_name("na&me") == "na_me"
    assert clean_display_name("na%me") == "na_me"
    assert clean_display_name("na=me") == "na_me"
    assert clean_display_name("na+me") == "na_me"
    assert clean_display_name("na'me") == "na_me"
    assert clean_display_name('na"me') == "na_me"
    assert clean_display_name("na<me") == "na_me"
    assert clean_display_name("na>me") == "na_me"
    assert clean_display_name("na#me") == "na_me"
    assert clean_display_name("na|me") == "na_me"
    assert clean_display_name("na!me") == "na_me"
    assert clean_display_name("na(me") == "na_me"
    assert clean_display_name("na)me") == "na_me"
    assert clean_display_name("na/me") == "na_me"
    assert clean_display_name("na.me") == "na_me"
    assert clean_display_name("na?me") == "na_me"
    assert clean_display_name("na[me") == "na_me"
    assert clean_display_name("na\\me") == "na_me"
    assert clean_display_name("na]me") == "na_me"
    assert clean_display_name("na^me") == "na_me"
    assert clean_display_name("na`me") == "na_me"
    assert clean_display_name("na{me") == "na_me"
    assert clean_display_name("na}me") == "na_me"
    assert clean_display_name("na~me") == "na_me"

    # Test suffix invalid characters
    assert clean_display_name("name-") == "name_"
    assert clean_display_name("name&") == "name_"
    assert clean_display_name("name%") == "name_"
    assert clean_display_name("name=") == "name_"
    assert clean_display_name("name+") == "name_"
    assert clean_display_name("name:") == "name_"
    assert clean_display_name("name'") == "name_"
    assert clean_display_name('name"') == "name_"
    assert clean_display_name("name<") == "name_"
    assert clean_display_name("name>") == "name_"
    assert clean_display_name("name#") == "name_"
    assert clean_display_name("name|") == "name_"
    assert clean_display_name("name!") == "name_"
    assert clean_display_name("name(") == "name_"
    assert clean_display_name("name)") == "name_"
    assert clean_display_name("name,") == "name_"
    assert clean_display_name("name.") == "name_"
    assert clean_display_name("name/") == "name_"
    assert clean_display_name("name@") == "name_"
    assert clean_display_name("name[") == "name_"
    assert clean_display_name("name\\") == "name_"
    assert clean_display_name("name]") == "name_"
    assert clean_display_name("name^") == "name_"
    assert clean_display_name("name{") == "name_"
    assert clean_display_name("name}") == "name_"
    assert clean_display_name("name~") == "name_"

    # Test single character cases
    assert clean_display_name("1") == "_"
    assert clean_display_name("-") == "_"
    assert clean_display_name(".") == "_"
    assert clean_display_name("a") == "a"  # valid single character

    # Test multiple consecutive underscores collapse
    assert (
        clean_display_name("na--me") == "na_me"
    )  # middle chars become underscores, then collapsed
    assert (
        clean_display_name("na..me") == "na_me"
    )  # dots become underscores, then collapsed

    # Test complex cases with multiple invalid characters
    assert clean_display_name("123-test.name@") == "_123_test_name_"
    assert clean_display_name(".table.name.") == "_table_name_"
    assert clean_display_name("!@#$%^&*()") == "_"

    # Test underscore collapsing in complex scenarios
    result = clean_display_name("!@#$%^&*()")
    assert result == "_"  # All get replaced, then collapsed

    # Test real-world examples
    assert clean_display_name("user.email") == "user_email"
    assert (
        clean_display_name("order-total") == "order_total"
    )  # prefix 'o' stays, '-' becomes '_'
    assert clean_display_name("2023_sales") == "_2023_sales"
    assert clean_display_name("product_name!") == "product_name_"
