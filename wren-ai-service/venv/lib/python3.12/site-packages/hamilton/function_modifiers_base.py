# Quick hack to make this a backwards compatible refactor
# This allows us to define everything within the function_modifiers directory, and just refer to that
# While maintaining old imports
import logging

from hamilton.function_modifiers.base import *  # noqa F403

logger = logging.getLogger(__name__)
logger.warning(
    "Import of this module is deprecated, and will be removed in a 2.0 release. In fact, "
    "this is not a public-facing API, so if you're hitting this message either we're internally "
    "importing the wrong one or you're doing something fancy. Either way, \n"
    "please replace with `from hamilton.function_modifiers import base as fm_base`."
)
