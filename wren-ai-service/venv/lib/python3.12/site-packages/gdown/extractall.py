import os.path as osp
import tarfile
import zipfile


def extractall(path, to=None):
    """Extract archive file.

    Parameters
    ----------
    path: str
        Path of archive file to be extracted.
    to: str, optional
        Directory to which the archive file will be extracted.
        If None, it will be set to the parent directory of the archive file.
    """
    if to is None:
        to = osp.dirname(path)

    if path.endswith(".zip"):
        opener, mode = zipfile.ZipFile, "r"
    elif path.endswith(".tar"):
        opener, mode = tarfile.open, "r"
    elif path.endswith(".tar.gz") or path.endswith(".tgz"):
        opener, mode = tarfile.open, "r:gz"
    elif path.endswith(".tar.bz2") or path.endswith(".tbz"):
        opener, mode = tarfile.open, "r:bz2"
    else:
        raise ValueError(
            "Could not extract '%s' as no appropriate " "extractor is found" % path
        )

    def namelist(f):
        if isinstance(f, zipfile.ZipFile):
            return f.namelist()
        return [m.path for m in f.members]

    def filelist(f):
        files = []
        for fname in namelist(f):
            fname = osp.join(to, fname)
            files.append(fname)
        return files

    with opener(path, mode) as f:
        f.extractall(path=to)

    return filelist(f)
