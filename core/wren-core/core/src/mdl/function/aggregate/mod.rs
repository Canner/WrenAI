use std::sync::Arc;

use datafusion::{
    functions_aggregate::{
        approx_percentile_cont::approx_percentile_cont_udaf,
        approx_percentile_cont_with_weight::approx_percentile_cont_with_weight_udaf, *,
    },
    logical_expr::AggregateUDF,
};

pub fn aggregate_functions() -> Vec<Arc<AggregateUDF>> {
    vec![
        array_agg::array_agg_udaf(),
        first_last::first_value_udaf(),
        first_last::last_value_udaf(),
        covariance::covar_samp_udaf(),
        covariance::covar_pop_udaf(),
        correlation::corr_udaf(),
        sum::sum_udaf(),
        min_max::max_udaf(),
        min_max::min_udaf(),
        median::median_udaf(),
        count::count_udaf(),
        regr::regr_slope_udaf(),
        regr::regr_intercept_udaf(),
        regr::regr_count_udaf(),
        regr::regr_r2_udaf(),
        regr::regr_avgx_udaf(),
        regr::regr_avgy_udaf(),
        regr::regr_sxx_udaf(),
        regr::regr_syy_udaf(),
        regr::regr_sxy_udaf(),
        variance::var_samp_udaf(),
        variance::var_pop_udaf(),
        stddev::stddev_udaf(),
        stddev::stddev_pop_udaf(),
        approx_median::approx_median_udaf(),
        approx_distinct::approx_distinct_udaf(),
        approx_percentile_cont_udaf(),
        approx_percentile_cont_with_weight_udaf(),
        string_agg::string_agg_udaf(),
        bit_and_or_xor::bit_and_udaf(),
        bit_and_or_xor::bit_or_udaf(),
        bit_and_or_xor::bit_xor_udaf(),
        bool_and_or::bool_and_udaf(),
        bool_and_or::bool_or_udaf(),
        average::avg_udaf(),
        grouping::grouping_udaf(),
        nth_value::nth_value_udaf(),
    ]
}
