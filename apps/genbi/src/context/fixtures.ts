import type {
  BlastRadius,
  BrokenPair,
  ContextFileNode,
  KnowledgeStatus,
  SemanticMeasure,
  SemanticModel,
  SemanticRelationship,
} from './types';

/**
 * Fixture semantic layer for the Context page. Phase 1 renders entirely from
 * these mocks (no backend) — obviously synthetic, no customer data. See
 * `src/fixtures/index.ts` for the app-wide fixture convention this follows.
 */

export const fixtureProjectName = 'acme-genbi';

export const fixtureProjectPath = '/Users/you/wren-projects/acme-genbi';

export const fixtureModels: SemanticModel[] = [
  {
    key: 'model.orders',
    name: 'orders',
    position: { x: 300, y: 24 },
    columns: [
      { name: 'order_id', type: 'varchar', key: 'pk' },
      { name: 'customer_id', type: 'varchar', key: 'fk' },
      { name: 'product_id', type: 'varchar', key: 'fk' },
      { name: 'order_date', type: 'date' },
      { name: 'amount', type: 'decimal' },
    ],
  },
  {
    key: 'model.customers',
    name: 'customers',
    position: { x: 24, y: 190 },
    columns: [
      { name: 'customer_id', type: 'varchar', key: 'pk' },
      { name: 'name', type: 'varchar' },
      { name: 'plan', type: 'varchar' },
      { name: 'signed_up_at', type: 'date' },
    ],
  },
  {
    key: 'model.products',
    name: 'products',
    position: { x: 580, y: 190 },
    columns: [
      { name: 'product_id', type: 'varchar', key: 'pk' },
      { name: 'name', type: 'varchar' },
      { name: 'category', type: 'varchar' },
    ],
  },
];

export const fixtureRelationships: SemanticRelationship[] = [
  {
    key: 'relationship.orders_customers',
    name: 'orders_customers',
    fromModel: 'model.orders',
    toModel: 'model.customers',
    type: 'many-to-one',
  },
  {
    key: 'relationship.orders_products',
    name: 'orders_products',
    fromModel: 'model.orders',
    toModel: 'model.products',
    type: 'many-to-one',
  },
];

export const fixtureMeasures: SemanticMeasure[] = [
  {
    key: 'measure.revenue',
    name: 'revenue',
    baseModel: 'model.orders',
    expression: 'SUM(amount)',
    additivity: 'additive',
  },
  {
    key: 'measure.churn_rate',
    name: 'churn_rate',
    baseModel: 'model.customers',
    expression: 'churned_customers / total_customers',
    additivity: 'non-additive',
  },
];

export const fixtureKnowledgeStatus: KnowledgeStatus = {
  instructionsPresent: true,
  verifiedPairCount: 18,
};

/** Blast radius per semantic entity key (`SemanticModel/Relationship/Measure.key`, or a view key). */
export const blastRadiusByKey: Record<string, BlastRadius> = {
  'model.orders': {
    seed: { key: 'model.orders', name: 'orders', kind: 'model' },
    downstream: [
      { key: 'relationship.orders_customers', name: 'orders_customers', kind: 'relationship' },
      { key: 'relationship.orders_products', name: 'orders_products', kind: 'relationship' },
      { key: 'measure.revenue', name: 'revenue', kind: 'measure' },
      { key: 'view.top_customers', name: 'top_customers', kind: 'view' },
    ],
    // Changing `orders` can silently shift `revenue` without any schema error.
    severity: 'semantic',
  },
  'model.customers': {
    seed: { key: 'model.customers', name: 'customers', kind: 'model' },
    downstream: [
      { key: 'relationship.orders_customers', name: 'orders_customers', kind: 'relationship' },
      { key: 'measure.churn_rate', name: 'churn_rate', kind: 'measure' },
      { key: 'view.top_customers', name: 'top_customers', kind: 'view' },
    ],
    severity: 'structural',
  },
  'model.products': {
    seed: { key: 'model.products', name: 'products', kind: 'model' },
    downstream: [
      { key: 'relationship.orders_products', name: 'orders_products', kind: 'relationship' },
    ],
    severity: 'compatibility',
  },
  'relationship.orders_customers': {
    seed: { key: 'relationship.orders_customers', name: 'orders_customers', kind: 'relationship' },
    downstream: [
      { key: 'measure.revenue', name: 'revenue', kind: 'measure' },
      { key: 'view.top_customers', name: 'top_customers', kind: 'view' },
    ],
    severity: 'structural',
  },
  'relationship.orders_products': {
    seed: { key: 'relationship.orders_products', name: 'orders_products', kind: 'relationship' },
    downstream: [{ key: 'measure.revenue', name: 'revenue', kind: 'measure' }],
    severity: 'compatibility',
  },
  'measure.revenue': {
    seed: { key: 'measure.revenue', name: 'revenue', kind: 'measure' },
    downstream: [{ key: 'view.top_customers', name: 'top_customers', kind: 'view' }],
    severity: 'structural',
  },
  'measure.churn_rate': {
    seed: { key: 'measure.churn_rate', name: 'churn_rate', kind: 'measure' },
    downstream: [],
    severity: 'none',
  },
  'view.top_customers': {
    seed: { key: 'view.top_customers', name: 'top_customers', kind: 'view' },
    downstream: [],
    severity: 'none',
  },
};

