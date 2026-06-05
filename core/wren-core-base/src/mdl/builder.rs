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

#![allow(dead_code)]

use crate::mdl::manifest::{
    Column, Cube, CubeDimension, DataSource, JoinType, Manifest, Measure, Model, PrimaryKey,
    Relationship, TimeDimension, View,
};
use crate::mdl::{ColumnLevelOperator, NormalizedExpr, RowLevelAccessControl, SessionProperty};
use std::collections::BTreeMap;
use std::sync::Arc;

use super::ColumnLevelAccessControl;

/// A builder for creating a Manifest
pub struct ManifestBuilder {
    pub manifest: Manifest,
}

impl Default for ManifestBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl ManifestBuilder {
    pub fn new() -> Self {
        Self {
            manifest: Manifest {
                layout_version: 1,
                catalog: "wrenai".to_string(),
                schema: "public".to_string(),
                models: vec![],
                relationships: vec![],
                views: vec![],
                data_source: None,
                cubes: vec![],
            },
        }
    }

    pub fn layout_version(mut self, version: u32) -> Self {
        self.manifest.layout_version = version;
        self
    }

    pub fn catalog(mut self, catalog: &str) -> Self {
        self.manifest.catalog = catalog.to_string();
        self
    }

    pub fn schema(mut self, schema: &str) -> Self {
        self.manifest.schema = schema.to_string();
        self
    }

    pub fn model(mut self, model: Arc<Model>) -> Self {
        self.manifest.models.push(model);
        self
    }

    pub fn relationship(mut self, relationship: Arc<Relationship>) -> Self {
        self.manifest.relationships.push(relationship);
        self
    }

    pub fn view(mut self, view: Arc<View>) -> Self {
        self.manifest.views.push(view);
        self
    }

    pub fn cube(mut self, cube: Arc<Cube>) -> Self {
        self.manifest.cubes.push(cube);
        self
    }

    pub fn data_source(mut self, data_source: DataSource) -> Self {
        self.manifest.data_source = Some(data_source);
        self
    }

    pub fn build(self) -> Manifest {
        self.manifest
    }
}

pub struct ModelBuilder {
    pub model: Model,
}

impl ModelBuilder {
    pub fn new(name: &str) -> Self {
        Self {
            model: Model {
                name: name.to_string(),
                ref_sql: None,
                base_object: None,
                table_reference: None,
                columns: vec![],
                primary_key: None,
                cached: false,
                refresh_time: None,
                row_level_access_controls: vec![],
                dialect: None,
            },
        }
    }

    pub fn ref_sql(mut self, ref_sql: &str) -> Self {
        self.model.ref_sql = Some(ref_sql.to_string());
        self
    }

    pub fn base_object(mut self, base_object: &str) -> Self {
        self.model.base_object = Some(base_object.to_string());
        self
    }

    pub fn table_reference(mut self, table_reference: &str) -> Self {
        self.model.table_reference = Some(table_reference.to_string());
        self
    }

    pub fn column(mut self, column: Arc<Column>) -> Self {
        self.model.columns.push(column);
        self
    }

    pub fn primary_key(mut self, primary_key: &str) -> Self {
        assert!(
            !primary_key.trim().is_empty(),
            "primary_key must be a non-empty column name"
        );
        self.model.primary_key = Some(PrimaryKey::Single(primary_key.to_string()));
        self
    }

    /// Set a composite primary key spanning multiple columns.
    /// A single column collapses to [`PrimaryKey::Single`] so the serialized
    /// form stays a plain string.
    pub fn primary_keys(mut self, primary_keys: &[&str]) -> Self {
        assert!(
            !primary_keys.is_empty(),
            "primary_keys must contain at least one column"
        );
        assert!(
            primary_keys.iter().all(|k| !k.trim().is_empty()),
            "primary_keys cannot contain empty column names"
        );
        self.model.primary_key = Some(if let [single] = primary_keys {
            PrimaryKey::Single(single.to_string())
        } else {
            PrimaryKey::Composite(primary_keys.iter().map(|s| s.to_string()).collect())
        });
        self
    }

    pub fn cached(mut self, cached: bool) -> Self {
        self.model.cached = cached;
        self
    }

