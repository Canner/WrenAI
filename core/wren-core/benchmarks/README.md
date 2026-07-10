# Wren Core Benchmarks

This crate contains benchmarks for the Wren core library, based on industry-standard open source benchmarks, designed to help measure and improve the performance of Wren core.

# Supported Benchmarks

## TPC-H

The TPC-H benchmark measures query performance using standard decision support queries.

This benchmark is derived from the [TPC-H][1] version [2.17.1]. The data and reference answers are generated using `tpch-gen` from [2].

[1]: http://www.tpc.org/tpch/
[2]: https://github.com/databricks/tpch-dbgen.git
[2.17.1]: https://www.tpc.org/tpc_documents_current_versions/pdf/tpc-h_v2.17.1.pdf

## Wren

This benchmark is used to collect complex SQL test cases for Wren AI performance evaluation.

- **`q1`**: A complex SQL query featuring multiple CTEs (Common Table Expressions) and subqueries, designed to test complex query planning and optimization.
- **`q2`**: Similar to `q1` but includes an additional `UNION` clause to test query rewriting and optimization with set operations.

# Running the Benchmarks

## Quick Start with `bench.sh`

The easiest way to run benchmarks is using the [bench.sh](bench.sh) script. To see all available options and usage instructions:

```shell
# Show usage information
./bench.sh
```

## Performance Comparison Between Branches

To compare the performance between the main branch and a feature branch:

```shell
# Switch to main branch and gather baseline data
git checkout main
./benchmarks/bench.sh run tpch

# Switch to your feature branch and gather comparison data
git checkout mybranch
./benchmarks/bench.sh run tpch

# Compare results between the two branches
./bench.sh compare main mybranch
```

The comparison will produce a detailed performance report like this:

```shell
Comparing main and mybranch
--------------------
Benchmark tpch.json
--------------------
┏━━━━━━━━━━━━━━┳━━━━━━━━━┳━━━━━━━━━┳━━━━━━━━━━━┓
┃ Query        ┃    main ┃mybranch ┃    Change ┃
┡━━━━━━━━━━━━━━╇━━━━━━━━━╇━━━━━━━━━╇━━━━━━━━━━━┩
│ QQuery 1     │  4.25ms │  4.26ms │ no change │
│ QQuery 2     │ 11.25ms │ 11.68ms │ no change │
│ QQuery 3     │  5.03ms │  4.97ms │ no change │
│ QQuery 4     │  3.43ms │  3.46ms │ no change │
│ QQuery 5     │  7.39ms │  7.28ms │ no change │
│ QQuery 6     │  2.26ms │  2.26ms │ no change │
│ QQuery 7     │  8.53ms │  8.51ms │ no change │
│ QQuery 8     │  9.90ms │  9.99ms │ no change │
│ QQuery 9     │  8.56ms │  8.27ms │ no change │
│ QQuery 10    │  7.37ms │  7.63ms │ no change │
│ QQuery 11    │  7.06ms │  7.00ms │ no change │
│ QQuery 12    │  4.35ms │  4.19ms │ no change │
│ QQuery 13    │  2.93ms │  2.88ms │ no change │
│ QQuery 14    │  3.34ms │  3.33ms │ no change │
│ QQuery 15    │  6.51ms │  6.49ms │ no change │
│ QQuery 16    │  4.59ms │  4.64ms │ no change │
│ QQuery 17    │  4.00ms │  4.05ms │ no change │
│ QQuery 18    │  5.46ms │  5.47ms │ no change │
│ QQuery 19    │  5.84ms │  5.72ms │ no change │
│ QQuery 20    │  7.22ms │  7.33ms │ no change │
│ QQuery 21    │  9.35ms │  9.19ms │ no change │
│ QQuery 22    │  4.54ms │  4.33ms │ no change │
└──────────────┴─────────┴─────────┴───────────┘
┏━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━┓
┃ Benchmark Summary      ┃          ┃
┡━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━┩
│ Total Time (main)      │ 133.16ms │
│ Total Time (mybranch)  │ 132.92ms │
│ Average Time (main)    │   6.05ms │
│ Average Time (mybranch)│   6.04ms │
│ Queries Faster         │        0 │
│ Queries Slower         │        0 │
│ Queries with No Change │       22 │
└────────────────────────┴──────────┘
```

## Running Benchmarks Manually

For more control over benchmark execution, you can run individual benchmarks directly using Cargo:

```bash
# Run TPC-H benchmark for query 1 with 10 iterations, output to JSON
cargo run --release --bin tpch -- benchmark --query 1 -i 10 -o result.json

# Run all TPC-H queries
cargo run --release --bin tpch -- benchmark --all-queries -i 5

# Run Wren-specific benchmarks
cargo run --release --bin wren -- benchmark --query 1 -i 10
```

### Command Line Options

- `--query <number>`: Run a specific query (TPC-H: 1-22, Wren: 1-2)
- `-i, --iterations <number>`: Number of iterations to run (default: 1)
- `-o, --output <file>`: Output results to JSON file
- `--all-queries`: Run all available queries in the benchmark suite


## Project Structure

```
benchmarks/
├── bench.sh              # Main benchmark runner script
├── data/                 # Generated benchmark data
├── results/              # Benchmark results and comparisons
├── src/
│   ├── tpch/            # TPC-H benchmark implementation
│   └── wren/            # Wren-specific benchmark queries
└── Cargo.toml           # Dependencies and build configuration
```

