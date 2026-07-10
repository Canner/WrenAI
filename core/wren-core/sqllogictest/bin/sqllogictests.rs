// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
#[cfg(target_family = "windows")]
use std::thread;

use clap::Parser;
use futures::stream::StreamExt;
use log::info;
use sqllogictest::strict_column_validator;
use wren_sqllogictest::{engine::DataFusion, TestContext};

use datafusion::common::runtime::SpawnedTask;
use datafusion::common::{exec_err, DataFusionError, Result};
use wren_sqllogictest::engine::utils::read_dir_recursive;

const TEST_DIRECTORY: &str = "test_files/";

#[cfg(target_family = "windows")]
pub fn main() {
    // Tests from `tpch/tpch.slt` fail with stackoverflow with the default stack size.
    thread::Builder::new()
        .stack_size(2 * 1024 * 1024) // 2 MB
        .spawn(move || {
            tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(async { run_tests().await })
                .unwrap()
        })
        .unwrap()
        .join()
        .unwrap();
}

#[tokio::main]
#[cfg(not(target_family = "windows"))]
pub async fn main() -> Result<()> {
    run_tests().await
}

// Trailing whitespace from lines in SLT will typically be removed, but do not fail if it is not
// If particular test wants to cover trailing whitespace on a value,
// it should project additional non-whitespace column on the right.
#[allow(clippy::ptr_arg)]
fn value_normalizer(s: &String) -> String {
    s.trim_end().to_string()
}

/// Sets up an empty directory at test_files/scratch/<name>
/// creating it if needed and clearing any file contents if it exists
/// This allows tests for inserting to external tables or copy to
/// to persist data to disk and have consistent state when running
/// a new test
fn setup_scratch_dir(name: &Path) -> Result<()> {
    let file_stem = name.file_stem().expect("File should have a stem");
    let path = PathBuf::from(TEST_DIRECTORY)
        .join("scratch")
        .join(file_stem);

    info!("Creating scratch dir in {path:?}");
    if path.exists() {
        fs::remove_dir_all(&path)?;
    }
    fs::create_dir_all(&path)?;
    Ok(())
}

async fn run_tests() -> Result<()> {
    // Enable logging (e.g. set RUST_LOG=debug to see debug logs)
    env_logger::init();

    let options: Options = Parser::parse();
    options.warn_on_ignored();

    // Run all tests in parallel, reporting failures at the end
    //
    // Doing so is safe because each slt file runs with its own
    // `SessionContext` and should not have side effects (like
    // modifying shared state like `/tmp/`)
    let errors: Vec<_> = futures::stream::iter(read_test_files(&options)?)
        .map(|test_file| {
            SpawnedTask::spawn(async move {
                println!("Running {:?}", test_file.relative_path);
                if options.complete {
                    run_complete_file(test_file).await?;
                } else {
                    run_test_file(test_file).await?;
                }
                Ok(()) as Result<()>
            })
            .join()
        })
        // run up to num_cpus streams in parallel
        .buffer_unordered(num_cpus::get())
        .flat_map(|result| {
            // Filter out any Ok() leaving only the DataFusionErrors
            futures::stream::iter(match result {
                // Tokio panic error
                Err(e) => Some(DataFusionError::External(Box::new(e))),
                Ok(thread_result) => thread_result.err(),
            })
        })
        .collect()
        .await;

    // report on any errors
    if !errors.is_empty() {
        for e in &errors {
            println!("{e}");
        }
        exec_err!("{} failures", errors.len())
    } else {
        Ok(())
    }
}

async fn run_test_file(test_file: TestFile) -> Result<()> {
    let TestFile {
        path,
        relative_path,
    } = test_file;
    info!("Running with DataFusion runner: {}", path.display());
    let Some(test_ctx) = TestContext::try_new_for_test_file(&relative_path).await else {
        info!("Skipping: {}", path.display());
        return Ok(());
    };
    let test_ctx = Arc::new(test_ctx);
    setup_scratch_dir(&relative_path)?;
    let mut runner = sqllogictest::Runner::new(|| async {
        Ok(DataFusion::new(
            Arc::clone(&test_ctx),
            relative_path.clone(),
        ))
    });
    runner.with_column_validator(strict_column_validator);
    runner
        .run_file_async(path)
        .await
        .map_err(|e| DataFusionError::External(Box::new(e)))
}

