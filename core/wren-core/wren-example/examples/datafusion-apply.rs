use std::collections::HashMap;
use std::sync::Arc;

use datafusion::error::Result;
use datafusion::prelude::{CsvReadOptions, SessionContext};
use wren_core::mdl::builder::{
    ColumnBuilder, ManifestBuilder, ModelBuilder, RelationshipBuilder,
};
use wren_core::mdl::manifest::{JoinType, Manifest};
use wren_core::mdl::{transform_sql_with_ctx, AnalyzedWrenMDL};

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();
    let manifest = init_manifest();

    // register the table
    let ctx = SessionContext::new();
    ctx.register_csv(
        "orders",
        "sqllogictest/tests/resources/ecommerce/orders.csv",
        CsvReadOptions::new(),
    )
    .await?;
    let provider = ctx
        .catalog("datafusion")
        .unwrap()
        .schema("public")
        .unwrap()
        .table("orders")
        .await?
        .unwrap();

    ctx.register_csv(
        "customers",
        "sqllogictest/tests/resources/ecommerce/customers.csv",
        CsvReadOptions::new(),
    )
    .await?;
    let customers_provider = ctx
        .catalog("datafusion")
        .unwrap()
        .schema("public")
        .unwrap()
        .table("customers")
        .await?
        .unwrap();

    ctx.register_csv(
        "order_items",
        "sqllogictest/tests/resources/ecommerce/order_items.csv",
        CsvReadOptions::new(),
    )
    .await?;
    let order_items_provider = ctx
        .catalog("datafusion")
        .unwrap()
        .schema("public")
        .unwrap()
        .table("order_items")
        .await?
        .unwrap();

    let register = HashMap::from([
        ("datafusion.public.orders".to_string(), provider),
        (
            "datafusion.public.customers".to_string(),
            customers_provider,
        ),
        (
            "datafusion.public.order_items".to_string(),
            order_items_provider,
        ),
    ]);
    let analyzed_mdl =
        Arc::new(AnalyzedWrenMDL::analyze_with_tables(manifest, register)?);

    // TODO: there're some issue for optimize rules
    // let ctx = create_ctx_with_mdl(&ctx, analyzed_mdl).await?;
    let sql = "select * from wrenai.public.order_items";
    let sql = transform_sql_with_ctx(&ctx, analyzed_mdl, &[], HashMap::new().into(), sql)
        .await?;
    println!("Wren engine generated SQL: \n{sql}");
    // create a plan to run a SQL query
    let df = match ctx.sql(&sql).await {
        Ok(df) => df,
        Err(e) => {
            eprintln!("Error: {e}");
            return Err(e);
        }
    };
    match df.show().await {
        Ok(_) => {}
        Err(e) => eprintln!("Error: {e}"),
    }
    Ok(())
}

fn init_manifest() -> Manifest {
    ManifestBuilder::new()
        .model(
            ModelBuilder::new("customers")
                .table_reference("datafusion.public.customers")
                .column(ColumnBuilder::new("city", "varchar").build())
                .column(ColumnBuilder::new("id", "varchar").build())
                .column(ColumnBuilder::new("state", "varchar").build())
                .primary_key("id")
                .build(),
        )
        .model(
            ModelBuilder::new("order_items")
                .table_reference("datafusion.public.order_items")
                .column(ColumnBuilder::new("freight_value", "double").build())
                .column(ColumnBuilder::new("id", "bigint").build())
                .column(ColumnBuilder::new("item_number", "bigint").build())
                .column(ColumnBuilder::new("order_id", "varchar").build())
                .column(ColumnBuilder::new("price", "double").build())
                .column(ColumnBuilder::new("product_id", "varchar").build())
                .column(ColumnBuilder::new("shipping_limit_date", "varchar").build())
                .column(
                    ColumnBuilder::new("orders", "orders")
                        .relationship("orders_order_items")
                        .build(),
                )
                .column(
                    ColumnBuilder::new("customer_state", "varchar")
                        .calculated(true)
                        .expression("orders.customers.state")
                        .build(),
                )
                .primary_key("id")
                .build(),
        )
        .model(
            ModelBuilder::new("orders")
                .table_reference("datafusion.public.orders")
                .column(ColumnBuilder::new("approved_timestamp", "varchar").build())
                .column(ColumnBuilder::new("customer_id", "varchar").build())
                .column(ColumnBuilder::new("delivered_carrier_date", "varchar").build())
                .column(ColumnBuilder::new("estimated_delivery_date", "varchar").build())
                .column(ColumnBuilder::new("order_id", "varchar").build())
                .column(ColumnBuilder::new("purchase_timestamp", "varchar").build())
                .column(
                    ColumnBuilder::new("customers", "customers")
                        .relationship("orders_customer")
                        .build(),
                )
                .column(
                    ColumnBuilder::new("customer_state", "varchar")
                        .calculated(true)
                        .expression("customers.state")
                        .build(),
                )
                .build(),
        )
        .relationship(
            RelationshipBuilder::new("orders_customer")
                .model("orders")
                .model("customers")
                .join_type(JoinType::ManyToOne)
                .condition("orders.customer_id = customers.id")
                .build(),
        )
        .relationship(
            RelationshipBuilder::new("orders_order_items")
                .model("orders")
                .model("order_items")
                .join_type(JoinType::ManyToOne)
                .condition("orders.order_id = order_items.order_id")
                .build(),
        )
        .build()
}
