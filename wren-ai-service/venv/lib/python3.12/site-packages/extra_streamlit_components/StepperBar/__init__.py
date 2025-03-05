import os
import streamlit.components.v1 as components
from streamlit.components.v1.components import CustomComponent
from typing import List

from extra_streamlit_components import IS_RELEASE

if IS_RELEASE:
    absolute_path = os.path.dirname(os.path.abspath(__file__))
    build_path = os.path.join(absolute_path, "frontend/build")
    _component_func = components.declare_component("stepper_bar", path=build_path)
else:
    _component_func = components.declare_component("stepper_bar", url="http://localhost:3000")


def stepper_bar(steps: List[str], is_vertical: bool = False, lock_sequence: bool = True) -> CustomComponent:
    component_value = _component_func(steps=steps, is_vertical=is_vertical, lock_sequence=lock_sequence, default=0)
    return component_value
