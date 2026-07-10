use std::sync::Arc;

use datafusion::{
    catalog::TableFunction,
    functions_table::{generate_series, range},
};

/// Returns all default table functions
pub fn table_functions() -> Vec<Arc<TableFunction>> {
    vec![generate_series(), range()]
}
