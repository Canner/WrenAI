from typing import Any, Optional


class MixedAnswerComposer:
    def start(self, *, request_from: str) -> dict[str, Any]:
        return {
            "ask_result": {},
            "metadata": {
                "type": "",
                "error_type": "",
                "error_message": "",
                "request_from": request_from,
            },
        }

    def compose_general(
        self,
        result: dict[str, Any],
        *,
        metadata_type: str = "GENERAL",
    ) -> dict[str, Any]:
        result["metadata"]["type"] = metadata_type
        return result

    def compose_text_to_sql_success(
        self,
        result: dict[str, Any],
        *,
        api_results: list[Any],
    ) -> dict[str, Any]:
        result["ask_result"] = api_results
        result["metadata"]["type"] = "TEXT_TO_SQL"
        return result

    def compose_text_to_sql_failure(
        self,
        result: dict[str, Any],
        *,
        error_type: str,
        error_message: Optional[str] = None,
    ) -> dict[str, Any]:
        result["metadata"]["type"] = "TEXT_TO_SQL"
        result["metadata"]["error_type"] = error_type
        result["metadata"]["error_message"] = error_message
        return result
