import pytest

from src.config import settings
from src.core.provider import DocumentStoreProvider
from src.pipelines.indexing import Instructions
from src.pipelines.indexing.instructions import Instruction
from src.providers import generate_components


@pytest.mark.asyncio
async def test_instructions_indexing():
    pipe_components = generate_components(settings.components)
    document_store_provider: DocumentStoreProvider = pipe_components[
        "instructions_indexing"
    ]["document_store_provider"]
    store = document_store_provider.get_store(
        dataset_name="instructions",
        recreate_index=True,
    )

    instructions = Instructions(**pipe_components["instructions_indexing"])
    test_instructions = [
        Instruction(
            id="test-id-1",
            instruction="This is a test instruction",
            question="What is the test question?",
            is_default=False,
        ),
        Instruction(
            id="test-id-2",
            instruction="This is another test instruction",
            question="What is another test question?",
            is_default=True,
        ),
    ]

    await instructions.run(
        project_id="fake-id",
        instructions=test_instructions,
    )

    assert await store.count_documents() == 2
    documents = store.filter_documents()
    for document in documents:
        assert document.content, "content should not be empty"
        assert document.meta, "meta should not be empty"
        assert document.meta.get("instruction_id"), "instruction_id should be in meta"
        assert document.meta.get("instruction"), "instruction should be in meta"
        assert "is_default" in document.meta, "is_default should be in meta"


@pytest.mark.asyncio
async def test_instructions_indexing_with_multiple_project_ids():
    pipe_components = generate_components(settings.components)
    document_store_provider: DocumentStoreProvider = pipe_components[
        "instructions_indexing"
    ]["document_store_provider"]
    store = document_store_provider.get_store(
        dataset_name="instructions",
        recreate_index=True,
    )

    instructions = Instructions(**pipe_components["instructions_indexing"])
    test_instructions = [
        Instruction(
            id="test-id-1",
            instruction="This is a test instruction",
            question="What is the test question?",
        ),
    ]

    await instructions.run(
        project_id="fake-id",
        instructions=test_instructions,
    )

    await instructions.run(
        project_id="fake-id-2",
        instructions=test_instructions,
    )

    assert await store.count_documents() == 2
    documents = store.filter_documents(
        filters={
            "operator": "AND",
            "conditions": [
                {"field": "project_id", "operator": "==", "value": "fake-id"},
            ],
        }
    )
    assert len(documents) == 1


@pytest.mark.asyncio
async def test_instructions_deletion():
    pipe_components = generate_components(settings.components)
    document_store_provider: DocumentStoreProvider = pipe_components[
        "instructions_indexing"
    ]["document_store_provider"]
    store = document_store_provider.get_store(
        dataset_name="instructions",
        recreate_index=True,
    )

    instructions = Instructions(**pipe_components["instructions_indexing"])
    test_instructions = [
        Instruction(
            id="test-id-1",
            instruction="This is a test instruction",
            question="What is the test question?",
        ),
        Instruction(
            id="test-id-2",
            instruction="This is another test instruction",
            question="What is another test question?",
        ),
    ]

    await instructions.run(
        project_id="fake-id",
        instructions=test_instructions,
    )

    await instructions.clean(
        instructions=[Instruction(id="test-id-1")],
        project_id="fake-id-2",
    )
    assert await store.count_documents() == 2

    await instructions.clean(
        instructions=[Instruction(id="test-id-1")],
        project_id="fake-id",
    )
    assert await store.count_documents() == 1

    await instructions.clean(
        instructions=[],
        delete_all=True,
        project_id="fake-id",
    )
    assert await store.count_documents() == 0
