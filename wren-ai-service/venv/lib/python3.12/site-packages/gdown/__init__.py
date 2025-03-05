# flake8: noqa

import importlib.metadata

from . import exceptions
from .cached_download import cached_download
from .cached_download import md5sum
from .download import download
from .download_folder import download_folder
from .extractall import extractall

__version__ = importlib.metadata.version("gdown")
