use std::collections::{HashMap, HashSet};
use std::fmt::Display;
use std::sync::Arc;

use datafusion::common::{internal_err, plan_err, Column};
use datafusion::error::Result;
use datafusion::sql::TableReference;
use petgraph::Graph;

use crate::logical_plan::utils::from_qualified_name;
use crate::mdl::{utils, WrenMDL};

use super::manifest::{Cube, JoinType, Relationship};
use super::utils::{
    collect_identifiers, qualify_name_from_column_name, quoted, to_expr_queue,
};
use crate::mdl::Dataset;

pub struct Lineage {
    pub source_columns_map: HashMap<Column, HashSet<Column>>,
    pub required_fields_map: HashMap<Column, HashSet<Column>>,
    pub required_dataset_topo: HashMap<Column, Graph<Dataset, DatasetLink>>,
}

impl Lineage {
    pub fn new(mdl: &WrenMDL) -> Result<Self> {
        let source_columns_map = Lineage::collect_source_columns(mdl)?;
        let RequiredInfo {
            required_fields_map,
            required_dataset_topo,
        } = Lineage::collect_required_fields(mdl, &source_columns_map)?;
        Ok(Lineage {
            source_columns_map,
            required_fields_map,
            required_dataset_topo,
        })
    }

    fn collect_source_columns(mdl: &WrenMDL) -> Result<HashMap<Column, HashSet<Column>>> {
        let mut source_columns_map = HashMap::new();

        for model in mdl.manifest.models.iter() {
            for column in model.get_visible_columns() {
                if column.is_calculated {
                    let expr: &String = match column.expression {
                        Some(ref exp) => exp,
                        None => {
                            return plan_err!(
                                "calculated field should have expression: {}",
                                column.name()
                            )
                        }
                    };
                    let source_columns = collect_identifiers(expr)?;
                    let qualified_name =
                        from_qualified_name(mdl, model.name(), column.name());
                    source_columns.iter().for_each(|source_column| {
                        source_columns_map
                            .entry(qualified_name.clone())
                            .or_insert(HashSet::new())
                            .insert(Column::new(
                                Some(TableReference::full(
                                    mdl.catalog(),
                                    mdl.schema(),
                                    model.name(),
                                )),
                                &source_column.name,
                            ));
                    });
                // relationship columns are not a physical column
                } else if column.relationship.is_none() {
                    let qualified_name =
                        from_qualified_name(mdl, model.name(), column.name());
                    source_columns_map.insert(qualified_name, HashSet::new());
                }
            }
        }
        Ok(source_columns_map)
    }
    fn collect_required_fields(
        mdl: &WrenMDL,
        source_columns_map: &HashMap<Column, HashSet<Column>>,
    ) -> Result<RequiredInfo> {
        let mut required_fields_map: HashMap<Column, HashSet<Column>> = HashMap::new();
        let mut required_dataset_topo: HashMap<Column, Graph<Dataset, DatasetLink>> =
            HashMap::new();
        let mut pending_fields = Vec::new();
        for (column, source_columns) in source_columns_map.iter() {
            let Some(relation) = column.clone().relation else {
                return internal_err!("relation not found: {}", column);
            };
            let current_relation = match relation {
                TableReference::Bare { table } => {
                    TableReference::full(mdl.catalog(), mdl.schema(), table)
                }
                TableReference::Partial { schema, table } => {
                    TableReference::full(mdl.catalog(), schema, table)
                }
                TableReference::Full {
                    catalog,
                    schema,
                    table,
                } => TableReference::full(catalog, schema, table),
            };

            let Some(column_ref) = mdl.get_column_reference(column) else {
                return internal_err!("column not found: {}", column);
            };

            // Only analyze the calculated field and the relationship field
            if !column_ref.column.is_calculated
                || column_ref.column.relationship.is_some()
            {
                continue;
            }

            let mut directed_graph: Graph<Dataset, DatasetLink> = Graph::new();
            let mut node_index_map = HashMap::new();
            let mut left_vertex = *node_index_map
                .entry(column_ref.dataset.clone())
                .or_insert_with(|| directed_graph.add_node(column_ref.dataset.clone()));

            for source_column in source_columns.iter() {
                let mut expr_parts = to_expr_queue(source_column.clone());
                let mut relation_ref = current_relation.clone();
                while !expr_parts.is_empty() {
                    let ident = expr_parts.pop_front().unwrap();
                    let Some(source_column_ref) = mdl.get_column_reference(&Column::new(
                        Some(relation_ref.clone()),
                        ident.clone(),
                    )) else {
                        return plan_err!("source column not found: {}", ident);
                    };
                    match source_column_ref.dataset {
                        Dataset::Model(_) => {
                            if let Some(rs) =
                                source_column_ref.column.relationship.clone()
                            {
                                if let Some(rs_rf) = mdl.get_relationship(&rs) {
                                    let related_model_name = rs_rf
                                        .models
                                        .iter()
                                        .find(|m| m != &relation_ref.table())
                                        .cloned()
                                        .unwrap();
                                    if related_model_name
                                        != source_column_ref.column.r#type
                                    {
                                        return plan_err!(
                                            "invalid relationship type: {}",
                                            source_column
                                        );
                                    }

                                    collect_identifiers(&rs_rf.condition)?
                                        .iter()
                                        .for_each(|ident| {
                                            required_fields_map
                                                .entry(column.clone())
                                                .or_default()
                                                .insert(Column::from_qualified_name(
                                                    format!(
                                                        "{}.{}.{}",
                                                        quoted(mdl.catalog()),
                                                        quoted(mdl.schema()),
                                                        qualify_name_from_column_name(
                                                            ident
                                                        )
                                                    ),
                                                ));
                                        });

                                    let related_model =
                                        mdl.get_model(&related_model_name).unwrap();

                                    let right_vertex = *node_index_map
                                        .entry(Dataset::Model(Arc::clone(&related_model)))
                                        .or_insert_with(|| {
                                            directed_graph.add_node(Dataset::Model(
                                                Arc::clone(&related_model),
                                            ))
                                        });
                                    directed_graph.add_edge(
                                        left_vertex,
                                        right_vertex,
                                        get_dataset_link_revers_if_need(
                                            source_column_ref.dataset.clone(),
                                            rs_rf,
                                        ),
                                    );

                                    relation_ref = TableReference::full(
                                        mdl.catalog(),
                                        mdl.schema(),
                                        related_model_name,
                                    );

                                    left_vertex = right_vertex;
                                } else {
                                    return plan_err!(
                                        "relationship not found: {}",
                                        source_column
                                    );
                                }
                            } else {
                                if !expr_parts.is_empty() {
                                    return plan_err!(
                                        "invalid relationship chain: {}",
                                        source_column
                                    );
                                }
                                let value = Column::new(
                                    Some(relation_ref.clone()),
                                    source_column_ref.column.name(),
                                );
                                if source_column_ref.column.is_calculated {
                                    pending_fields.push((value.clone(), column));
                                    required_fields_map
                                        .entry(column.clone())
                                        .or_default()
                                        .insert(value);
                                } else {
                                    required_fields_map
                                        .entry(column.clone())
                                        .or_default()
                                        .insert(value);
                                }
                            }
                        }
                    }
                }
            }
            if !utils::is_dag(&directed_graph) {
                return plan_err!("cyclic dependency detected: {}", column);
            }
            required_dataset_topo.insert(column.clone(), directed_graph);
        }

        // resolve pending fields
        while let Some((value, source_column)) = pending_fields.pop() {
            consume_pending_field(mdl, &mut required_fields_map, value, source_column)?;
        }

        Ok(RequiredInfo {
            required_fields_map,
            required_dataset_topo,
        })
    }
}

