use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use datafusion::common::{plan_err, Result};
use datafusion::prelude::{Expr, SessionContext};
use wren_core::logical_plan::analyze::access_control::{
    build_filter_expression, collect_condition,
};
use wren_core::mdl::builder::{
    ColumnBuilder, ManifestBuilder, ModelBuilder, RelationshipBuilder,
};
use wren_core::mdl::context::{
    apply_wren_on_ctx_with_access_control, Mode, SessionPropertiesRef,
};
use wren_core::mdl::manifest::{
    Column, ColumnLevelOperator, JoinType, Manifest, Model, RowLevelAccessControl,
    SessionProperty,
};
use wren_core::mdl::{
    create_wren_ctx, transform_sql_with_ctx, transform_sql_with_ctx_with_access_control,
    AnalyzedWrenMDL, SessionStateRef,
};
use wren_core::{
    AccessControlProvider, AccessScope, ColumnAccessDecision, WrenAccessControlProvider,
};

#[derive(Debug, Default)]
struct RecordingProvider {
    conditions: HashMap<String, String>,
    denied_columns: HashSet<String>,
    internal_only: HashSet<String>,
    fail_at: Option<&'static str>,
    row_calls: Mutex<Vec<(String, AccessScope)>>,
    column_calls: Mutex<Vec<String>>,
}

impl AccessControlProvider for RecordingProvider {
    fn row_filter(
        &self,
        model: &Model,
        state: &SessionStateRef,
        properties: &SessionPropertiesRef,
        mdl: Option<Arc<AnalyzedWrenMDL>>,
        scope: AccessScope,
    ) -> Result<Option<Expr>> {
        self.row_calls
            .lock()
            .unwrap()
            .push((model.name().into(), scope));
        if self.fail_at == Some("row") {
            return plan_err!("row provider unavailable");
        }
        if scope == AccessScope::DirectQuery && self.internal_only.contains(model.name())
        {
            return plan_err!("direct access denied to {}", model.name());
        }
        self.conditions
            .get(model.name())
            .map(|condition| {
                build_filter_expression(
                    state,
                    mdl,
                    Arc::new(model.clone()),
                    properties,
                    &RowLevelAccessControl {
                        name: "test filter".into(),
                        required_properties: vec![],
                        condition: condition.clone(),
                    },
                )
            })
            .transpose()
    }

    fn column_access(
        &self,
        model_name: &str,
        column: &Column,
        _properties: &SessionPropertiesRef,
        _mdl: Option<Arc<AnalyzedWrenMDL>>,
    ) -> Result<ColumnAccessDecision> {
        if self.fail_at == Some("column") {
            return plan_err!("column provider unavailable");
        }
        let name = format!("{model_name}.{}", column.name());
        self.column_calls.lock().unwrap().push(name.clone());
        Ok(if self.denied_columns.contains(&name) {
            ColumnAccessDecision::Deny {
                rule_name: "test restriction".into(),
            }
        } else {
            ColumnAccessDecision::Allow
        })
    }

    fn collect_required_fields(
        &self,
        model: &Model,
        _state: &SessionStateRef,
        _properties: &SessionPropertiesRef,
        _mdl: Option<Arc<AnalyzedWrenMDL>>,
    ) -> Result<Vec<Expr>> {
        if self.fail_at == Some("fields") {
            return plan_err!("fields provider unavailable");
        }
        match self.conditions.get(model.name()) {
            Some(condition) => Ok(collect_condition(model, condition)?.0),
            None => Ok(vec![]),
        }
    }
}

fn manifest() -> Manifest {
    ManifestBuilder::new()
        .catalog("wren")
        .schema("test")
        .model(
            ModelBuilder::new("items")
                .table_reference("items_remote")
                .column(ColumnBuilder::new("id", "int").build())
                .column(ColumnBuilder::new("tenant_id", "int").build())
                .column(
                    ColumnBuilder::new("secret", "string")
                        .column_level_access_control(
                            "mdl restriction",
                            vec![SessionProperty::new_required("level")],
                            ColumnLevelOperator::Equals,
                            "1",
                        )
                        .build(),
                )
                .column(
                    ColumnBuilder::new("label", "string")
                        .calculated(true)
                        .expression("secret")
                        .build(),
                )
                .primary_key("id")
                .build(),
        )
        .model(
            ModelBuilder::new("allowed")
                .table_reference("allowed_remote")
                .column(ColumnBuilder::new("id", "int").build())
                .column(ColumnBuilder::new("tenant_id", "int").build())
                .build(),
        )
        .build()
}

