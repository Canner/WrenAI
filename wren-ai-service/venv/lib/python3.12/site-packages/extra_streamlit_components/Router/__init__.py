import streamlit as st
from urllib.parse import unquote
import time


# from werkzeug.routing import Map, Rule, NotFound, RequestRedirect


def does_support_session_state():
    try:
        return st.session_state is not None
    except:
        return False


class Router:
    def __init__(self, routes: dict, **kwargs):
        # self.tmp = Map([
        #     Rule('/', endpoint='root'),
        #     Rule('/home', endpoint='home'),
        #     Rule('/<int:id>', endpoint='id'),
        # ])

        self.routes = routes
        if "key" in kwargs:
            st.warning(
                "No need for a key for initialization,"
                " this is not a rendered component."
            )
        if not does_support_session_state():
            raise Exception(
                "Streamlit installation doesn't support session state."
                " Session state needs to be available in the used Streamlit installation"
            )

    def show_route_view(self):
        query_route = self.get_nav_query_param()
        sys_route = self.get_url_route()

        if sys_route is None and query_route is None:
            self.route("/")
            return
        elif sys_route is not None and query_route is not None:
            st.query_params["nav"] = sys_route
            st.session_state["stx_router_route"] = sys_route
        elif query_route is not None:
            self.route(query_route)
            return

        _callable = self.routes.get(sys_route)
        if callable(_callable):
            _callable()

        # match_route = f"{sys_route}"
        # x = self.tmp.bind("", path_info=match_route).match()

    def get_nav_query_param(self):
        url = st.query_params.get("nav")
        url = url[0] if type(url) == list else url
        route = unquote(url) if url is not None else url
        return route

    def get_url_route(self):
        if (
            "stx_router_route" in st.session_state
            and st.session_state.stx_router_route is not None
        ):
            return st.session_state.stx_router_route

        route = self.get_nav_query_param()
        return route

    def route(self, new_route):
        if new_route[0] != "/":
            new_route = "/" + new_route
        st.session_state["stx_router_route"] = new_route
        st.query_params["nav"] = new_route
        time.sleep(0.1)  # Needed for URL param refresh
        st.experimental_rerun()