/**
 * Verified Question-SQL pairs broken by a seed's change, per entity key —
 * mirrors the BFF's `GET /api/context/impact/:entityKey` `brokenPairs` shape
 * so offline (fixture) mode exercises the same rendering as live mode. Only
 * `model.orders` has samples; every other key falls back to an empty list.
 */
export const brokenPairsByKey: Record<string, BrokenPair[]> = {
  'model.orders': [
    {
      question: 'Which plan has the most churn by revenue?',
      refs: ['customers', 'orders', 'measure.revenue'],
      // Resolves to the `revenue` downstream node's name.
      hitDownstreamKeys: ['measure.revenue'],
    },
    {
      question: 'What is total revenue by customer this quarter?',
      refs: ['customers', 'orders', 'total_revenue'],
      // Doesn't match a downstream node key — falls back to the raw keys.
      hitDownstreamKeys: ['orders', 'total_revenue'],
    },
  ],
};

const ordersModelYaml = `# wren_project/models/orders.model.yaml
name: orders
columns:
  - name: order_id
    type: varchar
  - name: customer_id
    type: varchar
  - name: product_id
    type: varchar
  - name: order_date
    type: date
  - name: amount
    type: decimal
`;

const customersModelYaml = `# wren_project/models/customers.model.yaml
name: customers
columns:
  - name: customer_id
    type: varchar
  - name: name
    type: varchar
  - name: plan
    type: varchar
  - name: signed_up_at
    type: date
`;

const productsModelYaml = `# wren_project/models/products.model.yaml
name: products
columns:
  - name: product_id
    type: varchar
  - name: name
    type: varchar
  - name: category
    type: varchar
`;

const ordersCustomersRelationshipYaml = `# wren_project/relationships/orders_customers.relationship.yaml
name: orders_customers
from: orders.customer_id
to: customers.customer_id
type: many-to-one
`;

const ordersProductsRelationshipYaml = `# wren_project/relationships/orders_products.relationship.yaml
name: orders_products
from: orders.product_id
to: products.product_id
type: many-to-one
`;

const revenueCubeYaml = `# wren_project/cubes/revenue.cube.yaml
name: revenue
base_model: orders
expression: SUM(amount)
additivity: additive
`;

const churnRateCubeYaml = `# wren_project/cubes/churn_rate.cube.yaml
name: churn_rate
base_model: customers
expression: churned_customers / total_customers
additivity: non-additive
`;

const topCustomersViewYaml = `# wren_project/views/top_customers.view.yaml
name: top_customers
statement: |
  SELECT c.name, SUM(o.amount) AS revenue
  FROM orders o
  JOIN customers c ON o.customer_id = c.customer_id
  GROUP BY c.name
  ORDER BY revenue DESC
`;

const businessContextMd = `# Business context

- A "customer" is uniquely identified by \`customer_id\`; plans are
  \`starter\` / \`team\` / \`enterprise\`.
- Revenue is recognized on the order date, not on payment date.
- Churn is evaluated monthly at the account level, not the seat level.
`;

