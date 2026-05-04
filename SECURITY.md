# Security Policy

## Reporting a Vulnerability

If you believe you have found a security vulnerability in any Canner-owned repository, please report it to us through coordinated disclosure.

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Instead, please send an email to `contact@cannerdata.com`.

Please include as much of the information listed below as you can to help us better understand and resolve the issue:

- The type of issue (e.g., buffer overflow, SQL injection, cross-site scripting)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

This information will help us triage your report more quickly.

## Supported versions

Security fixes are issued only for the most recent minor release of each published package (`wren-engine`, `wren-core`, `wren-core-wasm`). Older releases may be patched on a best-effort basis.

The historical WrenAI GenBI app (preserved on `legacy/v1`, tag `v1-final`) is **not** receiving security updates beyond the freeze. Use the maintained [`main`](https://github.com/Canner/WrenAI/tree/main) branch for new deployments.
