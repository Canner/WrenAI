# Wren Core Module

The Wren Core module serves as the semantic core of the Wren engine. To understand the concepts behind it, refer to [What is MDL?](https://docs.getwren.ai/oss/concepts/what_is_mdl) in the Wren AI Core documentation.

This module handles SQL planning for the [`wren` CLI and SDK](../wren/) through its Python bindings, [wren-core-py](../wren-core-py/), and is also compiled to WebAssembly in [wren-core-wasm](../wren-core-wasm/).

## How to Test / Build

- **Run Tests**:
  - Most unit test cases are located in `src/mdl/mod.rs`.
  - SQL end-to-end tests are executed using `sqllogictests`.

You can run all tests with the following command:
```
cargo test
```


## Coding Style

Please ensure your code is properly formatted before submitting a pull request. Use `rustfmt` for Rust files and `taplo` for formatting TOML files.

### Format with rustfmt

Run the following command to format Rust code:

```
cargo fmt
```

### Format TOML with taplo

Install `taplo-cli` and format TOML files with the following commands:

```
cargo install taplo-cli --locked
taplo fmt
```