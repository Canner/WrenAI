import streamlit.components.v1 as components

from .javascript import get_itables_extension_arguments
from .utils import find_package_file

_streamlit_component_func = components.declare_component(
    "itables_for_streamlit", path=find_package_file("itables_for_streamlit")
)


def interactive_table(df, caption=None, **kwargs):
    dt_args, other_args = get_itables_extension_arguments(df, caption, **kwargs)
    return _streamlit_component_func(dt_args=dt_args, other_args=other_args)
