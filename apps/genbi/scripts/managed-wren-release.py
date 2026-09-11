"""Build managed-runtime review metadata; this script never approves or publishes."""

import argparse
import email.parser
import hashlib
import json
import os
from pathlib import Path
import sys
import urllib.request
import zipfile


def wheel_inventory(release):
    rows = []
    for wheel in sorted((release / "wheels").glob("*.whl")):
        with zipfile.ZipFile(wheel) as archive:
            entries = [n for n in archive.namelist() if n.endswith(".dist-info/METADATA")]
            if len(entries) != 1:
                raise SystemExit("wheel must have exactly one METADATA entry")
            meta = email.parser.BytesParser().parsebytes(archive.read(entries[0]))
        if len(meta.get_all("Name", [])) != 1 or len(meta.get_all("Version", [])) != 1:
            raise SystemExit("wheel must declare one Name and Version")
        expressions = meta.get_all("License-Expression", [])
        if len(expressions) > 1:
            raise SystemExit("wheel has ambiguous License-Expression")
        licenses = [v for v in meta.get_all("License", []) if v.strip() and v.strip() != "UNKNOWN"]
        classifiers = [v for v in meta.get_all("Classifier", []) if v.startswith("License ::")]
        license_value = "; ".join(expressions or licenses or classifiers) or "UNKNOWN"
        sha256 = hashlib.sha256(wheel.read_bytes()).hexdigest()
        with urllib.request.urlopen(
            "https://pypi.org/pypi/{}/{}/json".format(meta["Name"], meta["Version"]),
            timeout=30,
        ) as response:
            source_release = json.load(response)
        source = next(
            (item["url"] for item in source_release["urls"]
             if item["filename"] == wheel.name and item["digests"]["sha256"] == sha256),
            None,
        )
        if not source:
            raise SystemExit("could not establish exact source identity for " + wheel.name)
        rows.append({
            "filename": wheel.name,
            "sha256": sha256,
            "distribution": meta["Name"].lower().replace("-", "_"),
            "version": meta["Version"],
            "license": license_value,
            "sourceUrl": source,
        })
    (release / "wheel-inputs.json").write_text(json.dumps(rows))
    (release / "wheel-license-inventory.json").write_text(
        json.dumps({"schema": 1, "wheels": rows}, indent=2)
    )


def pbs_inventory(paths, archive_sha256):
    evidence = [
        p.strip() for p in paths
        if any(marker in p.upper() for marker in ("LICENSE", "COPYING", "NOTICE"))
    ]
    return {
        "schema": 1,
        "archiveSha256": archive_sha256,
        "bundledLicenseEvidence": [
            {"path": p, "declaredLicense": "REVIEW_REQUIRED"} for p in evidence
        ],
    }


def requirements(release):
    rows = json.loads((release / "wheel-inputs.json").read_text())
    (release / "requirements.txt").write_text("".join(
        "{}=={} --hash=sha256:{}\n".format(row["distribution"], row["version"], row["sha256"])
        for row in rows
    ))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("wheels", "pbs", "requirements"))
    parser.add_argument("--release-dir", type=Path, default=Path("release"))
    args = parser.parse_args()
    if args.command == "wheels":
        wheel_inventory(args.release_dir)
    elif args.command == "pbs":
        # stdin is the verified archive's tar listing, not extracted file contents.
        print(json.dumps(pbs_inventory(sys.stdin, os.environ["PYTHON_SHA256"]), indent=2))
    else:
        requirements(args.release_dir)


if __name__ == "__main__":
    main()