fn consume_pending_field(
    mdl: &WrenMDL,
    required_fields_map: &mut HashMap<Column, HashSet<Column>>,
    value: Column,
    source_column: &Column,
) -> Result<()> {
    let Some(fields) = required_fields_map.get_mut(&value) else {
        return plan_err!("pending field not found: {}", value);
    };
    for field in fields.clone() {
        let Some(source_column_ref) = mdl.get_column_reference(&field) else {
            return plan_err!("source column not found: {}", field);
        };
        if source_column_ref.column.is_calculated {
            consume_pending_field(mdl, required_fields_map, field, &value)?;
        } else {
            required_fields_map
                .entry(source_column.clone())
                .or_default()
                .insert(field);
        }
    }
    Ok(())
}

struct RequiredInfo {
    required_fields_map: HashMap<Column, HashSet<Column>>,
    required_dataset_topo: HashMap<Column, Graph<Dataset, DatasetLink>>,
}

#[derive(PartialEq, Eq, Hash, Debug, Clone)]
pub struct DatasetLink {
    pub join_type: JoinType,
    pub condition: String,
}

impl DatasetLink {
    fn new(join_type: JoinType, condition: String) -> Self {
        DatasetLink {
            join_type,
            condition,
        }
    }
}

impl Display for DatasetLink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} ON {}", self.join_type, self.condition)
    }
}

