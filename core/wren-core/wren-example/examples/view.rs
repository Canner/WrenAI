use std::collections::HashMap;
use std::sync::Arc;

use datafusion::prelude::SessionContext;

use wren_core::mdl::builder::{
    ColumnBuilder, ManifestBuilder, ModelBuilder, ViewBuilder,
};
use wren_core::mdl::context::Mode;
use wren_core::mdl::manifest::Manifest;
use wren_core::mdl::{transform_sql_with_ctx, AnalyzedWrenMDL};

#[tokio::main]
async fn main() -> datafusion::common::Result<()> {
    let manifest = init_manifest();
    let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
        manifest,
        Arc::new(HashMap::default()),
        Mode::Unparse,
    )?);

    let sql = "select * from wrenai.public.customers_view";
    println!("Original SQL: \n{sql}");
    let sql = transform_sql_with_ctx(
        &SessionContext::new(),
        analyzed_mdl,
        &[],
        HashMap::new().into(),
        sql,
    )
    .await?;
    println!("Wren engine generated SQL: \n{sql}");
    Ok(())
}

fn init_manifest() -> Manifest {
    ManifestBuilder::new()
        .model(
            ModelBuilder::new("customers_model")
                .table_reference("datafusion.public.customers")
                .column(ColumnBuilder::new("city", "varchar").build())
                .column(ColumnBuilder::new("id", "varchar").build())
                .column(ColumnBuilder::new("state", "varchar").build())
                .primary_key("id")
                .build(),
        )
        .view(
            ViewBuilder::new("customers_view")
                .statement("select * from wrenai.public.customers_model")
                .build(),
        )
        .build()
}
