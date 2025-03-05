from __future__ import annotations

import typing as t

from langchain.smith import RunEvalConfig

from ragas.integrations.langchain import EvaluatorChain

if t.TYPE_CHECKING:
    from langsmith.schemas import Dataset as LangsmithDataset

    from ragas.testset import Testset

try:
    from langsmith import Client
    from langsmith.utils import LangSmithNotFoundError
except ImportError:
    raise ImportError(
        "Please install langsmith to use this feature. You can install it via pip install langsmith"
    )


def upload_dataset(
    dataset: Testset, dataset_name: str, dataset_desc: str = ""
) -> LangsmithDataset:
    """
    Uploads a new dataset to LangSmith, converting it from a TestDataset object to a
    pandas DataFrame before upload. If a dataset with the specified name already
    exists, the function raises an error.

    Parameters
    ----------
    dataset : TestDataset
        The dataset to be uploaded.
    dataset_name : str
        The name for the new dataset in LangSmith.
    dataset_desc : str, optional
        A description for the new dataset. The default is an empty string.

    Returns
    -------
    LangsmithDataset
        The dataset object as stored in LangSmith after upload.

    Raises
    ------
    ValueError
        If a dataset with the specified name already exists in LangSmith.

    Notes
    -----
    The function attempts to read a dataset by the given name to check its existence.
    If not found, it proceeds to upload the dataset after converting it to a pandas
    DataFrame. This involves specifying input and output keys for the dataset being
    uploaded.
    """
    client = Client()
    try:
        # check if dataset exists
        langsmith_dataset: LangsmithDataset = client.read_dataset(
            dataset_name=dataset_name
        )
        raise ValueError(
            f"Dataset {dataset_name} already exists in langsmith. [{langsmith_dataset}]"
        )
    except LangSmithNotFoundError:
        # if not create a new one with the generated query examples
        langsmith_dataset: LangsmithDataset = client.upload_dataframe(
            df=dataset.to_pandas(),
            name=dataset_name,
            input_keys=["question"],
            output_keys=["ground_truth"],
            description=dataset_desc,
        )

        print(
            f"Created a new dataset '{langsmith_dataset.name}'. Dataset is accessible at {langsmith_dataset.url}"
        )
        return langsmith_dataset


def evaluate(
    dataset_name: str,
    llm_or_chain_factory: t.Any,
    experiment_name: t.Optional[str] = None,
    metrics: t.Optional[list] = None,
    verbose: bool = False,
) -> t.Dict[str, t.Any]:
    """
    Evaluates a language model or a chain factory on a specified dataset using
    LangSmith, with the option to customize metrics and verbosity.

    Parameters
    ----------
    dataset_name : str
        The name of the dataset to use for evaluation. This dataset must exist in
        LangSmith.
    llm_or_chain_factory : Any
        The language model or chain factory to be evaluated. This parameter is
        flexible and can accept a variety of objects depending on the implementation.
    experiment_name : Optional[str], optional
        The name of the experiment. This can be used to categorize or identify the
        evaluation run within LangSmith. The default is None.
    metrics : Optional[list], optional
        A list of custom metrics (functions or evaluators) to be used for the
        evaluation. If None, a default set of metrics (answer relevancy, context
        precision, context recall, and faithfulness) are used.
        The default is None.
    verbose : bool, optional
        If True, detailed progress and results will be printed during the evaluation
        process.
        The default is False.

    Returns
    -------
    Dict[str, Any]
        A dictionary containing the results of the evaluation.

    Raises
    ------
    ValueError
        If the specified dataset does not exist in LangSmith.

    See Also
    --------
    Client.read_dataset : Method to read an existing dataset.
    Client.run_on_dataset : Method to run the evaluation on the specified dataset.

    Examples
    --------
    >>> results = evaluate(
    ...     dataset_name="MyDataset",
    ...     llm_or_chain_factory=my_llm,
    ...     experiment_name="experiment_1_with_vanila_rag",
    ...     verbose=True
    ... )
    >>> print(results)
    {'evaluation_result': ...}

    Notes
    -----
    The function initializes a client to interact with LangSmith, validates the existence
    of the specified dataset, prepares evaluation metrics, and runs the evaluation,
    returning the results. Custom evaluation metrics can be specified, or a default set
    will be used if none are provided.
    """
    # init client and validate dataset
    client = Client()
    try:
        _ = client.read_dataset(dataset_name=dataset_name)
    except LangSmithNotFoundError:
        raise ValueError(
            f"Dataset {dataset_name} not found in langsmith, make sure it exists in langsmith"
        )

    # make config
    if metrics is None:
        from ragas.metrics import (
            answer_relevancy,
            context_precision,
            context_recall,
            faithfulness,
        )

        metrics = [answer_relevancy, context_precision, faithfulness, context_recall]

    metrics = [EvaluatorChain(m) for m in metrics]
    eval_config = RunEvalConfig(
        custom_evaluators=metrics,
    )

    # run evaluation with langsmith
    run = client.run_on_dataset(
        dataset_name=dataset_name,
        llm_or_chain_factory=llm_or_chain_factory,
        evaluation=eval_config,
        verbose=verbose,
        # Any experiment metadata can be specified here
        project_name=experiment_name,
    )

    return run