fn properties() -> SessionPropertiesRef {
    Arc::new(HashMap::from([
        ("level".into(), Some("0".into())),
        ("tenant".into(), Some("7".into())),
    ]))
}

#[cfg(feature = "multi-thread")]
#[tokio::test]
async fn synchronous_provider_api_rejects_active_runtime() -> Result<()> {
    let mdl = Arc::new(AnalyzedWrenMDL::analyze_with_unfiltered_schema(manifest())?);
    let error = wren_core::mdl::transform_sql_with_access_control(
        mdl,
        &[],
        HashMap::new(),
        "select id from items",
        Arc::new(RecordingProvider::default()),
    )
    .unwrap_err();
    assert!(error
        .to_string()
        .contains("use transform_sql_with_ctx_with_access_control"));
    Ok(())
}

#[cfg(feature = "multi-thread")]
#[test]
fn synchronous_provider_api_applies_filter() -> Result<()> {
    let mdl = Arc::new(AnalyzedWrenMDL::analyze_with_unfiltered_schema(manifest())?);
    let sql = wren_core::mdl::transform_sql_with_access_control(
        mdl,
        &[],
        HashMap::new(),
        "select id from items",
        Arc::new(RecordingProvider {
            conditions: HashMap::from([("items".into(), "tenant_id = 7".into())]),
            ..Default::default()
        }),
    )?;
    assert!(sql.contains("tenant_id = 7"), "{sql}");
    Ok(())
}

async fn transform(
    manifest: Manifest,
    sql: &str,
    provider: Arc<dyn AccessControlProvider>,
) -> Result<String> {
    let mdl = Arc::new(AnalyzedWrenMDL::analyze_with_unfiltered_schema(manifest)?);
    transform_sql_with_ctx_with_access_control(
        &create_wren_ctx(None, None),
        mdl,
        &[],
        properties(),
        sql,
        provider,
    )
    .await
}

#[tokio::test]
async fn default_provider_preserves_existing_results_and_errors() -> Result<()> {
    let manifest = manifest();
    let mdl = Arc::new(AnalyzedWrenMDL::analyze(
        manifest,
        properties(),
        Mode::Unparse,
    )?);
    for sql in [
        "SELECT id FROM items",
        "SELECT * FROM items",
        "SELECT count(*) FROM items i",
        "SELECT secret FROM items",
        "SELECT label FROM items",
    ] {
        let ctx = create_wren_ctx(None, None);
        let old = transform_sql_with_ctx(&ctx, mdl.clone(), &[], properties(), sql).await;
        let new = transform_sql_with_ctx_with_access_control(
            &ctx,
            mdl.clone(),
            &[],
            properties(),
            sql,
            Arc::new(WrenAccessControlProvider),
        )
        .await;
        assert_eq!(
            old.map_err(|e| e.to_string()),
            new.map_err(|e| e.to_string()),
            "{sql}"
        );
    }
    Ok(())
}

#[tokio::test]
async fn custom_provider_replaces_mdl_rules_before_source_columns_are_pruned(
) -> Result<()> {
    let custom = Arc::new(RecordingProvider::default());
    for sql in ["SELECT secret FROM items", "SELECT label FROM items"] {
        let output = transform(manifest(), sql, custom.clone()).await?;
        assert!(
            output.replace('"', "").contains("__source.secret"),
            "{output}"
        );
        let old_mdl = Arc::new(AnalyzedWrenMDL::analyze(
            manifest(),
            properties(),
            Mode::Unparse,
        )?);
        let error = transform_sql_with_ctx(
            &create_wren_ctx(None, None),
            old_mdl,
            &[],
            properties(),
            sql,
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("Permission Denied"), "{error}");
    }
    Ok(())
}

