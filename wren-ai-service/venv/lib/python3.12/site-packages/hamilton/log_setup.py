import logging
import sys

import numpy as np

LOG_LEVELS = {
    "CRITICAL": logging.CRITICAL,
    "ERROR": logging.ERROR,
    "WARNING": logging.WARNING,
    "INFO": logging.INFO,
    "DEBUG": logging.DEBUG,
}


# this is suboptimal but python has no public mapping of log names to levels


def setup_logging(log_level: int = logging.INFO):
    """Helper function to setup logging to console.
    :param log_level: Log level to use when logging
    """
    root_logger = logging.getLogger("")  # root logger
    formatter = logging.Formatter("[%(levelname)s] %(asctime)s %(name)s(%(lineno)s): %(message)s")
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)
    if not len(root_logger.handlers):
        # assumes we have already been set up.
        root_logger.addHandler(stream_handler)
        root_logger.setLevel(log_level)
    np.seterr(divide="ignore", invalid="ignore")
