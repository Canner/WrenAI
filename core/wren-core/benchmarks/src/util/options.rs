use structopt::StructOpt;

// Common benchmark options (don't use doc comments otherwise this doc
// shows up in help files)
#[derive(Debug, StructOpt, Clone)]
pub struct CommonOpt {
    /// Number of iterations of each test run
    #[structopt(short = "i", long = "iterations", default_value = "3")]
    pub iterations: usize,
}
