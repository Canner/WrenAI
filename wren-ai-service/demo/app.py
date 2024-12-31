import re
import uuid

import extra_streamlit_components as stx
import orjson
import pytz
import streamlit as st
from utils import (
    DATA_SOURCES,
    ask,
    ask_details,
    generate_chart,
    get_data_from_wren_engine,
    get_mdl_json,
    get_sql_answer,
    on_click_adjust_chart,
    prepare_semantics,
    rerun_wren_engine,
    save_mdl_json_file,
    show_asks_details_results,
    show_asks_results,
)

st.set_page_config(layout="wide")
st.title("Wren AI LLM Service Demo")

if "deployment_id" not in st.session_state:
    st.session_state["deployment_id"] = str(uuid.uuid4())
if "chosen_dataset" not in st.session_state:
    st.session_state["chosen_dataset"] = "ecommerce"
if "dataset_type" not in st.session_state:
    st.session_state["dataset_type"] = "duckdb"
if "chosen_models" not in st.session_state:
    st.session_state["chosen_models"] = None
if "mdl_json" not in st.session_state:
    st.session_state["mdl_json"] = None
if "semantics_preparation_status" not in st.session_state:
    st.session_state["semantics_preparation_status"] = None
if "query" not in st.session_state:
    st.session_state["query"] = None
if "asks_results" not in st.session_state:
    st.session_state["asks_results"] = None
if "asks_results_type" not in st.session_state:
    st.session_state["asks_results_type"] = None
if "chosen_query_result" not in st.session_state:
    st.session_state["chosen_query_result"] = None
if "asks_details_result" not in st.session_state:
    st.session_state["asks_details_result"] = None
if "preview_data_button_index" not in st.session_state:
    st.session_state["preview_data_button_index"] = None
if "preview_sql" not in st.session_state:
    st.session_state["preview_sql"] = None
if "query_history" not in st.session_state:
    st.session_state["query_history"] = None
if "sql_explanation_question" not in st.session_state:
    st.session_state["sql_explanation_question"] = None
if "sql_explanation_steps_with_analysis" not in st.session_state:
    st.session_state["sql_explanation_steps_with_analysis"] = None
if "sql_analysis_results" not in st.session_state:
    st.session_state["sql_analysis_results"] = None
if "sql_explanation_results" not in st.session_state:
    st.session_state["sql_explanation_results"] = None
if "sql_user_corrections_by_step" not in st.session_state:
    st.session_state["sql_user_corrections_by_step"] = []
if "sql_regeneration_results" not in st.session_state:
    st.session_state["sql_regeneration_results"] = None
if "language" not in st.session_state:
    st.session_state["language"] = "English"
if "timezone" not in st.session_state:
    st.session_state["timezone"] = "UTC"
if "chosen_tab_id" not in st.session_state:
    st.session_state["chosen_tab_id"] = "1"


def onchange_demo_dataset():
    st.session_state["chosen_dataset"] = st.session_state["choose_demo_dataset"]


def onchange_language():
    st.session_state["language"] = st.session_state["language_selectbox"]


def onchange_timezone():
    st.session_state["timezone"] = st.session_state["timezone_selectbox"]


with st.sidebar:
    st.markdown("## Deploy MDL Model")
    uploaded_file = st.file_uploader(
        f"Upload an MDL json file, and the file name must be [xxx]_[datasource]_mdl.json, now we support these datasources: {DATA_SOURCES}",
        type="json",
    )
    st.markdown("or")
    chosen_demo_dataset = st.selectbox(
        "Select a demo dataset",
        key="choose_demo_dataset",
        options=[
            "ecommerce",
            "hr",
        ],
        index=0,
        on_change=onchange_demo_dataset,
    )

    if uploaded_file is not None:
        match = re.match(
            r".+_(" + "|".join(DATA_SOURCES) + r")_mdl\.json$",
            uploaded_file.name,
        )
        if not match:
            st.error(
                f"the file name must be [xxx]_[datasource]_mdl.json, now we support these datasources: {DATA_SOURCES}"
            )
            st.stop()

        data_source = match.group(1)
        st.session_state["chosen_dataset"] = uploaded_file.name.split(
            f"_{data_source}_mdl.json"
        )[0]
        st.session_state["dataset_type"] = data_source
        st.session_state["mdl_json"] = orjson.loads(
            uploaded_file.getvalue().decode("utf-8")
        )
        save_mdl_json_file(uploaded_file.name, st.session_state["mdl_json"])
    elif (
        chosen_demo_dataset
        and st.session_state["chosen_dataset"] == chosen_demo_dataset
    ):
        st.session_state["chosen_dataset"] = chosen_demo_dataset
        st.session_state["dataset_type"] = "duckdb"
        st.session_state["mdl_json"] = get_mdl_json(chosen_demo_dataset)

    if st.session_state["mdl_json"]:
        # Display the model using the selected database
        st.markdown("MDL Model Preview")
        st.json(
            body=st.session_state["mdl_json"],
            expanded=False,
        )

    st.markdown("## Settings")
    st.selectbox(
        "LLM Output Language",
        key="language_selectbox",
        options=[
            "English",
            "Spanish",
            "French",
            "TraditionalChinese",
            "SimplifiedChinese",
            "German",
            "Portuguese",
            "Russian",
            "Japanese",
            "Korean",
        ],
        index=0,
        on_change=onchange_language,
    )
    st.selectbox(
        "User Timezone",
        key="timezone_selectbox",
        options=pytz.all_timezones,
        index=pytz.all_timezones.index(st.session_state["timezone"]),
        on_change=onchange_timezone,
    )

    st.markdown("---")

    deploy_ok = st.button(
        "Deploy",
        use_container_width=True,
        type="primary",
    )
    # Semantics preparation
    if deploy_ok:
        rerun_wren_engine(
            st.session_state["mdl_json"],
            st.session_state["dataset_type"],
            st.session_state["chosen_dataset"],
        )
        prepare_semantics(st.session_state["mdl_json"])

