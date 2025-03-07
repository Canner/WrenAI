import uuid

import pytest

from src.config import settings
from src.core.provider import DocumentStoreProvider
from src.globals import create_service_container
from src.providers import generate_components
from src.web.v1.services.instructions import InstructionsService


@pytest.fixture
def instructions_service():
    pipe_components = generate_components(settings.components)
    service_container = create_service_container(pipe_components, settings)

    document_store_provider: DocumentStoreProvider = pipe_components[
        "instructions_indexing"
    ]["document_store_provider"]
    document_store_provider.get_store(
        dataset_name="instructions",
        recreate_index=True,
    )

    return service_container.instructions_service


@pytest.mark.asyncio
async def test_preparation(
    instructions_service: InstructionsService,
):
    id = str(uuid.uuid4())
    instructions = [
        InstructionsService.Instruction(
            id="1",
            instruction="This is a test instruction",
            questions=["What is the test question?"],
            is_default=False,
        ),
        InstructionsService.Instruction(
            id="2",
            instruction="This is another test instruction",
            questions=["What is another test question?"],
            is_default=True,
        ),
    ]

    request = InstructionsService.IndexRequest(
        event_id=id,
        instructions=instructions,
        project_id="fake-id",
    )
    await instructions_service.index(request)

    response = instructions_service[id]

    assert response.status == "finished"

    pipe_components = generate_components(settings.components)
    document_store_provider: DocumentStoreProvider = pipe_components[
        "instructions_indexing"
    ]["document_store_provider"]
    store = document_store_provider.get_store(
        dataset_name="instructions",
    )
    assert await store.count_documents() == 2


@pytest.mark.asyncio
async def test_with_empty_questions(
    instructions_service: InstructionsService,
):
    id = str(uuid.uuid4())

    request = InstructionsService.IndexRequest(
        event_id=id,
        instructions=[
            InstructionsService.Instruction(
                id="1",
                instruction="This is a test instruction",
                questions=[],
                is_default=False,
            )
        ],
        project_id="fake-id",
    )

    await instructions_service.index(request)
    response = instructions_service[id]

    assert response.status == "finished"
    # No documents should be indexed since there were no questions
    pipe_components = generate_components(settings.components)
    document_store_provider: DocumentStoreProvider = pipe_components[
        "instructions_indexing"
    ]["document_store_provider"]
    store = document_store_provider.get_store(
        dataset_name="instructions",
    )
    assert await store.count_documents() == 0


@pytest.mark.asyncio
async def test_with_empty_instructions(
    instructions_service: InstructionsService,
):
    id = str(uuid.uuid4())

    request = InstructionsService.IndexRequest(
        event_id=id,
        instructions=[],
        project_id="fake-id",
    )

    await instructions_service.index(request)
    response = instructions_service[id]

    assert response.status == "finished"


@pytest.mark.asyncio
async def test_deletion(
    instructions_service: InstructionsService,
):
    id = str(uuid.uuid4())
    instructions = [
        InstructionsService.Instruction(
            id="1",
            instruction="This is a test instruction",
            questions=["What is the test question?"],
            is_default=False,
        ),
        InstructionsService.Instruction(
            id="2",
            instruction="This is another test instruction",
            questions=["What is another test question?"],
            is_default=True,
        ),
    ]

    index_request = InstructionsService.IndexRequest(
        event_id=id,
        instructions=instructions,
        project_id="fake-id",
    )

    await instructions_service.index(index_request)
    response = instructions_service[id]

    assert response.status == "finished"

    id = str(uuid.uuid4())
    delete_request = InstructionsService.DeleteRequest(
        event_id=id,
        instruction_ids=["1", "2"],
        project_id="fake-id",
    )

    await instructions_service.delete(delete_request)
    response = instructions_service[id]

    assert response.status == "finished"

    pipe_components = generate_components(settings.components)
    document_store_provider: DocumentStoreProvider = pipe_components[
        "instructions_indexing"
    ]["document_store_provider"]
    store = document_store_provider.get_store(
        dataset_name="instructions",
    )
    assert await store.count_documents() == 0


@pytest.mark.asyncio
async def test_delete_single_instruction(
    instructions_service: InstructionsService,
):
    id = str(uuid.uuid4())
    instructions = [
        InstructionsService.Instruction(
            id="1",
            instruction="This is a test instruction",
            questions=["What is the test question?"],
            is_default=False,
        ),
        InstructionsService.Instruction(
            id="2",
            instruction="This is another test instruction",
            questions=["What is another test question?"],
            is_default=True,
        ),
    ]

    index_request = InstructionsService.IndexRequest(
        event_id=id,
        instructions=instructions,
        project_id="fake-id",
    )

    await instructions_service.index(index_request)
    response = instructions_service[id]
    assert response.status == "finished"

    id = str(uuid.uuid4())
    delete_request = InstructionsService.DeleteRequest(
        event_id=id,
        instruction_ids=["1"],
        project_id="fake-id",
    )

    await instructions_service.delete(delete_request)
    response = instructions_service[id]
    assert response.status == "finished"

    pipe_components = generate_components(settings.components)
    document_store_provider: DocumentStoreProvider = pipe_components[
        "instructions_indexing"
    ]["document_store_provider"]
    store = document_store_provider.get_store(
        dataset_name="instructions",
    )
    assert await store.count_documents() == 1


@pytest.mark.asyncio
async def test_delete_cross_project_instruction(
    instructions_service: InstructionsService,
):
    async def index_instructions(project_id: str):
        id = str(uuid.uuid4())
        instructions = [
            InstructionsService.Instruction(
                id="1",
                instruction="This is a test instruction",
                questions=["What is the test question?"],
                is_default=False,
            ),
        ]
        index_request = InstructionsService.IndexRequest(
            event_id=id,
            instructions=instructions,
            project_id=project_id,
        )
        await instructions_service.index(index_request)
        response = instructions_service[id]
        assert response.status == "finished"

    await index_instructions("project-a")
    await index_instructions("project-b")

    id = str(uuid.uuid4())
    delete_request = InstructionsService.DeleteRequest(
        event_id=id,
        instruction_ids=["1"],
        project_id="project-a",
    )
    await instructions_service.delete(delete_request)
    response = instructions_service[id]
    assert response.status == "finished"

    pipe_components = generate_components(settings.components)
    document_store_provider: DocumentStoreProvider = pipe_components[
        "instructions_indexing"
    ]["document_store_provider"]

    store = document_store_provider.get_store(dataset_name="instructions")
    assert await store.count_documents() == 1
