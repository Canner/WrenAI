# Copyright (c) 2020, 2021 The HuggingFace Team
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

"""Lazy-Imports module.

This is code taken from the `HuggingFace team <https://huggingface.co/>`__.
Many thanks to HuggingFace for
`your consent <https://github.com/huggingface/transformers/issues/12861#issuecomment-886712209>`__
to publish it as a standalone package.
"""

import importlib
import os
from dataclasses import dataclass
from types import ModuleType
from typing import Any, Dict, List, Union


@dataclass
class Submodule:
    """Submodule.

    Example: `from . import types`.
    """

    def describe(self, key: str):
        """Describe the object."""
        return f"submodule {key}"


@dataclass
class FromSubmodule:
    """Object exported from submodule.

    Example: `from .types import models, BaseModel`.
    """

    submodule: str

    def describe(self, key: str):
        """Describe the object."""
        return f"{key} from submodule {self.submodule}"


@dataclass
class Raw:
    """Raw object.

    Example: `__version__ = 0.0.1`.
    """

    value: Any

    def describe(self, key: str):
        """Describe the object."""
        return f"extra object {key} of type {type(self.value).__qualname__}"


Export = Union[Submodule, FromSubmodule, Raw]


class LazyImporter(ModuleType):
    """Do lazy imports."""

    # Very heavily inspired by optuna.integration._IntegrationModule
    # https://github.com/optuna/optuna/blob/master/optuna/integration/__init__.py
    def __init__(
        self,
        name: str,
        module_file: str,
        import_structure: Dict[str, List[str]],
        extra_objects: Union[Dict[str, Any], None] = None,
    ):
        super().__init__(name)
        self._exports: Dict[str, Export] = {}

        def safe_insert(key: str, value: Export):
            if (previous := self._exports.get(key)) is not None:
                raise ValueError(f"Duplicate symbol: {previous.describe(key)} and {value.describe(key)}")
            self._exports[key] = value

        for key, values in import_structure.items():
            safe_insert(key, Submodule())
            for value in values:
                safe_insert(value, FromSubmodule(submodule=key))

        self._objects = {} if extra_objects is None else extra_objects
        for key, value in self._objects.items():
            safe_insert(key, Raw(value=value))

        # Needed for autocompletion in an IDE and wildcard imports (although those won't be lazy)
        self.__all__ = [*self._exports.keys()]
        self.__file__ = module_file
        self.__path__ = [os.path.dirname(module_file)]
        self._name = name
        self._import_structure = import_structure

    # Needed for autocompletion in an IDE
    def __dir__(self):
        return [*super().__dir__(), *self.__all__]

    def __getattr__(self, name: str) -> Any:
        target = self._exports.get(name)
        if target is None:
            raise AttributeError(f"module {self.__name__} has no attribute {name}")

        if isinstance(target, Submodule):
            value = self._get_module(name)
        elif isinstance(target, FromSubmodule):
            value = getattr(self._get_module(target.submodule), name)
        elif isinstance(target, Raw):
            value = target.value
        else:
            assert False

        setattr(self, name, value)
        return value

    def _get_module(self, module_name: str):
        return importlib.import_module("." + module_name, self.__name__)

    def __reduce__(self):
        return (self.__class__, (self._name, self.__file__, self._import_structure, self._objects))
