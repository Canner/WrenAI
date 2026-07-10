use crate::util::options::CommonOpt;
use crate::util::run::BenchmarkRun;
use crate::wren::get_manifest;
use crate::wren::get_query_sql;
use datafusion::common::Result;
use datafusion::prelude::SessionContext;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use structopt::StructOpt;
use wren_core::mdl::context::Mode;
use wren_core::mdl::{transform_sql_with_ctx, AnalyzedWrenMDL};

#[derive(Debug, StructOpt, Clone)]
#[structopt(verbatim_doc_comment)]
pub struct RunOpt {
    /// Query number. If not specified, runs all queries
    #[structopt(short, long)]
    query: Option<usize>,
    /// Common options
    #[structopt(flatten)]
    common: CommonOpt,

    /// Path to machine readable output file
    #[structopt(parse(from_os_str), short = "o", long = "output")]
    output_path: Option<PathBuf>,
}

const QUERY_START_ID: usize = 1;
const QUERY_END_ID: usize = 2;

impl RunOpt {
    pub async fn run(self) -> Result<()> {
        println!("Running benchmarks with the following options: {self:?}");
        let query_range = match self.query {
            Some(query_id) => query_id..=query_id,
            None => QUERY_START_ID..=QUERY_END_ID,
        };

        let mut benchmark_run = BenchmarkRun::new();

        for query_id in query_range {
            benchmark_run.start_new_case(&format!("Query {query_id}"));
            let query_run = self.benchmark_query(query_id).await?;
            for iter in query_run {
                benchmark_run.write_iter(iter.elapsed);
            }
        }
        benchmark_run.maybe_write_json(self.output_path.as_ref())?;
        Ok(())
    }

    async fn benchmark_query(&self, query_id: usize) -> Result<Vec<QueryResult>> {
        let ctx = SessionContext::new();

        // run benchmark
        let mut query_results = vec![];
        let iterations = self.iterations();
        if iterations == 0 {
            return Ok(vec![]);
        }
        for i in 0..self.iterations() {
            let mdl = Arc::new(AnalyzedWrenMDL::analyze(
                get_manifest(query_id)?,
                Arc::new(HashMap::default()),
                Mode::Unparse,
            )?);
            let start = Instant::now();
            let sql = &get_query_sql(query_id)?;
            for query in sql {
                transform_sql_with_ctx(
                    &ctx,
                    Arc::clone(&mdl),
                    &[],
                    HashMap::new().into(),
                    query,
                )
                .await?;
            }

            let elapsed = start.elapsed(); //.as_secs_f64() * 1000.0;
            let ms = elapsed.as_secs_f64() * 1000.0;
            println!("Query {query_id} iteration {i} took {ms:.1} ms");
            query_results.push(QueryResult { elapsed });
        }

        let avg = query_results
            .iter()
            .map(|r| r.elapsed.as_secs_f64() * 1000.0)
            .sum::<f64>()
            / query_results.len() as f64;
        println!("Query {query_id} avg time: {avg:.2} ms");

        Ok(query_results)
    }

    fn iterations(&self) -> usize {
        self.common.iterations
    }
}

struct QueryResult {
    elapsed: std::time::Duration,
}