#[tokio::test]
async fn denial_is_pruned_for_wildcards_and_reported_for_explicit_references(
) -> Result<()> {
    let custom = Arc::new(RecordingProvider {
        denied_columns: HashSet::from(["items.secret".into(), "items.label".into()]),
        ..Default::default()
    });
    for sql in [
        "SELECT * FROM items",
        "SELECT count(*) FROM items",
        "SELECT id FROM items i",
    ] {
        let output = transform(manifest(), sql, custom.clone()).await?;
        assert!(!output.contains("secret"), "{output}");
    }
    for sql in [
        "SELECT secret FROM items",
        "SELECT id FROM items WHERE secret = 'x'",
        "SELECT i.id FROM items i JOIN items j ON i.secret = j.secret",
        "SELECT label FROM items",
    ] {
        let error = transform(manifest(), sql, custom.clone())
            .await
            .unwrap_err()
            .to_string();
        assert!(
            error.contains("Permission Denied") && error.contains("test restriction"),
            "{sql}: {error}"
        );
    }
    Ok(())
}

#[tokio::test]
async fn row_filter_projects_required_fields_without_exposing_them() -> Result<()> {
    let provider = Arc::new(RecordingProvider {
        conditions: HashMap::from([("items".into(), "tenant_id = @tenant".into())]),
        ..Default::default()
    });
    let sql = transform(manifest(), "SELECT id FROM items", provider.clone()).await?;
    assert!(
        sql.replace('"', "").starts_with("SELECT items.id FROM"),
        "{sql}"
    );
    assert!(
        sql.replace('"', "").contains("items.tenant_id = 7"),
        "{sql}"
    );
    assert!(provider
        .row_calls
        .lock()
        .unwrap()
        .contains(&("items".into(), AccessScope::DirectQuery)));
    Ok(())
}

#[tokio::test]
async fn only_provider_subqueries_receive_internal_scope() -> Result<()> {
    let provider = Arc::new(RecordingProvider {
        conditions: HashMap::from([
            ("items".into(), "id IN (SELECT id FROM allowed)".into()),
            ("allowed".into(), "tenant_id = @tenant".into()),
        ]),
        internal_only: HashSet::from(["allowed".into()]),
        ..Default::default()
    });
    let sql = transform(manifest(), "SELECT id FROM items", provider.clone()).await?;
    assert!(
        sql.contains("allowed_remote") && sql.contains("allowed.tenant_id = 7"),
        "{sql}"
    );
    assert!(provider
        .row_calls
        .lock()
        .unwrap()
        .contains(&("allowed".into(), AccessScope::InternalSubquery)));
    for query in [
        "SELECT id FROM allowed",
        "SELECT id FROM items WHERE id IN (SELECT id FROM allowed)",
    ] {
        let error = transform(manifest(), query, provider.clone())
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("direct access denied to allowed"), "{error}");
    }
    Ok(())
}

#[tokio::test]
async fn custom_filter_cycles_are_rejected() -> Result<()> {
    let provider = Arc::new(RecordingProvider {
        conditions: HashMap::from([
            ("items".into(), "id IN (SELECT id FROM allowed)".into()),
            ("allowed".into(), "id IN (SELECT id FROM items)".into()),
        ]),
        ..Default::default()
    });
    let error = transform(manifest(), "SELECT id FROM items", provider)
        .await
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("cycle in row level access control"),
        "{error}"
    );
    Ok(())
}

#[tokio::test]
async fn provider_errors_never_fall_back_to_mdl_rules() {
    for failure in ["row", "column", "fields"] {
        let provider = Arc::new(RecordingProvider {
            fail_at: Some(failure),
            ..Default::default()
        });
        let error = transform(manifest(), "SELECT id FROM items", provider)
            .await
            .unwrap_err()
            .to_string();
        assert!(
            error.contains(&format!("{failure} provider unavailable")),
            "{error}"
        );
    }
}

