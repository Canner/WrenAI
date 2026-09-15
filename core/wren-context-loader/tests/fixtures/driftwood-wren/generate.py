# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb", "pyyaml"]
# ///
"""
Driftwood Outfitters — deterministic messy-dataset generator.

Generates driftwood.duckdb: an outdoor-gear e-commerce dataset spanning a
2019-2023 "legacy platform" and a 2023-2026 "new platform", with a 2023-03
to 2023-08 migration window. The mess (enum drift, cents vs dollars, naive
local timestamps, semi-additive snapshots, refund double-representation,
etc.) is deliberate — see README.md and TRAPS.md
for the full trap catalogue (T1-T15).

Determinism: all randomness for the base dataset comes from a single
`random.Random(42)` instance, consumed in a fixed call order. No faker, no
numpy, no datetime.now() — "today" is the fixed anchor 2026-06-30.
Re-running this script produces byte-different files (row order / vacuum
internals) but identical query results.

Run: uv run generate.py

Fault injection: `--inject <scenario>` generates the same seed-42 base
dataset, applies a deterministic anomaly mutation to it, and writes the
result to a second db plus a manifest YAML describing exactly what was
mutated. See README.md "Fault injection" for the scenario catalogue, the
manifest schema, and the precision/recall/attribution oracle. Run
`uv run generate.py --verify` (or `uv run test_generate.py`) for the
self-check suite.
"""

from __future__ import annotations

import argparse
import os
import random
import shutil
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, ROUND_UP, Decimal
from zoneinfo import ZoneInfo

import duckdb
import yaml

# --------------------------------------------------------------------------
# Constants & timeline anchors
# --------------------------------------------------------------------------

SEED = 42
HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "driftwood.duckdb")

# Bump only when the seed-42 base dataset's query-visible contents change.
# Fixture tooling and fault-injection-only changes do not invalidate the base.
BASE_FIXTURE_VERSION = 1
BASE_FIXTURE_ID = f"driftwood-seed{SEED}-v{BASE_FIXTURE_VERSION}"

TODAY = date(2026, 6, 30)

LEGACY_START = date(2019, 1, 1)
LEGACY_END = date(2023, 8, 31)
MIGRATION_START = date(2023, 3, 1)
MIGRATION_END = date(2023, 8, 31)
NEW_START = date(2023, 3, 1)
NEW_END = TODAY
SUB_START = date(2024, 1, 1)

CENT = Decimal("0.01")
UTC = ZoneInfo("UTC")
LA_TZ = ZoneInfo("America/Los_Angeles")

# Target row-count knobs. These are the "organic" (non-derived) counts;
# derived tables (migrated order dupes, refund-reversal payments, snapshots,
# etc.) size themselves off the rules and land close to the design doc's
# "~" targets — see README.md "Actual row counts vs. design targets".
N_CUSTOMERS_TOTAL = 8_000
N_LEGACY_CUSTOMERS_TOTAL = 5_000
N_OVERLAP_HUMANS = 3_000
XREF_COVERAGE = 0.85

N_LEGACY_ORDERS = 45_000
N_ORDERS_TOTAL_TARGET = 60_000

N_PRODUCTS = 600
N_SUBSCRIPTIONS = 2_500
N_WEB_EVENTS = 300_000
N_RETURNS = 2_000
WAREHOUSE_PRODUCT_SAMPLE = 200


# --------------------------------------------------------------------------
# Word lists (hardcoded — no faker)
# --------------------------------------------------------------------------

FIRST_NAMES = [
    "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda",
    "David", "Elizabeth", "William", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
    "Thomas", "Sarah", "Charles", "Karen", "Daniel", "Nancy", "Matthew", "Lisa",
    "Anthony", "Betty", "Mark", "Margaret", "Paul", "Sandra", "Emma", "Olivia",
    "Noah", "Ava", "Liam", "Sophia", "Lucas", "Mia", "Ethan", "Isabella",
    "Anna", "Lukas", "Sophie", "Max", "Julia", "Felix", "Marie", "Tom",
    "Chloe", "Hugo", "Camille", "Louis",
]

LAST_NAMES = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
    "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas",
    "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White",
    "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Mueller", "Schmidt",
    "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker", "Dubois", "Bernard",
    "Petit", "Durand", "Leroy", "Moreau", "Simon", "Laurent", "Meyer", "Klein",
    "Hoffmann", "Fontaine",
]

EMAIL_DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "web.de", "gmx.de"]
TEST_DOMAIN = "driftwood.example"

TOP_CATEGORIES = [
    "Camping", "Climbing", "Hiking", "Cycling", "Water Sports",
    "Winter Sports", "Fishing", "Hunting", "Running", "Fitness",
]
SUBCATEGORIES = {
    "Camping": ["Tents", "Sleeping Bags", "Backpacks", "Stoves"],
    "Climbing": ["Ropes", "Harnesses", "Carabiners"],
    "Hiking": ["Boots", "Poles", "Backpacks", "Apparel"],
    "Cycling": ["Bikes", "Helmets", "Apparel", "Accessories"],
    "Water Sports": ["Kayaks", "Paddles", "Life Vests"],
    "Winter Sports": ["Skis", "Snowboards", "Goggles", "Jackets"],
    "Fishing": ["Rods", "Reels", "Tackle"],
    "Hunting": ["Rifle Cases", "Optics", "Apparel"],
    "Running": ["Shoes", "Apparel", "Accessories"],
    "Fitness": ["Weights", "Mats", "Accessories"],
}

MARKETING_CHANNELS = [
    ("fb", 10), ("facebook", 8), ("Facebook Ads", 5),
    ("google", 12), ("adwords", 6), ("Google", 4),
    ("organic", 20), ("email", 10), ("newsletter", 5),
    (None, 20),
]

COUNTRIES = [("US", 70), ("DE", 12), ("FR", 10), ("GB", 8)]

REGIONS = [("west", 45), ("east", 35), ("eu", 20)]

LEGACY_STATUS_CODES = [
    (1, "pending"), (2, "paid"), (3, "shipped"), (4, "delivered"),
    (9, "cancelled"), (7, "refunded"), (5, "partial"),
]
LEGACY_TO_NEW_STATUS = {2: "paid", 3: "shipped", 4: "delivered"}


# --------------------------------------------------------------------------
# Small deterministic helpers
# --------------------------------------------------------------------------

def weighted_choice(rng: random.Random, options: list[tuple]):
    """options: list of (value, weight)."""
    total = sum(w for _, w in options)
    x = rng.uniform(0, total)
    cum = 0.0
    for value, w in options:
        cum += w
        if x <= cum:
            return value
    return options[-1][0]


def rand_datetime(rng: random.Random, start: date, end: date) -> datetime:
    start_dt = datetime(start.year, start.month, start.day)
    end_dt = datetime(end.year, end.month, end.day, 23, 59, 59)
    span = (end_dt - start_dt).total_seconds()
    offset = rng.uniform(0, span)
    return (start_dt + timedelta(seconds=offset)).replace(microsecond=0)


def rand_amount(rng: random.Random) -> Decimal:
    """Order gross total: mostly $20-$400, occasionally $400-$1500."""
    if rng.random() < 0.85:
        v = rng.uniform(20, 400)
    else:
        v = rng.uniform(400, 1500)
    return Decimal(str(round(v, 2))).quantize(CENT, rounding=ROUND_HALF_UP)


def month_end_dates(start: date, end: date) -> list[date]:
    out = []
    y, m = start.year, start.month
    while True:
        if m == 12:
            nxt = date(y + 1, 1, 1)
        else:
            nxt = date(y, m + 1, 1)
        last_day = nxt - timedelta(days=1)
        if last_day > end:
            break
        if last_day >= start:
            out.append(last_day)
        y, m = nxt.year, nxt.month
    return out


def fiscal_year_quarter(d: date) -> tuple[int, str]:
    m = d.month
    fy = d.year - 1 if m == 1 else d.year
    if m in (2, 3, 4):
        q = 1
    elif m in (5, 6, 7):
        q = 2
    elif m in (8, 9, 10):
        q = 3
    else:
        q = 4  # 11, 12, 1
    return fy, f"FY{fy}-Q{q}"


