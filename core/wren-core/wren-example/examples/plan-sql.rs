use std::collections::HashMap;
use std::sync::Arc;
use wren_core::mdl::builder::{
    ColumnBuilder, ManifestBuilder, ModelBuilder, RelationshipBuilder,
};
use wren_core::mdl::context::Mode;
use wren_core::mdl::manifest::{DataSource, JoinType, Manifest};
use wren_core::mdl::{create_wren_ctx, transform_sql_with_ctx, AnalyzedWrenMDL};

#[tokio::main]
async fn main() -> datafusion::common::Result<()> {
    let manifest = init_manifest();
    let analyzed_mdl = Arc::new(AnalyzedWrenMDL::analyze(
        manifest,
        Arc::new(HashMap::default()),
        Mode::Unparse,
    )?);

    let sql = "select customer_state from wrenai.public.orders_model";
    println!("Original SQL: \n{sql}");
    let sql = transform_sql_with_ctx(
        &create_wren_ctx(None, Some(&DataSource::BigQuery)),
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
        .model(
            ModelBuilder::new("order_items_model")
                .table_reference("datafusion.public.order_items")
                .column(ColumnBuilder::new("freight_value", "double").build())
                .column(ColumnBuilder::new("id", "bigint").build())
                .column(ColumnBuilder::new("item_number", "bigint").build())
                .column(ColumnBuilder::new("order_id", "varchar").build())
                .column(ColumnBuilder::new("price", "double").build())
                .column(ColumnBuilder::new("product_id", "varchar").build())
                .column(ColumnBuilder::new("shipping_limit_date", "varchar").build())
                .column(
                    ColumnBuilder::new("orders_model", "orders_model")
                        .relationship("orders_order_items")
                        .build(),
                )
                .column(
                    ColumnBuilder::new("customer_state", "varchar")
                        .calculated(true)
                        .expression("orders_model.customers_model.state")
                        .build(),
                )
                .primary_key("id")
                .build(),
        )
        .model(
            ModelBuilder::new("orders_model")
                .table_reference("datafusion.public.orders")
                .column(ColumnBuilder::new("approved_timestamp", "varchar").build())
                .column(ColumnBuilder::new("customer_id", "varchar").build())
                .column(ColumnBuilder::new("delivered_carrier_date", "varchar").build())
                .column(ColumnBuilder::new("estimated_delivery_date", "varchar").build())
                .column(ColumnBuilder::new("order_id", "varchar").build())
                .column(ColumnBuilder::new("purchase_timestamp", "varchar").build())
                .column(
                    ColumnBuilder::new("customers_model", "customers_model")
                        .relationship("orders_customer")
                        .build(),
                )
                .column(
                    ColumnBuilder::new("customer_state", "varchar")
                        .calculated(true)
                        .expression("customers_model.state")
                        .build(),
                )
                .build(),
        )
        .relationship(
            RelationshipBuilder::new("orders_customer")
                .model("orders_model")
                .model("customers_model")
                .join_type(JoinType::ManyToOne)
                .condition("orders_model.customer_id = customers_model.id")
                .build(),
        )
        .relationship(
            RelationshipBuilder::new("orders_order_items")
                .model("orders_model")
                .model("order_items_model")
                .join_type(JoinType::ManyToOne)
                .condition("orders_model.order_id = order_items_model.order_id")
                .build(),
        )
        .build()
}
