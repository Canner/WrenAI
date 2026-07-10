use datafusion::common::{plan_err, Result};
use std::fs;
use wren_core::mdl::builder::{ColumnBuilder, ManifestBuilder, ModelBuilder};
use wren_core::mdl::manifest::Manifest;

pub mod run;

/// Get the SQL statements from the specified query file
pub fn get_query_sql(query: usize) -> Result<Vec<String>> {
    if query > 0 && query < 23 {
        let possibilities = vec![
            format!("queries/tpch/q{query}.sql"),
            format!("benchmarks/queries/tpch/q{query}.sql"),
        ];
        let mut errors = vec![];
        for filename in possibilities {
            match fs::read_to_string(&filename) {
                Ok(contents) => {
                    return Ok(contents
                        .split(';')
                        .map(|s| s.trim())
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string())
                        .collect());
                }
                Err(e) => errors.push(format!("{filename}: {e}")),
            };
        }
        plan_err!("invalid query. Could not find query: {:?}", errors)
    } else {
        plan_err!("invalid query. Expected value between 1 and 22")
    }
}

fn tpch_manifest() -> Manifest {
    ManifestBuilder::new()
        .model(
            ModelBuilder::new("customer")
                .table_reference("datafusion.public.customer")
                .column(ColumnBuilder::new("c_custkey", "bigint").build())
                .column(ColumnBuilder::new("c_name", "varchar").build())
                .column(ColumnBuilder::new("c_address", "varchar").build())
                .column(ColumnBuilder::new("c_nationkey", "bigint").build())
                .column(ColumnBuilder::new("c_phone", "varchar").build())
                .column(ColumnBuilder::new("c_acctbal", "double").build())
                .column(ColumnBuilder::new("c_mktsegment", "varchar").build())
                .column(ColumnBuilder::new("c_comment", "varchar").build())
                .primary_key("c_custkey")
                .build(),
        )
        // Orders
        .model(
            ModelBuilder::new("orders")
                .table_reference("datafusion.public.orders")
                .column(ColumnBuilder::new("o_orderkey", "bigint").build())
                .column(ColumnBuilder::new("o_custkey", "bigint").build())
                .column(ColumnBuilder::new("o_orderstatus", "char").build())
                .column(ColumnBuilder::new("o_totalprice", "double").build())
                .column(ColumnBuilder::new("o_orderdate", "date").build())
                .column(ColumnBuilder::new("o_orderpriority", "varchar").build())
                .column(ColumnBuilder::new("o_clerk", "varchar").build())
                .column(ColumnBuilder::new("o_shippriority", "int").build())
                .column(ColumnBuilder::new("o_comment", "varchar").build())
                .primary_key("o_orderkey")
                .build(),
        )
        // Lineitem
        .model(
            ModelBuilder::new("lineitem")
                .table_reference("datafusion.public.lineitem")
                .column(ColumnBuilder::new("l_orderkey", "bigint").build())
                .column(ColumnBuilder::new("l_partkey", "bigint").build())
                .column(ColumnBuilder::new("l_suppkey", "bigint").build())
                .column(ColumnBuilder::new("l_linenumber", "int").build())
                .column(ColumnBuilder::new("l_quantity", "double").build())
                .column(ColumnBuilder::new("l_extendedprice", "double").build())
                .column(ColumnBuilder::new("l_discount", "double").build())
                .column(ColumnBuilder::new("l_tax", "double").build())
                .column(ColumnBuilder::new("l_returnflag", "char").build())
                .column(ColumnBuilder::new("l_linestatus", "char").build())
                .column(ColumnBuilder::new("l_shipdate", "date").build())
                .column(ColumnBuilder::new("l_commitdate", "date").build())
                .column(ColumnBuilder::new("l_receiptdate", "date").build())
                .column(ColumnBuilder::new("l_shipinstruct", "varchar").build())
                .column(ColumnBuilder::new("l_shipmode", "varchar").build())
                .column(ColumnBuilder::new("l_comment", "varchar").build())
                .primary_key("l_orderkey")
                .build(),
        )
        // Part
        .model(
            ModelBuilder::new("part")
                .table_reference("datafusion.public.part")
                .column(ColumnBuilder::new("p_partkey", "bigint").build())
                .column(ColumnBuilder::new("p_name", "varchar").build())
                .column(ColumnBuilder::new("p_mfgr", "varchar").build())
                .column(ColumnBuilder::new("p_brand", "varchar").build())
                .column(ColumnBuilder::new("p_type", "varchar").build())
                .column(ColumnBuilder::new("p_size", "int").build())
                .column(ColumnBuilder::new("p_container", "varchar").build())
                .column(ColumnBuilder::new("p_retailprice", "double").build())
                .column(ColumnBuilder::new("p_comment", "varchar").build())
                .primary_key("p_partkey")
                .build(),
        )
        // Partsupp
        .model(
            ModelBuilder::new("partsupp")
                .table_reference("datafusion.public.partsupp")
                .column(ColumnBuilder::new("ps_partkey", "bigint").build())
                .column(ColumnBuilder::new("ps_suppkey", "bigint").build())
                .column(ColumnBuilder::new("ps_availqty", "int").build())
                .column(ColumnBuilder::new("ps_supplycost", "double").build())
                .column(ColumnBuilder::new("ps_comment", "varchar").build())
                .primary_key("ps_partkey") // ps_partkey and ps_suppkey should be composite primary key
                .build(),
        )
        // Supplier
        .model(
            ModelBuilder::new("supplier")
                .table_reference("datafusion.public.supplier")
                .column(ColumnBuilder::new("s_suppkey", "bigint").build())
                .column(ColumnBuilder::new("s_name", "varchar").build())
                .column(ColumnBuilder::new("s_address", "varchar").build())
                .column(ColumnBuilder::new("s_nationkey", "bigint").build())
                .column(ColumnBuilder::new("s_phone", "varchar").build())
                .column(ColumnBuilder::new("s_acctbal", "double").build())
                .column(ColumnBuilder::new("s_comment", "varchar").build())
                .primary_key("s_suppkey")
                .build(),
        )
        // Nation
        .model(
            ModelBuilder::new("nation")
                .table_reference("datafusion.public.nation")
                .column(ColumnBuilder::new("n_nationkey", "bigint").build())
                .column(ColumnBuilder::new("n_name", "varchar").build())
                .column(ColumnBuilder::new("n_regionkey", "bigint").build())
                .column(ColumnBuilder::new("n_comment", "varchar").build())
                .primary_key("n_nationkey")
                .build(),
        )
        // Region
        .model(
            ModelBuilder::new("region")
                .table_reference("datafusion.public.region")
                .column(ColumnBuilder::new("r_regionkey", "bigint").build())
                .column(ColumnBuilder::new("r_name", "varchar").build())
                .column(ColumnBuilder::new("r_comment", "varchar").build())
                .primary_key("r_regionkey")
                .build(),
        )
        .build()
}