def daterange(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def email_variant(base_email: str, rng: random.Random) -> str:
    """Return a casing/whitespace variant of an email (identity-dedup trap)."""
    local, domain = base_email.split("@")
    choice = rng.randrange(6)
    if choice == 0:
        return base_email
    if choice == 1:
        return base_email.upper()
    if choice == 2:
        return local.capitalize() + "@" + domain
    if choice == 3:
        return " " + base_email + " "
    if choice == 4:
        return local + "@" + domain.capitalize()
    return local.capitalize() + "@" + domain.upper()


@dataclass
class Person:
    first: str
    last: str
    base_email: str


def make_person(rng: random.Random, used_emails: dict[str, int]) -> Person:
    first = rng.choice(FIRST_NAMES)
    last = rng.choice(LAST_NAMES)
    domain = rng.choice(EMAIL_DOMAINS)
    local = f"{first.lower()}.{last.lower()}"
    key = local + "@" + domain
    n = used_emails.get(key, 0)
    used_emails[key] = n + 1
    if n:
        local = f"{local}{n}"
    base_email = f"{local}@{domain}"
    return Person(first, last, base_email)


# --------------------------------------------------------------------------
# Item reconciliation for order_items <-> order_total (T14)
# --------------------------------------------------------------------------

def build_reconciled_items(
    rng: random.Random,
    order_id: int,
    base_total: Decimal,
    product_ids: list[int],
    next_item_id: list[int],
    force_exact: bool,
) -> tuple[list[tuple], Decimal]:
    """
    Build 1-5 order_item rows whose (qty*unit_price - discount) sum is
    EXACTLY base_total, using the last line's discount as a slack variable.
    Returns (rows, items_sum). If force_exact is False, the caller may
    perturb the *stored* order_total or the last item's discount afterward
    to create a T14 mismatch — this function always reconciles items to
    base_total itself so the "true" grain-level total is well-defined.
    """
    n = weighted_choice(rng, [(1, 25), (2, 30), (3, 25), (4, 12), (5, 8)])
    quantities = [weighted_choice(rng, [(1, 45), (2, 25), (3, 15), (4, 10), (5, 5)]) for _ in range(n)]
    weights = [rng.uniform(0.5, 1.5) for _ in range(n)]
    wsum = sum(weights)

    rows = []
    running = Decimal("0.00")
    for i in range(n):
        pid = rng.choice(product_ids)
        qty = quantities[i]
        item_id = next_item_id[0]
        next_item_id[0] += 1
        if i < n - 1:
            share = (base_total * Decimal(str(weights[i] / wsum))).quantize(CENT, rounding=ROUND_HALF_UP)
            discount = Decimal("0.00") if rng.random() < 0.8 else Decimal(str(round(rng.uniform(1, 15), 2))).quantize(CENT)
            unit_price = ((share + discount) / qty).quantize(CENT, rounding=ROUND_HALF_UP)
            if unit_price <= 0:
                unit_price = Decimal("0.01")
                discount = Decimal("0.00")
            line_total = (unit_price * qty - discount).quantize(CENT)
            running += line_total
            rows.append((item_id, order_id, pid, qty, unit_price, discount))
        else:
            remainder = base_total - running
            unit_price = (remainder / qty).quantize(CENT, rounding=ROUND_HALF_UP)
            if unit_price <= 0:
                unit_price = Decimal("0.01")
            discount = (unit_price * qty - remainder).quantize(CENT)
            tries = 0
            while discount < 0 and tries < 200:
                unit_price += CENT
                discount = (unit_price * qty - remainder).quantize(CENT)
                tries += 1
            line_total = (unit_price * qty - discount).quantize(CENT)
            running += line_total
            rows.append((item_id, order_id, pid, qty, unit_price, discount))

    items_sum = running
    return rows, items_sum


# --------------------------------------------------------------------------
# Generation
# --------------------------------------------------------------------------

def generate(rng: random.Random | None = None) -> dict[str, list[tuple]]:
    """
    Build all 18 tables in memory, in the fixed rng call order.

    `rng` defaults to a freshly-seeded `random.Random(SEED)` — this is
    byte-for-byte equivalent to the previous module-global-`rng` behavior
    (nothing touched that global before `generate()` ran, so "fresh
    Random(SEED)" and "untouched module-global Random(SEED)" draw the exact
    same sequence). Tests pass an explicit fresh instance to prove
    reproducibility across independent calls; callers doing fault injection
    should also pass a fresh instance so the base dataset is unperturbed.
    """
    if rng is None:
        rng = random.Random(SEED)
    data: dict[str, list[tuple]] = {}
    used_emails: dict[str, int] = {}

    # ---- warehouses -------------------------------------------------
    data["warehouses"] = [
        (1, "West Coast DC", "US", "America/Los_Angeles"),
        (2, "East Coast DC", "US", "America/New_York"),
        (3, "Berlin DC", "DE", "Europe/Berlin"),
    ]

    # ---- products -----------------------------------------------------
    products = []
    product_ids = []
    pid = 1
    per_cat = N_PRODUCTS // len(TOP_CATEGORIES)
    for cat in TOP_CATEGORIES:
        subs = SUBCATEGORIES[cat]
        for _ in range(per_cat):
            sub = rng.choice(subs)
            category = f"{cat} > {sub}"
            price = Decimal(str(round(rng.uniform(15, 800), 2))).quantize(CENT, rounding=ROUND_HALF_UP)
            cost = (price * Decimal(str(round(rng.uniform(0.35, 0.7), 3)))).quantize(CENT, rounding=ROUND_HALF_UP)
            introduced = rand_datetime(rng, LEGACY_START, date(2026, 3, 1))
            discontinued = None
            if rng.random() < 0.12:
                discontinued = rand_datetime(rng, introduced.date(), TODAY)
            sku = f"DW-{cat[:3].upper()}-{pid:04d}"
            name = f"{sub[:-1] if sub.endswith('s') else sub} {rng.choice(['Pro','Trail','Alpine','Classic','Explorer','Summit'])} {pid}"
            products.append((pid, sku, name, category, price, cost, introduced, discontinued))
            product_ids.append(pid)
            pid += 1
    data["products"] = products

    # ---- fiscal_calendar ------------------------------------------------
    fiscal_rows = []
    for d in daterange(date(2019, 1, 1), date(2026, 12, 31)):
        fy, fq = fiscal_year_quarter(d)
        fiscal_rows.append((d, fy, fq))
    data["fiscal_calendar"] = fiscal_rows

    # ---- fx_rates (weekdays only, random walk) --------------------------
    fx_rows = []
    eur_rate = 1.10
    gbp_rate = 1.25
    for d in daterange(date(2023, 1, 1), date(2026, 6, 30)):
        if d.weekday() >= 5:  # Sat/Sun
            continue
        eur_rate = min(1.15, max(1.05, eur_rate + rng.uniform(-0.004, 0.004)))
        gbp_rate = min(1.30, max(1.20, gbp_rate + rng.uniform(-0.004, 0.004)))
        fx_rows.append((d, "EUR", Decimal(str(round(eur_rate, 4)))))
        fx_rows.append((d, "GBP", Decimal(str(round(gbp_rate, 4)))))
    data["fx_rates"] = fx_rows

    # ---- legacy_status_codes ---------------------------------------------
    data["legacy_status_codes"] = list(LEGACY_STATUS_CODES)

    # ---- identity graph: overlap humans, customers-only, legacy-only -----
    overlap_people = [make_person(rng, used_emails) for _ in range(N_OVERLAP_HUMANS)]
    customers_only_people = [make_person(rng, used_emails) for _ in range(N_CUSTOMERS_TOTAL - N_OVERLAP_HUMANS)]
    legacy_only_people = [make_person(rng, used_emails) for _ in range(N_LEGACY_CUSTOMERS_TOTAL - N_OVERLAP_HUMANS)]

    customers = []
    customer_ids_all = []
    overlap_customer_id_by_index: dict[int, int] = {}  # index into overlap_people -> customers.id
    cid = 1

    def make_customer_row(person: Person, cid: int) -> tuple:
        is_test = rng.random() < 0.02
        email = email_variant(person.base_email, rng)
        if is_test:
            if rng.random() < 0.5:
                local = email.strip().split("@")[0]
                email = f"{local}+test@{person.base_email.split('@')[1]}"
            else:
                local = person.base_email.split("@")[0]
                email = f"{local}@{TEST_DOMAIN}"
        full_name = f"{person.first} {person.last}"
        country = weighted_choice(rng, COUNTRIES)
        created_at = rand_datetime(rng, NEW_START, NEW_END)
        deleted_at = None
        if rng.random() < 0.04:
            deleted_at = rand_datetime(rng, created_at.date(), NEW_END)
        channel = weighted_choice(rng, MARKETING_CHANNELS)
        return (cid, email, full_name, country, created_at, deleted_at, is_test, channel)

    for idx, person in enumerate(overlap_people):
        customers.append(make_customer_row(person, cid))
        overlap_customer_id_by_index[idx] = cid
        customer_ids_all.append(cid)
        cid += 1
    for person in customers_only_people:
        customers.append(make_customer_row(person, cid))
        customer_ids_all.append(cid)
        cid += 1
    data["customers"] = customers

    legacy_customers = []
    legacy_ref_by_overlap_index: dict[int, str] = {}
    legacy_ref_all = []
    lc_counter = 1

    def make_legacy_row(person: Person, cust_ref: str) -> tuple:
        email = email_variant(person.base_email, rng)
        signup_dt = rand_datetime(rng, LEGACY_START, LEGACY_END).date()
        region = weighted_choice(rng, REGIONS)
        return (cust_ref, email, signup_dt, region)

    for idx, person in enumerate(overlap_people):
        cust_ref = f"C-{lc_counter:05d}"
        legacy_customers.append(make_legacy_row(person, cust_ref))
        legacy_ref_by_overlap_index[idx] = cust_ref
        legacy_ref_all.append(cust_ref)
        lc_counter += 1
    for person in legacy_only_people:
        cust_ref = f"C-{lc_counter:05d}"
        legacy_customers.append(make_legacy_row(person, cust_ref))
        legacy_ref_all.append(cust_ref)
        lc_counter += 1
    data["legacy_customers"] = legacy_customers

    # customer_xref: covers XREF_COVERAGE of the overlap humans only
    n_xref = int(N_OVERLAP_HUMANS * XREF_COVERAGE)
    overlap_indices = list(range(N_OVERLAP_HUMANS))
    xref_indices = sorted(rng.sample(overlap_indices, n_xref))
    xref_rows = [(legacy_ref_by_overlap_index[i], overlap_customer_id_by_index[i]) for i in xref_indices]
    data["customer_xref"] = xref_rows

    # ---- legacy_orders (+ derive migrated duplicates) --------------------
    legacy_order_rows = []
    dup_order_stubs = []  # (legacy_ord_id, customer_id, utc_placed, status, ship_utc_or_none)
    ord_id = 1
    overlap_refs = [legacy_ref_by_overlap_index[i] for i in range(N_OVERLAP_HUMANS)]
    overlap_ref_to_idx = {ref: i for i, ref in enumerate(overlap_refs)}

    for _ in range(N_LEGACY_ORDERS):
        utc_dt = rand_datetime(rng, LEGACY_START, LEGACY_END)
        utc_aware = utc_dt.replace(tzinfo=UTC)
        la_aware = utc_aware.astimezone(LA_TZ)
        ord_dt_str = la_aware.strftime("%Y-%m-%d %H:%M:%S")
        in_migration_window = MIGRATION_START <= la_aware.date() <= MIGRATION_END

        # Migration-window rows are drawn preferentially from the overlap
        # pool so a migrated duplicate always has a resolvable customer_id
        # (modeling: these are the customers who "stuck around" through
        # the cutover).
        if in_migration_window and rng.random() < 0.7:
            cust_ref = rng.choice(overlap_refs)
        else:
            cust_ref = rng.choice(legacy_ref_all)

        stat = weighted_choice(
            rng,
            [(1, 10), (2, 25), (3, 20), (4, 30), (9, 8), (7, 6), (5, 1)],
        )
        amount = rand_amount(rng)
        amt_c = int((amount * 100).to_integral_value(rounding=ROUND_HALF_UP))

        shipped_statuses = {3, 4, 7, 5}
        ship_dt_str = "1970-01-01 00:00:00"
        ship_utc = None
        if stat in shipped_statuses:
            ship_utc = utc_dt + timedelta(hours=rng.uniform(6, 96))
            ship_la = ship_utc.replace(tzinfo=UTC).astimezone(LA_TZ)
            ship_dt_str = ship_la.strftime("%Y-%m-%d %H:%M:%S")

        migrated_at = None
        if in_migration_window and stat in (2, 3, 4) and rng.random() < 0.90:
            migrated_at = utc_dt + timedelta(hours=rng.uniform(1, 48))
            # resolve customer_id: overlap human always has one, whether
            # or not customer_xref happens to cover it (real-world: the
            # join key is the email, xref coverage is just incomplete).
            found_idx = overlap_ref_to_idx.get(cust_ref)
            if found_idx is not None:
                cust_id = overlap_customer_id_by_index[found_idx]
                dup_order_stubs.append(
                    (ord_id, cust_id, utc_dt, LEGACY_TO_NEW_STATUS[stat], ship_utc, amount)
                )
            else:
                migrated_at = None  # no resolvable identity -> not migrated after all

        legacy_order_rows.append(
            (ord_id, cust_ref, ord_dt_str, amt_c, stat, ship_dt_str, migrated_at)
        )
        ord_id += 1

    data["legacy_orders"] = legacy_order_rows

    # ---- orders (organic + migrated dupes), order_items, payments, refunds
    orders = []
    order_items = []
    payments = []
    refunds = []
    next_item_id = [1]
    next_payment_id = [1]
    next_refund_id = [1]

    organic_target = max(0, N_ORDERS_TOTAL_TARGET - len(dup_order_stubs))
    order_id = 1

    STATUS_WEIGHTS = [
        ("pending", 8), ("paid", 32), ("shipped", 20),
        ("delivered", 25), ("cancelled", 8), ("refunded", 7),
    ]
    CURRENCY_WEIGHTS = [("USD", 65), ("EUR", 25), ("GBP", 10)]

    def maybe_case_variant(status: str) -> str:
        if status == "paid" and rng.random() < 0.03:
            return rng.choice(["PAID", "Paid"])
        return status

    def eligible_for_payment(status_lower: str) -> bool:
        return status_lower in ("paid", "shipped", "delivered", "refunded")

    def finalize_order(order_id, customer_id, currency, placed_at, status_display,
                        shipped_at, base_total, legacy_ord_id, refund_pool):
        force_exact = rng.random() < 0.92
        rows, items_sum = build_reconciled_items(
            rng, order_id, base_total, product_ids, next_item_id, force_exact
        )
        if force_exact:
            order_total = base_total
        else:
            delta = Decimal(str(round(rng.uniform(0.01, 0.99), 2)))
            if legacy_ord_id is not None:
                # order_total must stay == amt_c/100 (T2/T3 contract);
                # perturb the last item's discount instead so the items
                # sum diverges from the header total.
                order_total = base_total
                last_idx = len(rows) - 1
                iid, oid, pidv, qty, up, disc = rows[last_idx]
                sign = 1 if rng.random() < 0.5 else -1
                new_disc = (disc + sign * delta)
                if new_disc < 0:
                    new_disc = disc + delta
                    sign = 1
                new_disc = new_disc.quantize(CENT)
                rows[last_idx] = (iid, oid, pidv, qty, up, new_disc)
                items_sum = items_sum - sign * delta
            else:
                sign = 1 if rng.random() < 0.5 else -1
                order_total = base_total + sign * delta
        order_items.extend(rows)

        status_lower = status_display.lower()
        orders.append(
            (order_id, customer_id, currency, order_total, status_display,
             placed_at, shipped_at, legacy_ord_id)
        )

        if eligible_for_payment(status_lower):
            gross = order_total
            fee = (gross * Decimal("0.029") + Decimal("0.30")).quantize(CENT, rounding=ROUND_HALF_UP)
            net = (gross - fee).quantize(CENT)
            captured_at = placed_at + timedelta(hours=rng.uniform(0, 6))
            method = weighted_choice(rng, [("card", 70), ("paypal", 20), ("apple_pay", 10)])
            payments.append(
                (next_payment_id[0], order_id, net, fee, currency, captured_at, method)
            )
            next_payment_id[0] += 1

        if status_lower in ("shipped", "delivered") and rng.random() < 0.14:
            refund_pool.append((order_id, order_total, currency, placed_at, status_display))

    refund_candidates = []

    # migrated duplicates first (fixed order_total from legacy amt_c)
    for legacy_ord_id, cust_id, utc_placed, status, ship_utc, base_total in dup_order_stubs:
        finalize_order(
            order_id, cust_id, "USD", utc_placed, status, ship_utc,
            base_total, legacy_ord_id, refund_candidates,
        )
        order_id += 1

    # organic orders
    for _ in range(organic_target):
        customer_id = rng.choice(customer_ids_all)
        currency = weighted_choice(rng, CURRENCY_WEIGHTS)
        status = maybe_case_variant(weighted_choice(rng, STATUS_WEIGHTS))
        placed_at = rand_datetime(rng, NEW_START, NEW_END)
        shipped_at = None
        if status.lower() not in ("pending", "cancelled"):
            shipped_at = placed_at + timedelta(hours=rng.uniform(6, 96))
        base_total = rand_amount(rng)
        finalize_order(
            order_id, customer_id, currency, placed_at, status, shipped_at,
            base_total, None, refund_candidates,
        )
        order_id += 1

    # ---- refunds (T5: every refund also produces a negative payment row) -
    for oid, order_total, currency, placed_at, status_display in refund_candidates:
        full_refund = rng.random() < 0.6
        if full_refund:
            amount = order_total
        else:
            frac = Decimal(str(round(rng.uniform(0.1, 0.6), 2)))
            amount = (order_total * frac).quantize(CENT, rounding=ROUND_HALF_UP)
        refunded_at = placed_at + timedelta(hours=rng.uniform(72, 720))
        reason = weighted_choice(
            rng,
            [("defective", 30), ("wrong_item", 20), ("changed_mind", 30),
             ("late_delivery", 10), ("other", 10)],
        )
        refunds.append((next_refund_id[0], oid, amount, reason, refunded_at))
        next_refund_id[0] += 1

        # negative refund-reversal payment row (double representation)
        method = "refund_reversal"
        payments.append(
            (next_payment_id[0], oid, -amount, Decimal("0.00"), currency, refunded_at, method)
        )
        next_payment_id[0] += 1

        if full_refund:
            # flip the order's status to 'refunded' in place
            for i in range(len(orders)):
                if orders[i][0] == oid:
                    o = orders[i]
                    orders[i] = (o[0], o[1], o[2], o[3], "refunded", o[5], o[6], o[7])
                    break

    data["orders"] = orders
    data["order_items"] = order_items
    data["payments"] = payments
    data["refunds"] = refunds

    # ---- subscriptions + subscription_snapshots --------------------------
    subs = []
    sub_id = 1
    plan_prices = {"plus_monthly": Decimal("19.00"), "plus_annual": Decimal("15.83")}
    for _ in range(N_SUBSCRIPTIONS):
        customer_id = rng.choice(customer_ids_all)
        plan = weighted_choice(rng, [("plus_monthly", 60), ("plus_annual", 40)])
        started_at = rand_datetime(rng, SUB_START, TODAY)
        canceled_at = None
        if rng.random() < 0.35:
            canceled_at = rand_datetime(rng, started_at.date(), TODAY)
        subs.append((sub_id, customer_id, plan, started_at, canceled_at, plan_prices[plan]))
        sub_id += 1
    data["subscriptions"] = subs

    snapshot_rows = []
    for snap_date in month_end_dates(date(2024, 1, 1), date(2026, 6, 30)):
        for (s_id, _cust, _plan, started_at, canceled_at, monthly_price) in subs:
            if started_at.date() <= snap_date and (canceled_at is None or canceled_at.date() > snap_date):
                snapshot_rows.append((snap_date, s_id, monthly_price, "active"))
    data["subscription_snapshots"] = snapshot_rows

    # ---- web_events --------------------------------------------------
    web_events = []
    event_types = [("page_view", 60), ("add_to_cart", 20), ("checkout", 10), ("search", 10)]
    for i in range(1, N_WEB_EVENTS + 1):
        et = rand_datetime(rng, NEW_START, NEW_END)
        epoch_ms = int(et.replace(tzinfo=UTC).timestamp() * 1000)
        customer_id = None if rng.random() < 0.35 else rng.choice(customer_ids_all)
        event_type = weighted_choice(rng, event_types)
        session_id = f"sess-{rng.randrange(10**9):09d}"
        web_events.append((i, epoch_ms, customer_id, event_type, session_id))
    data["web_events"] = web_events

    # ---- inventory_levels ----------------------------------------------
    inventory_rows = []
    warehouse_ids = [1, 2, 3]
    warehouse_products = {
        wid: sorted(rng.sample(product_ids, min(WAREHOUSE_PRODUCT_SAMPLE, len(product_ids))))
        for wid in warehouse_ids
    }
    for snap_date in month_end_dates(date(2023, 3, 1), date(2026, 6, 30)):
        for wid in warehouse_ids:
            for p_id in warehouse_products[wid]:
                units = rng.randint(0, 500)
                inventory_rows.append((snap_date, wid, p_id, units))
    data["inventory_levels"] = inventory_rows

    # ---- returns (T15: RMA vs refunds, partial overlap by construction) --
    returns_rows = []
    n_items = len(order_items)
    sample_size = min(N_RETURNS, n_items)
    chosen_positions = sorted(rng.sample(range(n_items), sample_size))
    disposition_weights = [("restock", 50), ("damaged", 30), ("disposed", 20)]
    order_placed_at = {o[0]: o[5] for o in orders}
    rma = 1
    for pos in chosen_positions:
        item_id, o_id, _pid, qty, _up, _disc = order_items[pos]
        qty_returned = rng.randint(1, qty)
        base_placed = order_placed_at.get(o_id, rand_datetime(rng, NEW_START, NEW_END))
        received_at = base_placed + timedelta(hours=rng.uniform(48, 30 * 24))
        disposition = weighted_choice(rng, disposition_weights)
        returns_rows.append((rma, item_id, qty_returned, received_at, disposition))
        rma += 1
    data["returns"] = returns_rows

    return data


# --------------------------------------------------------------------------
# DDL + load
# --------------------------------------------------------------------------

DDL = """
CREATE TABLE warehouses (
    id INTEGER PRIMARY KEY,
    name VARCHAR,
    country VARCHAR,
    tz VARCHAR
);

CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    sku VARCHAR,
    name VARCHAR,
    category VARCHAR,
    current_price DECIMAL(12,2),
    cost DECIMAL(12,2),
    introduced_at TIMESTAMP,
    discontinued_at TIMESTAMP
);

CREATE TABLE fiscal_calendar (
    date DATE PRIMARY KEY,
    fiscal_year INTEGER,
    fiscal_quarter VARCHAR
);

CREATE TABLE fx_rates (
    date DATE,
    currency VARCHAR,
    usd_rate DECIMAL(12,6)
);

CREATE TABLE legacy_status_codes (
    code INTEGER PRIMARY KEY,
    label VARCHAR
);

CREATE TABLE customers (
    id INTEGER PRIMARY KEY,
    email VARCHAR,
    full_name VARCHAR,
    country VARCHAR,
    created_at TIMESTAMP,
    deleted_at TIMESTAMP,
    is_test BOOLEAN,
    marketing_channel VARCHAR
);

CREATE TABLE legacy_customers (
    cust_ref VARCHAR PRIMARY KEY,
    email VARCHAR,
    signup_dt DATE,
    region VARCHAR
);

CREATE TABLE customer_xref (
    cust_ref VARCHAR,
    customer_id INTEGER
);

CREATE TABLE legacy_orders (
    ord_id INTEGER PRIMARY KEY,
    cust_ref VARCHAR,
    ord_dt VARCHAR,
    amt_c INTEGER,
    stat INTEGER,
    ship_dt VARCHAR,
    migrated_at TIMESTAMP
);

CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER,
    currency VARCHAR,
    order_total DECIMAL(12,2),
    status VARCHAR,
    placed_at TIMESTAMP,
    shipped_at TIMESTAMP,
    legacy_ord_id INTEGER
);

CREATE TABLE order_items (
    id INTEGER PRIMARY KEY,
    order_id INTEGER,
    product_id INTEGER,
    quantity INTEGER,
    unit_price DECIMAL(12,2),
    discount_amount DECIMAL(12,2)
);

CREATE TABLE payments (
    id INTEGER PRIMARY KEY,
    order_id INTEGER,
    amount DECIMAL(12,2),
    fee_amount DECIMAL(12,2),
    currency VARCHAR,
    captured_at TIMESTAMP,
    method VARCHAR
);

CREATE TABLE refunds (
    id INTEGER PRIMARY KEY,
    order_id INTEGER,
    amount DECIMAL(12,2),
    reason VARCHAR,
    refunded_at TIMESTAMP
);

CREATE TABLE subscriptions (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER,
    plan VARCHAR,
    started_at TIMESTAMP,
    canceled_at TIMESTAMP,
    monthly_price DECIMAL(12,2)
);

CREATE TABLE subscription_snapshots (
    snapshot_date DATE,
    subscription_id INTEGER,
    mrr_amount DECIMAL(12,2),
    status VARCHAR
);

CREATE TABLE web_events (
    id BIGINT PRIMARY KEY,
    event_time BIGINT,
    customer_id INTEGER,
    event_type VARCHAR,
    session_id VARCHAR
);

CREATE TABLE inventory_levels (
    snapshot_date DATE,
    warehouse_id INTEGER,
    product_id INTEGER,
    units_on_hand INTEGER
);

CREATE TABLE returns (
    rma_id INTEGER PRIMARY KEY,
    order_item_id INTEGER,
    qty_returned INTEGER,
    received_at TIMESTAMP,
    disposition VARCHAR
);
"""

INSERT_SQL = {
    "warehouses": "INSERT INTO warehouses VALUES (?,?,?,?)",
    "products": "INSERT INTO products VALUES (?,?,?,?,?,?,?,?)",
    "fiscal_calendar": "INSERT INTO fiscal_calendar VALUES (?,?,?)",
    "fx_rates": "INSERT INTO fx_rates VALUES (?,?,?)",
    "legacy_status_codes": "INSERT INTO legacy_status_codes VALUES (?,?)",
    "customers": "INSERT INTO customers VALUES (?,?,?,?,?,?,?,?)",
    "legacy_customers": "INSERT INTO legacy_customers VALUES (?,?,?,?)",
    "customer_xref": "INSERT INTO customer_xref VALUES (?,?)",
    "legacy_orders": "INSERT INTO legacy_orders VALUES (?,?,?,?,?,?,?)",
    "orders": "INSERT INTO orders VALUES (?,?,?,?,?,?,?,?)",
    "order_items": "INSERT INTO order_items VALUES (?,?,?,?,?,?)",
    "payments": "INSERT INTO payments VALUES (?,?,?,?,?,?,?)",
    "refunds": "INSERT INTO refunds VALUES (?,?,?,?,?)",
    "subscriptions": "INSERT INTO subscriptions VALUES (?,?,?,?,?,?)",
    "subscription_snapshots": "INSERT INTO subscription_snapshots VALUES (?,?,?,?)",
    "web_events": "INSERT INTO web_events VALUES (?,?,?,?,?)",
    "inventory_levels": "INSERT INTO inventory_levels VALUES (?,?,?,?)",
    "returns": "INSERT INTO returns VALUES (?,?,?,?,?)",
}

# Load order respects FK dependency (informational only — DuckDB here does
# not enforce FK constraints across these tables).
TABLE_ORDER = [
    "warehouses", "products", "fiscal_calendar", "fx_rates", "legacy_status_codes",
    "customers", "legacy_customers", "customer_xref", "legacy_orders",
    "orders", "order_items", "payments", "refunds",
    "subscriptions", "subscription_snapshots", "web_events", "inventory_levels", "returns",
]

# Row-identity key for each table, used only by the fault-injection /
# verification code below (never by `generate()`/`load()` themselves) to
# diff a clean vs. injected data dict row-by-row. Tables with a single
# surrogate-key column key on that column; tables without one (pure
# snapshot/link tables) key on their natural composite.
TABLE_KEY = {
    "warehouses": lambda r: r[0],
    "products": lambda r: r[0],
    "fiscal_calendar": lambda r: r[0],
    "fx_rates": lambda r: (r[0], r[1]),
    "legacy_status_codes": lambda r: r[0],
    "customers": lambda r: r[0],
    "legacy_customers": lambda r: r[0],
    "customer_xref": lambda r: (r[0], r[1]),
    "legacy_orders": lambda r: r[0],
    "orders": lambda r: r[0],
    "order_items": lambda r: r[0],
    "payments": lambda r: r[0],
    "refunds": lambda r: r[0],
    "subscriptions": lambda r: r[0],
    "subscription_snapshots": lambda r: (r[0], r[1]),
    "web_events": lambda r: r[0],
    "inventory_levels": lambda r: (r[0], r[1], r[2]),
    "returns": lambda r: r[0],
}


def load(data: dict[str, list[tuple]], db_path: str = DB_PATH) -> None:
    if os.path.exists(db_path):
        os.remove(db_path)
    con = duckdb.connect(db_path)
    con.execute(DDL)
    for table in TABLE_ORDER:
        rows = data[table]
        if rows:
            con.executemany(INSERT_SQL[table], rows)
    con.close()


def read_tables(db_path: str, tables: tuple[str, ...]) -> dict[str, list[tuple]]:
    """Read only the tables one injection scenario needs from an existing base.

    Sorting by the same row-identity keys used by the mutation verifier keeps
    scenario behavior deterministic even though DuckDB does not promise scan
    order. Unknown table names fail before interpolation into SQL.
    """
    unknown = set(tables) - set(TABLE_ORDER)
    if unknown:
        raise ValueError(f"unknown Driftwood table(s): {sorted(unknown)}")

    con = duckdb.connect(db_path, read_only=True)
    try:
        data = {}
        for table in tables:
            rows = con.execute(f'SELECT * FROM "{table}"').fetchall()
            rows.sort(key=TABLE_KEY[table])
            data[table] = rows
        return data
    finally:
        con.close()


def replace_tables(db_path: str, data: dict[str, list[tuple]]) -> None:
    """Replace scenario-touched tables in a copied DuckDB transactionally."""
    unknown = set(data) - set(TABLE_ORDER)
    if unknown:
        raise ValueError(f"unknown Driftwood table(s): {sorted(unknown)}")

    con = duckdb.connect(db_path)
    try:
        con.execute("BEGIN TRANSACTION")
        for table in TABLE_ORDER:
            if table not in data:
                continue
            con.execute(f'DELETE FROM "{table}"')
            rows = data[table]
            if rows:
                con.executemany(INSERT_SQL[table], rows)
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise
    finally:
        con.close()


def print_summary(db_path: str = DB_PATH) -> None:
    con = duckdb.connect(db_path, read_only=True)
    print(f"\n{'table':<28} {'rows':>10}")
    print("-" * 40)
    total = 0
    for table in TABLE_ORDER:
        n = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        total += n
        print(f"{table:<28} {n:>10,}")
    print("-" * 40)
    print(f"{'TOTAL':<28} {total:>10,}")
    con.close()
    size_mb = os.path.getsize(db_path) / (1024 * 1024)
    print(f"\n{db_path} — {size_mb:.1f} MB")


# --------------------------------------------------------------------------
# Fault injection
# --------------------------------------------------------------------------
#
# Each scenario function takes an already-generated `data` dict and returns
# (mutated_data, injections): a NEW dict (input untouched; tables not
# mutated share the same underlying list objects) and a list of injection-
# record dicts matching the manifest schema in README.md. Scenarios never
# touch the shared global `rng` — all parameters are fixed literals, so
# `--inject <scenario>` is deterministic and reproducible by construction.

REFERENCE_NOW = datetime(TODAY.year, TODAY.month, TODAY.day, tzinfo=UTC)

# Assumed reporting cadence for the one table stopped_updates targets, used
# to turn "how many hours has it been" into a warn/critical severity call
# below. Mirrors the monitor_freshness heuristic exactly (see
# hub/components/monitor_freshness/steps/assess_severity.md and
# eval/runner/tests/freshness_detection.rs): fresh iff lag <= cadence; else
# warn if lag <= 2*cadence, else critical.
STOPPED_UPDATES_CADENCE_HOURS = 730.0  # ~monthly (30.4d) — subscription_snapshots is a month-end snapshot table

SCENARIO_NAMES = ("stopped_updates", "sudden_drop", "drift", "duplicates")


def fresh_verdict(lag_hours: float, cadence_hours: float) -> bool:
    """`fresh` iff the observed lag is within the expected cadence."""
    return lag_hours <= cadence_hours


def reference_severity(lag_hours: float, cadence_hours: float) -> str | None:
    """warn/critical heuristic mirroring assess_severity.md and
    freshness_detection.rs's `reference_severity` exactly: no severity when
    fresh; `warn` within ~2x cadence; `critical` beyond."""
    if fresh_verdict(lag_hours, cadence_hours):
        return None
    return "warn" if lag_hours <= 2.0 * cadence_hours else "critical"


class QuotedStr(str):
    """Marker for strings (ISO8601 dates/timestamps) that must round-trip
    through YAML as plain strings, never as PyYAML's implicit !!timestamp."""


def _quoted_str_representer(dumper: yaml.Dumper, data: "QuotedStr"):
    return dumper.represent_scalar("tag:yaml.org,2002:str", str(data), style='"')


yaml.add_representer(QuotedStr, _quoted_str_representer, Dumper=yaml.SafeDumper)


def _plain(value):
    """
    Recursively convert manifest values into YAML-safe primitives: Decimal
    -> float, date/datetime -> quoted ISO8601 string, tuples -> lists,
    dicts/lists recursed. Used only when writing/round-tripping the
    manifest — scenario functions and the diff/oracle checks work with raw
    values (dates, Decimals, tuples) throughout.
    """
    if isinstance(value, QuotedStr):
        return value
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        v = value if value.tzinfo else value.replace(tzinfo=UTC)
        return QuotedStr(v.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"))
    if isinstance(value, date):
        return QuotedStr(value.isoformat())
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    return value


def _stats(values: list) -> dict:
    if not values:
        return {"count": 0, "min": None, "max": None, "mean": None}
    return {
        "count": len(values),
        "min": min(values),
        "max": max(values),
        "mean": sum(values) / len(values),
    }


def inject_stopped_updates(data: dict[str, list[tuple]]) -> tuple[dict[str, list[tuple]], list[dict]]:
    """
    subscription_snapshots is a month-end MRR snapshot table (T8: semi-
    additive). Delete every row whose snapshot_date is after a fixed cutoff
    well before TODAY — simulating "the snapshot job silently stopped
    running". snapshot_date only ever takes month-end values, so a
    month-boundary cutoff produces a clean, obviously-stale max(ts).
    """
    table = "subscription_snapshots"
    cutoff = date(2026, 3, 31)  # keep through March; drop the Apr/May/Jun snapshots
    rows = data[table]
    kept = [r for r in rows if r[0] <= cutoff]
    dropped = [r for r in rows if r[0] > cutoff]

    mutated = dict(data)
    mutated[table] = kept

    new_max = max((r[0] for r in kept), default=cutoff)
    lag_hours = (REFERENCE_NOW - datetime(new_max.year, new_max.month, new_max.day, tzinfo=UTC)).total_seconds() / 3600.0
    severity = reference_severity(lag_hours, STOPPED_UPDATES_CADENCE_HOURS)

    injection = {
        "id": f"stopped_updates_{table}",
        "kind": "stopped_updates",
        "entity": table,
        "location": {
            "table": table,
            "column": "snapshot_date",
            "row_id_range": None,
            "timestamp_cutoff": datetime(cutoff.year, cutoff.month, cutoff.day, tzinfo=UTC),
            "date_window": None,
        },
        "magnitude": {"lag_hours": round(lag_hours, 2)},
        "expected_verdict": "anomaly",
        "expected_fresh": False,
        "expected_severity": severity,
        "expected_cause": f"{table} stopped receiving new rows after {cutoff.isoformat()}",
        "pre_mutation_summary": {"count": len(rows), "max_snapshot_date": max(r[0] for r in rows)},
        "post_mutation_summary": {"count": len(kept), "max_snapshot_date": new_max},
        "affected_row_ids": [(r[0], r[1]) for r in dropped],
        "new_row_ids": [],
    }
    return mutated, [injection]


def inject_sudden_drop(data: dict[str, list[tuple]]) -> tuple[dict[str, list[tuple]], list[dict]]:
    """
    orders.order_total: one calendar month (2026-03) gets a level-shift
    down — every order placed that month has its total multiplied by a
    fixed factor < 1, as if a pricing bug silently undercharged a whole
    batch. Only the header total is touched (order_items/payments are left
    as generated) — a "which number do you trust" trap, same flavor as T14.
    """
    table = "orders"
    factor = Decimal("0.3")
    window_start = date(2026, 3, 1)
    window_end = date(2026, 3, 31)

    rows = data[table]
    mutated_rows = []
    affected_ids = []
    before_vals, after_vals = [], []
    for r in rows:
        oid, customer_id, currency, order_total, status, placed_at, shipped_at, legacy_ord_id = r
        if window_start <= placed_at.date() <= window_end:
            new_total = (order_total * factor).quantize(CENT, rounding=ROUND_HALF_UP)
            before_vals.append(order_total)
            after_vals.append(new_total)
            affected_ids.append(oid)
            mutated_rows.append((oid, customer_id, currency, new_total, status, placed_at, shipped_at, legacy_ord_id))
        else:
            mutated_rows.append(r)

    mutated = dict(data)
    mutated[table] = mutated_rows

    magnitude_factor = float(factor)
    severity = "critical" if (1.0 - magnitude_factor) >= 0.5 else "warn"

    injection = {
        "id": f"sudden_drop_{table}_order_total",
        "kind": "sudden_drop",
        "entity": table,
        "location": {
            "table": table,
            "column": "order_total",
            "row_id_range": None,
            "timestamp_cutoff": None,
            "date_window": [window_start, window_end],
        },
        "magnitude": {"factor": magnitude_factor},
        "expected_verdict": "anomaly",
        "expected_fresh": None,
        "expected_severity": severity,
        "expected_cause": (
            f"{table}.order_total dropped abruptly (level shift, factor {magnitude_factor}) "
            f"for orders placed {window_start.isoformat()}..{window_end.isoformat()}"
        ),
        "pre_mutation_summary": _stats(before_vals),
        "post_mutation_summary": _stats(after_vals),
        "affected_row_ids": affected_ids,
        "new_row_ids": [],
    }
    return mutated, [injection]


def inject_drift(data: dict[str, list[tuple]]) -> tuple[dict[str, list[tuple]], list[dict]]:
    """
    fx_rates.usd_rate for EUR drifts upward with a small daily compounding
    slope over a 6-month window, as if a stale/broken FX feed silently
    diverged from the true rate instead of erroring out. day_index is
    assigned by each row's existing chronological position in the window
    (fx_rates is generated in ascending-date order) — no new rng draw.
    """
    table = "fx_rates"
    currency = "EUR"
    window_start = date(2026, 1, 1)
    window_end = date(2026, 6, 30)
    k = 0.0015  # ~0.15%/day cumulative multiplicative slope

    rows = data[table]
    window_positions = [
        i for i, r in enumerate(rows) if r[1] == currency and window_start <= r[0] <= window_end
    ]

    mutated_rows = list(rows)
    before_vals, after_vals, affected_keys = [], [], []
    for day_index, i in enumerate(window_positions):
        d, cur, usd_rate = rows[i]
        new_rate = (usd_rate * Decimal(str(1 + k * day_index))).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
        before_vals.append(usd_rate)
        after_vals.append(new_rate)
        affected_keys.append((d, cur))
        mutated_rows[i] = (d, cur, new_rate)

    mutated = dict(data)
    mutated[table] = mutated_rows

    n = len(window_positions)
    cumulative = k * max(n - 1, 0)
    severity = "critical" if cumulative >= 0.15 else "warn"

    injection = {
        "id": f"drift_{table}_{currency.lower()}_usd_rate",
        "kind": "drift",
        "entity": table,
        "location": {
            "table": table,
            "column": "usd_rate",
            "row_id_range": None,
            "timestamp_cutoff": None,
            "date_window": [window_start, window_end],
        },
        "magnitude": {"slope": k, "cumulative_pct": round(cumulative, 4)},
        "expected_verdict": "anomaly",
        "expected_fresh": None,
        "expected_severity": severity,
        "expected_cause": (
            f"{table}.usd_rate ({currency}) drifted upward ~{k * 100:.3f}%/day, compounding to "
            f"~{cumulative * 100:.1f}% by {window_end.isoformat()} "
            f"(window {window_start.isoformat()}..{window_end.isoformat()})"
        ),
        "pre_mutation_summary": _stats(before_vals),
        "post_mutation_summary": _stats(after_vals),
        # fx_rates has no single-column PK; (date, currency) pairs identify the affected rows.
        "affected_row_ids": affected_keys,
        "new_row_ids": [],
    }
    return mutated, [injection]


def inject_duplicates(data: dict[str, list[tuple]]) -> tuple[dict[str, list[tuple]], list[dict]]:
    """
    Duplicate a contiguous range of existing orders — plus their dependent
    order_items and payments rows, so the duplication looks real at the
    entity level — verbatim, under new ids appended after the current max.
    A genuine duplicate-content anomaly (e.g. a retried batch job), not a
    PK collision.

    Emits one injection instance per touched table (orders, order_items,
    payments): a scenario CAN in principle inject more than one instance,
    and this is the case that does.
    """
    lo, hi = 1000, 1004  # fixed id range, well within any seed-42 run

    orders = data["orders"]
    order_items = data["order_items"]
    payments = data["payments"]

    orders_by_id = {r[0]: r for r in orders}
    dup_order_ids = [oid for oid in range(lo, hi + 1) if oid in orders_by_id]
    if not dup_order_ids:
        raise ValueError(f"duplicates scenario: no orders in id range [{lo}, {hi}]")

    next_order_id = max(r[0] for r in orders) + 1
    next_item_id = max(r[0] for r in order_items) + 1
    next_payment_id = max(r[0] for r in payments) + 1

    id_map: dict[int, int] = {}
    new_orders = []
    for oid in dup_order_ids:
        new_id = next_order_id
        next_order_id += 1
        id_map[oid] = new_id
        new_orders.append((new_id,) + orders_by_id[oid][1:])

    item_id_map: dict[int, int] = {}
    new_items = []
    for it in order_items:
        if it[1] in id_map:
            new_iid = next_item_id
            next_item_id += 1
            item_id_map[it[0]] = new_iid
            new_items.append((new_iid, id_map[it[1]]) + it[2:])

    payment_id_map: dict[int, int] = {}
    new_payments = []
    for p in payments:
        if p[1] in id_map:
            new_pid = next_payment_id
            next_payment_id += 1
            payment_id_map[p[0]] = new_pid
            new_payments.append((new_pid, id_map[p[1]]) + p[2:])

    mutated = dict(data)
    mutated["orders"] = orders + new_orders
    mutated["order_items"] = order_items + new_items
    mutated["payments"] = payments + new_payments

    cause_suffix = f"under new ids {min(id_map.values())}-{max(id_map.values())}"
    injections = [
        {
            "id": "duplicates_orders",
            "kind": "duplicates",
            "entity": "orders",
            "location": {
                "table": "orders", "column": None, "row_id_range": [lo, hi],
                "timestamp_cutoff": None, "date_window": None,
            },
            "magnitude": {"dup_count": len(dup_order_ids)},
            "expected_verdict": "anomaly",
            "expected_fresh": None,
            "expected_severity": None,  # content anomaly, not magnitude-graded — no severity axis
            "expected_cause": f"orders {lo}-{hi} were duplicated verbatim {cause_suffix}",
            "affected_row_ids": [],
            "new_row_ids": list(id_map.values()),
        },
        {
            "id": "duplicates_order_items",
            "kind": "duplicates",
            "entity": "order_items",
            "location": {
                "table": "order_items", "column": None,
                "row_id_range": [min(item_id_map), max(item_id_map)] if item_id_map else None,
                "timestamp_cutoff": None, "date_window": None,
            },
            "magnitude": {"dup_count": len(new_items)},
            "expected_verdict": "anomaly",
            "expected_fresh": None,
            "expected_severity": None,
            "expected_cause": f"order_items belonging to duplicated orders {lo}-{hi} were duplicated verbatim {cause_suffix}",
            "affected_row_ids": [],
            "new_row_ids": list(item_id_map.values()),
        },
        {
            "id": "duplicates_payments",
            "kind": "duplicates",
            "entity": "payments",
            "location": {
                "table": "payments", "column": None,
                "row_id_range": [min(payment_id_map), max(payment_id_map)] if payment_id_map else None,
                "timestamp_cutoff": None, "date_window": None,
            },
            "magnitude": {"dup_count": len(new_payments)},
            "expected_verdict": "anomaly",
            "expected_fresh": None,
            "expected_severity": None,
            "expected_cause": f"payments belonging to duplicated orders {lo}-{hi} were duplicated verbatim {cause_suffix}",
            "affected_row_ids": [],
            "new_row_ids": list(payment_id_map.values()),
        },
    ]
    return mutated, injections


SCENARIOS = {
    "stopped_updates": inject_stopped_updates,
    "sudden_drop": inject_sudden_drop,
    "drift": inject_drift,
    "duplicates": inject_duplicates,
}

# Read and rewrite only the tables a scenario can mutate. This is the key
# seam that lets a pinned clean DuckDB fixture replace a full 693k-row
# regeneration without changing any scenario or manifest logic.
SCENARIO_TABLES = {
    "stopped_updates": ("subscription_snapshots",),
    "sudden_drop": ("orders",),
    "drift": ("fx_rates",),
    "duplicates": ("orders", "order_items", "payments"),
}


def build_manifest(scenario: str, base_db_name: str, injected_db_name: str, injections: list[dict]) -> dict:
    manifest_injections = []
    for injection in injections:
        manifest_injection = dict(injection)
        manifest_injection["attribution_keywords"] = sorted(attribution_keywords(injection["id"]))
        manifest_injections.append(manifest_injection)
    return {
        "seed": SEED,
        "base": base_db_name,
        "injected": injected_db_name,
        "reference_now": REFERENCE_NOW,
        "dataset": "driftwood",
        "scenario": scenario,
        "injections": manifest_injections,
    }


def write_manifest(path: str, manifest: dict) -> None:
    with open(path, "w") as f:
        yaml.safe_dump(_plain(manifest), f, sort_keys=False, default_flow_style=False, allow_unicode=True)


def diff_tables(clean: dict[str, list[tuple]], injected: dict[str, list[tuple]]) -> dict[str, dict]:
    """
    Row-level diff keyed by TABLE_KEY. Returns, per table with any
    difference: {"added": [key,...], "removed": [key,...], "changed": [key,...]}.
    """
    diffs = {}
    for table in TABLE_ORDER:
        key = TABLE_KEY[table]
        clean_by_key = {key(r): r for r in clean[table]}
        injected_by_key = {key(r): r for r in injected[table]}
        added = [k for k in injected_by_key if k not in clean_by_key]
        removed = [k for k in clean_by_key if k not in injected_by_key]
        changed = [k for k in clean_by_key if k in injected_by_key and clean_by_key[k] != injected_by_key[k]]
        if added or removed or changed:
            diffs[table] = {"added": added, "removed": removed, "changed": changed}
    return diffs


# --------------------------------------------------------------------------
# Precision/recall/attribution oracle
# --------------------------------------------------------------------------

def _normalize_cause(text: str) -> set[str]:
    return {w for w in "".join(c.lower() if c.isalnum() else " " for c in text).split() if len(w) > 2}


# Canonical, minimal keyword phrases serialized into each manifest injection
# and used by the attribution oracle below — never by mutation/verdict logic. Each phrase is a handful of
# words (the phenomenon verb + the table/column names) that always appear
# verbatim inside that injection's own `expected_cause` sentence (asserted
# by _check_attribution_paraphrase / test_attribution_paraphrase_all_scenarios),
# so scoring an injection's own `expected_cause` against its own keyword set
# always yields 1.0. A real detector's paraphrase only has to name the same
# table/column/phenomenon in its own words — it does not have to reproduce
# the manifest's ids/dates/sentence structure — to clear the 0.5 threshold.
ATTRIBUTION_KEYWORD_PHRASES: dict[str, list[str]] = {
    "stopped_updates_subscription_snapshots": ["stopped", "subscription snapshots"],
    "sudden_drop_orders_order_total": ["dropped", "orders", "order total"],
    "drift_fx_rates_eur_usd_rate": ["drifted", "fx rates", "usd rate"],
    "duplicates_orders": ["duplicated", "orders"],
    "duplicates_order_items": ["duplicated", "order items"],
    "duplicates_payments": ["duplicated", "payments"],
}


def attribution_keywords(injection_id: str) -> set[str]:
    """The canonical keyword set for one injection id (see
    ATTRIBUTION_KEYWORD_PHRASES). Empty set for an unknown id (matches
    nothing, fails closed rather than open)."""
    keywords: set[str] = set()
    for phrase in ATTRIBUTION_KEYWORD_PHRASES.get(injection_id, []):
        keywords |= _normalize_cause(phrase)
    return keywords


def _attribution_score(stated: str, injection: dict) -> float:
    """Fraction of the injection's canonical attribution keywords
    (table/column/phenomenon — NOT the full expected_cause sentence, which
    embeds ids and dates a paraphrasing detector won't quote) that appear in
    the stated cause. A serialized manifest set is authoritative; raw
    pre-manifest injections fall back to the canonical id mapping. 0.0 when
    neither source provides keywords."""
    serialized_keywords = injection.get("attribution_keywords")
    keywords = (
        set(serialized_keywords)
        if serialized_keywords is not None
        else attribution_keywords(injection["id"])
    )
    if not keywords:
        return 0.0
    stated_tokens = _normalize_cause(stated)
    return len(keywords & stated_tokens) / len(keywords)


def _cause_matches(stated: str, injection: dict) -> bool:
    """Fuzzy attribution match: at least half of the injection's canonical
    keywords (see ATTRIBUTION_KEYWORD_PHRASES) must appear in the stated
    cause. Loose by design (keyword overlap, not exact equality, and against
    a short canonical set rather than the whole expected_cause sentence) — a
    real detector paraphrases in its own words, it doesn't quote the
    manifest verbatim."""
    return _attribution_score(stated, injection) >= 0.5


def score_detections(manifest: dict, detections: list[dict]) -> dict:
    """
    manifest: parsed manifest dict (as built by build_manifest, or loaded
        from a written YAML file).
    detections: list of {"entity": str, "verdict": "anomaly"|"no_anomaly",
        "cause": str}, for BOTH the injected entities and some clean ones
        (to allow false-positive/false-alarm measurement).

    Returns recall, precision, false_alarm_rate (the headline metric per
    the eval design — false anomaly claims on entities with no injection),
    and attribution accuracy, plus the raw counts backing each.

    Counting convention (recall is per-INJECTION; the other three are
    per-DETECTION): `duplicates` emits three injections (orders,
    order_items, payments) for what is conceptually one event, so a
    detector that flags only `orders` recalls 1/3, not 1/1 — this is
    intentional, it rewards flagging every affected entity, not just the
    scenario as a whole. precision/false_alarm_rate/attribution_accuracy
    are counted per detection instead, so they are unaffected by how many
    injections one scenario happens to emit.

    Assumes at most one detection per entity in `detections` (raises
    ValueError otherwise) — with duplicate entities, a false positive on
    one row and a true positive on another for the same entity would let
    precision/false_alarm_rate exceed 1.0.
    """
    injections = manifest["injections"]
    injected_entities = {inj["entity"] for inj in injections}
    injection_by_entity = {inj["entity"]: inj for inj in injections}

    detection_entities = [d["entity"] for d in detections]
    if len(detection_entities) != len(set(detection_entities)):
        raise ValueError("score_detections: `detections` must have at most one entry per entity")

    detections_by_entity = {d["entity"]: d for d in detections}
    clean_entities_checked = {d["entity"] for d in detections if d["entity"] not in injected_entities}

    total_injected = len(injections)
    recalled = sum(
        1 for inj in injections
        if (d := detections_by_entity.get(inj["entity"])) is not None and d["verdict"] == "anomaly"
    )
    recall = recalled / total_injected if total_injected else 0.0

    anomaly_detections = [d for d in detections if d["verdict"] == "anomaly"]
    true_positives = [d for d in anomaly_detections if d["entity"] in injected_entities]
    false_positives_on_clean = [d for d in anomaly_detections if d["entity"] not in injected_entities]
    precision = len(true_positives) / len(anomaly_detections) if anomaly_detections else 0.0

    false_alarm_rate = (
        len(false_positives_on_clean) / len(clean_entities_checked) if clean_entities_checked else 0.0
    )

    attributed_correctly = sum(
        1 for d in true_positives
        if (inj := injection_by_entity.get(d["entity"])) is not None and _cause_matches(d.get("cause", ""), inj)
    )
    attribution_accuracy = attributed_correctly / len(true_positives) if true_positives else 0.0

    return {
        "recall": recall,
        "precision": precision,
        "false_alarm_rate": false_alarm_rate,  # headline metric
        "attribution_accuracy": attribution_accuracy,
        "counts": {
            "total_injected": total_injected,
            "recalled": recalled,
            "total_anomaly_detections": len(anomaly_detections),
            "true_positives": len(true_positives),
            "false_positives_on_clean": len(false_positives_on_clean),
            "clean_entities_checked": len(clean_entities_checked),
            "attributed_correctly": attributed_correctly,
        },
    }


def _hand_authored_detection_sets(manifest: dict) -> dict[str, list[dict]]:
    """Perfect/imperfect detection sets for the stopped_updates manifest,
    used both to demonstrate and to self-check the oracle (see README.md)."""
    injected_entity = manifest["injections"][0]["entity"]
    expected_cause = manifest["injections"][0]["expected_cause"]
    clean_entities = ["orders", "web_events", "fx_rates"]  # untouched by stopped_updates

    perfect = [{"entity": injected_entity, "verdict": "anomaly", "cause": expected_cause}]
    perfect += [{"entity": e, "verdict": "no_anomaly", "cause": ""} for e in clean_entities]

    imperfect = [{"entity": injected_entity, "verdict": "no_anomaly", "cause": ""}]  # misses the real injection
    imperfect += [{"entity": clean_entities[0], "verdict": "anomaly", "cause": "looks stale to me"}]  # false alarm
    imperfect += [{"entity": e, "verdict": "no_anomaly", "cause": ""} for e in clean_entities[1:]]

    return {"perfect": perfect, "imperfect": imperfect}


# --------------------------------------------------------------------------
# Self-check suite (`--verify`)
# --------------------------------------------------------------------------

def _tables_equal(a: dict[str, list[tuple]], b: dict[str, list[tuple]]) -> bool:
    return a.keys() == b.keys() and all(a[t] == b[t] for t in a)


def _print_check(ok: bool, name: str, detail: str) -> None:
    print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}")


def _check_clean_reproducible() -> tuple[bool, str]:
    d1 = generate(random.Random(SEED))
    d2 = generate(random.Random(SEED))
    return _tables_equal(d1, d2), "two independent generate(Random(SEED)) calls are row-for-row identical"


def _check_injection_reproducible(scenario: str) -> tuple[bool, str]:
    base1 = generate(random.Random(SEED))
    base2 = generate(random.Random(SEED))
    mutated1, inj1 = SCENARIOS[scenario](base1)
    mutated2, inj2 = SCENARIOS[scenario](base2)
    ok = _tables_equal(mutated1, mutated2) and _plain(inj1) == _plain(inj2)
    return ok, f"--inject {scenario} is row-for-row identical across two independent runs"


def _check_diff_matches_manifest(scenario: str) -> tuple[bool, str]:
    base = generate(random.Random(SEED))
    mutated, injections = SCENARIOS[scenario](base)
    diffs = diff_tables(base, mutated)

    declared_tables = {inj["location"]["table"] for inj in injections}
    problems = []
    for table, d in diffs.items():
        if table not in declared_tables:
            problems.append(f"undeclared table touched: {table}")
            continue
        allowed: set = set()
        for inj in injections:
            if inj["location"]["table"] == table:
                allowed |= set(inj.get("affected_row_ids", []))
                allowed |= set(inj.get("new_row_ids", []))
        touched = set(d["added"]) | set(d["removed"]) | set(d["changed"])
        stray = touched - allowed
        if stray:
            problems.append(f"{table}: {len(stray)} touched row(s) outside declared affected_row_ids/new_row_ids")

    if problems:
        return False, "; ".join(problems)
    return True, f"tables touched: {sorted(diffs) or '(none)'}, all within declared locations"


def _check_manifest_well_formed(manifest: dict) -> tuple[bool, str]:
    required_top = {"seed", "base", "injected", "reference_now", "dataset", "scenario", "injections"}
    missing_top = required_top - manifest.keys()
    if missing_top:
        return False, f"missing top-level keys: {sorted(missing_top)}"
    required_inj = {
        "id",
        "kind",
        "entity",
        "location",
        "magnitude",
        "expected_verdict",
        "attribution_keywords",
    }
    for inj in manifest["injections"]:
        missing = required_inj - inj.keys()
        if missing:
            return False, f"injection {inj.get('id')} missing keys: {sorted(missing)}"
        if inj["kind"] not in SCENARIO_NAMES:
            return False, f"injection {inj.get('id')} has unknown kind {inj['kind']!r}"
        if not inj["attribution_keywords"]:
            return False, f"injection {inj.get('id')} has no attribution keywords"

    dumped = yaml.safe_dump(_plain(manifest), sort_keys=False, default_flow_style=False, allow_unicode=True)
    reparsed = yaml.safe_load(dumped)
    if reparsed["scenario"] != manifest["scenario"]:
        return False, "YAML round-trip lost the scenario field"
    if not isinstance(reparsed["reference_now"], str):
        return False, "reference_now did not round-trip as a plain string"
    return True, f"{len(manifest['injections'])} injection(s), required keys present, YAML round-trips cleanly"


def _check_oracle_sanity() -> tuple[bool, str]:
    base = generate(random.Random(SEED))
    _, injections = SCENARIOS["stopped_updates"](base)
    manifest = build_manifest("stopped_updates", os.path.basename(DB_PATH), "driftwood-stopped_updates.duckdb", injections)
    sets = _hand_authored_detection_sets(manifest)

    perfect = score_detections(manifest, sets["perfect"])
    imperfect = score_detections(manifest, sets["imperfect"])

    checks = [
        (perfect["recall"] == 1.0, "perfect recall == 1.0"),
        (perfect["precision"] == 1.0, "perfect precision == 1.0"),
        (perfect["false_alarm_rate"] == 0.0, "perfect false_alarm_rate == 0.0"),
        (perfect["attribution_accuracy"] == 1.0, "perfect attribution_accuracy == 1.0"),
        (imperfect["recall"] == 0.0, "imperfect recall == 0.0"),
        (imperfect["precision"] == 0.0, "imperfect precision == 0.0"),
        (abs(imperfect["false_alarm_rate"] - (1 / 3)) < 1e-9, "imperfect false_alarm_rate == 1/3"),
        (imperfect["attribution_accuracy"] == 0.0, "imperfect attribution_accuracy == 0.0"),
    ]
    failed = [msg for ok, msg in checks if not ok]
    if failed:
        return False, "; ".join(failed)
    return True, (
        f"perfect r/p/far/attr = 1.00/1.00/0.00/1.00, "
        f"imperfect r/p/far/attr = {imperfect['recall']:.2f}/{imperfect['precision']:.2f}/"
        f"{imperfect['false_alarm_rate']:.2f}/{imperfect['attribution_accuracy']:.2f}"
    )


# Hand-written, realistic paraphrases of each injection's cause — deliberately
# NOT the manifest's own `expected_cause` sentence (no ids, no dates, different
# wording/structure) — used to prove attribution is achievable by a detector
# that never sees the manifest text, only the data. Keyed by injection id.
PARAPHRASE_CAUSES: dict[str, str] = {
    "stopped_updates_subscription_snapshots": "Looks like subscription snapshots stopped refreshing a while back.",
    "sudden_drop_orders_order_total": "March orders show total revenue dropped sharply, maybe a pricing bug.",
    "drift_fx_rates_eur_usd_rate": "The fx_rates usd_rate has drifted upward for months — this isn't noise.",
    "duplicates_orders": "Orders look duplicated — the same rows appear twice under new ids.",
    "duplicates_order_items": "Order items for a batch of orders got duplicated under new ids.",
    "duplicates_payments": "Payments for a batch of orders got duplicated under new ids.",
}

# An unrelated cause that should not match ANY injection's attribution keywords.
UNRELATED_CAUSE = "Web traffic spiked due to a viral social media post."


def _check_attribution_paraphrase() -> tuple[bool, str]:
    """For every injection produced by every scenario (all four, including
    all three `duplicates` sub-injections): the injection's own verbatim
    `expected_cause` must self-score 1.0, a realistic hand-written paraphrase
    (PARAPHRASE_CAUSES) must score >= 0.5, and an unrelated cause must score
    < 0.5. This is what proves attribution_accuracy is achievable by a
    detector that paraphrases instead of quoting the manifest."""
    base = generate(random.Random(SEED))
    problems = []
    checked = 0
    for scenario in SCENARIO_NAMES:
        _, injections = SCENARIOS[scenario](base)
        for inj in injections:
            checked += 1
            verbatim_score = _attribution_score(inj["expected_cause"], inj)
            if verbatim_score != 1.0:
                problems.append(f"{inj['id']}: verbatim expected_cause scored {verbatim_score:.2f}, want 1.00")

            paraphrase = PARAPHRASE_CAUSES.get(inj["id"])
            if paraphrase is None:
                problems.append(f"{inj['id']}: no paraphrase test case defined")
                continue
            paraphrase_score = _attribution_score(paraphrase, inj)
            if paraphrase_score < 0.5:
                problems.append(f"{inj['id']}: paraphrase scored {paraphrase_score:.2f}, want >= 0.50")

            wrong_score = _attribution_score(UNRELATED_CAUSE, inj)
            if wrong_score >= 0.5:
                problems.append(f"{inj['id']}: unrelated cause scored {wrong_score:.2f}, want < 0.50")

    if problems:
        return False, "; ".join(problems)
    return True, f"{checked} injection(s) across all 4 scenarios: verbatim=1.00, paraphrase>=0.50, unrelated<0.50"


def run_verify_suite() -> bool:
    all_ok = True

    ok, detail = _check_clean_reproducible()
    _print_check(ok, "clean db reproducible", detail)
    all_ok = all_ok and ok

    for scenario in SCENARIO_NAMES:
        ok, detail = _check_injection_reproducible(scenario)
        _print_check(ok, f"injected db reproducible ({scenario})", detail)
        all_ok = all_ok and ok

        ok, detail = _check_diff_matches_manifest(scenario)
        _print_check(ok, f"clean vs injected differ only at declared locations ({scenario})", detail)
        all_ok = all_ok and ok

        base = generate(random.Random(SEED))
        _, injections = SCENARIOS[scenario](base)
        manifest = build_manifest(scenario, os.path.basename(DB_PATH), f"driftwood-{scenario}.duckdb", injections)
        ok, detail = _check_manifest_well_formed(manifest)
        _print_check(ok, f"manifest well-formed ({scenario})", detail)
        all_ok = all_ok and ok

    ok, detail = _check_oracle_sanity()
    _print_check(ok, "oracle sanity (hand-authored detection sets)", detail)
    all_ok = all_ok and ok

    ok, detail = _check_attribution_paraphrase()
    _print_check(ok, "attribution scores (verbatim/paraphrase/unrelated, all 4 scenarios)", detail)
    all_ok = all_ok and ok

    return all_ok


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def run_injection(
    scenario: str,
    data: dict[str, list[tuple]],
    out: str | None,
) -> None:
    mutated, injections = SCENARIOS[scenario](data)

    out_path = out or os.path.join(HERE, f"driftwood-{scenario}.duckdb")
    manifest_path = os.path.splitext(out_path)[0] + ".manifest.yaml"

    load(mutated, out_path)
    manifest = build_manifest(
        scenario,
        os.path.basename(DB_PATH),
        os.path.basename(out_path),
        injections,
    )
    write_manifest(manifest_path, manifest)

    print(f"\n[inject:{scenario}] {len(injections)} injection instance(s)")
    for inj in injections:
        print(f"  - {inj['id']}: {inj['expected_cause']}")
    print(f"[inject:{scenario}] wrote {out_path}")
    print(f"[inject:{scenario}] wrote {manifest_path}")


def run_injection_from_base(scenario: str, base_path: str, out: str | None) -> None:
    """Copy a clean DuckDB fixture and inject one scenario without regeneration."""
    if not os.path.isfile(base_path):
        raise ValueError(f"base fixture does not exist or is not a file: {base_path}")

    out_path = out or os.path.join(HERE, f"driftwood-{scenario}.duckdb")
    if os.path.realpath(base_path) == os.path.realpath(out_path):
        raise ValueError("--base and --out must be different files")

    data = read_tables(base_path, SCENARIO_TABLES[scenario])
    mutated, injections = SCENARIOS[scenario](data)

    out_dir = os.path.dirname(os.path.abspath(out_path))
    os.makedirs(out_dir, exist_ok=True)
    wal_path = f"{out_path}.wal"
    if os.path.exists(wal_path):
        raise ValueError(f"refusing to replace output with a stale DuckDB WAL present: {wal_path}")

    temp_fd, temp_path = tempfile.mkstemp(prefix=".driftwood-inject-", suffix=".duckdb", dir=out_dir)
    os.close(temp_fd)
    try:
        shutil.copyfile(base_path, temp_path)
        replace_tables(temp_path, {table: mutated[table] for table in SCENARIO_TABLES[scenario]})
        os.replace(temp_path, out_path)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

    manifest_path = os.path.splitext(out_path)[0] + ".manifest.yaml"
    manifest = build_manifest(
        scenario,
        os.path.basename(base_path),
        os.path.basename(out_path),
        injections,
    )
    write_manifest(manifest_path, manifest)

    print(f"\n[inject:{scenario}] reused base fixture {base_path}")
    for inj in injections:
        print(f"  - {inj['id']}: {inj['expected_cause']}")
    print(f"[inject:{scenario}] wrote {out_path}")
    print(f"[inject:{scenario}] wrote {manifest_path}")


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Driftwood Outfitters deterministic dataset generator")
    parser.add_argument(
        "--inject", choices=SCENARIO_NAMES, default=None,
        help="after generating the clean seed-42 base dataset, apply this anomaly scenario and "
             "write it (+ a manifest YAML) to a separate db",
    )
    parser.add_argument(
        "--out", default=None,
        help="override the injected db output path (default: driftwood-<scenario>.duckdb next to "
             "the clean db); the manifest path is derived from this basename with a "
             ".manifest.yaml suffix",
    )
    parser.add_argument(
        "--base", default=None,
        help="reuse this clean Driftwood DuckDB for --inject instead of regenerating seed-42; "
             "the base is copied and never modified",
    )
    parser.add_argument(
        "--verify", action="store_true",
        help="run the self-check suite (reproducibility, manifest shape, oracle sanity) and exit "
             "nonzero on failure, instead of generating anything",
    )
    return parser


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()

    if args.verify:
        if args.inject or args.out or args.base:
            parser.error("--verify cannot be combined with --inject, --out, or --base")
        sys.exit(0 if run_verify_suite() else 1)

    if args.out and not args.inject:
        parser.error("--out requires --inject")
    if args.base and not args.inject:
        parser.error("--base requires --inject")

    if args.base:
        try:
            run_injection_from_base(args.inject, args.base, args.out)
        except (OSError, ValueError, duckdb.Error) as exc:
            parser.error(str(exc))
        return

    data = generate()
    load(data, DB_PATH)
    print_summary(DB_PATH)

    if args.inject:
        run_injection(args.inject, data, args.out)


if __name__ == "__main__":
    main()
