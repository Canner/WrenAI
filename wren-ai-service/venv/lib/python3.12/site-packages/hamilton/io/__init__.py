import logging

from hamilton.io.default_data_loaders import DATA_ADAPTERS
from hamilton.registry import register_adapter

logger = logging.getLogger(__name__)

registered = False
# Register all the default ones
if not registered:
    logger.debug(f"Registering default data loaders: {DATA_ADAPTERS}")
    for data_loader in DATA_ADAPTERS:
        register_adapter(data_loader)

registered = True
