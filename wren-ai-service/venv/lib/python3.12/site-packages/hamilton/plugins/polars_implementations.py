import logging

from hamilton.plugins.h_polars import PolarsDataFrameResult

logger = logging.getLogger(__name__)
logger.warning("This module is deprecated. Please use hamilton.plugins.h_polars instead.")

__all__ = ["PolarsDataFrameResult"]
