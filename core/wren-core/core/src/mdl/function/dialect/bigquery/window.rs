use datafusion::logical_expr::{Signature, Volatility};

use crate::{
    make_udwf_function,
    mdl::function::{ByPassWindowFunction, ReturnType},
};

use crate::mdl::function::utils::build_document;

make_udwf_function!(
    ByPassWindowFunction::new(
        "percentile_cont",
        ReturnType::SameAsInput,
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Calculates the value at the given percentile of a set of values.",
            "SELECT PERCENTILE_CONT(column_name, 0.5) OVER() FROM table;"
        )),
    ),
    percentile_cont_udwf
);

make_udwf_function!(
    ByPassWindowFunction::new(
        "percentile_disc",
        ReturnType::SameAsInput,
        Signature::any(2, Volatility::Immutable),
        Some(build_document(
            "Calculates the discrete value at the given percentile of a set of values.",
            "SELECT PERCENTILE_DISC(column_name, 0.5) OVER() FROM table;"
        )),
    ),
    percentile_disc_udwf
);
