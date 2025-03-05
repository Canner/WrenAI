from typing import Union

# This is a dirty hack - proper way it to upgrade OpenAPI generator for at least 5.0
# But this upgrade will also require updating of all templates. Maybe some other day
AnyOfstringinteger = Union[str, int]