fn relationship_manifest() -> Manifest {
    ManifestBuilder::new()
        .catalog("wren")
        .schema("test")
        .model(
            ModelBuilder::new("parents")
                .table_reference("parents_remote")
                .column(ColumnBuilder::new("id", "int").build())
                .column(
                    ColumnBuilder::new("children", "children")
                        .relationship("parent_children")
                        .build(),
                )
                .column(
                    ColumnBuilder::new("total", "int")
                        .calculated(true)
                        .expression("sum(children.value)")
                        .build(),
                )
                .primary_key("id")
                .build(),
        )
        .model(
            ModelBuilder::new("children")
                .table_reference("children_remote")
                .column(ColumnBuilder::new("id", "int").build())
                .column(ColumnBuilder::new("parent_id", "int").build())
                .column(ColumnBuilder::new("value", "int").build())
                .primary_key("id")
                .build(),
        )
        .relationship(
            RelationshipBuilder::new("parent_children")
                .model("parents")
                .model("children")
                .join_type(JoinType::OneToMany)
                .condition("parents.id = children.parent_id")
                .build(),
        )
        .build()
}

#[tokio::test]
async fn relationship_calculations_use_the_selected_provider() -> Result<()> {
    let provider = Arc::new(RecordingProvider {
        conditions: HashMap::from([("children".into(), "value > 5".into())]),
        ..Default::default()
    });
    let sql = transform(
        relationship_manifest(),
        "SELECT total FROM parents",
        provider.clone(),
    )
    .await?;
    assert!(sql.replace('"', "").contains("children.value > 5"), "{sql}");
    assert!(provider
        .row_calls
        .lock()
        .unwrap()
        .contains(&("children".into(), AccessScope::DirectQuery)));
    let denied = Arc::new(RecordingProvider {
        denied_columns: HashSet::from(["children.value".into()]),
        ..Default::default()
    });
    let error = transform(relationship_manifest(), "SELECT total FROM parents", denied)
        .await
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("children") && error.contains("test restriction"),
        "{error}"
    );
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shared_context_does_not_leak_internal_scope_between_queries() -> Result<()> {
    let provider = Arc::new(RecordingProvider {
        conditions: HashMap::from([(
            "items".into(),
            "id IN (SELECT id FROM allowed)".into(),
        )]),
        internal_only: HashSet::from(["allowed".into()]),
        ..Default::default()
    });
    let mdl = Arc::new(AnalyzedWrenMDL::analyze_with_unfiltered_schema(manifest())?);
    let ctx = Arc::new(
        apply_wren_on_ctx_with_access_control(
            &create_wren_ctx(None, None),
            mdl,
            properties(),
            Mode::Unparse,
            provider,
        )
        .await?,
    );
    let mut tasks = vec![];
    for i in 0..12 {
        let ctx = ctx.clone();
        tasks.push(tokio::spawn(async move {
            let query = if i % 2 == 0 {
                "SELECT id FROM items"
            } else {
                "SELECT id FROM allowed"
            };
            let plan = ctx.state().create_logical_plan(query).await?;
            let result = ctx.state().optimize(&plan);
            if i % 2 == 0 {
                result?;
            } else {
                assert!(result
                    .unwrap_err()
                    .to_string()
                    .contains("direct access denied to allowed"));
            }
            Ok::<_, datafusion::error::DataFusionError>(())
        }));
    }
    for task in tasks {
        task.await.unwrap()?;
    }
    Ok(())
}

#[tokio::test]
async fn local_runtime_enforces_row_filter() -> Result<()> {
    let base = SessionContext::new();
    let data = base
        .sql("SELECT 1 AS id, 7 AS tenant_id, 'a' AS secret UNION ALL SELECT 2, 8, 'b'")
        .await?;
    let table = data.into_view();
    let mdl = Arc::new(AnalyzedWrenMDL::analyze_with_tables(
        manifest(),
        HashMap::from([("items_remote".into(), table)]),
    )?);
    let provider = Arc::new(RecordingProvider {
        conditions: HashMap::from([("items".into(), "tenant_id = @tenant".into())]),
        ..Default::default()
    });
    let ctx = apply_wren_on_ctx_with_access_control(
        &base,
        mdl,
        properties(),
        Mode::LocalRuntime,
        provider,
    )
    .await?;
    let result = ctx.sql("SELECT id FROM items").await?.collect().await?;
    assert_eq!(
        result.iter().map(|batch| batch.num_rows()).sum::<usize>(),
        1
    );
    assert_eq!(result[0].num_columns(), 1);
    Ok(())
}

