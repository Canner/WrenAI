# RepairQ WrenAI - Building from Source

## Our Philosophy

**"Make wren work for US, let's not work for WREN"**

This is our fork. We build everything from source to maintain full control over the codebase, especially for Oracle ADB 19c integration with views that have spaces in their names.

## What We Changed

### 1. oracle.py (Python - ibis-server)
- Returns raw table names without schema prefix or extra quotes
- Stores clean data in SQLite: `"RT Model"` (not `REPORTS_ASSURANTDEV."RT Model"`)

### 2. wren-core/mod.rs (Rust - ibis-server)
- **Critical Fix**: Disabled pretty printing for Oracle data source
- **Why**: Oracle interprets CTEs with same name as source tables as recursive CTEs
- **Location**: `wren-engine/wren-core/core/src/mdl/mod.rs` line ~426
```rust
let use_pretty = !matches!(data_source, DataSource::Oracle);
```

## Building from Source

All services are now built from our RepairQ fork:

```bash
cd Wren-Workspace/WrenAI/docker
docker compose build
```

### Services Built:
1. **wren-engine** - Java/Trino-based legacy engine
2. **ibis-server** - Python + Rust (includes our Oracle CTE fix)
3. **wren-ai-service** - Python AI service
4. **wren-ui** - Next.js frontend

### Why We Build Everything:
- **Full Control**: No dependency on upstream images
- **Oracle Integration**: Our Rust fix is compiled into ibis-server
- **Transparency**: We know exactly what's running
- **Flexibility**: Easy to modify any component

## No More Overrides!

We don't use `docker-compose.override.yml` for core functionality.  
We don't mount volumes to "fix" pre-built images.  
**We control the source. We build the images.**

## Running the Stack

```bash
cd Wren-Workspace/WrenAI/docker
docker compose up -d
```

## The Oracle CTE Fix

**Problem**: Oracle was rejecting queries with `ORA-00923` error for tables with spaces.

**Root Cause**: wren-engine was reformatting SQL with CTEs:
```sql
WITH "RT Model" AS (
  SELECT ... FROM "RT Model" ...
)
SELECT ... FROM "RT Model"
```

Oracle sees this as a recursive CTE (since the CTE name matches the source table) and requires column aliases.

**Solution**: Disable pretty printing for Oracle in `wren-core/mod.rs`:
```rust
let use_pretty = !matches!(data_source, DataSource::Oracle);
```

This keeps SQL in compact format that Oracle accepts:
```sql
SELECT ... FROM (SELECT ... FROM "RT Model" "RT Model") "RT Model" FETCH FIRST 500 ROWS ONLY
```

## Commit Strategy

1. All changes go to `oracle-adb-integration` branch
2. Test thoroughly with all 99 Oracle views
3. Document everything
4. Keep upstream `main` clean for potential PRs back to Canner/WrenAI

---

**Built by RepairQ - October 2025**
