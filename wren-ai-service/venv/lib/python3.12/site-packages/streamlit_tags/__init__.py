import os

import streamlit.components.v1 as components
import streamlit as st
import pyarrow

# Create a _RELEASE constant. We'll set this to False while we're developing
# the component, and True when we're ready to package and distribute it.
# (This is, of course, optional - there are innumerable ways to manage your
# release process.)
_RELEASE = True

# Declare a Streamlit component. `declare_component` returns a function
# that is used to create instances of the component. We're naming this
# function "_component_func", with an underscore prefix, because we don't want
# to expose it directly to users. Instead, we will create a custom wrapper
# function, below, that will serve as our component's public API.

# It's worth noting that this call to `declare_component` is the
# *only thing* you need to do to create the binding between Streamlit and
# your component frontend. Everything else we do in this file is simply a
# best practice.

if not _RELEASE:
    _component_func = components.declare_component(
        # We give the component a simple, descriptive name ("my_component"
        # does not fit this bill, so please choose something better for your
        # own component :)
        "streamlit_tags",
        # Pass `url` here to tell Streamlit that the component will be served
        # by the local dev server that you run via `npm run start`.
        # (This is useful while your component is in development.)
        url="http://localhost:3001",
    )
else:
    # When we're distributing a production version of the component, we'll
    # replace the `url` param with `path`, and point it to to the component's
    # build directory:
    parent_dir = os.path.dirname(os.path.abspath(__file__))
    build_dir = os.path.join(parent_dir, "frontend/build")
    _component_func = components.declare_component("streamlit_tags", path=build_dir)


# Create a wrapper function for the component. This is an optional
# best practice - we could simply expose the component function returned by
# `declare_component` and call it done. The wrapper allows us to customize
# our component's API: we can pre-process its input args, post-process its
# output value, and add a docstring for users.
def st_tags(value: list = [],
            suggestions: list = [],
            label: str = "# Enter Keywords",
            text: str = "Press enter to add more",
            maxtags: int = -1,
            key=None) -> list:
    '''

    :param maxtags: Maximum number of tags allowed maxtags = -1 for unlimited entries
    :param suggestions: (List) List of possible suggestions
    :param label: (Str) Label of the Function
    :param text: (Str) Instructions for entry
    :param value: (List) Initial Value
    :param key: (Str)
        An optional string to use as the unique key for the widget.
        Assign a key so the component is not remount every time the script is rerun.
    :return: Tags
    '''
    import streamlit as st

    st.write(label)
    component_value = _component_func(label=label,
                                      text=text,
                                      initialValue=value,
                                      suggestions=suggestions,
                                      maxTags=maxtags,
                                      key=key,
                                      default=value)
    return component_value


def st_tags_sidebar(value: list = [],
                    suggestions: list = [],
                    label: str = "# Enter Keywords",
                    text: str = "Press enter to add more",
                    maxtags: int = -1,
                    key=None) -> list:
    '''

    :param maxtags: Maximum number of tags allowed maxtags = -1 for unlimited entries
    :param suggestions: (List) List of possible suggestions
    :param label: (Str) Label of the Function
    :param text: (Str) Instructions for entry
    :param value: (List) Initial Value
    :param key: (Str)
        An optional string to use as the unique key for the widget.
        Assign a key so the component is not remount every time the script is rerun.
    :return: Tags
    '''
    import streamlit as st

    with st.sidebar:
        st.sidebar.write(label)
        component_value = _component_func(label=label,
                                          text=text,
                                          initialValue=value,
                                          suggestions=suggestions,
                                          maxTags=maxtags,
                                          key=key,
                                          default=value)
        return component_value


# Add some test code to play with the component while it's in development.
# During development, we can run this just as we would any other Streamlit
# app: `$ streamlit run my_component/__init__.py`
if not _RELEASE:
    import streamlit as st

    # Create a second instance of our component whose `name` arg will vary
    # based on a text_input widget.
    #
    # We use the special "key" argument to assign a fixed identity to this
    # component instance. By default, when a component's arguments change,
    # it is considered a new instance and will be re-mounted on the frontend
    # and lose its current state. In this case, we want to vary the component's
    # "name" argument without having it get recreated.

    keyword = st_tags(label='# Enter Keywords:',
                      text='Press enter to add more',
                      value=['Zero', 'One', 'Two'],
                      suggestions=['five', 'six', 'seven', 'eight', 'nine', 'three', 'eleven', 'ten', 'four'],
                      maxtags=4,
                      key='2')

    st.sidebar.write("### Results:")
    st.sidebar.write(keyword)
