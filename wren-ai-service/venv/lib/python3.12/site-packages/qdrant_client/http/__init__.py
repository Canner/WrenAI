import inspect

from pydantic import BaseModel
from qdrant_client._pydantic_compat import update_forward_refs
from qdrant_client.http.api_client import (  # noqa F401
    ApiClient as ApiClient,
    AsyncApiClient as AsyncApiClient,
    AsyncApis as AsyncApis,
    SyncApis as SyncApis,
)
from qdrant_client.http.models import models as models  # noqa F401

for model in inspect.getmembers(models, inspect.isclass):
    if model[1].__module__ == "qdrant_client.http.models.models":
        model_class = model[1]
        if issubclass(model_class, BaseModel):
            update_forward_refs(model_class)
