import logging
import typing as t
from dataclasses import dataclass

import numpy as np
from tenacity import (
    AsyncRetrying,
    Retrying,
    WrappedFn,
    after_log,
    retry_if_exception_type,
    stop_after_attempt,
    wait_random_exponential,
)
from tenacity.after import after_nothing


@dataclass
class RunConfig:
    """
    Configuration for a timeouts, retries and seed for Ragas operations.

    Parameters
    ----------
    timeout : int, optional
        Maximum time (in seconds) to wait for a single operation, by default 60.
    max_retries : int, optional
        Maximum number of retry attempts, by default 10.
    max_wait : int, optional
        Maximum wait time (in seconds) between retries, by default 60.
    max_workers : int, optional
        Maximum number of concurrent workers, by default 16.
    exception_types : Union[Type[BaseException], Tuple[Type[BaseException], ...]], optional
        Exception types to catch and retry on, by default (Exception,).
    log_tenacity : bool, optional
        Whether to log retry attempts using tenacity, by default False.
    seed : int, optional
        Random seed for reproducibility, by default 42.

    Attributes
    ----------
    rng : numpy.random.Generator
        Random number generator initialized with the specified seed.

    Notes
    -----
    The `__post_init__` method initializes the `rng` attribute as a numpy random
    number generator using the specified seed.
    """

    timeout: int = 180
    max_retries: int = 10
    max_wait: int = 60
    max_workers: int = 16
    exception_types: t.Union[
        t.Type[BaseException],
        t.Tuple[t.Type[BaseException], ...],
    ] = (Exception,)
    log_tenacity: bool = False
    seed: int = 42

    def __post_init__(self):
        self.rng = np.random.default_rng(seed=self.seed)


def add_retry(fn: WrappedFn, run_config: RunConfig) -> WrappedFn:
    """
    Adds retry functionality to a given function using the provided RunConfig.

    This function wraps the input function with retry logic using the tenacity library.
    It configures the retry behavior based on the settings in the RunConfig.

    Notes
    -----
    - If log_tenacity is enabled in the RunConfig, it sets up logging for retry attempts.
    - The retry logic uses exponential backoff with random jitter for wait times.
    - The number of retry attempts and exception types to retry on are configured
      based on the RunConfig.
    """
    # configure tenacity's after section wtih logger
    if run_config.log_tenacity is not None:
        logger = logging.getLogger(f"ragas.retry.{fn.__name__}")
        tenacity_logger = after_log(logger, logging.DEBUG)
    else:
        tenacity_logger = after_nothing

    r = Retrying(
        wait=wait_random_exponential(multiplier=1, max=run_config.max_wait),
        stop=stop_after_attempt(run_config.max_retries),
        retry=retry_if_exception_type(run_config.exception_types),
        reraise=True,
        after=tenacity_logger,
    )
    return r.wraps(fn)


def add_async_retry(fn: WrappedFn, run_config: RunConfig) -> WrappedFn:
    """
    Decorator for retrying a function if it fails.
    """
    # configure tenacity's after section wtih logger
    if run_config.log_tenacity is not None:
        logger = logging.getLogger(f"TENACITYRetry[{fn.__name__}]")
        tenacity_logger = after_log(logger, logging.DEBUG)
    else:
        tenacity_logger = after_nothing

    r = AsyncRetrying(
        wait=wait_random_exponential(multiplier=1, max=run_config.max_wait),
        stop=stop_after_attempt(run_config.max_retries),
        retry=retry_if_exception_type(run_config.exception_types),
        reraise=True,
        after=tenacity_logger,
    )
    return r.wraps(fn)
