# SQLite residual inventory (2026-04-10)

## Summary

- Product/runtime/dev path should be PostgreSQL-first.
- Remaining SQLite references are expected only in benchmark/eval tooling or repo/dependency metadata.
- Refresh with: `bash misc/scripts/inventory-sqlite-residuals.sh > docs/sqlite-residual-inventory.md`
- Guardrail with: `bash misc/scripts/check-sqlite-residuals.sh`
- Allowlist source: `misc/sqlite-residual-allowlist.txt`

## active runtime / dev / ops path
hit-count: 0
sample-files: none

## benchmark / eval tooling
hit-count: 48
sample-files:
- wren-ai-service/tools/eval_postgres_loader_smoke.py
- wren-ai-service/tests/pytest/eval/test_spider_database_adapter.py
- wren-ai-service/eval/preparation.py
- wren-ai-service/eval/utils.py
- wren-ai-service/eval/README.md
- wren-ai-service/eval/prediction.py
- wren-ai-service/eval/metrics/spider/database.py

## repo / dependency metadata
hit-count: 15
sample-files:
- wren-launcher/go.sum
- wren-ui/.dockerignore
- .gitignore
- wren-engine/ibis-server/poetry.lock
- wren-ai-service/poetry.lock
- wren-ui/yarn.lock
exact-matches:
- wren-launcher/go.sum:347:github.com/mattn/go-sqlite3 v1.6.0/go.mod h1:FPy6KqzDD04eiIsT53CuJW3U88zkxoIYsOqkbpncsNc=
- wren-ui/.dockerignore:8:*.sqlite
- wren-ui/.dockerignore:9:*.sqlite3
- .gitignore:53:# sqlite
- .gitignore:54:*.sqlite
- .gitignore:55:*.sqlite3
- wren-engine/ibis-server/poetry.lock:1792:sqlite = ["numpy (>=1.23.2,<3)", "pandas (>=1.5.3,<3)", "pyarrow (>=10.0.1)", "pyarrow-hotfix (>=0.4)", "regex (>=2021.7.6)", "rich (>=12.4.4)"]
- wren-engine/ibis-server/poetry.lock:2559:all = ["PyQt5 (>=5.15.9)", "SQLAlchemy (>=2.0.0)", "adbc-driver-postgresql (>=0.8.0)", "adbc-driver-sqlite (>=0.8.0)", "beautifulsoup4 (>=4.11.2)", "bottleneck (>=1.3.6)", "dataframe-api-compat (>=0.1.7)", "fastparquet (>=2022.12.0)", "fsspec (>=2022.11.0)", "gcsfs (>=2022.11.0)", "html5lib (>=1.1)", "hypothesis (>=6.46.1)", "jinja2 (>=3.1.2)", "lxml (>=4.9.2)", "matplotlib (>=3.6.3)", "numba (>=0.56.4)", "numexpr (>=2.8.4)", "odfpy (>=1.4.1)", "openpyxl (>=3.1.0)", "pandas-gbq (>=0.19.0)", "psycopg2 (>=2.9.6)", "pyarrow (>=10.0.1)", "pymysql (>=1.0.2)", "pyreadstat (>=1.2.0)", "pytest (>=7.3.2)", "pytest-xdist (>=2.2.0)", "python-calamine (>=0.1.7)", "pyxlsb (>=1.0.10)", "qtpy (>=2.3.0)", "s3fs (>=2022.11.0)", "scipy (>=1.10.0)", "tables (>=3.8.0)", "tabulate (>=0.9.0)", "xarray (>=2022.12.0)", "xlrd (>=2.0.1)", "xlsxwriter (>=3.0.5)", "zstandard (>=0.19.0)"]
- wren-engine/ibis-server/poetry.lock:2579:sql-other = ["SQLAlchemy (>=2.0.0)", "adbc-driver-postgresql (>=0.8.0)", "adbc-driver-sqlite (>=0.8.0)"]
- wren-engine/ibis-server/poetry.lock:3920:aiosqlite = ["aiosqlite", "greenlet (!=0.4.17)", "typing_extensions (!=3.10.0.1)"]
- wren-ai-service/poetry.lock:4167:all = ["PyQt5 (>=5.15.9)", "SQLAlchemy (>=2.0.0)", "adbc-driver-postgresql (>=0.8.0)", "adbc-driver-sqlite (>=0.8.0)", "beautifulsoup4 (>=4.11.2)", "bottleneck (>=1.3.6)", "dataframe-api-compat (>=0.1.7)", "fastparquet (>=2022.12.0)", "fsspec (>=2022.11.0)", "gcsfs (>=2022.11.0)", "html5lib (>=1.1)", "hypothesis (>=6.46.1)", "jinja2 (>=3.1.2)", "lxml (>=4.9.2)", "matplotlib (>=3.6.3)", "numba (>=0.56.4)", "numexpr (>=2.8.4)", "odfpy (>=1.4.1)", "openpyxl (>=3.1.0)", "pandas-gbq (>=0.19.0)", "psycopg2 (>=2.9.6)", "pyarrow (>=10.0.1)", "pymysql (>=1.0.2)", "pyreadstat (>=1.2.0)", "pytest (>=7.3.2)", "pytest-xdist (>=2.2.0)", "python-calamine (>=0.1.7)", "pyxlsb (>=1.0.10)", "qtpy (>=2.3.0)", "s3fs (>=2022.11.0)", "scipy (>=1.10.0)", "tables (>=3.8.0)", "tabulate (>=0.9.0)", "xarray (>=2022.12.0)", "xlrd (>=2.0.1)", "xlsxwriter (>=3.0.5)", "zstandard (>=0.19.0)"]
- wren-ai-service/poetry.lock:4187:sql-other = ["SQLAlchemy (>=2.0.0)", "adbc-driver-postgresql (>=0.8.0)", "adbc-driver-sqlite (>=0.8.0)"]
- wren-ai-service/poetry.lock:6257:aiosqlite = ["aiosqlite", "greenlet (>=1)", "typing_extensions (!=3.10.0.1)"]
- wren-ui/yarn.lock:9819:    better-sqlite3:
- wren-ui/yarn.lock:9829:    sqlite3:

## Notes

- Active runtime/dev/ops hits should stay at **0** after the PostgreSQL cutover.
- Eval hits are currently intentional: the Spider/BIRD benchmark artifacts and helper code still consume upstream SQLite datasets.
- Repo/dependency metadata hits come from ignore files, lockfiles, or upstream package/go checksum records and are not active runtime behavior.
