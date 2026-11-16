"""Prepare a fresh synthetic project for the loopback scripted-provider test."""

import argparse
import runpy
from pathlib import Path
from urllib.parse import urlparse

import yaml

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("destination", type=Path)
parser.add_argument("endpoint")
args = parser.parse_args()
url = urlparse(args.endpoint)
assert url.scheme == "http" and url.hostname == "127.0.0.1" and url.port
assert not url.username and not url.password and not url.query and not url.fragment
destination = args.destination.resolve()
prepare = Path(__file__).resolve().parents[1] / "p1/prepare.py"
runpy.run_path(str(prepare))["prepare"](destination)
config_path = destination / "project/service.yml"
config = yaml.safe_load(config_path.read_text())
config["private_model"]["base_url"] = args.endpoint
config["private_model"]["id"] = "nvidia/nemotron-scripted"
config["private_model"]["credential_env"] = "HARNESS_EVAL_KEY"
config["audit_path"] = str(destination / "audit.jsonl")
config["execution"]["thinking"] = "off"
config["execution"]["max_tokens"] = 4096
config_path.write_text(yaml.safe_dump(config, sort_keys=False))
