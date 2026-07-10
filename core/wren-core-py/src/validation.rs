use pyo3::pyfunction;
use wren_core_base::mdl::{Model, RowLevelAccessControl};

use crate::errors::CoreError;

#[pyfunction]
pub fn validate_rlac_rule(
    rule: &RowLevelAccessControl,
    model: &Model,
) -> Result<(), CoreError> {
    wren_core::logical_plan::analyze::access_control::validate_rlac_rule(rule, model)?;
    Ok(())
}