    pub fn refresh_time(mut self, refresh_time: &str) -> Self {
        self.model.refresh_time = Some(refresh_time.to_string());
        self
    }

    pub fn add_row_level_access_control(
        mut self,
        name: &str,
        required_properties: Vec<SessionProperty>,
        condition: &str,
    ) -> Self {
        let rule = RowLevelAccessControl {
            name: name.to_string(),
            required_properties,
            condition: condition.to_string(),
        };
        self.model.row_level_access_controls.push(Arc::new(rule));
        self
    }

    pub fn dialect(mut self, dialect: DataSource) -> Self {
        self.model.dialect = Some(dialect);
        self
    }

    pub fn build(self) -> Arc<Model> {
        Arc::new(self.model)
    }
}

impl SessionProperty {
    pub fn new_required(name: &str) -> Self {
        SessionProperty::new(name.to_string(), true, None)
    }
    pub fn new_optional(name: &str, default_expr: Option<String>) -> Self {
        SessionProperty::new(name.to_string(), false, default_expr)
    }
}
pub struct ColumnBuilder {
    pub column: Column,
}

impl ColumnBuilder {
    pub fn new(name: &str, r#type: &str) -> Self {
        Self {
            column: Column {
                name: name.to_string(),
                r#type: r#type.to_string(),
                relationship: None,
                is_calculated: false,
                is_hidden: false,
                not_null: false,
                expression: None,
                column_level_access_control: None,
            },
        }
    }

