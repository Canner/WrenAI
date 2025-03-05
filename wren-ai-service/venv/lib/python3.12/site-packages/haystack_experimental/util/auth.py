# SPDX-FileCopyrightText: 2022-present deepset GmbH <info@deepset.ai>
#
# SPDX-License-Identifier: Apache-2.0

from typing import Any, Dict, Iterable

from haystack.utils import Secret


def serialize_secrets_inplace(data: Dict[str, Any], keys: Iterable[str], *, recursive: bool = False) -> None:
    """
    Serialize secrets in a dictionary inplace.

    :param data:
        The dictionary with the data containing secrets.
    :param keys:
        The keys of the secrets to serialize.
    :param recursive:
        Whether to recursively serialize nested dictionaries.
    """
    for k, v in data.items():
        if isinstance(v, dict) and recursive:
            serialize_secrets_inplace(v, keys, recursive=True)
        elif k in keys and isinstance(v, Secret):
            data[k] = v.to_dict()
