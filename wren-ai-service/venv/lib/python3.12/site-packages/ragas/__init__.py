from ragas.cache import CacheInterface, DiskCacheBackend, cacher
from ragas.dataset_schema import EvaluationDataset, MultiTurnSample, SingleTurnSample
from ragas.evaluation import evaluate
from ragas.run_config import RunConfig

try:
    from ._version import version as __version__
except ImportError:
    __version__ = "unknown version"


__all__ = [
    "evaluate",
    "RunConfig",
    "__version__",
    "SingleTurnSample",
    "MultiTurnSample",
    "EvaluationDataset",
    "cacher",
    "CacheInterface",
    "DiskCacheBackend",
]
