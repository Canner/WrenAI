use crate::errors::CoreError;
use base64::prelude::BASE64_STANDARD;
use base64::Engine;
use pyo3::pyfunction;
use wren_core_base::mdl::migration;

pub use wren_core_base::mdl::*;

/// Convert a manifest to a JSON string and then encode it as base64.
#[pyfunction]
pub fn to_json_base64(mdl: Manifest) -> Result<String, CoreError> {
    let mdl_json = serde_json::to_string(&mdl)?;
    let mdl_base64 = BASE64_STANDARD.encode(mdl_json.as_bytes());
    Ok(mdl_base64)
}

#[pyfunction]
/// Convert a base64 encoded JSON string to a manifest object.
pub fn to_manifest(mdl_base64: &str) -> Result<Manifest, CoreError> {
    let decoded_bytes = BASE64_STANDARD.decode(mdl_base64)?;
    let mdl_json = String::from_utf8(decoded_bytes)?;
    let manifest = serde_json::from_str::<Manifest>(&mdl_json)?;
    Ok(manifest)
}

/// Migrate a manifest JSON string to the specified target layout version.
#[pyfunction]
pub fn migrate_manifest_json(
    manifest_json: &str,
    target_version: u32,
) -> Result<String, CoreError> {
    migration::migrate_manifest(manifest_json, target_version)
        .map_err(|e| CoreError::new(&e.to_string()))
}

/// Check if the MDL can be used by the v2 wren core. If there are any access controls rules,
/// the MDL should be used by the v3 wren core only.
#[pyfunction]
pub fn is_backward_compatible(mdl_base64: &str) -> Result<bool, CoreError> {
    let manifest = to_manifest(mdl_base64)?;
    let ralc_exist = manifest
        .models
        .iter()
        .all(|model| model.row_level_access_controls().is_empty());
    let clac_exist = manifest.models.iter().all(|model| {
        model
            .columns
            .iter()
            .all(|column| column.column_level_access_control().is_none())
    });
    Ok(ralc_exist && clac_exist)
}

#[cfg(test)]
mod tests {
    use crate::manifest::{to_json_base64, to_manifest, Manifest};
    use std::collections::BTreeMap;
    use std::sync::Arc;
    use wren_core::mdl::manifest::DataSource::BigQuery;
    use wren_core::mdl::manifest::{Cube, CubeDimension, Measure, Model, TimeDimension};

    #[test]
    fn test_manifest_to_json_base64() {
        let py_manifest = Manifest {
            layout_version: 1,
            catalog: "catalog".to_string(),
            schema: "schema".to_string(),
            models: vec![
                Arc::from(Model {
                    name: "model_1".to_string(),
                    ref_sql: "SELECT * FROM table".to_string().into(),
                    base_object: None,
                    table_reference: None,
                    columns: vec![],
                    primary_key: None,
                    cached: false,
                    refresh_time: None,
                    row_level_access_controls: vec![],
                    dialect: None,
                }),
                Arc::from(Model {
                    name: "model_2".to_string(),
                    ref_sql: None,
                    base_object: None,
                    table_reference: "catalog.schema.table".to_string().into(),
                    columns: vec![],
                    primary_key: None,
                    cached: false,
                    refresh_time: None,
                    row_level_access_controls: vec![],
                    dialect: None,
                }),
            ],
            relationships: vec![],
            views: vec![],
            data_source: Some(BigQuery),
            cubes: vec![Arc::from(Cube {
                name: "order_cube".to_string(),
                base_object: "model_1".to_string(),
                measures: vec![Arc::from(Measure {
                    name: "total_price".to_string(),
                    expression: "sum(price)".to_string(),
                    r#type: "float".to_string(),
                })],
                dimensions: vec![Arc::from(CubeDimension {
                    name: "status".to_string(),
                    expression: "status".to_string(),
                    r#type: "string".to_string(),
                })],
                time_dimensions: vec![Arc::from(TimeDimension {
                    name: "order_date".to_string(),
                    expression: "order_date".to_string(),
                    r#type: "date".to_string(),
                })],
                hierarchies: BTreeMap::new(),
            })],
        };
        let base64_str = to_json_base64(py_manifest).unwrap();
        let manifest = to_manifest(&base64_str).unwrap();
        assert_eq!(manifest.catalog, "catalog");
        assert_eq!(manifest.schema, "schema");
        assert_eq!(manifest.models.len(), 2);
        assert_eq!(manifest.models[0].name, "model_1");
        assert_eq!(
            manifest.models[0].ref_sql,
            Some("SELECT * FROM table".to_string())
        );
        assert_eq!(manifest.models[1].name(), "model_2");
        assert_eq!(manifest.models[1].table_reference(), Some("catalog.schema.table"));
        assert_eq!(manifest.data_source, Some(BigQuery));
        assert_eq!(manifest.cubes.len(), 1);
        assert_eq!(manifest.cubes[0].name, "order_cube");
        assert_eq!(manifest.cubes[0].measures.len(), 1);
        assert_eq!(manifest.cubes[0].dimensions.len(), 1);
        assert_eq!(manifest.cubes[0].time_dimensions.len(), 1);
    }
}