    pub fn new_calculated(name: &str, r#type: &str) -> Self {
        Self::new(name, r#type).calculated(true)
    }

    pub fn new_relationship(name: &str, r#type: &str, relationship: &str) -> Self {
        Self::new(name, r#type).relationship(relationship)
    }

    pub fn relationship(mut self, relationship: &str) -> Self {
        self.column.relationship = Some(relationship.to_string());
        self
    }

    pub fn calculated(mut self, is_calculated: bool) -> Self {
        self.column.is_calculated = is_calculated;
        self
    }

    pub fn not_null(mut self, not_null: bool) -> Self {
        self.column.not_null = not_null;
        self
    }

    pub fn expression(mut self, expression: &str) -> Self {
        self.column.expression = Some(expression.to_string());
        self
    }

    pub fn hidden(mut self, is_hidden: bool) -> Self {
        self.column.is_hidden = is_hidden;
        self
    }

    pub fn column_level_access_control(
        mut self,
        name: &str,
        required_properties: Vec<SessionProperty>,
        operator: ColumnLevelOperator,
        threshold: &str,
    ) -> Self {
        self.column.column_level_access_control = Some(Arc::new(ColumnLevelAccessControl {
            name: name.to_string(),
            required_properties,
            operator,
            threshold: NormalizedExpr::new(threshold),
        }));
        self
    }

    pub fn build(self) -> Arc<Column> {
        Arc::new(self.column)
    }
}

pub struct RelationshipBuilder {
    pub relationship: Relationship,
}

impl RelationshipBuilder {
    pub fn new(name: &str) -> Self {
        Self {
            relationship: Relationship {
                name: name.to_string(),
                models: vec![],
                join_type: JoinType::OneToOne,
                condition: "".to_string(),
            },
        }
    }

    pub fn model(mut self, model: &str) -> Self {
        self.relationship.models.push(model.to_string());
        self
    }

    pub fn join_type(mut self, join_type: JoinType) -> Self {
        self.relationship.join_type = join_type;
        self
    }

    pub fn condition(mut self, condition: &str) -> Self {
        self.relationship.condition = condition.to_string();
        self
    }

    pub fn build(self) -> Arc<Relationship> {
        Arc::new(self.relationship)
    }
}

pub struct ViewBuilder {
    pub view: View,
}

impl ViewBuilder {
    pub fn new(name: &str) -> Self {
        Self {
            view: View {
                name: name.to_string(),
                statement: "".to_string(),
                dialect: None,
            },
        }
    }

    pub fn statement(mut self, statement: &str) -> Self {
        self.view.statement = statement.to_string();
        self
    }

    pub fn dialect(mut self, dialect: DataSource) -> Self {
        self.view.dialect = Some(dialect);
        self
    }

    pub fn build(self) -> Arc<View> {
        Arc::new(self.view)
    }
}

pub struct MeasureBuilder {
    pub measure: Measure,
}

impl MeasureBuilder {
    pub fn new(name: &str, expression: &str, r#type: &str) -> Self {
        Self {
            measure: Measure {
                name: name.to_string(),
                expression: expression.to_string(),
                r#type: r#type.to_string(),
            },
        }
    }

    pub fn build(self) -> Arc<Measure> {
        Arc::new(self.measure)
    }
}

pub struct CubeDimensionBuilder {
    pub dimension: CubeDimension,
}

impl CubeDimensionBuilder {
    pub fn new(name: &str, expression: &str, r#type: &str) -> Self {
        Self {
            dimension: CubeDimension {
                name: name.to_string(),
                expression: expression.to_string(),
                r#type: r#type.to_string(),
            },
        }
    }

    pub fn build(self) -> Arc<CubeDimension> {
        Arc::new(self.dimension)
    }
}

pub struct TimeDimensionBuilder {
    pub time_dimension: TimeDimension,
}

impl TimeDimensionBuilder {
    pub fn new(name: &str, expression: &str, r#type: &str) -> Self {
        Self {
            time_dimension: TimeDimension {
                name: name.to_string(),
                expression: expression.to_string(),
                r#type: r#type.to_string(),
            },
        }
    }

    pub fn build(self) -> Arc<TimeDimension> {
        Arc::new(self.time_dimension)
    }
}

pub struct CubeBuilder {
    pub cube: Cube,
}

impl CubeBuilder {
    pub fn new(name: &str, base_object: &str) -> Self {
        Self {
            cube: Cube {
                name: name.to_string(),
                base_object: base_object.to_string(),
                measures: vec![],
                dimensions: vec![],
                time_dimensions: vec![],
                hierarchies: BTreeMap::new(),
            },
        }
    }

    pub fn measure(mut self, measure: Arc<Measure>) -> Self {
        self.cube.measures.push(measure);
        self
    }

    pub fn dimension(mut self, dimension: Arc<CubeDimension>) -> Self {
        self.cube.dimensions.push(dimension);
        self
    }

    pub fn time_dimension(mut self, time_dimension: Arc<TimeDimension>) -> Self {
        self.cube.time_dimensions.push(time_dimension);
        self
    }

    pub fn hierarchy(mut self, name: &str, levels: Vec<&str>) -> Self {
        self.cube.hierarchies.insert(
            name.to_string(),
            levels.iter().map(|s| s.to_string()).collect(),
        );
        self
    }

    pub fn build(self) -> Arc<Cube> {
        Arc::new(self.cube)
    }
}

#[cfg(test)]
mod test {
    use crate::mdl::builder::{
        ColumnBuilder, CubeBuilder, CubeDimensionBuilder, ManifestBuilder, MeasureBuilder,
        ModelBuilder, RelationshipBuilder, TimeDimensionBuilder, ViewBuilder,
    };
    use crate::mdl::manifest::DataSource::MySQL;
    use crate::mdl::manifest::{Column, DataSource, JoinType, Manifest, Model, Relationship, View};
    use crate::mdl::manifest::{Cube, CubeDimension, Measure, TimeDimension};
    use crate::mdl::ColumnLevelOperator;
    use crate::mdl::SessionProperty;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Arc;

    #[test]
    fn test_column_roundtrip() {
        let expected = ColumnBuilder::new("id", "integer")
            .relationship("test")
            .calculated(true)
            .not_null(true)
            .hidden(true)
            .expression("test")
            .column_level_access_control(
                "rlac",
                vec![SessionProperty::new_required("session_id")],
                ColumnLevelOperator::Equals,
                "'NORMAL'",
            )
            .build();

        let json_str = serde_json::to_string(&expected).unwrap();
        let actual: Arc<Column> = serde_json::from_str(&json_str).unwrap();
        assert_eq!(actual, expected)
    }

    #[test]
    fn test_expression_empty_as_none() {
        let expected = ColumnBuilder::new("id", "integer").expression("").build();

        let json_str = serde_json::to_string(&expected).unwrap();
        let actual: Arc<Column> = serde_json::from_str(&json_str).unwrap();
        assert!(actual.expression.is_none())
    }

    #[test]
    fn test_bool_from_int() {
        let json = r#"
        {
            "name": "id",
            "type": "integer",
            "isCalculated": 1,
            "notNull": 0
        }
        "#;

        let actual: Arc<Column> = serde_json::from_str(json).unwrap();
        assert!(actual.is_calculated);
        assert!(!actual.not_null);

        let json = r#"
        {
            "name": "id",
            "type": "integer",
            "isCalculated": true,
            "notNull": false
        }
        "#;

        let actual: Arc<Column> = serde_json::from_str(json).unwrap();
        assert!(actual.is_calculated);
        assert!(!actual.not_null);
    }

    #[test]
    fn test_model_roundtrip() {
        let model = ModelBuilder::new("test")
            .ref_sql("SELECT * FROM test")
            .base_object("test")
            .table_reference("test")
            .column(ColumnBuilder::new("id", "integer").build())
            .primary_key("id")
            .cached(true)
            .refresh_time("1h")
            .add_row_level_access_control(
                "rule1",
                vec![SessionProperty::new_required("session_id")],
                "id = @session_id",
            )
            .add_row_level_access_control(
                "rule2",
                vec![SessionProperty::new_optional("session_id_optional", None)],
                "id = @session_id_optional",
            )
            .add_row_level_access_control(
                "rule3",
                vec![SessionProperty::new_optional(
                    "session_id_default",
                    Some("1".to_string()),
                )],
                "id = @session_id_default",
            )
            .build();

        let json_str = serde_json::to_string(&model).unwrap();
        let actual: Arc<Model> = serde_json::from_str(&json_str).unwrap();
        assert_eq!(actual, model);

        // test table_reference is null
        let model = ModelBuilder::new("test")
            .ref_sql("SELECT * FROM test")
            .base_object("test")
            .column(ColumnBuilder::new("id", "integer").build())
            .primary_key("id")
            .cached(true)
            .refresh_time("1h")
            .build();

        let json_str = serde_json::to_string(&model).unwrap();
        let actual: Arc<Model> = serde_json::from_str(&json_str).unwrap();
        assert_eq!(actual, model);

        // test only table_reference
        let model = ModelBuilder::new("test")
            .table_reference("test")
            .column(ColumnBuilder::new("id", "integer").build())
            .build();

        let json_str = serde_json::to_string(&model).unwrap();
        let actual: Arc<Model> = serde_json::from_str(&json_str).unwrap();
        assert_eq!(actual, model);

        let model = ModelBuilder::new("test")
            .table_reference(r#""Wren"."Public"."Source""#)
            .column(ColumnBuilder::new("id", "integer").build())
            .build();

        let json_str = serde_json::to_string(&model).unwrap();
        let actual: Arc<Model> = serde_json::from_str(&json_str).unwrap();
        assert_eq!(actual, model);
    }

    #[test]
    fn test_relationship_roundtrip() {
        let expected = RelationshipBuilder::new("test")
            .model("testA")
            .model("testB")
            .join_type(JoinType::OneToMany)
            .condition("test")
            .build();

        let json_str = serde_json::to_string(&expected).unwrap();
        let actual: Arc<Relationship> = serde_json::from_str(&json_str).unwrap();
        assert_eq!(actual, expected)
    }

    #[test]
    fn test_join_type_case_insensitive() {
        let case = ["one_to_one", "ONE_TO_ONE"];
        let expected = JoinType::OneToOne;
        for case in case.iter() {
            assert_serde(&format!("\"{}\"", case), expected);
        }

        let case = ["one_to_many", "ONE_TO_MANY"];
        let expected = JoinType::OneToMany;
        for case in case.iter() {
            assert_serde(&format!("\"{}\"", case), expected);
        }

        let case = ["many_to_one", "MANY_TO_ONE"];
        let expected = JoinType::ManyToOne;
        for case in case.iter() {
            assert_serde(&format!("\"{}\"", case), expected);
        }

        let case = ["many_to_many", "MANY_TO_MANY"];
        let expected = JoinType::ManyToMany;
        for case in case.iter() {
            assert_serde(&format!("\"{}\"", case), expected);
        }
    }

    fn assert_serde(json_str: &str, expected: JoinType) {
        let actual: JoinType = serde_json::from_str(json_str).unwrap();
        assert_eq!(actual, expected);
    }

    #[test]
    fn test_view_roundtrip() {
        let expected = ViewBuilder::new("test")
            .statement("SELECT * FROM test")
            .build();

        let json_str = serde_json::to_string(&expected).unwrap();
        let actual: Arc<View> = serde_json::from_str(&json_str).unwrap();
        assert_eq!(actual, expected)
    }

    #[test]
    fn test_measure_roundtrip() {
        let expected = MeasureBuilder::new("total_price", "sum(price)", "float").build();
        let json_str = serde_json::to_string(&expected).unwrap();
        let actual: Arc<Measure> = serde_json::from_str(&json_str).unwrap();
        assert_eq!(actual, expected)
    }

    #[test]
    fn test_cube_dimension_roundtrip() {
        let expected = CubeDimensionBuilder::new("status", "status", "string").build();
        let json_str = serde_json::to_string(&expected).unwrap();
        let actual: Arc<CubeDimension> = serde_json::from_str(&json_str).unwrap();
        assert_eq!(actual, expected)
    }

    #[test]
    fn test_time_dimension_roundtrip() {
        let expected = TimeDimensionBuilder::new("order_date", "order_date", "date").build();
        let json_str = serde_json::to_string(&expected).unwrap();
        let actual: Arc<TimeDimension> = serde_json::from_str(&json_str).unwrap();
        assert_eq!(actual, expected)
    }

    #[test]
    fn test_cube_roundtrip() {
        let expected = CubeBuilder::new("order_cube", "orders")
            .measure(MeasureBuilder::new("total_price", "sum(price)", "float").build())
            .dimension(CubeDimensionBuilder::new("status", "status", "string").build())
            .time_dimension(TimeDimensionBuilder::new("order_date", "order_date", "date").build())
            .hierarchy("time", vec!["year", "quarter", "month"])
            .build();

        let json_str = serde_json::to_string(&expected).unwrap();
        let actual: Arc<Cube> = serde_json::from_str(&json_str).unwrap();
        assert_eq!(actual, expected)
    }

    #[test]
    fn test_manifest_roundtrip() {
        let model = ModelBuilder::new("test")
            .ref_sql("SELECT * FROM test")
            .base_object("test")
            .table_reference("test")
            .column(ColumnBuilder::new("id", "integer").build())
            .primary_key("id")
            .cached(true)
            .refresh_time("1h")
            .build();

        let relationship = RelationshipBuilder::new("test")
            .model("testA")
            .model("testB")
            .join_type(JoinType::OneToMany)
            .condition("test")
            .build();

        let view = ViewBuilder::new("test")
            .statement("SELECT * FROM test")
            .build();

        let expected = crate::mdl::builder::ManifestBuilder::new()
            .catalog("wrenai")
            .schema("public")
            .model(model)
            .relationship(relationship)
            .view(view)
            .data_source(DataSource::Datafusion)
            .build();

        let json_str = serde_json::to_string(&expected).unwrap();
        let actual: crate::mdl::manifest::Manifest = serde_json::from_str(&json_str).unwrap();
        assert_eq!(actual, expected)
    }

    #[test]
    fn test_json_serde() {
        let test_data: PathBuf = [env!("CARGO_MANIFEST_DIR"), "tests", "data", "mdl.json"]
            .iter()
            .collect();
        let mdl_json = fs::read_to_string(test_data.as_path()).unwrap();
        let mdl = serde_json::from_str::<Manifest>(&mdl_json).unwrap();

        let expected = ManifestBuilder::new()
            .catalog("test")
            .schema("test")
            .model(
                ModelBuilder::new("customer")
                    .table_reference("customer")
                    .column(ColumnBuilder::new("c_custkey", "integer").build())
                    .column(ColumnBuilder::new("c_name", "varchar").build())
                    .column(
                        ColumnBuilder::new("custkey_plus", "integer")
                            .expression("c_custkey + 1")
                            .calculated(true)
                            .build(),
                    )
                    .column(
                        ColumnBuilder::new("orders", "orders")
                            .relationship("CustomerOrders")
                            .build(),
                    )
                    .add_row_level_access_control(
                        "rule1",
                        vec![SessionProperty::new_required("session_id")],
                        "c_custkey = @session_id",
                    )
                    .add_row_level_access_control(
                        "rule2",
                        vec![SessionProperty::new_optional("session_id_optional", None)],
                        "c_custkey = @session_id_optional",
                    )
                    .add_row_level_access_control(
                        "rule3",
                        vec![SessionProperty::new_optional(
                            "session_id_default",
                            Some("1".to_string()),
                        )],
                        "c_custkey = @session_id_default",
                    )
                    .primary_key("c_custkey")
                    .build(),
            )
            .model(
                ModelBuilder::new("profile")
                    .table_reference("profile")
                    .column(ColumnBuilder::new("p_custkey", "integer").build())
                    .column(ColumnBuilder::new("p_phone", "varchar").build())
                    .column(ColumnBuilder::new("p_sex", "varchar").build())
                    .column(
                        ColumnBuilder::new("customer", "customer")
                            .relationship("CustomerProfile")
                            .build(),
                    )
                    .column(
                        ColumnBuilder::new("totalcost", "integer")
                            .expression("sum(customer.orders.o_totalprice)")
                            .calculated(true)
                            .build(),
                    )
                    .primary_key("p_custkey")
                    .build(),
            )
            .model(
                ModelBuilder::new("orders")
                    .table_reference("orders")
                    .column(ColumnBuilder::new("o_orderkey", "integer").build())
                    .column(ColumnBuilder::new("o_custkey", "integer").build())
                    .column(ColumnBuilder::new("o_totalprice", "integer").build())
                    .column(
                        ColumnBuilder::new("customer", "customer")
                            .relationship("CustomerOrders")
                            .build(),
                    )
                    .column(
                        ColumnBuilder::new("customer_name", "varchar")
                            .expression("customer.c_name")
                            .calculated(true)
                            .build(),
                    )
                    .column(
                        ColumnBuilder::new("orderkey_plus_custkey", "integer")
                            .expression("o_orderkey + o_custkey")
                            .calculated(true)
                            .build(),
                    )
                    .column(
                        ColumnBuilder::new("hash_orderkey", "varchar")
                            .expression("md5(o_orderkey)")
                            .calculated(true)
                            .build(),
                    )
                    .primary_key("o_orderkey")
                    .build(),
            )
            .relationship(
                RelationshipBuilder::new("CustomerOrders")
                    .model("customer")
                    .model("orders")
                    .join_type(JoinType::OneToMany)
                    .condition("customer.c_custkey = orders.o_custkey")
                    .build(),
            )
            .relationship(
                RelationshipBuilder::new("CustomerProfile")
                    .model("customer")
                    .model("profile")
                    .join_type(JoinType::OneToOne)
                    .condition("customer.c_custkey = profile.p_custkey")
                    .build(),
            )
            .view(
                ViewBuilder::new("customer_view")
                    .statement("select * from test.test.customer")
                    .build(),
            )
            .data_source(MySQL);
        assert_eq!(mdl, expected.build());
    }

    #[test]
    fn test_session_property_roundtrip() {
        let expected = SessionProperty::new_optional("session_id", Some("1".to_string()));

        let json_str = serde_json::to_string(&expected).unwrap();
        assert!(!json_str.contains(r#"normalizedName"#));
        let actual: SessionProperty = serde_json::from_str(&json_str).unwrap();
        assert_eq!(actual.normalized_name(), actual.name.to_lowercase());
        assert_eq!(actual, expected)
    }

    #[test]
    fn test_manifest_layout_version_default() {
        let json = r#"{"catalog":"wren","schema":"public"}"#;
        let manifest: Manifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.layout_version, 1);
    }

    #[test]
    fn test_manifest_layout_version_explicit() {
        let json = r#"{"layoutVersion":2,"catalog":"wren","schema":"public"}"#;
        let manifest: Manifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.layout_version, 2);
    }

    #[test]
    fn test_manifest_layout_version_roundtrip() {
        let expected = ManifestBuilder::new().layout_version(2).build();
        let json_str = serde_json::to_string(&expected).unwrap();
        assert!(json_str.contains(r#""layoutVersion":2"#));
        let actual: Manifest = serde_json::from_str(&json_str).unwrap();
        assert_eq!(actual.layout_version, 2);
        assert_eq!(actual, expected);
    }

    #[test]
    fn test_manifest_version_validation_ok() {
        use crate::mdl::manifest::MAX_SUPPORTED_LAYOUT_VERSION;
        let manifest = ManifestBuilder::new()
            .layout_version(MAX_SUPPORTED_LAYOUT_VERSION)
            .build();
        assert!(manifest.validate_layout_version().is_ok());
    }

    #[test]
    fn test_manifest_version_validation_rejected() {
        let manifest = ManifestBuilder::new().layout_version(99).build();
        let err = manifest.validate_layout_version().unwrap_err();
        assert!(err.to_string().contains("99"));
        assert!(err.to_string().contains("only supports up to"));
    }

    #[test]
    fn test_model_dialect_none_default() {
        let json = r#"{"name":"test","columns":[]}"#;
        let model: Arc<Model> = serde_json::from_str(json).unwrap();
        assert!(model.dialect.is_none());
    }

    #[test]
    fn test_model_dialect_roundtrip() {
        let expected = ModelBuilder::new("test")
            .table_reference("test")
            .column(ColumnBuilder::new("id", "integer").build())
            .dialect(DataSource::BigQuery)
            .build();

        let json_str = serde_json::to_string(&expected).unwrap();
        assert!(json_str.contains(r#""dialect":"BIGQUERY""#));
        let actual: Arc<Model> = serde_json::from_str(&json_str).unwrap();
        assert_eq!(actual.dialect, Some(DataSource::BigQuery));
        assert_eq!(actual, expected);
    }

    #[test]
    fn test_model_dialect_case_insensitive() {
        let json = r#"{"name":"test","columns":[],"dialect":"bigquery"}"#;
        let model: Arc<Model> = serde_json::from_str(json).unwrap();
        assert_eq!(model.dialect, Some(DataSource::BigQuery));
    }

    #[test]
    fn test_view_dialect_none_default() {
        let json = r#"{"name":"test","statement":"SELECT 1"}"#;
        let view: Arc<View> = serde_json::from_str(json).unwrap();
        assert!(view.dialect.is_none());
    }

    #[test]
    fn test_view_dialect_roundtrip() {
        let expected = ViewBuilder::new("test")
            .statement("SELECT * FROM test")
            .dialect(DataSource::Postgres)
            .build();

        let json_str = serde_json::to_string(&expected).unwrap();
        assert!(json_str.contains(r#""dialect":"POSTGRES""#));
        let actual: Arc<View> = serde_json::from_str(&json_str).unwrap();
        assert_eq!(actual.dialect, Some(DataSource::Postgres));
        assert_eq!(actual, expected);
    }

    #[test]
    fn test_manifest_with_dialect_models_and_views() {
        let model = ModelBuilder::new("revenue")
            .ref_sql("SELECT * FROM `project.dataset.table`")
            .dialect(DataSource::BigQuery)
            .column(ColumnBuilder::new("amount", "decimal").build())
            .build();

        let view = ViewBuilder::new("summary")
            .statement("SELECT date_trunc('month', created_at) FROM orders")
            .dialect(DataSource::Postgres)
            .build();

        let expected = ManifestBuilder::new()
            .layout_version(2)
            .model(model)
            .view(view)
            .data_source(DataSource::Postgres)
            .build();

        let json_str = serde_json::to_string(&expected).unwrap();
        let actual: Manifest = serde_json::from_str(&json_str).unwrap();
        assert_eq!(actual, expected);
        assert_eq!(actual.layout_version, 2);
        assert_eq!(actual.models[0].dialect, Some(DataSource::BigQuery));
        assert_eq!(actual.views[0].dialect, Some(DataSource::Postgres));
    }

    #[test]
    fn test_manifest_builder_default_layout_version() {
        let manifest = ManifestBuilder::new().build();
        assert_eq!(manifest.layout_version, 1);
    }
}
