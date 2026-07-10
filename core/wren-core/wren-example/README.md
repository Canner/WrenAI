# Wren Engine Examples
The crate includes several examples of how to use Wren Engine APIs and help you on your way.

## Running Examples

To run the examples, use the `cargo run` command, such as:

```bash
git clone https://github.com/Canner/WrenAI.git
cd WrenAI/core/wren-core

# Run the `datafusion_apply` example:
# ... use the equivalent for other examples
cargo run --example datafusion-apply
```

## Single Process
- [`datafusion-apply.rs`](examples/datafusion-apply.rs): Apply an Modeling Definition Language(MDL) to a DataFusion to query local CSV files
- [`plan_to_sql.rs`](examples/plan_to-sql.rs): Apply an Modeling Definition Language(MDL) to generate SQL from Datafusion `Expr` and `LogicalPlan`