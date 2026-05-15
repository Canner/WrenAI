---
sidebar_label: Redshift
---

# Connect Redshift

## Install the extra

```bash
pip install "wren-engine[redshift,main]"
```

## Profile fields

```yaml
datasource: redshift
host: ${REDSHIFT_HOST}                     # cluster.xxxxx.region.redshift.amazonaws.com
port: ${REDSHIFT_PORT}                     # 5439
database: ${REDSHIFT_DATABASE}
user: ${REDSHIFT_USER}
password: ${REDSHIFT_PASSWORD}
sslmode: require
```

| Field | Required | Description |
|---|---|---|
| `host` | yes | Cluster endpoint hostname |
| `port` | yes | Default `5439` |
| `database` | yes | |
| `user` | yes | Redshift user (not IAM user) |
| `password` | yes | |
| `sslmode` | no | `require` recommended |

## IAM-based auth

For IAM-based (instead of password) auth, use the AWS CLI to fetch a temporary password and inject it:

```bash
aws redshift get-cluster-credentials --cluster-identifier <id> --db-user <user> --db-name <db>
```

## Common errors

- `Connection refused / no route` — IP not in the cluster's security group. Add your egress IP to the inbound rules.
- `password authentication failed` — token expired (if using IAM); re-fetch.

See the [overview](./overview.md) for the rest of the workflow.
