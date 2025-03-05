# Copyright (c) 2021 Philip May, Deutsche Telekom AG
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Lazy-Imports main package."""

from lazy_imports.lazy_imports import LazyImporter
from lazy_imports.try_import import try_import


# Versioning follows the Semantic Versioning Specification https://semver.org/ and
# PEP 440 -- Version Identification and Dependency Specification: https://www.python.org/dev/peps/pep-0440/  # noqa: E501
__version__ = "0.4.0"

__all__ = ["LazyImporter", "try_import", "__version__"]
