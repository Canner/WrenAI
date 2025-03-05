# fmt: off
# isort: skip_file
# both are to so as to not formate out the type: ignore below

import typing as t

try:
    from opik.integrations.langchain import ( # type: ignore
        OpikTracer as LangchainOpikTracer,
    )  # type: ignore

    from ragas.evaluation import RAGAS_EVALUATION_CHAIN_NAME
except ImportError:
    raise ImportError(
        "Opik is not installed. Please install it using `pip install opik` to use the Opik tracer."
    )

if t.TYPE_CHECKING:
    from langchain_core.tracers.schemas import Run


class OpikTracer(LangchainOpikTracer):
    """
    Callback for Opik that can be used to log traces and evaluation scores to the Opik platform.

    Attributes
    ----------
    tags: list[string]
        The tags to set on each trace.
    metadata: dict
        Additional metadata to log for each trace.
    """

    _evaluation_run_id: t.Optional[str] = None

    def _process_start_trace(self, run: "Run"):
        if (run.parent_run_id is None) and (run.name == RAGAS_EVALUATION_CHAIN_NAME):
            # Store the evaluation run id so we can flag the child traces and log them independently
            self._evaluation_run_id = str(run.id)
        else:
            if run.parent_run_id == self._evaluation_run_id:
                run.parent_run_id = None

        super()._process_start_trace(run)

    def _process_end_trace(self, run: "Run"):
        if run.id != self._evaluation_run_id:
            if run.name.startswith("row "):
                trace_data = self._created_traces_data_map[run.id]
                if run.outputs:
                    self._opik_client.log_traces_feedback_scores(
                        [
                            {
                                "id": trace_data.id,
                                "name": name,
                                "value": round(value, 4),
                            }
                            for name, value in run.outputs.items()
                        ]
                    )

            super()._process_end_trace(run)

    def _persist_run(self, run: "Run"):
        if run.id != self._evaluation_run_id:
            super()._persist_run(run)
