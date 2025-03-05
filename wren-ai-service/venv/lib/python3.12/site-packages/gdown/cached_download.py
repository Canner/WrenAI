import hashlib
import os
import os.path as osp
import shutil
import sys
import tempfile
import warnings
from typing import Optional

import filelock

from .download import download

cache_root = osp.join(osp.expanduser("~"), ".cache/gdown")
if not osp.exists(cache_root):
    try:
        os.makedirs(cache_root)
    except OSError:
        pass


def md5sum(filename, blocksize=None):
    warnings.warn(
        "md5sum is deprecated and will be removed in the future.", FutureWarning
    )

    if blocksize is None:
        blocksize = 65536

    hash = hashlib.md5()
    with open(filename, "rb") as f:
        for block in iter(lambda: f.read(blocksize), b""):
            hash.update(block)
    return hash.hexdigest()


def assert_md5sum(filename, md5, quiet=False, blocksize=None):
    warnings.warn(
        "assert_md5sum is deprecated and will be removed in the future.", FutureWarning
    )

    if not (isinstance(md5, str) and len(md5) == 32):
        raise ValueError(f"MD5 must be 32 chars: {md5}")

    md5_actual = md5sum(filename)

    if md5_actual == md5:
        if not quiet:
            print(f"MD5 matches: {filename!r} == {md5!r}", file=sys.stderr)
        return True

    raise AssertionError(f"MD5 doesn't match:\nactual: {md5_actual}\nexpected: {md5}")


def cached_download(
    url=None,
    path=None,
    md5=None,
    quiet=False,
    postprocess=None,
    hash: Optional[str] = None,
    **kwargs,
):
    """Cached download from URL.

    Parameters
    ----------
    url: str
        URL. Google Drive URL is also supported.
    path: str, optional
        Output filename. Default is basename of URL.
    md5: str, optional
        Expected MD5 for specified file. Deprecated in favor of `hash`.
    quiet: bool
        Suppress terminal output. Default is False.
    postprocess: callable, optional
        Function called with filename as postprocess.
    hash: str, optional
        Hash value of file in the format of {algorithm}:{hash_value}
        such as sha256:abcdef.... Supported algorithms: md5, sha1, sha256, sha512.
    kwargs: dict
        Keyword arguments to be passed to `download`.

    Returns
    -------
    path: str
        Output filename.
    """
    if path is None:
        path = (
            url.replace("/", "-SLASH-")
            .replace(":", "-COLON-")
            .replace("=", "-EQUAL-")
            .replace("?", "-QUESTION-")
        )
        path = osp.join(cache_root, path)

    if md5 is not None and hash is not None:
        raise ValueError("md5 and hash cannot be specified at the same time.")

    if md5 is not None:
        warnings.warn(
            "md5 is deprecated in favor of hash. Please use hash='md5:xxx...' instead.",
            FutureWarning,
        )
        hash = f"md5:{md5}"
    del md5

    # check existence
    if osp.exists(path) and not hash:
        if not quiet:
            print(f"File exists: {path}", file=sys.stderr)
        return path
    elif osp.exists(path) and hash:
        try:
            _assert_filehash(path=path, hash=hash, quiet=quiet)
            return path
        except AssertionError as e:
            # show warning and overwrite if md5 doesn't match
            print(e, file=sys.stderr)

    # download
    lock_path = osp.join(cache_root, "_dl_lock")
    try:
        os.makedirs(osp.dirname(path))
    except OSError:
        pass
    temp_root = tempfile.mkdtemp(dir=cache_root)
    try:
        temp_path = osp.join(temp_root, "dl")

        log_message_hash = f"Hash: {hash}\n" if hash else ""
        download(
            url=url,
            output=temp_path,
            quiet=quiet,
            log_messages={
                "start": f"Cached downloading...\n{log_message_hash}",
                "output": f"To: {path}\n",
            },
            **kwargs,
        )
        with filelock.FileLock(lock_path):
            shutil.move(temp_path, path)
    except Exception:
        shutil.rmtree(temp_root)
        raise

    if hash:
        _assert_filehash(path=path, hash=hash, quiet=quiet)

    # postprocess
    if postprocess is not None:
        postprocess(path)

    return path


def _compute_filehash(path, algorithm):
    BLOCKSIZE = 65536

    if algorithm not in hashlib.algorithms_guaranteed:
        raise ValueError(
            f"Unsupported hash algorithm: {algorithm}. "
            f"Supported algorithms: {hashlib.algorithms_guaranteed}"
        )

    algorithm_instance = getattr(hashlib, algorithm)()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(BLOCKSIZE), b""):
            algorithm_instance.update(block)
    return f"{algorithm}:{algorithm_instance.hexdigest()}"


def _assert_filehash(path, hash, quiet=False, blocksize=None):
    if ":" not in hash:
        raise ValueError(
            f"Invalid hash: {hash}. "
            "Hash must be in the format of {algorithm}:{hash_value}."
        )
    algorithm = hash.split(":")[0]

    hash_actual = _compute_filehash(path=path, algorithm=algorithm)

    if hash_actual == hash:
        return True

    raise AssertionError(
        f"File hash doesn't match:\nactual: {hash_actual}\nexpected: {hash}"
    )
