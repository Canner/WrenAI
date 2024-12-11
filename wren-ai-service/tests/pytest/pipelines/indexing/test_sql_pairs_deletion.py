import pytest

from src.config import settings
from src.core.provider import DocumentStoreProvider
from src.pipelines.indexing.sql_pairs_deletion import SqlPairsDeletion
from src.pipelines.indexing.sql_pairs_preparation import SqlPair, SqlPairsPreparation
from src.providers import generate_components


@pytest.mark.asyncio
async def test_sql_pairs_deletion():
    pipe_components = generate_components(settings.components)
    document_store_provider: DocumentStoreProvider = pipe_components[
        "sql_pairs_preparation"
    ]["document_store_provider"]
    store = document_store_provider.get_store(
        dataset_name="sql_pairs",
        recreate_index=True,
    )

    sql_pairs = [
        SqlPair(sql="SELECT * FROM book", id="1"),
        SqlPair(sql="SELECT * FROM author", id="2"),
    ]
    sql_pairs_preparation = SqlPairsPreparation(
        **pipe_components["sql_pairs_preparation"]
    )
    await sql_pairs_preparation.run(
        sql_pairs=sql_pairs,
        id="fake-id",
    )

    sql_pairs_deletion = SqlPairsDeletion(**pipe_components["sql_pairs_deletion"])
    await sql_pairs_deletion.run(
        id="fake-id-2", sql_pair_ids=[sql_pair.id for sql_pair in sql_pairs]
    )
    assert await store.count_documents() == 2

    await sql_pairs_deletion.run(
        id="fake-id", sql_pair_ids=[sql_pair.id for sql_pair in sql_pairs]
    )
    assert await store.count_documents() == 0
