#!/usr/bin/env bash
# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.

# This script is meant for developers of DataFusion -- it is runnable
# from the standard DataFusion development environment and uses cargo,
# etc and orchestrates gathering data and run the benchmark binary in
# different configurations.


# Exit on error
set -e

# https://stackoverflow.com/questions/59895/how-do-i-get-the-directory-where-a-bash-script-is-located-from-within-the-script
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )


# Set Defaults
COMMAND=
BENCHMARK=all
WREN_DIR=${WREN_DIR:-$SCRIPT_DIR/..}
CARGO_COMMAND=${CARGO_COMMAND:-"cargo run --release"}
VIRTUAL_ENV=${VIRTUAL_ENV:-$SCRIPT_DIR/venv}

usage() {
    echo "
Orchestrates running benchmarks against DataFusion checkouts

Usage:
$0 run [benchmark]
$0 compare <branch1> <branch2>
$0 venv

**********
Examples:
**********
# Run the 'tpch' benchmark on the datafusion checkout in /source/datafusion
WREN_DIR=/source/datafusion ./bench.sh run tpch

**********
* Commands
**********
run:          Runs the named benchmark
compare:      Compares results from benchmark runs
venv:         Creates new venv (unless already exists) and installs compare's requirements into it

**********
* Benchmarks
**********
all(default): Data/Run/Compare for all benchmarks
tpch:                   TPCH inspired benchmark on Scale Factor (SF) 1 (~1GB), single parquet file per table, hash join

**********
* Supported Configuration (Environment Variables)
**********
CARGO_COMMAND       command that runs the benchmark binary
WREN_DIR      directory to use (default $WREN_DIR)
RESULTS_NAME        folder where the benchmark files are stored
VENV_PATH           Python venv to use for compare and venv commands (default ./venv, override by <your-venv>/bin/activate)
"
    exit 1
}

# https://stackoverflow.com/questions/192249/how-do-i-parse-command-line-arguments-in-bash
POSITIONAL_ARGS=()

while [[ $# -gt 0 ]]; do
    case $1 in
        # -e|--extension)
        #   EXTENSION="$2"
        #   shift # past argument
        #   shift # past value
        #   ;;
        -h|--help)
            shift # past argument
            usage
            ;;
        -*)
            echo "Unknown option $1"
            exit 1
            ;;
        *)
            POSITIONAL_ARGS+=("$1") # save positional arg
            shift # past argument
            ;;
    esac
done

set -- "${POSITIONAL_ARGS[@]}" # restore positional parameters
COMMAND=${1:-"${COMMAND}"}
ARG2=$2
ARG3=$3

# Do what is requested
main() {
    # Command Dispatch
    case "$COMMAND" in
        run)
            # Parse positional parameters
            BENCHMARK=${ARG2:-"${BENCHMARK}"}
            BRANCH_NAME=$(cd "${WREN_DIR}" && git rev-parse --abbrev-ref HEAD)
            BRANCH_NAME=${BRANCH_NAME//\//_} # mind blowing syntax to replace / with _
            RESULTS_NAME=${RESULTS_NAME:-"${BRANCH_NAME}"}
            RESULTS_DIR=${RESULTS_DIR:-"$SCRIPT_DIR/results/$RESULTS_NAME"}

            # Optional query filter to run specific query
            QUERY=${ARG3}
            QUERY_ARG=$([ -n "$QUERY" ] && echo "--query ${QUERY}" || echo "")

            echo "***************************"
            echo "Wren Benchmark Script"
            echo "COMMAND: ${COMMAND}"
            echo "BENCHMARK: ${BENCHMARK}"
            echo "WREN_DIR: ${WREN_DIR}"
            echo "BRANCH_NAME: ${BRANCH_NAME}"
            echo "RESULTS_DIR: ${RESULTS_DIR}"
            echo "CARGO_COMMAND: ${CARGO_COMMAND}"
            echo "***************************"

            # navigate to the appropriate directory
            pushd "${WREN_DIR}/benchmarks" > /dev/null
            mkdir -p "${RESULTS_DIR}"
            case "$BENCHMARK" in
                all)
                    run_tpch "1"
                    run_wren
                    ;;
                tpch)
                    run_tpch "1"
                    ;;
                wren)
                    run_wren
                    ;;
                *)
                    echo "Error: unknown benchmark '$BENCHMARK' for run"
                    usage
                    ;;
            esac
            popd > /dev/null
            echo "Done"
            ;;
        compare)
            compare_benchmarks "$ARG2" "$ARG3"
            ;;
        venv)
            setup_venv
            ;;
        "")
            usage
            ;;
        *)
            echo "Error: unknown command: $COMMAND"
            usage
            ;;
    esac
}


# Runs the tpch benchmark
run_tpch() {
    RESULTS_FILE="${RESULTS_DIR}/tpch.json"
    echo "RESULTS_FILE: ${RESULTS_FILE}"
    echo "Running tpch benchmark..."
    $CARGO_COMMAND --bin tpch -- benchmark -i 10 -o "${RESULTS_FILE}" ${QUERY_ARG}
}

# Runs wren benchmark
run_wren() {
    RESULTS_FILE="${RESULTS_DIR}/wren.json"
    echo "RESULTS_FILE: ${RESULTS_FILE}"
    echo "Running wren benchmark..."
    $CARGO_COMMAND --bin wren -- benchmark -i 10 -o "${RESULTS_FILE}" ${QUERY_ARG}
}




compare_benchmarks() {
    BASE_RESULTS_DIR="${SCRIPT_DIR}/results"
    BRANCH1="$1"
    BRANCH2="$2"
    if [ -z "$BRANCH1" ] ; then
        echo "<branch1> not specified. Available branches:"
        ls -1 "${BASE_RESULTS_DIR}"
        exit 1
    fi

    if [ -z "$BRANCH2" ] ; then
        echo "<branch2> not specified"
        ls -1 "${BASE_RESULTS_DIR}"
        exit 1
    fi

    echo "Comparing ${BRANCH1} and ${BRANCH2}"
    for RESULTS_FILE1 in "${BASE_RESULTS_DIR}/${BRANCH1}"/*.json ; do
	BENCH=$(basename "${RESULTS_FILE1}")
        RESULTS_FILE2="${BASE_RESULTS_DIR}/${BRANCH2}/${BENCH}"
        if test -f "${RESULTS_FILE2}" ; then
            echo "--------------------"
            echo "Benchmark ${BENCH}"
            echo "--------------------"
            PATH=$VIRTUAL_ENV/bin:$PATH python3 "${SCRIPT_DIR}"/compare.py "${RESULTS_FILE1}" "${RESULTS_FILE2}"
        else
            echo "Note: Skipping ${RESULTS_FILE1} as ${RESULTS_FILE2} does not exist"
        fi
    done

}

setup_venv() {
    python3 -m venv "$VIRTUAL_ENV"
    PATH=$VIRTUAL_ENV/bin:$PATH python3 -m pip install -r requirements.txt
}

# And start the process up
main
