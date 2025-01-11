import pytest

from src.config import settings
from src.core.provider import DocumentStoreProvider
from src.pipelines.indexing import SqlPairs, SqlPairsDeletion
from src.providers import generate_components


@pytest.mark.asyncio
async def test_sql_pairs_deletion():
    pipe_components = generate_components(settings.components)
    document_store_provider: DocumentStoreProvider = pipe_components[
        "sql_pairs_indexing"
    ]["document_store_provider"]
    store = document_store_provider.get_store(
        dataset_name="sql_pairs",
        recreate_index=True,
    )

    sql_pairs = SqlPairs(
        **pipe_components["sql_pairs_indexing"], sql_pairs_path="tests/data/pairs.json"
    )
    await sql_pairs.run(
        mdl_str='{"models": [{"properties": {"boilerplate": "test"}}]}',
        project_id="fake-id",
    )

    sql_pairs_deletion = SqlPairsDeletion(**pipe_components["sql_pairs_deletion"])
    await sql_pairs_deletion.run(id="fake-id-2", sql_pair_ids=["1", "2"])
    assert await store.count_documents() == 2

    await sql_pairs_deletion.run(id="fake-id", sql_pair_ids=["1", "2"])
    assert await store.count_documents() == 0