/// Validate every cube in the manifest:
/// 1. `base_object` must point to an existing Model or View.
/// 2. Derived-measure expressions must not form a cycle.
/// 3. Every level in each hierarchy must reference a defined dimension or time_dimension.
pub(super) fn validate_cubes(mdl: &WrenMDL) -> Result<()> {
    for cube in mdl.manifest.cubes.iter() {
        if mdl.get_model(&cube.base_object).is_none()
            && mdl.get_view(&cube.base_object).is_none()
        {
            return plan_err!(
                "Cube '{}': baseObject '{}' is not a defined Model or View",
                cube.name,
                cube.base_object
            );
        }

        validate_measure_cycles(cube)?;

        let all_dim_names: HashSet<&str> = cube
            .dimensions
            .iter()
            .map(|d| d.name.as_str())
            .chain(cube.time_dimensions.iter().map(|td| td.name.as_str()))
            .collect();
        for (hierarchy_name, levels) in &cube.hierarchies {
            for level in levels {
                if !all_dim_names.contains(level.as_str()) {
                    return plan_err!(
                        "Cube '{}': hierarchy '{}' references unknown dimension '{}'",
                        cube.name,
                        hierarchy_name,
                        level
                    );
                }
            }
        }
    }
    Ok(())
}

fn validate_measure_cycles(cube: &Cube) -> Result<()> {
    let mut graph: Graph<&str, ()> = Graph::new();
    let mut node_map: HashMap<&str, _> = HashMap::new();
    for measure in cube.measures.iter() {
        let idx = graph.add_node(measure.name.as_str());
        node_map.insert(measure.name.as_str(), idx);
    }

    let measure_names: HashSet<&str> = node_map.keys().copied().collect();

    for measure in cube.measures.iter() {
        let identifiers = collect_identifiers(&measure.expression)?;
        for ident in &identifiers {
            if measure_names.contains(ident.name.as_str()) {
                let from = node_map[measure.name.as_str()];
                let to = node_map[ident.name.as_str()];
                graph.add_edge(from, to, ());
            }
        }
    }

    if !utils::is_dag(&graph) {
        return plan_err!(
            "Cube '{}': circular dependency detected in measure expressions",
            cube.name
        );
    }
    Ok(())
}

fn get_dataset_link_revers_if_need(
    source: Dataset,
    rs: Arc<Relationship>,
) -> DatasetLink {
    let join_type = if rs.models[0] == source.name() {
        rs.join_type
    } else {
        match rs.join_type {
            JoinType::OneToMany => JoinType::ManyToOne,
            JoinType::ManyToOne => JoinType::OneToMany,
            _ => rs.join_type,
        }
    };
    DatasetLink::new(join_type, rs.condition.clone())
}

