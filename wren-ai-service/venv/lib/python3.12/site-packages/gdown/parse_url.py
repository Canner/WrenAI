import re
import urllib.parse
import warnings


def is_google_drive_url(url):
    parsed = urllib.parse.urlparse(url)
    return parsed.hostname in ["drive.google.com", "docs.google.com"]


def parse_url(url, warning=True):
    """Parse URLs especially for Google Drive links.

    file_id: ID of file on Google Drive.
    is_download_link: Flag if it is download link of Google Drive.
    """
    parsed = urllib.parse.urlparse(url)
    query = urllib.parse.parse_qs(parsed.query)
    is_gdrive = is_google_drive_url(url=url)
    is_download_link = parsed.path.endswith("/uc")

    if not is_gdrive:
        return is_gdrive, is_download_link

    file_id = None
    if "id" in query:
        file_ids = query["id"]
        if len(file_ids) == 1:
            file_id = file_ids[0]
    else:
        patterns = [
            r"^/file/d/(.*?)/(edit|view)$",
            r"^/file/u/[0-9]+/d/(.*?)/(edit|view)$",
            r"^/document/d/(.*?)/(edit|htmlview|view)$",
            r"^/document/u/[0-9]+/d/(.*?)/(edit|htmlview|view)$",
            r"^/presentation/d/(.*?)/(edit|htmlview|view)$",
            r"^/presentation/u/[0-9]+/d/(.*?)/(edit|htmlview|view)$",
            r"^/spreadsheets/d/(.*?)/(edit|htmlview|view)$",
            r"^/spreadsheets/u/[0-9]+/d/(.*?)/(edit|htmlview|view)$",
        ]
        for pattern in patterns:
            match = re.match(pattern, parsed.path)
            if match:
                file_id = match.groups()[0]
                break

    if warning and not is_download_link:
        warnings.warn(
            "You specified a Google Drive link that is not the correct link "
            "to download a file. You might want to try `--fuzzy` option "
            "or the following url: {url}".format(
                url="https://drive.google.com/uc?id={}".format(file_id)
            )
        )

    return file_id, is_download_link
