# RepairQ WrenAI - Quick Start

## Our Fork
This is RepairQ's fork of WrenAI, modified for Oracle ADB 19c integration.

**Philosophy**: Make Wren work for US, not the other way around!

## Build from Source

```bash
cd Wren-Workspace/WrenAI
./build.sh
```

This builds all services with our Oracle fixes baked in.

## Start the Stack

```bash
cd docker
docker compose up -d
```

## Access WrenAI

Open http://localhost:3000 in your browser

## Configure Oracle Connection

1. Click "Add Connection"
2. Select "Oracle"
3. Enter your Oracle ADB connection details:
   - **Host**: u7evvvue.adb.us-ashburn-1.oraclecloud.com
   - **Port**: 1522
   - **Service Name**: (from tnsnames.ora)
   - **Username**: REPORTS_ASSURANTDEV
   - **Password**: (your password)
   - **Wallet**: Upload your wallet zip

4. Click "Test Connection" then "Save"

## View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f ibis-server
docker compose logs -f wren-engine
```

## Stop the Stack

```bash
docker compose down
```

## Rebuild After Code Changes

```bash
# Rebuild specific service
docker compose build ibis-server

# Rebuild all
docker compose build

# Restart after rebuild
docker compose up -d
```

## Troubleshooting

### Data Preview Fails
- Check ibis-server logs: `docker compose logs ibis-server`
- Look for SQL queries being sent to Oracle
- Verify compact format (no CTEs for Oracle)

### Connection Issues
- Verify VPN is connected
- Check wallet files are correct
- Test connection with Python script first

### Build Failures
- Clean Docker cache: `docker system prune -a`
- Rebuild: `./build.sh`

## Key Modifications

1. **oracle.py** - Returns raw table names (no schema prefix)
2. **wren-core/mod.rs** - Disables pretty printing for Oracle (no CTEs)

## Support

Contact RepairQ team for issues with this fork.

For upstream WrenAI issues, see: https://github.com/Canner/WrenAI