#[cfg(test)]
mod test {
    use datafusion::common::{Column, Spans};
    use datafusion::error::Result;
    use datafusion::sql::TableReference;
    use std::collections::{HashMap, HashSet};
    use std::sync::Arc;

    use crate::mdl::builder::{
        ColumnBuilder, CubeBuilder, CubeDimensionBuilder, ManifestBuilder,
        MeasureBuilder, ModelBuilder, RelationshipBuilder, TimeDimensionBuilder,
    };
    use crate::mdl::context::Mode;
    use crate::mdl::lineage::Lineage;
    use crate::mdl::manifest::JoinType;
    use crate::mdl::AnalyzedWrenMDL;
    use crate::mdl::Dataset;
    use crate::mdl::WrenMDL;

    #[test]
    fn test_collect_source_columns() -> Result<()> {
        let manifest = ManifestBuilder::new()
            .model(
                model_a()
                    .column(
                        ColumnBuilder::new("a1_concat_native", "varchar")
                            .expression("a1 || a2")
                            .build(),
                    )
                    .column(
                        ColumnBuilder::new_calculated("a1_concat_id", "varchar")
                            .expression("a1 || id")
                            .build(),
                    )
                    .column(
                        ColumnBuilder::new_calculated("a1_concat_b1", "varchar")
                            .expression("a1 || b.b1")
                            .build(),
                    )
                    .column(
                        ColumnBuilder::new_calculated("a1_concat_c1", "varchar")
                            .expression("a1 || b.c.c1")
                            .build(),
                    )
                    .column(ColumnBuilder::new_relationship("b", "b", "a_b").build())
                    .build(),
            )
            .model(
                model_b()
                    .column(ColumnBuilder::new_relationship("c", "c", "b_c").build())
                    .column(
                        ColumnBuilder::new_calculated("c1", "varchar")
                            .expression("c.c1")
                            .build(),
                    )
                    .build(),
            )
            .model(model_c().build())
            .relationship(
                RelationshipBuilder::new("a_b")
                    .model("a")
                    .model("b")
                    .join_type(JoinType::OneToOne)
                    .condition("a.a1 = b.a1")
                    .build(),
            )
            .relationship(
                RelationshipBuilder::new("b_c")
                    .model("b")
                    .model("c")
                    .join_type(JoinType::OneToOne)
                    .condition("b.b1 = c.b1")
                    .build(),
            )
            .build();

        let wren_mdl = WrenMDL::new(manifest);
        let lineage = Lineage::new(&wren_mdl)?;
        assert_eq!(lineage.source_columns_map.len(), 13);
        assert_eq!(
            lineage
                .source_columns_map
                .get(&Column::from_qualified_name("wrenai.public.a.a1_concat_id"))
                .unwrap()
                .len(),
            2
        );
        let a1_concat_b1 = lineage
            .source_columns_map
            .get(&Column::from_qualified_name("wrenai.public.a.a1_concat_b1"))
            .unwrap();
        assert_eq!(a1_concat_b1.len(), 2);
        assert!(a1_concat_b1.contains(&Column {
            relation: Some(TableReference::full("wrenai", "public", "a")),
            name: "b.b1".to_string(),
            spans: Spans::new(),
        }));

        let a1_concat_c1 = lineage
            .source_columns_map
            .get(&Column::from_qualified_name("wrenai.public.a.a1_concat_c1"))
            .unwrap();
        assert_eq!(a1_concat_c1.len(), 2);
        assert!(a1_concat_c1.contains(&Column {
            relation: Some(TableReference::full("wrenai", "public", "a")),
            name: "b.c.c1".to_string(),
            spans: Spans::new(),
        }));
        Ok(())
    }

