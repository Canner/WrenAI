use datafusion::error::Result;
use structopt::StructOpt;
use wren_benchmarks::wren;

#[derive(Debug, StructOpt)]
#[structopt(name = "WREN", about = "WREN Benchmarks.")]
enum WrenOpt {
    Benchmark(wren::run::RunOpt),
}

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();
    match WrenOpt::from_args() {
        WrenOpt::Benchmark(opt) => opt.run().await,
    }
}
