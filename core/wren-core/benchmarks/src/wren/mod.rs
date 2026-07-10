use datafusion::common::{plan_err, Result};
use std::fs;
use wren_core::mdl::manifest::Manifest;

pub mod run;

/// Get the SQL statements from the specified query file
pub fn get_query_sql(query_id: usize) -> Result<Vec<String>> {
    let possibilities = vec![
        format!("queries/q{query_id}.sql"),
        format!("benchmarks/queries/q{query_id}.sql"),
    ];
    let mut errors = vec![];
    for filename in possibilities {
        match fs::read_to_string(&filename) {
            Ok(contents) => {
                return Ok(contents
                    .split(';')
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
                    .collect());
            }
            Err(e) => errors.push(format!("{filename}: {e}")),
        };
    }
    plan_err!("invalid query. Could not find query: {:?}", errors)
}

fn get_manifest(query_id: usize) -> Result<Manifest> {
    let possibilities = vec![
        format!("mdls/q{query_id}.json"),
        format!("benchmarks/mdls/q{query_id}.json"),
    ];

    for filename in &possibilities {
        if let Ok(contents) = fs::read_to_string(filename) {
            let manifest: Manifest = serde_json::from_str(&contents).unwrap();
            return Ok(manifest);
        }
    }
    plan_err!("Could not find manifest file. Tried: {:?}", possibilities)
}