    #[test]
    fn test_case_sensitive() -> Result<()> {
        let manifest = ManifestBuilder::new()
            .model(
                model_a_upper_case()
                    .column(
                        ColumnBuilder::new("A1_concat_native", "varchar")
                            .expression("A1 || A2")
                            .build(),
                    )
                    .build(),
            )
            .model(
                model_b()
                    .column(ColumnBuilder::new_relationship("A", "A", "a_b").build())
                    .column(
                        ColumnBuilder::new_calculated("a_id", "varchar")
                            .expression(r#""A"."Id""#)
                            .build(),
                    )
                    .build(),
            )
            .relationship(
                RelationshipBuilder::new("a_b")
                    .model("A")
                    .model("b")
                    .join_type(JoinType::OneToOne)
                    .condition(r#""A"."A1" = b.a1"#)
                    .build(),
            )
            .build();
        let wren_mdl = WrenMDL::new(manifest);
        let lineage = Lineage::new(&wren_mdl)?;
        assert_eq!(lineage.source_columns_map.len(), 7);
        assert!(lineage
            .source_columns_map
            .contains_key(&Column::from_qualified_name(r#"wrenai.public."A"."A1""#)));

        assert!(lineage
            .source_columns_map
            .contains_key(&Column::from_qualified_name(
                r#"wrenai.public."A"."A1_concat_native""#
            )));

        let a1_concat_c1 = lineage
            .required_fields_map
            .get(&Column::from_qualified_name("wrenai.public.b.a_id"))
            .unwrap();
        let expected: HashSet<Column> = HashSet::from([
            Column::from_qualified_name(r#"wrenai.public."A"."A1""#),
            Column::from_qualified_name(r#"wrenai.public."A"."Id""#),
            Column::from_qualified_name("wrenai.public.b.a1"),
        ]);
        assert_eq!(a1_concat_c1.len(), 3);
        assert_eq!(a1_concat_c1, &expected);

        Ok(())
    }

    #[test]
    fn test_collect_required_fields() -> Result<()> {
        let manifest = ManifestBuilder::new()
            .model(
                model_a()
                    .column(
                        ColumnBuilder::new("a1_concat_native", "varchar")
                            .expression("a1 || a2")
                            .build(),
                    )
                    .column(
                        ColumnBuilder::new_calculated("a1_concat_id", "varchar")
                            .expression("a1 || id")
                            .build(),
                    )
                    .column(
                        ColumnBuilder::new_calculated("a1_concat_b1", "varchar")
                            .expression("a1 || b.b1")
                            .build(),
                    )
                    .column(
                        ColumnBuilder::new_calculated("a1_concat_c1", "varchar")
                            .expression("a1 || b.c.c1")
                            .build(),
                    )
                    .column(
                        ColumnBuilder::new_calculated("b_c1", "varchar")
                            .expression("b.c1")
                            .build(),
                    )
                    .column(ColumnBuilder::new_relationship("b", "b", "a_b").build())
                    .build(),
            )
            .model(
                model_b()
                    .column(ColumnBuilder::new_relationship("c", "c", "b_c").build())
                    .column(ColumnBuilder::new_relationship("a", "a", "a_b").build())
                    .column(
                        ColumnBuilder::new_calculated("c1", "varchar")
                            .expression("c.c1")
                            .build(),
                    )
                    .column(
                        ColumnBuilder::new_calculated("a_id_concat_c1", "varchar")
                            .expression("a.id || c.c1")
                            .build(),
                    )
                    .build(),
            )
            .model(model_c().build())
            .relationship(
                RelationshipBuilder::new("a_b")
                    .model("a")
                    .model("b")
                    .join_type(JoinType::OneToOne)
                    .condition("a.a1 = b.a1")
                    .build(),
            )
            .relationship(
                RelationshipBuilder::new("b_c")
                    .model("b")
                    .model("c")
                    .join_type(JoinType::OneToOne)
                    .condition("b.b1 = c.b1")
                    .build(),
            )
            .build();
        let wren_mdl = WrenMDL::new(manifest);
        let lineage = Lineage::new(&wren_mdl)?;
        assert_eq!(lineage.required_fields_map.len(), 6);
        assert_eq!(
            lineage
                .required_fields_map
                .get(&Column::from_qualified_name("wrenai.public.a.a1_concat_id"))
                .unwrap()
                .len(),
            2
        );

        let a1_concat_b1 = lineage
            .required_fields_map
            .get(&Column::from_qualified_name("wrenai.public.a.a1_concat_b1"))
            .unwrap();
        let expected: HashSet<Column> = HashSet::from([
            Column::from_qualified_name("wrenai.public.a.a1"),
            Column::from_qualified_name("wrenai.public.b.a1"),
            Column::from_qualified_name("wrenai.public.b.b1"),
        ]);
        assert_eq!(a1_concat_b1.len(), 3);
        assert_eq!(a1_concat_b1, &expected);

        let a1_concat_c1 = lineage
            .required_fields_map
            .get(&Column::from_qualified_name("wrenai.public.a.a1_concat_c1"))
            .unwrap();
        let expected: HashSet<Column> = HashSet::from([
            Column::from_qualified_name("wrenai.public.a.a1"),
            Column::from_qualified_name("wrenai.public.b.a1"),
            Column::from_qualified_name("wrenai.public.b.b1"),
            Column::from_qualified_name("wrenai.public.c.b1"),
            Column::from_qualified_name("wrenai.public.c.c1"),
        ]);
        assert_eq!(a1_concat_c1.len(), 5);
        assert_eq!(a1_concat_c1, &expected);

        let c1 = lineage
            .required_fields_map
            .get(&Column::from_qualified_name("wrenai.public.b.c1"))
            .unwrap();
        let expected: HashSet<Column> = HashSet::from([
            Column::from_qualified_name("wrenai.public.b.b1"),
            Column::from_qualified_name("wrenai.public.c.b1"),
            Column::from_qualified_name("wrenai.public.c.c1"),
        ]);
        assert_eq!(c1.len(), 3);
        assert_eq!(c1, &expected);

        let a_id_concat_c1 = lineage
            .required_fields_map
            .get(&Column::from_qualified_name(
                "wrenai.public.b.a_id_concat_c1",
            ))
            .unwrap();
        let expected: HashSet<Column> = HashSet::from([
            Column::from_qualified_name("wrenai.public.a.id"),
            Column::from_qualified_name("wrenai.public.a.a1"),
            Column::from_qualified_name("wrenai.public.b.a1"),
            Column::from_qualified_name("wrenai.public.b.b1"),
            Column::from_qualified_name("wrenai.public.c.b1"),
            Column::from_qualified_name("wrenai.public.c.c1"),
        ]);
        assert_eq!(a_id_concat_c1.len(), 6);
        assert_eq!(a_id_concat_c1, &expected);

        let a_b_c1 = lineage
            .required_fields_map
            .get(&Column::from_qualified_name("wrenai.public.a.b_c1"))
            .unwrap();

        let expected: HashSet<Column> = HashSet::from([
            Column::from_qualified_name("wrenai.public.a.a1"),
            Column::from_qualified_name("wrenai.public.b.a1"),
            Column::from_qualified_name("wrenai.public.b.b1"),
            Column::from_qualified_name("wrenai.public.b.c1"),
            Column::from_qualified_name("wrenai.public.c.b1"),
            Column::from_qualified_name("wrenai.public.c.c1"),
        ]);

        assert_eq!(a_b_c1, &expected);

        Ok(())
    }

    #[test]
    fn test_required_dataset_topo() -> Result<()> {
        let manifest = ManifestBuilder::new()
            .model(
                model_a()
                    .column(ColumnBuilder::new_relationship("b", "b", "a_b").build())
                    .column(
                        ColumnBuilder::new("c1", "varchar")
                            .calculated(true)
                            .expression("b.c.c1")
                            .build(),
                    )
                    .build(),
            )
            .model(
                model_b()
                    .column(ColumnBuilder::new("c", "c").relationship("b_c").build())
                    .column(
                        ColumnBuilder::new("c1", "varchar")
                            .calculated(true)
                            .expression("c.c1")
                            .build(),
                    )
                    .build(),
            )
            .model(model_c().build())
            .relationship(
                RelationshipBuilder::new("a_b")
                    .model("a")
                    .model("b")
                    .join_type(JoinType::OneToOne)
                    .condition("a.a1 = b.a1")
                    .build(),
            )
            .relationship(
                RelationshipBuilder::new("b_c")
                    .model("b")
                    .model("c")
                    .join_type(JoinType::OneToOne)
                    .condition("b.b1 = c.b1")
                    .build(),
            )
            .build();
        let wren_mdl = WrenMDL::new(manifest);
        let lineage = crate::mdl::lineage::Lineage::new(&wren_mdl)?;
        assert_eq!(lineage.required_dataset_topo.len(), 2);
        let customer_name = lineage
            .required_dataset_topo
            .get(&Column::from_qualified_name("wrenai.public.a.c1"))
            .unwrap();
        assert_eq!(customer_name.node_count(), 3);
        assert_eq!(customer_name.edge_count(), 2);
        let mut iter = customer_name.node_indices();
        let first = iter.next().unwrap();
        let source = customer_name.node_weight(first).unwrap();
        assert_eq!(source, &Dataset::Model(wren_mdl.get_model("a").unwrap()));

        let second = iter.next().unwrap();
        let target = customer_name.node_weight(second).unwrap();
        assert_eq!(target, &Dataset::Model(wren_mdl.get_model("b").unwrap()));
        let first_edge = customer_name.find_edge(first, second).unwrap();
        let edge = customer_name.edge_weight(first_edge).unwrap();
        assert_eq!(edge.join_type, JoinType::OneToOne);
        assert_eq!(edge.condition, "a.a1 = b.a1");

        let third = iter.next().unwrap();
        let target = customer_name.node_weight(third).unwrap();
        assert_eq!(target, &Dataset::Model(wren_mdl.get_model("c").unwrap()));
        let second_edge = customer_name.find_edge(second, third).unwrap();
        let edge = customer_name.edge_weight(second_edge).unwrap();
        assert_eq!(edge.join_type, JoinType::OneToOne);
        assert_eq!(edge.condition, "b.b1 = c.b1");
        Ok(())
    }

    fn model_a() -> ModelBuilder {
        ModelBuilder::new("a")
            .table_reference("a")
            .column(ColumnBuilder::new("id", "varchar").build())
            .column(ColumnBuilder::new("a1", "varchar").build())
            .primary_key("id")
    }

    fn model_a_upper_case() -> ModelBuilder {
        ModelBuilder::new("A")
            .table_reference("a")
            .column(ColumnBuilder::new("Id", "varchar").build())
            .column(ColumnBuilder::new("A1", "varchar").build())
            .primary_key("Id")
    }

    fn model_b() -> ModelBuilder {
        ModelBuilder::new("b")
            .table_reference("b")
            .column(ColumnBuilder::new("id", "varchar").build())
            .column(ColumnBuilder::new("b1", "varchar").build())
            .column(ColumnBuilder::new("a1", "varchar").build())
            .primary_key("id")
    }

    fn model_c() -> ModelBuilder {
        ModelBuilder::new("c")
            .table_reference("c")
            .column(ColumnBuilder::new("id", "varchar").build())
            .column(ColumnBuilder::new("c1", "varchar").build())
            .column(ColumnBuilder::new("b1", "varchar").build())
            .primary_key("id")
    }

    #[test]
    fn test_validate_cube_valid() {
        let manifest = ManifestBuilder::new()
            .model(
                ModelBuilder::new("orders")
                    .table_reference("orders")
                    .column(ColumnBuilder::new("o_totalprice", "double").build())
                    .column(ColumnBuilder::new("o_orderstatus", "varchar").build())
                    .column(ColumnBuilder::new("o_orderdate", "date").build())
                    .build(),
            )
            .cube(
                CubeBuilder::new("order_metrics", "orders")
                    .measure(
                        MeasureBuilder::new("revenue", "SUM(o_totalprice)", "DOUBLE")
                            .build(),
                    )
                    .dimension(
                        CubeDimensionBuilder::new("status", "o_orderstatus", "VARCHAR")
                            .build(),
                    )
                    .time_dimension(
                        TimeDimensionBuilder::new("created_at", "o_orderdate", "DATE")
                            .build(),
                    )
                    .hierarchy("time_drill", vec!["created_at"])
                    .build(),
            )
            .build();
        if let Err(err) = AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        ) {
            panic!("expected Ok, got error: {err}");
        }
    }

    #[test]
    fn test_validate_cube_bad_base_object() {
        let manifest = ManifestBuilder::new()
            .cube(
                CubeBuilder::new("bad_cube", "nonexistent_model")
                    .measure(MeasureBuilder::new("count", "COUNT(*)", "BIGINT").build())
                    .build(),
            )
            .build();
        let result = AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        );
        let Err(err) = result else {
            panic!("expected error for unknown baseObject");
        };
        assert!(
            err.to_string().contains("not a defined Model or View"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn test_validate_cube_measure_cycle() {
        let manifest = ManifestBuilder::new()
            .model(
                ModelBuilder::new("orders")
                    .table_reference("orders")
                    .column(ColumnBuilder::new("amount", "double").build())
                    .build(),
            )
            .cube(
                CubeBuilder::new("cycle_cube", "orders")
                    .measure(MeasureBuilder::new("a", "b + 1", "DOUBLE").build())
                    .measure(MeasureBuilder::new("b", "a + 1", "DOUBLE").build())
                    .build(),
            )
            .build();
        let result = AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        );
        let Err(err) = result else {
            panic!("expected error for measure cycle");
        };
        assert!(
            err.to_string().contains("circular dependency"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn test_validate_cube_measure_self_reference() {
        let manifest = ManifestBuilder::new()
            .model(
                ModelBuilder::new("orders")
                    .table_reference("orders")
                    .column(ColumnBuilder::new("amount", "double").build())
                    .build(),
            )
            .cube(
                CubeBuilder::new("self_ref_cube", "orders")
                    .measure(
                        MeasureBuilder::new("revenue", "revenue * 1.1", "DOUBLE").build(),
                    )
                    .build(),
            )
            .build();
        let result = AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        );
        let Err(err) = result else {
            panic!("expected error for self-referential measure");
        };
        assert!(
            err.to_string().contains("circular dependency"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn test_validate_cube_bad_hierarchy() {
        let manifest = ManifestBuilder::new()
            .model(
                ModelBuilder::new("orders")
                    .table_reference("orders")
                    .column(ColumnBuilder::new("status_col", "varchar").build())
                    .build(),
            )
            .cube(
                CubeBuilder::new("bad_hier", "orders")
                    .measure(MeasureBuilder::new("count", "COUNT(*)", "BIGINT").build())
                    .dimension(
                        CubeDimensionBuilder::new("status", "status_col", "VARCHAR")
                            .build(),
                    )
                    .hierarchy("drill", vec!["status", "nonexistent_dim"])
                    .build(),
            )
            .build();
        let result = AnalyzedWrenMDL::analyze(
            manifest,
            Arc::new(HashMap::default()),
            Mode::Unparse,
        );
        let Err(err) = result else {
            panic!("expected error for bad hierarchy");
        };
        assert!(
            err.to_string().contains("unknown dimension"),
            "unexpected error: {err}"
        );
    }
}
