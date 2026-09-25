use std::collections::HashMap;
use std::sync::Arc;

use datafusion::common::{Column as DFColumn, Result, TableReference};
use datafusion::prelude::{col, lit, Expr};
use wren_core::mdl::builder::{ColumnBuilder, ManifestBuilder, ModelBuilder};
use wren_core::mdl::context::SessionPropertiesRef;
use wren_core::mdl::manifest::{Column, Model};
use wren_core::mdl::{
    create_wren_ctx, transform_sql_with_ctx_with_access_control, AnalyzedWrenMDL,
    SessionStateRef,
};
use wren_core::{AccessControlProvider, AccessScope, ColumnAccessDecision};

/// The host application supplies the authenticated tenant for this request.
#[derive(Debug)]
struct TenantAccess {
    tenant_id: i64,
}

impl AccessControlProvider for TenantAccess {
    fn row_filter(
        &self,
        model: &Model,
        _state: &SessionStateRef,
        _properties: &SessionPropertiesRef,
        _mdl: Option<Arc<AnalyzedWrenMDL>>,
        _scope: AccessScope,
    ) -> Result<Option<Expr>> {
        Ok(Some(
            col(DFColumn::new(
                Some(TableReference::bare(model.name())),
                "tenant_id",
            ))
            .eq(lit(self.tenant_id)),
        ))
    }

    fn column_access(
        &self,
        _model_name: &str,
        column: &Column,
        _properties: &SessionPropertiesRef,
        _mdl: Option<Arc<AnalyzedWrenMDL>>,
    ) -> Result<ColumnAccessDecision> {
        Ok(if column.name() == "internal_note" {
            ColumnAccessDecision::Deny {
                rule_name: "internal notes".into(),
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
        Ok(vec![col(DFColumn::new(
            Some(TableReference::bare(model.name())),
            "tenant_id",
        ))])
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let manifest = ManifestBuilder::new()
        .catalog("wren")
        .schema("public")
        .model(
            ModelBuilder::new("documents")
                .table_reference("documents_data")
                .column(ColumnBuilder::new("id", "int").build())
                .column(ColumnBuilder::new("tenant_id", "int").build())
                .column(ColumnBuilder::new("title", "string").build())
                .column(ColumnBuilder::new("internal_note", "string").build())
                .build(),
        )
        .build();
    let mdl = Arc::new(AnalyzedWrenMDL::analyze_with_unfiltered_schema(manifest)?);
    let provider = Arc::new(TenantAccess { tenant_id: 7 });
    let sql = transform_sql_with_ctx_with_access_control(
        &create_wren_ctx(None, None),
        mdl,
        &[],
        Arc::new(HashMap::new()),
        "SELECT id, title FROM documents",
        provider,
    )
    .await?;
    println!("{sql}");
    Ok(())
}