query = st.chat_input(
    "Ask a question about the database",
    disabled=st.session_state["semantics_preparation_status"] != "finished",
)

if query:
    if st.session_state["asks_results"] and st.session_state["asks_details_result"]:
        st.session_state["query_history"] = {
            "sql": st.session_state["chosen_query_result"]["sql"],
            "steps": st.session_state["asks_details_result"]["steps"],
        }
    else:
        st.session_state["query_history"] = None

    # reset relevant session_states
    st.session_state["asks_results"] = None
    st.session_state["asks_results_type"] = None
    st.session_state["chosen_query_result"] = None
    st.session_state["asks_details_result"] = None
    st.session_state["preview_data_button_index"] = None
    st.session_state["preview_sql"] = None

    ask(query, st.session_state["timezone"], st.session_state["query_history"])
if st.session_state["asks_results"]:
    show_asks_results()

    chosen_tab_id = stx.tab_bar(
        data=[
            stx.TabBarItemData(id=1, title="Answer", description=""),
            stx.TabBarItemData(id=2, title="SQL Details", description=""),
            stx.TabBarItemData(id=3, title="Chart", description=""),
        ],
        default=st.session_state["chosen_tab_id"],
    )
    st.session_state["chosen_tab_id"] = chosen_tab_id

    if chosen_tab_id == "1":
        if st.session_state["chosen_query_result"]:
            st.markdown("### Data Answer")
            get_sql_answer(
                st.session_state["chosen_query_result"]["query"],
                st.session_state["chosen_query_result"]["sql"],
                st.session_state["dataset_type"],
                st.session_state["mdl_json"],
            )

            st.markdown("### Data Preview")
            st.dataframe(
                get_data_from_wren_engine(
                    st.session_state["chosen_query_result"]["sql"],
                    st.session_state["dataset_type"],
                    st.session_state["mdl_json"],
                )
            )
    elif chosen_tab_id == "2":
        if st.session_state["chosen_query_result"]:
            ask_details_result = ask_details()
            if ask_details_response := ask_details_result.get("response"):
                st.session_state["asks_details_result"] = ask_details_response
                st.session_state["sql_explanation_question"] = None
                st.session_state["sql_explanation_steps_with_analysis"] = None
                st.session_state["sql_analysis_results"] = None
                st.session_state["sql_explanation_results"] = None
            else:
                st.error(
                    f'An error occurred while processing the query: {ask_details_result.get("error")}',
                    icon="🚨",
                )
            if st.session_state["asks_details_result"]:
                show_asks_details_results()
    else:
        if st.session_state["chosen_query_result"]:
            chart_response = generate_chart(
                query=st.session_state["chosen_query_result"]["query"],
                sql=st.session_state["chosen_query_result"]["sql"],
                language=st.session_state["language"],
                dataset_type=st.session_state["dataset_type"],
                manifest=st.session_state["mdl_json"],
                limit=500,
            )
            if chart_result := chart_response.get("response"):
                if chart_type := chart_result["chart_type"]:
                    st.markdown(f"### Chart Type: {chart_type}")
                if reasoning := chart_result["reasoning"]:
                    st.markdown("### Reasoning for making this chart")
                    st.markdown(f"{reasoning}")
                if vega_lite_schema := chart_result["chart_schema"]:
                    st.markdown("### Vega-Lite Schema")
                    st.json(vega_lite_schema, expanded=False)
                    st.vega_lite_chart(vega_lite_schema, use_container_width=True)

                    st.button(
                        "Adjust Chart",
                        on_click=on_click_adjust_chart,
                        kwargs={
                            "query": st.session_state["chosen_query_result"]["query"],
                            "sql": st.session_state["chosen_query_result"]["sql"],
                            "chart_schema": vega_lite_schema,
                            "chart_type": chart_type,
                            "language": st.session_state["language"],
                            "reasoning": chart_result["reasoning"],
                            "dataset_type": st.session_state["dataset_type"],
                            "manifest": st.session_state["mdl_json"],
                            "limit": 500,
                        },
                    )
            else:
                st.error(
                    f'An error occurred while processing the query: {chart_response.get("error")}',
                    icon="🚨",
                )
