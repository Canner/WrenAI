import logging

import hamilton.async_driver

logger = logging.getLogger(__name__)

logger.warning(
    "This module is deprecated and will be removed in Hamilton 2.0 "
    "Please use `hamilton.async_driver` instead. "
)

AsyncDriver = hamilton.async_driver.AsyncDriver
