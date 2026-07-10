# Popular dlt Verified Sources — Quick Reference

## Source Auth Patterns

| Source | Auth Method | Credential | Env Variable |
|--------|-----------|------------|-------------|
| HubSpot | Private App Token | PAT string | `SOURCES__HUBSPOT__API_KEY` |
| Stripe | Secret Key | `sk_live_...` or `sk_test_...` | `SOURCES__STRIPE_ANALYTICS__STRIPE_SECRET_KEY` |
| Salesforce | Username + Password + Security Token | 3 fields | `SOURCES__SALESFORCE__USERNAME`, `__PASSWORD`, `__SECURITY_TOKEN` |
| GitHub | Personal Access Token | `ghp_...` | `SOURCES__GITHUB__ACCESS_TOKEN` |
| Slack | Bot Token | `xoxb-...` | `SOURCES__SLACK__ACCESS_TOKEN` |
| Google Analytics | Service Account JSON | JSON key file | `SOURCES__GOOGLE_ANALYTICS__CREDENTIALS` (JSON string or file path) |
| Google Sheets | Service Account JSON | JSON key file | `SOURCES__GOOGLE_SHEETS__CREDENTIALS` |
| Notion | Integration Token | `secret_...` | `SOURCES__NOTION__API_KEY` |
| Jira | Email + API Token | 2 fields | `SOURCES__JIRA__SUBDOMAIN`, `__EMAIL`, `__API_TOKEN` |
| Zendesk | Email + API Token | 2 fields | `SOURCES__ZENDESK__SUBDOMAIN`, `__EMAIL`, `__PASSWORD` |
| Shopify | Admin API Access Token | token string | `SOURCES__SHOPIFY__PRIVATE_APP_PASSWORD` |
| Airtable | Personal Access Token | `pat...` | `SOURCES__AIRTABLE__ACCESS_TOKEN` |

## Pipeline Script Templates

### HubSpot

```python
import dlt
from dlt.sources.rest_api import rest_api_source

# Or use the dedicated hubspot source if available:
# dlt init hubspot duckdb
# Then: from hubspot import hubspot

pipeline = dlt.pipeline(
    pipeline_name="hubspot",
    destination="duckdb",
    dataset_name="hubspot_data",
)

# With the verified source:
from hubspot import hubspot_source
source = hubspot_source(api_key=dlt.secrets.value)
info = pipeline.run(source)
print(info)
```

**Typical tables produced:** contacts, companies, deals, tickets, owners, pipelines, stages, emails, calls, meetings, notes, tasks, products, line_items, quotes

### Stripe

```python
import dlt
from stripe_analytics import stripe_source

pipeline = dlt.pipeline(
    pipeline_name="stripe",
    destination="duckdb",
    dataset_name="stripe_data",
)

source = stripe_source()
info = pipeline.run(source)
print(info)
```

**Typical tables produced:** customers, charges, invoices, subscriptions, products, prices, payment_intents, refunds, balance_transactions, events

### GitHub

```python
import dlt
from github import github_reactions, github_repo_events

pipeline = dlt.pipeline(
    pipeline_name="github",
    destination="duckdb",
    dataset_name="github_data",
)

source = github_reactions("owner/repo", access_token=dlt.secrets.value)
info = pipeline.run(source)
print(info)
```

**Typical tables produced:** issues, pull_requests, comments, reactions, stargazers, commits, events

### Slack

```python
import dlt
from datetime import datetime
from slack import slack_source

pipeline = dlt.pipeline(
    pipeline_name="slack",
    destination="duckdb",
    dataset_name="slack_data",
)

source = slack_source(
    selected_channels=["general", "engineering"],
    start_date=datetime(2024, 1, 1),
)
info = pipeline.run(source)
print(info)
```

**Typical tables produced:** channels, messages, users, threads, files, reactions

### Salesforce

```python
import dlt
from salesforce import salesforce_source

pipeline = dlt.pipeline(
    pipeline_name="salesforce",
    destination="duckdb",
    dataset_name="salesforce_data",
)

source = salesforce_source()
info = pipeline.run(source)
print(info)
```

**Typical tables produced:** accounts, contacts, leads, opportunities, cases, tasks, events, campaigns, users

## How to Get Credentials

### HubSpot
1. Go to HubSpot → Settings → Integrations → Private Apps
2. Create a private app with the scopes you need (contacts, companies, deals, etc.)
3. Copy the access token

### Stripe
1. Go to Stripe Dashboard → Developers → API keys
2. Copy the Secret key (use test mode key for testing)

### GitHub
1. Go to GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Create a token with repo read access

### Slack
1. Go to api.slack.com → Your Apps → Create New App
2. Add Bot Token Scopes: channels:history, channels:read, users:read
3. Install to workspace, copy Bot User OAuth Token

### Salesforce
1. Your Salesforce username (email)
2. Your Salesforce password
3. Security token: Salesforce → Settings → Reset My Security Token (sent via email)

## dlt Init Shortcut

For verified sources, dlt provides a scaffolding command:
```bash
dlt init <source_name> duckdb
```
This creates a pipeline script and secrets template. Supported source names:
hubspot, stripe_analytics, salesforce, github, slack, google_analytics, google_sheets, notion, jira, zendesk, shopify, airtable, asana, chess, pokemon, pipedrive, freshdesk, matomo, mongodb, sql_database, rest_api
