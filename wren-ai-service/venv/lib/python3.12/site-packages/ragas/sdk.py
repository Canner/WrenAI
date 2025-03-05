"""
SDK module for interacting with the Ragas API service.
"""

import os
from functools import lru_cache

import requests

from ragas._version import __version__
from ragas.exceptions import UploadException

# endpoint for uploading results
RAGAS_API_URL = "https://api.ragas.io"
RAGAS_APP_URL = "https://app.ragas.io"
RAGAS_API_SOURCE = "ragas_py"


@lru_cache(maxsize=1)
def get_app_token() -> str:
    app_token = os.environ.get("RAGAS_APP_TOKEN")
    if app_token is None:
        raise ValueError("RAGAS_APP_TOKEN is not set")
    return app_token


@lru_cache(maxsize=1)
def get_api_url() -> str:
    return os.environ.get("RAGAS_API_URL", RAGAS_API_URL)


@lru_cache(maxsize=1)
def get_app_url() -> str:
    return os.environ.get("RAGAS_APP_URL", RAGAS_APP_URL)


def upload_packet(path: str, data_json_string: str):
    app_token = get_app_token()
    base_url = get_api_url()

    response = requests.post(
        f"{base_url}/api/v1{path}",
        data=data_json_string,
        headers={
            "Content-Type": "application/json",
            "x-app-token": app_token,
            "x-source": RAGAS_API_SOURCE,
            "x-app-version": __version__,
        },
    )
    check_api_response(response)
    return response


def check_api_response(response: requests.Response) -> None:
    """
    Check API response status and raise appropriate exceptions

    Parameters
    ----------
    response : requests.Response
        Response object from API request

    Raises
    ------
    UploadException
        If authentication fails or other API errors occur
    """
    if response.status_code == 403:
        raise UploadException(
            status_code=response.status_code,
            message="AUTHENTICATION_ERROR: The app token is invalid. Please check your RAGAS_APP_TOKEN environment variable.",
        )

    try:
        response.raise_for_status()
    except requests.exceptions.HTTPError:
        error_msg = ""
        try:
            error_data = response.json()
            if "message" in error_data:
                error_msg += f"\nAPI Message: {error_data['message']}"
            if "debug_error_info" in error_data:
                error_msg += f"\nDebug Info: {error_data['debug_error_info']}"
        except Exception as _e:
            error_msg = f"\nStatus Code: {response.status_code}"

        raise UploadException(
            status_code=response.status_code, message=f"Request failed: {error_msg}"
        )


def build_evaluation_app_url(app_url: str, run_id: str) -> str:
    return f"{app_url}/dashboard/alignment/evaluation/{run_id}"
