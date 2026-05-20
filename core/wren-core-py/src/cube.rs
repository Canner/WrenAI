use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use wren_core::mdl::{cube_query_to_sql as cube_query_to_sql_rs, CubeQuery};
use wren_core_base::mdl::manifest::Manifest;

/// Translate a structured CubeQuery (JSON) into a SQL string using the cube
/// definitions in the supplied manifest (JSON).
///
/// Both inputs are JSON strings so the binding stays serde-driven and
/// callers don't need to construct typed Rust objects from Python.
///
/// Raises `ValueError` on bad JSON or on translation errors (unknown
/// cube/measure/dimension, cyclic derived measures, …).
#[pyfunction]
pub fn cube_query_to_sql(cube_query_json: &str, manifest_json: &str) -> PyResult<String> {
    let query: CubeQuery = serde_json::from_str(cube_query_json)
        .map_err(|e| PyValueError::new_err(format!("Invalid CubeQuery JSON: {e}")))?;
    let manifest: Manifest = serde_json::from_str(manifest_json)
        .map_err(|e| PyValueError::new_err(format!("Invalid manifest JSON: {e}")))?;
    cube_query_to_sql_rs(&query, &manifest)
        .map_err(|e| PyValueError::new_err(e.to_string()))
}
