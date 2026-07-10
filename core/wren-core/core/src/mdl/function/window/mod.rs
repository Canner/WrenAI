use std::sync::Arc;

use datafusion::{functions_window::*, logical_expr::WindowUDF};

pub fn window_functions() -> Vec<Arc<WindowUDF>> {
    vec![
        cume_dist::cume_dist_udwf(),
        row_number::row_number_udwf(),
        lead_lag::lead_udwf(),
        lead_lag::lag_udwf(),
        rank::rank_udwf(),
        rank::dense_rank_udwf(),
        rank::percent_rank_udwf(),
        ntile::ntile_udwf(),
        nth_value::first_value_udwf(),
        nth_value::last_value_udwf(),
        nth_value::nth_value_udwf(),
    ]
}