async fn run_complete_file(test_file: TestFile) -> Result<()> {
    let TestFile {
        path,
        relative_path,
    } = test_file;
    use sqllogictest::default_validator;

    info!("Using complete mode to complete: {}", path.display());
    let Some(test_ctx) = TestContext::try_new_for_test_file(&relative_path).await else {
        info!("Skipping: {}", path.display());
        return Ok(());
    };
    let test_ctx = Arc::new(test_ctx);
    setup_scratch_dir(&relative_path)?;
    let mut runner = sqllogictest::Runner::new(|| async {
        Ok(DataFusion::new(
            Arc::clone(&test_ctx),
            relative_path.clone(),
        ))
    });
    let col_separator = " ";
    runner
        .update_test_file(
            path,
            col_separator,
            default_validator,
            value_normalizer,
            strict_column_validator,
        )
        .await
        // Can't use e directly because it isn't marked Send, so turn it into a string.
        .map_err(|e| {
            DataFusionError::Execution(format!("Error completing {relative_path:?}: {e}"))
        })
}

/// Represents a parsed test file
#[derive(Debug)]
struct TestFile {
    /// The absolute path to the file
    pub path: PathBuf,
    /// The relative path of the file (used for display)
    pub relative_path: PathBuf,
}

impl TestFile {
    fn new(path: PathBuf) -> Self {
        let relative_path = PathBuf::from(
            path.to_string_lossy()
                .strip_prefix(TEST_DIRECTORY)
                .unwrap_or(""),
        );

        Self {
            path,
            relative_path,
        }
    }

    fn is_slt_file(&self) -> bool {
        self.path.extension() == Some(OsStr::new("slt"))
    }
}

fn read_test_files<'a>(
    options: &'a Options,
) -> Result<Box<dyn Iterator<Item = TestFile> + 'a>> {
    Ok(Box::new(
        read_dir_recursive(TEST_DIRECTORY)?
            .into_iter()
            .map(TestFile::new)
            .filter(|f| options.check_test_file(&f.relative_path))
            .filter(|f| f.is_slt_file()),
    ))
}

/// Parsed command line options
///
/// This structure attempts to mimic the command line options
/// accepted by IDEs such as CLion that pass arguments
///
/// See <https://github.com/apache/datafusion/issues/8287> for more details
#[derive(Parser, Debug)]
#[clap(author, version, about, long_about= None)]
struct Options {
    #[clap(long, help = "Auto complete mode to fill out expected results")]
    complete: bool,

    #[clap(long, env = "INCLUDE_TPCH", help = "Include tpch files")]
    include_tpch: bool,

    #[clap(
        action,
        help = "regex like arguments passed to the program which are treated as cargo test filter (substring match on filenames)"
    )]
    filters: Vec<String>,

    #[clap(
        long,
        help = "IGNORED (for compatibility with built in rust test runner)"
    )]
    format: Option<String>,

    #[clap(
        short = 'Z',
        long,
        help = "IGNORED (for compatibility with built in rust test runner)"
    )]
    z_options: Option<String>,

    #[clap(
        long,
        help = "IGNORED (for compatibility with built in rust test runner)"
    )]
    show_output: bool,
}

impl Options {
    /// Because this test can be run as a cargo test, commands like
    ///
    /// ```shell
    /// cargo test foo
    /// ```
    ///
    /// Will end up passing `foo` as a command line argument.
    ///
    /// To be compatible with this, treat the command line arguments as a
    /// filter and that does a substring match on each input.  returns
    /// true f this path should be run
    fn check_test_file(&self, relative_path: &Path) -> bool {
        if self.filters.is_empty() {
            return true;
        }

        // otherwise check if any filter matches
        self.filters
            .iter()
            .any(|filter| relative_path.to_string_lossy().contains(filter))
    }

    /// Logs warning messages to stdout if any ignored options are passed
    fn warn_on_ignored(&self) {
        if self.format.is_some() {
            println!("WARNING: Ignoring `--format` compatibility option");
        }

        if self.z_options.is_some() {
            println!("WARNING: Ignoring `-Z` compatibility option");
        }

        if self.show_output {
            println!("WARNING: Ignoring `--show-output` compatibility option");
        }
    }
}
