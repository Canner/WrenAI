"""Offline contracts for the actual metadata script used by the release workflow."""

import hashlib
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile


SCRIPT = Path(__file__).with_name("managed-wren-release.py")


class ReleaseMetadataTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.release = Path(self.temporary.name)
        (self.release / "wheels").mkdir()
        self.responses = {}

    def wheel(self, name, license_headers="", extra_headers="", extra_metadata=False):
        filename = name + "-1.0-py3-none-any.whl"
        target = self.release / "wheels" / filename
        metadata = (
            "Metadata-Version: 2.4\nName: " + name + "\nVersion: 1.0\n"
            + extra_headers + license_headers
            + "\n\nName: spoofed\nVersion: 9.9\nLicense: SPOOFED\n"
        )
        with zipfile.ZipFile(target, "w") as archive:
            archive.writestr(name + "-1.0.dist-info/METADATA", metadata)
            if extra_metadata:
                archive.writestr("extra-1.0.dist-info/METADATA", metadata)
        sha = hashlib.sha256(target.read_bytes()).hexdigest()
        url = "https://pypi.org/pypi/" + name + "/1.0/json"
        self.responses[url] = {"urls": [{
            "url": "https://files.pythonhosted.org/fixture/" + filename,
            "filename": filename, "digests": {"sha256": sha},
        }]}

    def fake_urlopen(self, url, timeout):
        self.assertEqual(timeout, 30)
        self.assertIn(url, self.responses, "unexpected source identity")
        return io.BytesIO(json.dumps(self.responses[url]).encode())

    def inventory(self):
        with patch("urllib.request.urlopen", side_effect=self.fake_urlopen), patch.object(
            sys, "argv", [str(SCRIPT), "wheels", "--release-dir", str(self.release)]
        ):
            runpy.run_path(str(SCRIPT), run_name="__main__")

    def cli(self, command, **kwargs):
        return subprocess.run(
            [sys.executable, "-B", str(SCRIPT), command, "--release-dir", str(self.release)],
            capture_output=True, text=True, **kwargs,
        )

    def test_header_boundaries_and_license_variants(self):
        headers = {
            "modern": "License-Expression: MIT OR Apache-2.0\nLicense: ignored",
            "folded": "License: first line\n  second line",
            "classified": "License: UNKNOWN\nClassifier: Topic :: Database\n"
                          "Classifier: License :: OSI Approved :: MIT License\n"
                          "Classifier: License :: OSI Approved :: BSD License",
            "repeated": "License: first\nLicense: second",
            "unknown": "",
        }
        for name, value in headers.items():
            self.wheel(name, value)
        self.inventory()
        rows = json.loads((self.release / "wheel-inputs.json").read_text())
        licenses = {row["distribution"]: row["license"] for row in rows}
        self.assertEqual(licenses["modern"], "MIT OR Apache-2.0")
        self.assertRegex(licenses["folded"], r"first line\n\s+second line")
        self.assertEqual(licenses["repeated"], "first; second")
        self.assertEqual(licenses["classified"],
                         "License :: OSI Approved :: MIT License; License :: OSI Approved :: BSD License")
        self.assertEqual(licenses["unknown"], "UNKNOWN")
        self.assertEqual(len(rows), 5)
        self.assertTrue(all(row["version"] == "1.0" and "SPOOFED" not in row["license"] for row in rows))
        self.assertEqual(json.loads((self.release / "wheel-license-inventory.json").read_text()),
                         {"schema": 1, "wheels": rows})
        for row in rows:
            self.assertEqual(row["sha256"], hashlib.sha256(
                (self.release / "wheels" / row["filename"]).read_bytes()).hexdigest())
            self.assertEqual(row["sourceUrl"], "https://files.pythonhosted.org/fixture/" + row["filename"])

    def test_ambiguous_metadata_is_rejected_before_network(self):
        for extra_headers, license_headers, extra_metadata in [
            ("Name: duplicate\n", "", False),
            ("Version: 2.0\n", "", False),
            ("", "License-Expression: MIT\nLicense-Expression: BSD", False),
            ("", "", True),
        ]:
            with self.subTest(headers=(extra_headers, license_headers), extra_metadata=extra_metadata):
                self.wheel("sample", license_headers, extra_headers, extra_metadata)
                with patch("urllib.request.urlopen", side_effect=AssertionError("must not fetch")), patch.object(
                    sys, "argv", [str(SCRIPT), "wheels", "--release-dir", str(self.release)]
                ), self.assertRaises(SystemExit):
                    runpy.run_path(str(SCRIPT), run_name="__main__")
                self.assertFalse((self.release / "wheel-inputs.json").exists())

    def test_source_mismatch_cannot_emit_inventory(self):
        for field in ("filename", "sha256"):
            with self.subTest(field=field):
                self.wheel("sample")
                item = next(iter(self.responses.values()))["urls"][0]
                if field == "sha256":
                    item["digests"][field] = "f" * 64
                else:
                    item[field] = "different.whl"
                with self.assertRaisesRegex(SystemExit, "exact source identity"):
                    self.inventory()
                self.assertFalse((self.release / "wheel-inputs.json").exists())

    def test_pbs_cli_keeps_digest_and_marks_all_evidence_for_review(self):
        paths = "python/LICENSE\npython/lib/COPYING\npython/share/notice.txt\npython/bin/python\n"
        result = self.cli("pbs", input=paths, env={**os.environ, "PYTHON_SHA256": "e" * 64})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {
            "schema": 1, "archiveSha256": "e" * 64,
            "bundledLicenseEvidence": [
                {"path": p, "declaredLicense": "REVIEW_REQUIRED"}
                for p in paths.splitlines()[:3]
            ],
        })
        missing = self.cli("pbs", input=paths, env={k: v for k, v in os.environ.items() if k != "PYTHON_SHA256"})
        self.assertNotEqual(missing.returncode, 0)
        self.assertEqual(missing.stdout, "")

    def test_requirements_cli_preserves_exact_pins_and_hashes(self):
        rows = [
            {"distribution": "wrenai", "version": "0.13.0", "sha256": "a" * 64},
            {"distribution": "other_pkg", "version": "1.2.3", "sha256": "b" * 64},
        ]
        (self.release / "wheel-inputs.json").write_text(json.dumps(rows))
        result = self.cli("requirements")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.release / "requirements.txt").read_text(),
                         "wrenai==0.13.0 --hash=sha256:" + "a" * 64 + "\n"
                         + "other_pkg==1.2.3 --hash=sha256:" + "b" * 64 + "\n")


if __name__ == "__main__":
    unittest.main()
