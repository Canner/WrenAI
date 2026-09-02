use wren_core::mdl::builder::{
    ColumnBuilder, CubeBuilder, CubeDimensionBuilder, ManifestBuilder, MeasureBuilder,
    ModelBuilder,
};
use wren_core::mdl::{cube_query_to_sql, CubeOrderBy, CubeQuery, SortDirection};

#[test]
fn cube_query_public_order_by_types_generate_sql_without_a_limit() {
    let manifest = ManifestBuilder::new()
        .model(
            ModelBuilder::new("orders")
                .table_reference("orders")
                .column(ColumnBuilder::new("amount", "double").build())
                .column(ColumnBuilder::new("status", "varchar").build())
                .build(),
        )
        .cube(
            CubeBuilder::new("OrdersCube", "orders")
                .measure(MeasureBuilder::new("revenue", "SUM(amount)", "number").build())
                .dimension(
                    CubeDimensionBuilder::new("status", "status", "string").build(),
                )
                .build(),
        )
        .build();
    let query = CubeQuery {
        cube: "OrdersCube".to_string(),
        measures: vec!["revenue".to_string()],
        dimensions: vec!["status".to_string()],
        time_dimensions: vec![],
        filters: vec![],
        order_by: vec![CubeOrderBy {
            member: "revenue".to_string(),
            direction: SortDirection::Desc,
        }],
        limit: None,
        offset: None,
    };

    assert_eq!(
        cube_query_to_sql(&query, &manifest).unwrap(),
        "SELECT status AS status, SUM(amount) AS revenue FROM orders GROUP BY 1 ORDER BY 2 DESC"
    );
}
