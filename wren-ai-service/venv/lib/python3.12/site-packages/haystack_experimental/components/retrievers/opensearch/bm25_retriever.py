# SPDX-FileCopyrightText: 2022-present deepset GmbH <info@deepset.ai>
#
# SPDX-License-Identifier: Apache-2.0

from typing import Any, Dict, List, Optional, Union

from haystack import component, default_from_dict, default_to_dict, logging
from haystack.dataclasses import Document
from haystack.document_stores.types import FilterPolicy
from haystack.document_stores.types.filter_policy import apply_filter_policy

from haystack_experimental.document_stores.opensearch import OpenSearchDocumentStore

logger = logging.getLogger(__name__)


@component
class OpenSearchBM25Retriever:
    """
    OpenSearch BM25 retriever with async support.
    """

    def __init__(
        self,
        *,
        document_store: OpenSearchDocumentStore,
        filters: Optional[Dict[str, Any]] = None,
        fuzziness: str = "AUTO",
        top_k: int = 10,
        scale_score: bool = False,
        all_terms_must_match: bool = False,
        filter_policy: Union[str, FilterPolicy] = FilterPolicy.REPLACE,
        custom_query: Optional[Dict[str, Any]] = None,
        raise_on_failure: bool = True,
    ):
        """
        Creates the OpenSearchBM25Retriever component.

        :param document_store: An instance of OpenSearchDocumentStore to use with the Retriever.
        :param filters: Filters to narrow down the search for documents in the Document Store.
        :param fuzziness: Fuzziness parameter for full-text queries to apply approximate string matching.
        For more information, see [OpenSearch fuzzy query](https://opensearch.org/docs/latest/query-dsl/term/fuzzy/).
        :param top_k: Maximum number of documents to return.
        :param scale_score: If `True`, scales the score of retrieved documents to a range between 0 and 1.
            This is useful when comparing documents across different indexes.
        :param all_terms_must_match: If `True`, all terms in the query string must be present in the
        retrieved documents. This is useful when searching for short text where even one term
        can make a difference.
        :param filter_policy: Policy to determine how filters are applied. Possible options:
            - `replace`: Runtime filters replace initialization filters. Use this policy to change the filtering scope
            for specific queries.
            - `merge`: Runtime filters are merged with initialization filters.
        :param custom_query: The query containing a mandatory `$query` and an optional `$filters` placeholder.

            **An example custom_query:**

            ```python
            {
                "query": {
                    "bool": {
                        "should": [{"multi_match": {
                            "query": "$query",                 // mandatory query placeholder
                            "type": "most_fields",
                            "fields": ["content", "title"]}}],
                        "filter": "$filters"                  // optional filter placeholder
                    }
                }
            }
            ```

        An example `run()` method for this `custom_query`:

        ```python
        retriever.run(
            query="Why did the revenue increase?",
            filters={
                "operator": "AND",
                "conditions": [
                    {"field": "meta.years", "operator": "==", "value": "2019"},
                    {"field": "meta.quarters", "operator": "in", "value": ["Q1", "Q2"]},
                ],
            },
        )
        ```
        :param raise_on_failure:
            Whether to raise an exception if the API call fails. Otherwise log a warning and return an empty list.

        :raises ValueError: If `document_store` is not an instance of OpenSearchDocumentStore.

        """
        if not isinstance(document_store, OpenSearchDocumentStore):
            msg = "document_store must be an instance of OpenSearchDocumentStore"
            raise ValueError(msg)

        self._document_store = document_store
        self._filters = filters or {}
        self._fuzziness = fuzziness
        self._top_k = top_k
        self._scale_score = scale_score
        self._all_terms_must_match = all_terms_must_match
        self._filter_policy = (
            filter_policy if isinstance(filter_policy, FilterPolicy) else FilterPolicy.from_str(filter_policy)
        )
        self._custom_query = custom_query
        self._raise_on_failure = raise_on_failure

    def to_dict(self) -> Dict[str, Any]:
        """
        Serializes the component to a dictionary.

        :returns:
            Dictionary with serialized data.
        """
        return default_to_dict(
            self,
            filters=self._filters,
            fuzziness=self._fuzziness,
            top_k=self._top_k,
            scale_score=self._scale_score,
            document_store=self._document_store.to_dict(),
            filter_policy=self._filter_policy.value,
            custom_query=self._custom_query,
            raise_on_failure=self._raise_on_failure,
        )

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "OpenSearchBM25Retriever":
        """
        Deserializes the component from a dictionary.

        :param data:
            Dictionary to deserialize from.

        :returns:
            Deserialized component.
        """
        data["init_parameters"]["document_store"] = OpenSearchDocumentStore.from_dict(
            data["init_parameters"]["document_store"]
        )
        data["init_parameters"]["filter_policy"] = FilterPolicy.from_str(data["init_parameters"]["filter_policy"])
        return default_from_dict(cls, data)

    def _prepare_bm25_args(
        self,
        *,
        query: str,
        filters: Optional[Dict[str, Any]],
        all_terms_must_match: Optional[bool],
        top_k: Optional[int],
        fuzziness: Optional[str],
        scale_score: Optional[bool],
        custom_query: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        filters = apply_filter_policy(self._filter_policy, self._filters, filters)

        if filters is None:
            filters = self._filters
        if all_terms_must_match is None:
            all_terms_must_match = self._all_terms_must_match
        if top_k is None:
            top_k = self._top_k
        if fuzziness is None:
            fuzziness = self._fuzziness
        if scale_score is None:
            scale_score = self._scale_score
        if custom_query is None:
            custom_query = self._custom_query

        return {
            "query": query,
            "filters": filters,
            "fuzziness": fuzziness,
            "top_k": top_k,
            "scale_score": scale_score,
            "all_terms_must_match": all_terms_must_match,
            "custom_query": custom_query,
        }

    @component.output_types(documents=List[Document])
    def run(  # pylint: disable=too-many-positional-arguments
        self,
        query: str,
        filters: Optional[Dict[str, Any]] = None,
        all_terms_must_match: Optional[bool] = None,
        top_k: Optional[int] = None,
        fuzziness: Optional[str] = None,
        scale_score: Optional[bool] = None,
        custom_query: Optional[Dict[str, Any]] = None,
    ):
        """
        Retrieve documents using BM25 retrieval.

        :param query: The query string.
        :param filters: Filters applied to the retrieved documents. The way runtime filters are applied depends on
                        the `filter_policy` specified at Retriever's initialization.
        :param all_terms_must_match: If `True`, all terms in the query string must be present in the
        retrieved documents.
        :param top_k: Maximum number of documents to return.
        :param fuzziness: Fuzziness parameter for full-text queries to apply approximate string matching.
        For more information, see [OpenSearch fuzzy query](https://opensearch.org/docs/latest/query-dsl/term/fuzzy/).
        :param scale_score: If `True`, scales the score of retrieved documents to a range between 0 and 1.
            This is useful when comparing documents across different indexes.
        :param custom_query: A custom OpenSearch query. It must include a `$query` and may optionally
        include a `$filters` placeholder.

        :returns:
            A dictionary containing the retrieved documents with the following structure:
            - documents: List of retrieved Documents.

        """
        docs: List[Document] = []
        bm25_args = self._prepare_bm25_args(
            query=query,
            filters=filters,
            all_terms_must_match=all_terms_must_match,
            top_k=top_k,
            fuzziness=fuzziness,
            scale_score=scale_score,
            custom_query=custom_query,
        )
        try:
            docs = self._document_store._bm25_retrieval(**bm25_args)
        except Exception as e:
            if self._raise_on_failure:
                raise e
            logger.warning(
                "An error during BM25 retrieval occurred and will be ignored by returning empty results: {error}",
                error=str(e),
                exc_info=True,
            )

        return {"documents": docs}

    @component.output_types(documents=List[Document])
    async def run_async(  # pylint: disable=too-many-positional-arguments
        self,
        query: str,
        filters: Optional[Dict[str, Any]] = None,
        all_terms_must_match: Optional[bool] = None,
        top_k: Optional[int] = None,
        fuzziness: Optional[str] = None,
        scale_score: Optional[bool] = None,
        custom_query: Optional[Dict[str, Any]] = None,
    ):
        """
        Retrieve documents using BM25 retrieval.

        :param query: The query string.
        :param filters: Filters applied to the retrieved documents. The way runtime filters are applied depends on
                        the `filter_policy` specified at Retriever's initialization.
        :param all_terms_must_match: If `True`, all terms in the query string must be present in the
        retrieved documents.
        :param top_k: Maximum number of documents to return.
        :param fuzziness: Fuzziness parameter for full-text queries to apply approximate string matching.
        For more information, see [OpenSearch fuzzy query](https://opensearch.org/docs/latest/query-dsl/term/fuzzy/).
        :param scale_score: If `True`, scales the score of retrieved documents to a range between 0 and 1.
            This is useful when comparing documents across different indexes.
        :param custom_query: A custom OpenSearch query. It must include a `$query` and may optionally
        include a `$filters` placeholder.

        :returns:
            A dictionary containing the retrieved documents with the following structure:
            - documents: List of retrieved Documents.

        """
        docs: List[Document] = []
        bm25_args = self._prepare_bm25_args(
            query=query,
            filters=filters,
            all_terms_must_match=all_terms_must_match,
            top_k=top_k,
            fuzziness=fuzziness,
            scale_score=scale_score,
            custom_query=custom_query,
        )
        try:
            docs = await self._document_store._bm25_retrieval_async(**bm25_args)
        except Exception as e:
            if self._raise_on_failure:
                raise e
            logger.warning(
                "An error during BM25 retrieval occurred and will be ignored by returning empty results: {error}",
                error=str(e),
                exc_info=True,
            )

        return {"documents": docs}
