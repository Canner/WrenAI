---
sidebar_label: Spark
---

# Connect Spark

Wren AI connects to Spark via **Spark Connect** — a remote SQL endpoint exposed by a Spark cluster.

## Install the extra

```bash
pip install "wren-engine[spark,main]"
```

## Profile fields

```yaml
datasource: spark
host: ${SPARK_HOST}
port: ${SPARK_PORT}      # default Spark Connect port is 15002
```

| Field | Required | Description |
|---|---|---|
| `host` | yes | Hostname of the Spark Connect server |
| `port` | yes | Spark Connect port (typically `15002`) |

## Enable Spark Connect on the cluster

Spark Connect must be running on the target cluster. Start it with:

```bash
./sbin/start-connect-server.sh --packages org.apache.spark:spark-connect_2.12:3.5.0
```

See the [Spark Connect docs](https://spark.apache.org/docs/latest/spark-connect-overview.html) for cluster-side setup.

## Common errors

- `Connection refused` — Spark Connect server is not running on the host/port, or a firewall is blocking it.
- `Version mismatch` — the local PySpark version must match the cluster's Spark version.

See the [overview](./overview.md) for the rest of the workflow.
