from unittest.mock import AsyncMock

import pytest

from src.pipelines.generation.question_rephrasing import QuestionRephrasing


@pytest.mark.asyncio
async def test_empty_question():
    llm_provider = AsyncMock()
    llm_provider.get_generator.return_value = AsyncMock(
        return_value={"replies": ['{"question": ""}']}
    )

    pipe = QuestionRephrasing(llm_provider=llm_provider)
    result = await pipe.run(question="")
    assert result == {"output": ""}


@pytest.mark.asyncio
async def test_basic_question():
    llm_provider = AsyncMock()
    llm_provider.get_generator.return_value = AsyncMock(
        return_value={
            "replies": ['{"question": "What is the total revenue for 2024?"}']
        }
    )

    pipe = QuestionRephrasing(llm_provider=llm_provider)
    result = await pipe.run(
        question="What's the revenue for 2024?",
        contexts=["create table revenue (id INTEGER PRIMARY KEY, revenue INTEGER)"],
        language="English",
    )
    assert result == {"output": "What is the total revenue for 2024?"}


@pytest.mark.asyncio
async def test_question_with_context():
    llm_provider = AsyncMock()
    llm_provider.get_generator.return_value = AsyncMock(
        return_value={
            "replies": [
                '{"question": "What is the total order revenue for user ID 123?"}'
            ]
        }
    )

    pipe = QuestionRephrasing(llm_provider=llm_provider)
    result = await pipe.run(
        question="How much revenue from orders for user 123?",
        contexts=[
            "create table user (id INTEGER PRIMARY KEY)",
            "create table order (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES user(id), revenue INTEGER)",
        ],
        language="English",
    )
    assert result == {"output": "What is the total order revenue for user ID 123?"}


@pytest.mark.asyncio
async def test_invalid_json_response():
    llm_provider = AsyncMock()
    llm_provider.get_generator.return_value = AsyncMock(
        return_value={"replies": ["Invalid JSON"]}
    )

    pipe = QuestionRephrasing(llm_provider=llm_provider)
    result = await pipe.run(question="Test question")
    assert result == {"output": ""}


@pytest.mark.asyncio
async def test_different_language():
    llm_provider = AsyncMock()
    llm_provider.get_generator.return_value = AsyncMock(
        return_value={
            "replies": ['{"question": "¿Cuál es el ingreso total para 2024?"}']
        }
    )

    pipe = QuestionRephrasing(llm_provider=llm_provider)
    result = await pipe.run(
        question="¿Cuánto es el ingreso en 2024?", language="Spanish"
    )
    assert result == {"output": "¿Cuál es el ingreso total para 2024?"}