#[tokio::test]
async fn calculated_columns_cannot_read_denied_source_columns() {
    let provider = Arc::new(RecordingProvider {
        denied_columns: HashSet::from(["items.secret".into()]),
        ..Default::default()
    });
    let error = transform(manifest(), "SELECT label FROM items", provider)
        .await
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("test restriction") && error.contains("secret"),
        "{error}"
    );
}

#[tokio::test]
async fn views_and_normalized_properties_use_custom_provider() -> Result<()> {
    let mut manifest = manifest();
    manifest.views.push(
        wren_core::mdl::builder::ViewBuilder::new("item_view")
            .statement("SELECT id FROM items")
            .build(),
    );
    let mdl = Arc::new(AnalyzedWrenMDL::analyze_with_unfiltered_schema(manifest)?);
    let provider = Arc::new(RecordingProvider {
        conditions: HashMap::from([("items".into(), "tenant_id = @tenant".into())]),
        ..Default::default()
    });
    let sql = transform_sql_with_ctx_with_access_control(
        &create_wren_ctx(None, None),
        mdl,
        &[],
        Arc::new(HashMap::from([("TENANT".into(), Some("7".into()))])),
        "SELECT id FROM item_view",
        provider,
    )
    .await?;
    assert!(sql.contains("tenant_id = 7"), "{sql}");
    Ok(())
}

#[cfg(feature = "multi-thread")]
#[test]
fn synchronous_entrypoint_keeps_custom_provider() -> Result<()> {
    let mdl = Arc::new(AnalyzedWrenMDL::analyze_with_unfiltered_schema(manifest())?);
    let provider = Arc::new(RecordingProvider {
        conditions: HashMap::from([("items".into(), "tenant_id = 7".into())]),
        ..Default::default()
    });
    let sql = wren_core::mdl::transform_sql_with_access_control(
        mdl,
        &[],
        HashMap::new(),
        "SELECT id FROM items",
        provider,
    )?;
    assert!(sql.contains("tenant_id = 7"), "{sql}");
    Ok(())
}

#[tokio::test]
async fn relationship_row_filter_subqueries_are_enforced_recursively() -> Result<()> {
    let mut manifest = relationship_manifest();
    manifest.models.push(
        ModelBuilder::new("allowed")
            .table_reference("allowed_remote")
            .column(ColumnBuilder::new("id", "int").build())
            .build(),
    );
    let provider = Arc::new(RecordingProvider {
        conditions: HashMap::from([
            (
                "children".into(),
                "value IN (SELECT id FROM allowed)".into(),
            ),
            ("allowed".into(), "id > 5".into()),
        ]),
        internal_only: HashSet::from(["allowed".into()]),
        ..Default::default()
    });
    let sql = transform(manifest, "SELECT total FROM parents", provider.clone()).await?;
    assert!(sql.contains("allowed_remote"), "{sql}");
    assert!(provider
        .row_calls
        .lock()
        .unwrap()
        .contains(&("allowed".into(), AccessScope::InternalSubquery)));
    Ok(())
}

#[tokio::test]
async fn relationship_filter_cycles_use_the_enclosing_query_stack() {
    let provider = Arc::new(RecordingProvider {
        conditions: HashMap::from([(
            "children".into(),
            "parent_id IN (SELECT id FROM parents)".into(),
        )]),
        ..Default::default()
    });
    let error = transform(
        relationship_manifest(),
        "SELECT total FROM parents",
        provider,
    )
    .await
    .unwrap_err()
    .to_string();
    assert!(
        error.contains("cycle in row level access control"),
        "{error}"
    );
}
