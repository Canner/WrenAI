/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

use crate::mdl::manifest::MAX_SUPPORTED_LAYOUT_VERSION;
use serde_json::Value;
use std::fmt;

#[derive(Debug)]
pub enum MigrationError {
    Json(serde_json::Error),
    UnsupportedTargetVersion { target: u32, max: u32 },
}

impl fmt::Display for MigrationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MigrationError::Json(e) => write!(f, "JSON error during migration: {e}"),
            MigrationError::UnsupportedTargetVersion { target, max } => write!(
                f,
                "Cannot migrate to layout version {target}: maximum supported version is {max}"
            ),
        }
    }
}

impl std::error::Error for MigrationError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            MigrationError::Json(e) => Some(e),
            MigrationError::UnsupportedTargetVersion { .. } => None,
        }
    }
}

impl From<serde_json::Error> for MigrationError {
    fn from(e: serde_json::Error) -> Self {
        MigrationError::Json(e)
    }
}

/// Migrate a manifest JSON string to the specified target layout version.
///
/// Applies migration steps sequentially (1→2, 2→3, ...).
/// Returns the input unchanged if already at or above the target version.
pub fn migrate_manifest(
    manifest_json: &str,
    target_version: u32,
) -> Result<String, MigrationError> {
    if target_version > MAX_SUPPORTED_LAYOUT_VERSION {
        return Err(MigrationError::UnsupportedTargetVersion {
            target: target_version,
            max: MAX_SUPPORTED_LAYOUT_VERSION,
        });
    }

    let mut value: Value = serde_json::from_str(manifest_json)?;
    let current = value
        .get("layoutVersion")
        .and_then(|v| v.as_u64())
        .unwrap_or(1) as u32;

    if current >= target_version {
        return Ok(manifest_json.to_string());
    }

    for version in current..target_version {
        match version {
            1 => migrate_v1_to_v2(&mut value),
            2 => migrate_v2_to_v3(&mut value),
            3 => migrate_v3_to_v4(&mut value),
            _ => {
                return Err(MigrationError::UnsupportedTargetVersion {
                    target: target_version,
                    max: MAX_SUPPORTED_LAYOUT_VERSION,
                });
            }
        }
    }

    value["layoutVersion"] = serde_json::json!(target_version);
    Ok(serde_json::to_string(&value)?)
}

/// v1→v2: No data transformation needed.
/// The `dialect` field on Model and View is optional and defaults to null.
fn migrate_v1_to_v2(_value: &mut Value) {
    // No-op: `dialect` is Option<DataSource> with serde(default),
    // so existing manifests deserialize correctly without changes.
}

/// v2→v3: No data transformation needed.
/// `primaryKey` accepts a composite array in addition to a single string;
/// existing single-string primary keys remain valid.
fn migrate_v2_to_v3(_value: &mut Value) {
    // No-op: `primaryKey` is an untagged `string | array` enum, so existing
    // single-column manifests deserialize correctly without changes.
}

/// v3→v4: No data transformation needed.
/// Adds optional annotation fields (manifest-level `description` + `properties`,
/// `model.uniqueKeys`, and `description` + `properties` on cube
/// measure/cubeDimension/timeDimension) and widens `column.properties` value
/// types to match model/relationship/view.
fn migrate_v3_to_v4(_value: &mut Value) {
    // No-op: every v4 change is an additive optional field (or a validation
    // widening), so existing manifests deserialize and validate unchanged.
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migrate_v1_to_v2() {
        let v1_json = r#"{"catalog":"wren","schema":"public","models":[]}"#;
        let result = migrate_manifest(v1_json, 2).unwrap();
        let value: Value = serde_json::from_str(&result).unwrap();
        assert_eq!(value["layoutVersion"], 2);
    }

    #[test]
    fn test_migrate_v2_to_v3() {
        let v2_json = r#"{"layoutVersion":2,"catalog":"wren","schema":"public","models":[]}"#;
        let result = migrate_manifest(v2_json, 3).unwrap();
        let value: Value = serde_json::from_str(&result).unwrap();
        assert_eq!(value["layoutVersion"], 3);
    }

    #[test]
    fn test_migrate_v3_to_v4() {
        let v3_json = r#"{"layoutVersion":3,"catalog":"wren","schema":"public","models":[]}"#;
        let result = migrate_manifest(v3_json, 4).unwrap();
        let value: Value = serde_json::from_str(&result).unwrap();
        assert_eq!(value["layoutVersion"], 4);
    }

    #[test]
    fn test_migrate_v1_to_v3_preserves_composite_pk() {
        let v1_json = r#"{"catalog":"wren","schema":"public","models":[{"name":"partsupp","columns":[],"primaryKey":["ps_partkey","ps_suppkey"]}]}"#;
        let result = migrate_manifest(v1_json, 3).unwrap();
        let value: Value = serde_json::from_str(&result).unwrap();
        assert_eq!(value["layoutVersion"], 3);
        assert_eq!(
            value["models"][0]["primaryKey"],
            serde_json::json!(["ps_partkey", "ps_suppkey"])
        );
    }

    #[test]
    fn test_migrate_already_at_target() {
        let v2_json = r#"{"layoutVersion":2,"catalog":"wren","schema":"public","models":[]}"#;
        let result = migrate_manifest(v2_json, 2).unwrap();
        assert_eq!(result, v2_json);
    }

    #[test]
    fn test_migrate_above_target() {
        let v2_json = r#"{"layoutVersion":2,"catalog":"wren","schema":"public","models":[]}"#;
        let result = migrate_manifest(v2_json, 1).unwrap();
        assert_eq!(result, v2_json);
    }

    #[test]
    fn test_migrate_unsupported_target() {
        let v1_json = r#"{"catalog":"wren","schema":"public","models":[]}"#;
        let result = migrate_manifest(v1_json, 99);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("99"));
    }

    #[test]
    fn test_migrate_idempotent() {
        let v1_json = r#"{"catalog":"wren","schema":"public","models":[]}"#;
        let first = migrate_manifest(v1_json, 2).unwrap();
        let second = migrate_manifest(&first, 2).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn test_migrate_preserves_existing_fields() {
        let v1_json = r#"{"catalog":"test","schema":"myschema","models":[{"name":"m1","columns":[],"tableReference":null}],"dataSource":"BIGQUERY"}"#;
        let result = migrate_manifest(v1_json, 2).unwrap();
        let value: Value = serde_json::from_str(&result).unwrap();
        assert_eq!(value["catalog"], "test");
        assert_eq!(value["schema"], "myschema");
        assert_eq!(value["dataSource"], "BIGQUERY");
        assert_eq!(value["models"][0]["name"], "m1");
        assert_eq!(value["layoutVersion"], 2);
    }

    #[test]
    fn test_migrate_invalid_json() {
        let result = migrate_manifest("not json", 2);
        assert!(result.is_err());
    }
}
