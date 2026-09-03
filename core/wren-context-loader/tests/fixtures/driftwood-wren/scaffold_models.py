# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Emit models/<table>/metadata.yml for the driftwood wren project.

Column types come from schema_dump.csv (authoritative, introspected from the DB);
descriptions live in the DESC dict below. Fails loudly if any column in the dump
lacks a description (or vice versa), so the two can't drift.

Description policy (matters for the eval design): MDL descriptions carry truthful
*local* facts only (units, timezone, sentinels, net-vs-gross, snapshot grain).
Cross-cutting *business rules* (canonical revenue formula, dedup rule, fiscal
calendar usage, identity resolution) deliberately live in knowledge/rules/ —
that split is the schema-only vs schema+knowledge injection axis for this Wren fixture.
"""

import csv
import sys
from pathlib import Path

HERE = Path(__file__).parent

# table -> (table_description, primary_key or None, {column: description})
DESC: dict[str, tuple[str, str | None, dict[str, str]]] = {
    "customers": (
        "New-platform customers (2023-03 onward). One row per account, including "
        "soft-deleted and internal test accounts.",
        "id",
        {
            "id": "Unique customer id (new platform).",
            "email": "Account email as entered; casing/whitespace not normalized.",
            "full_name": "Customer display name.",
            "country": "ISO-ish country code: US, DE, FR, GB.",
            "created_at": "Account creation time (UTC).",
            "deleted_at": "Soft-delete timestamp (UTC); NULL = active. Deleted rows remain in the table.",
            "is_test": "TRUE for internal test accounts (emails with '+test' or @driftwood.example).",
            "marketing_channel": "Free-text acquisition channel; contains historical spelling variants "
            "(e.g. 'fb' / 'facebook' / 'Facebook Ads' are the same channel) and NULLs.",
        },
    ),
    "orders": (
        "New-platform orders (2023-03 onward). One row per order header. Includes copies of "
        "legacy orders migrated during 2023 (marked by legacy_ord_id).",
        "id",
        {
            "id": "Unique order id (new platform).",
            "customer_id": "FK to customers.id.",
            "currency": "Order currency: USD, EUR, or GBP.",
            "order_total": "Header-level gross order total (incl. tax) in the order's currency. "
            "Can differ slightly from the sum of line items on a small share of orders.",
            "status": "Order status: pending, paid, shipped, delivered, cancelled, refunded. "
            "A small share of historical rows use mixed case (e.g. 'PAID', 'Paid').",
            "placed_at": "Order placement time (UTC).",
            "shipped_at": "Ship time (UTC); NULL = not shipped.",
            "legacy_ord_id": "Non-NULL when this row is a migrated copy of a legacy order "
            "(FK to legacy_orders.ord_id). Such orders exist in BOTH tables.",
        },
    ),
    "order_items": (
        "Order line items (new platform). One row per product line within an order.",
        "id",
        {
            "id": "Surrogate line-item id.",
            "order_id": "FK to orders.id.",
            "product_id": "FK to products.id.",
            "quantity": "Units ordered on this line.",
            "unit_price": "Per-unit price in the order's currency.",
            "discount_amount": "Line-level discount in the order's currency (0 if none).",
        },
    ),
    "payments": (
        "Captured payments (new platform). One row per capture attempt; refund reversals "
        "appear as negative-amount rows.",
        "id",
        {
            "id": "Unique payment id.",
            "order_id": "FK to orders.id.",
            "amount": "Payment amount NET of processor fees, in the payment currency. "
            "NOTE: different meaning from orders.order_total (gross). Refund reversals are "
            "negative amounts with method='refund_reversal' and also exist in the refunds table.",
            "fee_amount": "Processor fee for this capture; gross captured = amount + fee_amount.",
            "currency": "Payment currency (matches the order's currency).",
            "captured_at": "Capture time (UTC).",
            "method": "card, paypal, apple_pay, or refund_reversal (negative rows).",
        },
    ),
    "refunds": (
        "Money refunds (new platform). One row per refund, gross amount, positive sign. "
        "Each refund is ALSO mirrored as a negative payments row.",
        "id",
        {
            "id": "Unique refund id.",
            "order_id": "FK to orders.id.",
            "amount": "Refunded amount, GROSS and positive, in the order's currency.",
            "reason": "Free-text refund reason.",
            "refunded_at": "Refund time (UTC).",
        },
    ),
    "products": (
        "Product catalog. One row per SKU.",
        "id",
        {
            "id": "Unique product id.",
            "sku": "Stock keeping unit code.",
            "name": "Product display name.",
            "category": "Hierarchical category as a single string, e.g. 'Camping > Tents'.",
            "current_price": "Current list price in USD.",
            "cost": "Unit cost in USD.",
            "introduced_at": "When the product entered the catalog (UTC).",
            "discontinued_at": "Non-NULL = discontinued at this time (UTC).",
        },
    ),
    "subscriptions": (
        "Driftwood+ gear-rental subscriptions (launched 2024-01). One row per subscription.",
        "id",
        {
            "id": "Unique subscription id.",
            "customer_id": "FK to customers.id.",
            "plan": "plus_monthly or plus_annual.",
            "started_at": "Subscription start (UTC).",
            "canceled_at": "Cancellation time (UTC); NULL = still active.",
            "monthly_price": "Monthly recurring price in USD (annual plans stored as the "
            "monthly-equivalent amount).",
        },
    ),
    "subscription_snapshots": (
        "Month-end point-in-time snapshots of active subscriptions. mrr_amount is a BALANCE "
        "as of snapshot_date — it is not additive across dates.",
        None,
        {
            "snapshot_date": "Snapshot date; always the last day of a calendar month.",
            "subscription_id": "FK to subscriptions.id.",
            "mrr_amount": "Monthly recurring revenue attributed to this subscription as of the "
            "snapshot date (USD). Point-in-time balance; never sum across snapshot dates.",
            "status": "Subscription status at snapshot time.",
        },
    ),
    "web_events": (
        "Website behavioral events. High-volume append-only log.",
        "id",
        {
            "id": "Unique event id.",
            "event_time": "Event timestamp as EPOCH MILLISECONDS (BIGINT, UTC).",
            "customer_id": "FK to customers.id; NULL for anonymous sessions.",
            "event_type": "page_view, add_to_cart, checkout, or search.",
            "session_id": "Browser session identifier.",
        },
    ),
    "inventory_levels": (
        "Month-end inventory snapshots per warehouse and product. units_on_hand is a BALANCE "
        "as of snapshot_date — not additive across dates.",
        None,
        {
            "snapshot_date": "Snapshot date; always the last day of a calendar month.",
            "warehouse_id": "FK to warehouses.id.",
            "product_id": "FK to products.id.",
            "units_on_hand": "Units in stock at snapshot time (point-in-time balance).",
        },
    ),
    "warehouses": (
        "Fulfillment warehouses.",
        "id",
        {
            "id": "Unique warehouse id.",
            "name": "Warehouse name.",
            "country": "Warehouse country (US or DE).",
            "tz": "IANA timezone of the warehouse.",
        },
    ),
    "legacy_orders": (
        "Orders from the legacy platform (2019-01 to 2023-08, USD only). Orders in the 2023 "
        "migration window may ALSO exist as copies in the new orders table (see migrated_at).",
        "ord_id",
        {
            "ord_id": "Unique legacy order id.",
            "cust_ref": "Legacy customer key (FK to legacy_customers.cust_ref), e.g. 'C-04217'.",
            "ord_dt": "Order timestamp as a NAIVE LOCAL-TIME string ('YYYY-MM-DD HH:MM:SS') in "
            "America/Los_Angeles — convert to UTC before comparing with new-platform timestamps.",
            "amt_c": "Order amount in integer US CENTS (divide by 100.0 for dollars). USD only.",
            "stat": "Numeric status code; decode via legacy_status_codes.",
            "ship_dt": "Ship timestamp string; the sentinel '1970-01-01 00:00:00' means never shipped "
            "(the legacy system did not use NULL).",
            "migrated_at": "Non-NULL when this order was copied into the new platform's orders table "
            "during the 2023 migration (the copy carries legacy_ord_id = this ord_id).",
        },
    ),
    "legacy_customers": (
        "Customers from the legacy platform. Many are the same people as new-platform customers, "
        "with email casing/whitespace variants; customer_xref maps only part of them.",
        "cust_ref",
        {
            "cust_ref": "Legacy customer key, e.g. 'C-04217'.",
            "email": "Email as entered in the legacy system; casing/whitespace may differ from the "
            "same person's new-platform email.",
            "signup_dt": "Legacy signup date.",
            "region": "Legacy sales region: west, east, or eu.",
        },
    ),
    "legacy_status_codes": (
        "Lookup for legacy_orders.stat numeric codes. Code 5 ('partial') was historically "
        "undocumented.",
        "code",
        {
            "code": "Numeric status code used by legacy_orders.stat.",
            "label": "Human-readable status label.",
        },
    ),
    "customer_xref": (
        "Cross-reference mapping legacy customers to new-platform customers. INCOMPLETE: covers "
        "only ~87% of the true overlap; email normalization finds the rest.",
        None,
        {
            "cust_ref": "FK to legacy_customers.cust_ref.",
            "customer_id": "FK to customers.id.",
        },
    ),
    "fx_rates": (
        "Daily FX rates to USD, BUSINESS DAYS ONLY (no weekend rows) — for a weekend date use "
        "the latest prior business day.",
        None,
        {
            "date": "Rate date (weekdays only).",
            "currency": "Quoted currency: EUR or GBP.",
            "usd_rate": "USD per 1 unit of the quoted currency.",
        },
    ),
    "fiscal_calendar": (
        "Company fiscal calendar. The fiscal year starts Feb 1 and is labeled by its starting "
        "year (FY2024 = 2024-02-01 through 2025-01-31).",
        "date",
        {
            "date": "Calendar date.",
            "fiscal_year": "Fiscal year label (year in which the FY starts).",
            "fiscal_quarter": "Fiscal quarter label, e.g. 'FY2024-Q3' (Q1 = Feb-Apr).",
        },
    ),
    "returns": (
        "Merchandise returns (RMA) at the order-line level. Distinct from refunds: returns track "
        "physical items coming back; refunds track money.",
        "rma_id",
        {
            "rma_id": "Unique return authorization id.",
            "order_item_id": "FK to order_items.id.",
            "qty_returned": "Units physically returned on this RMA.",
            "received_at": "When the returned items were received (UTC).",
            "disposition": "restock, damaged, or disposed.",
        },
    ),
}


def main() -> None:
    cols: dict[str, list[tuple[str, str]]] = {}
    with open(HERE / "schema_dump.csv", newline="") as f:
        for row in csv.DictReader(f):
            cols.setdefault(row["table_name"], []).append((row["column_name"], row["data_type"]))

    if set(cols) != set(DESC):
        sys.exit(f"table mismatch: db-only={set(cols) - set(DESC)} desc-only={set(DESC) - set(cols)}")

    def q(s: str) -> str:
        return '"' + s.replace('"', '\\"') + '"'

    for table, columns in cols.items():
        table_desc, pk, col_desc = DESC[table]
        db_cols = {c for c, _ in columns}
        if db_cols != set(col_desc):
            sys.exit(
                f"{table}: column mismatch: db-only={db_cols - set(col_desc)} "
                f"desc-only={set(col_desc) - db_cols}"
            )
        lines = [
            f"name: {table}",
            "properties:",
            f"  description: {q(table_desc)}",
            "table_reference:",
            "  catalog: driftwood",
            "  schema: main",
            f"  table: {table}",
        ]
        if pk:
            lines.append(f"primary_key: {pk}")
        lines.append("columns:")
        for cname, ctype in columns:
            lines += [
                f"  - name: {cname}",
                f"    type: {q(ctype) if '(' in ctype else ctype}",
                "    properties:",
                f"      description: {q(col_desc[cname])}",
            ]
        out = HERE / "models" / table / "metadata.yml"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("\n".join(lines) + "\n")
        print(f"wrote {out.relative_to(HERE)} ({len(columns)} cols)")


if __name__ == "__main__":
    main()
