use datafusion::error::Result;
use structopt::StructOpt;
use wren_benchmarks::tpch;

#[derive(Debug, StructOpt)]
#[structopt(name = "TPC-H", about = "TPC-H Benchmarks.")]
enum TpchOpt {
    Benchmark(tpch::run::RunOpt),
}

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();
    match TpchOpt::from_args() {
        TpchOpt::Benchmark(opt) => opt.run().await,
    }
}
