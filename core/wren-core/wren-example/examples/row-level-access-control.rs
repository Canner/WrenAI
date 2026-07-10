use std::collections::HashMap;
use std::sync::Arc;

use datafusion::prelude::{CsvReadOptions, SessionContext};
use wren_core::mdl::builder::{
    ColumnBuilder, ManifestBuilder, ModelBuilder, RelationshipBuilder,
};
use wren_core::mdl::manifest::{JoinType, Manifest, SessionProperty};
use wren_core::mdl::{transform_sql_with_ctx, AnalyzedWrenMDL};

/// It's an example to show how to use wren engine to set up row level access control
/// for a multi-tenant application.
#[tokio::main]
async fn main() -> datafusion::common::Result<()> {
    let manifest = init_manifest();
    let ctx = SessionContext::new();

    ctx.register_csv(
        "documents",
        "wren-example/data/company/documents.csv",
        CsvReadOptions::new(),
    )
    .await?;
    let documents = ctx
        .catalog("datafusion")
        .unwrap()
        .schema("public")
        .unwrap()
        .table("documents")
        .await?
        .unwrap();

    ctx.register_csv(
        "tenants",
        "wren-example/data/company/tenants.csv",
        CsvReadOptions::new(),
    )
    .await?;
    let tenants = ctx
        .catalog("datafusion")
        .unwrap()
        .schema("public")
        .unwrap()
        .table("tenants")
        .await?
        .unwrap();

    ctx.register_csv(
        "users",
        "wren-example/data/company/users.csv",
        CsvReadOptions::new(),
    )
    .await?;
    let users = ctx
        .catalog("datafusion")
        .unwrap()
        .schema("public")
        .unwrap()
        .table("users")
        .await?
        .unwrap();

    let register = HashMap::from([
        ("datafusion.public.documents".to_string(), documents),
        ("datafusion.public.tenants".to_string(), tenants),
        ("datafusion.public.users".to_string(), users),
    ]);

    let json_str = serde_json::to_string(&manifest).unwrap();
    println!("Manifest JSON: \n{json_str}");

    let analyzed_mdl =
        Arc::new(AnalyzedWrenMDL::analyze_with_tables(manifest, register)?);
    // carry the seesion property
    let mut properties = HashMap::new();
    properties.insert(
        "session_tenant_id".to_string(),
        Some("'1acdef01-aaaa-aaaa-aaaa-aaaaaaaaaaaa'".to_string()),
    );
    properties.insert(
        "session_department".to_string(),
        Some("'engineering'".to_string()),
    );
    properties.insert("session_user_id".to_string(), Some("'1003-u3'".to_string()));
    properties.insert("session_role".to_string(), Some("'ADMIN'".to_string()));

    println!("#####################");
    println!(
        "session_tenant_id: {}",
        &properties
            .get("session_tenant_id")
            .unwrap()
            .clone()
            .unwrap()
    );
    println!(
        "session_department: {}",
        &properties
            .get("session_department")
            .unwrap()
            .clone()
            .unwrap()
    );
    println!(
        "session_user_id: {}",
        &properties.get("session_user_id").unwrap().clone().unwrap()
    );
    println!(
        "session_role: {}",
        &properties.get("session_role").unwrap().clone().unwrap()
    );

    let sql = "select * from wren.test.documents";
    let sql =
        transform_sql_with_ctx(&ctx, analyzed_mdl, &[], properties.into(), sql).await?;
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

    println!("#####################");
    println!("Wren engine generated SQL: \n{sql}");

    Ok(())
}

fn init_manifest() -> Manifest {
    ManifestBuilder::new()
    .catalog("wren")
    .schema("test")
    .model(ModelBuilder::new("tenants")
        .table_reference("datafusion.public.tenants")
        .column(ColumnBuilder::new("id", "string").build())
        .column(ColumnBuilder::new("name", "string").build())
        .primary_key("id")
        .build())
    .model(ModelBuilder::new("users")
    .table_reference("datafusion.public.users")
        .column(ColumnBuilder::new("id", "string").build())
        .column(ColumnBuilder::new("email", "string").build())
        .column(ColumnBuilder::new("tenant_id", "string").build())
        .column(ColumnBuilder::new("name", "string").build())
        .column(ColumnBuilder::new("role", "string").build())
        .column(ColumnBuilder::new("department", "string").build())
        .column(ColumnBuilder::new("tenants", "tenants")
            .relationship("tenants_users")
            .build())
        .primary_key("id")
        .build())
    .model(ModelBuilder::new("documents")
    .table_reference("datafusion.public.documents")
        .column(ColumnBuilder::new("id", "string").build())
        .column(ColumnBuilder::new("tenant_id", "string").build())
        .column(ColumnBuilder::new("department", "string").build())
        .column(ColumnBuilder::new("created_by", "string").build())
        .column(ColumnBuilder::new("title", "string").build())
        .column(ColumnBuilder::new("content", "string").build())
        .column(ColumnBuilder::new("status", "string").build())
        .column(ColumnBuilder::new("created_at", "timestamp").build())
        // This is a row level access control allow the user to see the documents in the following rules:
        // 1. The user only can see the documents in his tenant
        .add_row_level_access_control("multitenant", vec![SessionProperty::new_required("session_tenant_id")], "tenant_id = @session_tenant_id")
        // This is a row level access control allow the user to see the documents in the following rules:
        // 1. Member only can see the documents created by himself or the documents with status 'PUBLIC' in his department
        // 2. Admin can see all the documents
        .add_row_level_access_control("auth", vec![
            SessionProperty::new_optional("session_role", Some("'MEMBER'".to_string())),
            SessionProperty::new_required("session_department"),
            SessionProperty::new_required("session_user_id")],
             "@session_role = 'ADMIN' OR (department = @session_department AND (created_by = @session_user_id OR status = 'PUBLIC'))")
        .build())
    .relationship(RelationshipBuilder::new("tenants_users").model("tenants")
        .model("users")
        .join_type(JoinType::OneToMany)
        .condition("tenants.id = users.tenant_id")
        .build())
    .relationship(RelationshipBuilder::new("users_documents").model("users")
        .model("documents")
        .join_type(JoinType::OneToMany)
        .condition("users.id = documents.created_by")
        .build())
        .relationship(RelationshipBuilder::new("tenants_documents").model("tenants")
        .model("documents")
        .join_type(JoinType::OneToMany)
        .condition("tenants.id = documents.tenant_id")
        .build())
    .build()
}
