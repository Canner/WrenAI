use pyo3::prelude::*;

use remote_functions::PyRemoteFunction;

pub mod context;
mod cube;
mod errors;
mod extractor;
mod manifest;
pub mod remote_functions;
mod validation;

#[pymodule]
#[pyo3(name = "wren_core")]
fn wren_core_wrapper(m: &Bound<'_, PyModule>) -> PyResult<()> {
    env_logger::init();
    m.add_class::<context::PySessionContext>()?;
    m.add_class::<PyRemoteFunction>()?;
    m.add_class::<manifest::Manifest>()?;
    m.add_class::<manifest::Model>()?;
    m.add_class::<manifest::RowLevelAccessControl>()?;
    m.add_class::<manifest::SessionProperty>()?;
    m.add_class::<extractor::PyManifestExtractor>()?;
    m.add_function(wrap_pyfunction!(manifest::to_json_base64, m)?)?;
    m.add_function(wrap_pyfunction!(manifest::to_manifest, m)?)?;
    m.add_function(wrap_pyfunction!(validation::validate_rlac_rule, m)?)?;
    m.add_function(wrap_pyfunction!(manifest::is_backward_compatible, m)?)?;
    m.add_function(wrap_pyfunction!(manifest::migrate_manifest_json, m)?)?;
    m.add_function(wrap_pyfunction!(cube::cube_query_to_sql, m)?)?;
    Ok(())
}