const verifiedQaMd = `# Verified Question-SQL pairs (18)

Each entry below has been reviewed and its SQL verified against the semantic
layer. This file is a status summary, not the full pair store.

1. "What is total revenue this quarter?" → \`SUM(orders.amount)\` filtered by
   \`order_date\` in the current quarter.
2. "Which plan has the most churn?" → \`churn_rate\` grouped by
   \`customers.plan\`.
3. "Top 5 customers by revenue" → \`top_customers\` view, limit 5.

… 15 more verified pairs omitted from this fixture for brevity.
`;

/** The `wren_project` file tree shown in the Context page's contextual sidebar. */
export const fixtureContextFileTree: ContextFileNode[] = [
  {
    key: 'root',
    title: 'wren_project',
    children: [
      {
        key: 'dir.models',
        title: 'models',
        children: [
          {
            key: 'model.orders',
            title: 'orders.model.yaml',
            kind: 'model',
            path: 'wren_project/models/orders.model.yaml',
            content: ordersModelYaml,
            entityKey: 'model.orders',
          },
          {
            key: 'model.customers',
            title: 'customers.model.yaml',
            kind: 'model',
            path: 'wren_project/models/customers.model.yaml',
            content: customersModelYaml,
            entityKey: 'model.customers',
          },
          {
            key: 'model.products',
            title: 'products.model.yaml',
            kind: 'model',
            path: 'wren_project/models/products.model.yaml',
            content: productsModelYaml,
            entityKey: 'model.products',
          },
        ],
      },
      {
        key: 'dir.relationships',
        title: 'relationships',
        children: [
          {
            key: 'relationship.orders_customers',
            title: 'orders_customers.relationship.yaml',
            kind: 'relationship',
            path: 'wren_project/relationships/orders_customers.relationship.yaml',
            content: ordersCustomersRelationshipYaml,
            entityKey: 'relationship.orders_customers',
          },
          {
            key: 'relationship.orders_products',
            title: 'orders_products.relationship.yaml',
            kind: 'relationship',
            path: 'wren_project/relationships/orders_products.relationship.yaml',
            content: ordersProductsRelationshipYaml,
            entityKey: 'relationship.orders_products',
          },
        ],
      },
      {
        key: 'dir.cubes',
        title: 'cubes',
        children: [
          {
            key: 'measure.revenue',
            title: 'revenue.cube.yaml',
            kind: 'cube',
            path: 'wren_project/cubes/revenue.cube.yaml',
            content: revenueCubeYaml,
            entityKey: 'measure.revenue',
          },
          {
            key: 'measure.churn_rate',
            title: 'churn_rate.cube.yaml',
            kind: 'cube',
            path: 'wren_project/cubes/churn_rate.cube.yaml',
            content: churnRateCubeYaml,
            entityKey: 'measure.churn_rate',
          },
        ],
      },
      {
        key: 'dir.views',
        title: 'views',
        children: [
          {
            key: 'view.top_customers',
            title: 'top_customers.view.yaml',
            kind: 'view',
            path: 'wren_project/views/top_customers.view.yaml',
            content: topCustomersViewYaml,
            entityKey: 'view.top_customers',
          },
        ],
      },
      {
        key: 'dir.knowledge',
        title: 'knowledge',
        children: [
          {
            key: 'knowledge.business_context',
            title: 'business-context.md',
            kind: 'knowledge',
            path: 'wren_project/knowledge/business-context.md',
            content: businessContextMd,
          },
          {
            key: 'knowledge.verified_qa',
            title: 'verified-qa.md',
            kind: 'knowledge',
            path: 'wren_project/knowledge/verified-qa.md',
            content: verifiedQaMd,
          },
        ],
      },
    ],
  },
];

function flattenFileTree(nodes: ContextFileNode[], out: Record<string, ContextFileNode>) {
  for (const node of nodes) {
    out[node.key] = node;
    if (node.children) flattenFileTree(node.children, out);
  }
}

/** Flat lookup of every file-tree node (folders and leaves) by its tree key. */
export const contextFileByKey: Record<string, ContextFileNode> = (() => {
  const out: Record<string, ContextFileNode> = {};
  flattenFileTree(fixtureContextFileTree, out);
  return out;
})();
