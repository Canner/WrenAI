import crypto from 'crypto';
import knex from 'knex';
import bcrypt from 'bcryptjs';
import { testDbConfig } from './config';
import { expect, Page } from '@playwright/test';
import { SampleDatasetName } from '@/types/dataSource';

const E2E_OWNER_EMAIL = 'admin@example.com';
const E2E_OWNER_PASSWORD = 'Admin@123';
const E2E_WORKSPACE_SLUG = 'e2e-workspace';
const E2E_KNOWLEDGE_BASE_SLUG = 'e2e-knowledge-base';
const shouldSkipDbReset = process.env.E2E_SKIP_DB_RESET === '1';

export type RuntimeScopeFixture = {
  workspaceId: string;
  knowledgeBaseId: string;
};

const RUNTIME_RESET_TABLES = [
  'api_history',
  'asking_task',
  'connector',
  'dashboard_item_refresh_job',
  'dashboard_item',
  'dashboard',
  'deploy_log',
  'instruction',
  'kb_snapshot',
  'learning',
  'model_nested_column',
  'model_column',
  'model',
  'project',
  'relation',
  'schedule_job_run',
  'schedule_job',
  'schema_change',
  'secret_record',
  'sql_pair',
  'thread_response',
  'thread',
  'view',
];

const E2E_SCHEMA_PRESERVED_TABLES = new Set([
  'knex_migrations',
  'knex_migrations_lock',
  'permission',
  'role',
  'role_permission',
]);

const truncatePostgresData = async (db: ReturnType<typeof knex>) => {
  const result = await db.raw(
    `select tablename from pg_tables where schemaname = 'public'`,
  );
  const tables = ((result as { rows?: { tablename: string }[] }).rows ||
    result) as {
    tablename: string;
  }[];

  const applicationTables = tables
    .map(({ tablename }) => tablename)
    .filter((tablename) => !E2E_SCHEMA_PRESERVED_TABLES.has(tablename));

  if (applicationTables.length === 0) {
    return;
  }

  await db.raw(
    `TRUNCATE TABLE ${applicationTables
      .map((tableName) => `"public"."${tableName}"`)
      .join(', ')} RESTART IDENTITY CASCADE`,
  );
};

const ensureE2EOwnerState = async (db: ReturnType<typeof knex>) => {
  let user = await db('user')
    .where({ email: E2E_OWNER_EMAIL })
    .first('id', 'default_workspace_id');
  const userId = (user?.id as string | undefined) || crypto.randomUUID();

  let workspace = await db('workspace')
    .where({ slug: E2E_WORKSPACE_SLUG })
    .first('id');

  if (!workspace?.id) {
    workspace = { id: crypto.randomUUID() };
    await db('workspace').insert({
      id: workspace.id,
      slug: E2E_WORKSPACE_SLUG,
      name: 'E2E Workspace',
      status: 'active',
      kind: 'regular',
      created_by: userId,
    });
  } else {
    await db('workspace').where({ id: workspace.id }).update({
      slug: E2E_WORKSPACE_SLUG,
      name: 'E2E Workspace',
      status: 'active',
      kind: 'regular',
      created_by: userId,
    });
  }

  if (!user?.id) {
    await db('user').insert({
      id: userId,
      email: E2E_OWNER_EMAIL,
      display_name: 'Admin',
      locale: 'en-US',
      status: 'active',
      is_platform_admin: true,
      default_workspace_id: workspace.id,
    });
  } else {
    await db('user').where({ id: user.id }).update({
      display_name: 'Admin',
      locale: 'en-US',
      status: 'active',
      is_platform_admin: true,
      default_workspace_id: workspace.id,
    });
  }

  const passwordHash = await bcrypt.hash(E2E_OWNER_PASSWORD, 10);
  await db('auth_identity')
    .insert({
      id: crypto.randomUUID(),
      user_id: userId,
      provider_type: 'local',
      provider_subject: E2E_OWNER_EMAIL,
      password_hash: passwordHash,
      password_algo: 'bcrypt',
    })
    .onConflict(['provider_type', 'provider_subject'])
    .merge({
      user_id: userId,
      password_hash: passwordHash,
      password_algo: 'bcrypt',
    });

  const membership = await db('workspace_member')
    .where({
      workspace_id: workspace.id,
      user_id: userId,
    })
    .first('id');

  if (!membership?.id) {
    await db('workspace_member').insert({
      id: crypto.randomUUID(),
      workspace_id: workspace.id,
      user_id: userId,
      role_key: 'owner',
      status: 'active',
    });
  } else {
    await db('workspace_member').where({ id: membership.id }).update({
      role_key: 'owner',
      status: 'active',
    });
  }

  let knowledgeBase = await db('knowledge_base')
    .where({
      workspace_id: workspace.id,
      slug: E2E_KNOWLEDGE_BASE_SLUG,
    })
    .first('id');

  if (!knowledgeBase?.id) {
    knowledgeBase = { id: crypto.randomUUID() };
    await db('knowledge_base').insert({
      id: knowledgeBase.id,
      workspace_id: workspace.id,
      slug: E2E_KNOWLEDGE_BASE_SLUG,
      name: 'E2E Knowledge Base',
      kind: 'regular',
      created_by: userId,
    });
  } else {
    await db('knowledge_base').where({ id: knowledgeBase.id }).update({
      slug: E2E_KNOWLEDGE_BASE_SLUG,
      name: 'E2E Knowledge Base',
      kind: 'regular',
      created_by: userId,
      archived_at: null,
    });
  }

  user = await db('user').where({ email: E2E_OWNER_EMAIL }).first('id');

  return {
    userId: (user?.id as string | undefined) || userId,
    workspaceId: workspace.id as string,
    knowledgeBaseId: knowledgeBase.id as string,
  };
};

export const migrateDatabase = async () => {
  if (shouldSkipDbReset) {
    return;
  }
  const db = knex(testDbConfig);
  try {
    await db.migrate.latest();
    await truncatePostgresData(db);
    await ensureE2EOwnerState(db);
  } finally {
    await db.destroy();
  }
};

export const removeDatabase = async () => {
  if (shouldSkipDbReset) {
    return;
  }
  const db = knex(testDbConfig);
  try {
    await db.migrate.latest();
    await truncatePostgresData(db);
  } finally {
    await db.destroy();
  }
};

export const resetDatabase = async () => {
  if (shouldSkipDbReset) {
    return;
  }
  const db = knex(testDbConfig);

  try {
    await db.raw(
      `TRUNCATE TABLE ${RUNTIME_RESET_TABLES.map((tableName) => `\"${tableName}\"`).join(', ')} RESTART IDENTITY CASCADE`,
    );

    await ensureE2EOwnerState(db);

    await db('knowledge_base').update({
      default_kb_snapshot_id: null,
      primary_connector_id: null,
      runtime_project_id: null,
      sample_dataset: null,
      recommendation_query_id: null,
      recommendation_status: null,
      recommendation_questions: null,
      recommendation_error: null,
    });

    // insert learning table data to skip guide
    await db.table('learning').insert({
      paths: JSON.stringify(['DATA_MODELING_GUIDE', 'SWITCH_PROJECT_LANGUAGE']),
    });
  } finally {
    await db.destroy();
  }
};

export const ensureRuntimeScopeFixtureForUser = async ({
  email,
  workspaceSlug,
  workspaceName,
  knowledgeBaseSlug,
  knowledgeBaseName,
  setDefaultWorkspace = false,
}: {
  email: string;
  workspaceSlug: string;
  workspaceName: string;
  knowledgeBaseSlug: string;
  knowledgeBaseName: string;
  setDefaultWorkspace?: boolean;
}): Promise<RuntimeScopeFixture> => {
  const db = knex(testDbConfig);

  try {
    let user = await db('user').where({ email }).first('id');
    if (!user?.id && email === E2E_OWNER_EMAIL) {
      await ensureE2EOwnerState(db);
      user = await db('user').where({ email }).first('id');
    }

    if (!user?.id) {
      throw new Error(`User ${email} was not found in the E2E database`);
    }

    let workspace = await db('workspace')
      .where({ slug: workspaceSlug })
      .first('id');

    if (!workspace?.id) {
      workspace = { id: crypto.randomUUID() };
      await db('workspace').insert({
        id: workspace.id,
        slug: workspaceSlug,
        name: workspaceName,
        status: 'active',
        kind: 'regular',
        created_by: user.id,
      });
    } else {
      await db('workspace').where({ id: workspace.id }).update({
        slug: workspaceSlug,
        name: workspaceName,
        status: 'active',
        kind: 'regular',
        created_by: user.id,
      });
    }

    const existingMembership = await db('workspace_member')
      .where({
        workspace_id: workspace.id,
        user_id: user.id,
      })
      .first('id');

    if (!existingMembership?.id) {
      await db('workspace_member').insert({
        id: crypto.randomUUID(),
        workspace_id: workspace.id,
        user_id: user.id,
        role_key: 'owner',
        status: 'active',
      });
    } else {
      await db('workspace_member')
        .where({ id: existingMembership.id })
        .update({ role_key: 'owner', status: 'active' });
    }

    let knowledgeBase = await db('knowledge_base')
      .where({
        workspace_id: workspace.id,
        slug: knowledgeBaseSlug,
      })
      .first('id');

    if (!knowledgeBase?.id) {
      knowledgeBase = { id: crypto.randomUUID() };
      await db('knowledge_base').insert({
        id: knowledgeBase.id,
        workspace_id: workspace.id,
        slug: knowledgeBaseSlug,
        name: knowledgeBaseName,
        kind: 'regular',
        created_by: user.id,
      });
    } else {
      await db('knowledge_base').where({ id: knowledgeBase.id }).update({
        slug: knowledgeBaseSlug,
        name: knowledgeBaseName,
        archived_at: null,
        kind: 'regular',
        created_by: user.id,
      });
    }

    if (setDefaultWorkspace) {
      await db('user').where({ id: user.id }).update({
        default_workspace_id: workspace.id,
      });
    }

    return {
      workspaceId: workspace.id as string,
      knowledgeBaseId: knowledgeBase.id as string,
    };
  } finally {
    await db.destroy();
  }
};

export const ensureMutableRuntimeScopeForUser = async ({
  email,
}: {
  email: string;
}) =>
  ensureRuntimeScopeFixtureForUser({
    email,
    workspaceSlug: E2E_WORKSPACE_SLUG,
    workspaceName: 'E2E Workspace',
    knowledgeBaseSlug: E2E_KNOWLEDGE_BASE_SLUG,
    knowledgeBaseName: 'E2E Knowledge Base',
    setDefaultWorkspace: true,
  });

export const ensureSystemSampleRuntimeScope = async ({
  page,
  sampleDataset,
}: {
  page: Page;
  sampleDataset: SampleDatasetName;
}): Promise<RuntimeScopeFixture> => {
  let lastFailure = 'unknown bootstrap failure';

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await page.request.post(
      '/api/v1/internal/system-samples/bootstrap',
      {
        data: { sampleDataset },
        headers: {
          'x-wren-e2e-internal': '1',
        },
      },
    );

    const body = await response.text();
    if (response.ok()) {
      return JSON.parse(body) as RuntimeScopeFixture;
    }

    lastFailure = `system sample bootstrap failed (${response.status()}): ${body}`;
    const isRetryableFailure =
      response.status() >= 500 ||
      body.includes('The initializing SQL seems to be invalid') ||
      body.includes('Deploy wren AI failed or timeout');

    if (attempt < 5 && isRetryableFailure) {
      await page.waitForTimeout(1_000 * attempt);
      continue;
    }

    break;
  }

  expect(false, lastFailure).toBeTruthy();
  throw new Error(lastFailure);
};

export const seedKnowledgeWorkbenchFixture = async ({
  workspaceId,
  knowledgeBaseId,
}: RuntimeScopeFixture) => {
  const db = knex(testDbConfig);

  try {
    const kbSnapshotId = crypto.randomUUID();
    const deployHash = crypto.randomBytes(20).toString('hex');
    const now = new Date().toISOString();
    const initSql = `
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS customers;
CREATE TABLE customers (
  customer_id INTEGER PRIMARY KEY,
  customer_name VARCHAR
);
CREATE TABLE orders (
  order_id INTEGER PRIMARY KEY,
  customer_id INTEGER,
  amount DECIMAL(10, 2)
);
INSERT INTO customers (customer_id, customer_name) VALUES
  (1, 'Alice'),
  (2, 'Bob'),
  (3, 'Carol');
INSERT INTO orders (order_id, customer_id, amount) VALUES
  (1001, 1, 120.50),
  (1002, 1, 88.00),
  (1003, 2, 45.25);
`.trim();
    const [runtimeProjectRow] = await db('project')
      .insert({
        display_name: `[internal] ${knowledgeBaseId} e2e runtime`,
        type: 'DUCKDB',
        catalog: 'wrenai',
        schema: 'public',
        connection_info: JSON.stringify({
          initSql,
          extensions: [],
          configurations: {},
        }),
        sample_dataset: null,
      })
      .returning(['id']);
    const runtimeProjectId = Number(
      typeof runtimeProjectRow === 'object'
        ? runtimeProjectRow.id
        : runtimeProjectRow,
    );

    await db('kb_snapshot').insert({
      id: kbSnapshotId,
      knowledge_base_id: knowledgeBaseId,
      snapshot_key: 'e2e-knowledge-workbench-default',
      display_name: '默认快照',
      environment: null,
      version_label: 'v1',
      deploy_hash: deployHash,
      manifest_ref: null,
      status: 'active',
      created_at: now,
      updated_at: now,
    });

    await db('knowledge_base').where({ id: knowledgeBaseId }).update({
      default_kb_snapshot_id: kbSnapshotId,
      runtime_project_id: runtimeProjectId,
    });

    const insertedModels = await db('model')
      .insert([
        {
          project_id: runtimeProjectId,
          workspace_id: workspaceId,
          knowledge_base_id: knowledgeBaseId,
          kb_snapshot_id: kbSnapshotId,
          deploy_hash: deployHash,
          actor_user_id: null,
          display_name: '订单',
          source_table_name: 'orders',
          reference_name: 'orders',
          ref_sql: 'select * from orders',
          cached: false,
          refresh_time: null,
          properties: JSON.stringify({ description: '订单事实表' }),
          created_at: now,
          updated_at: now,
        },
        {
          project_id: runtimeProjectId,
          workspace_id: workspaceId,
          knowledge_base_id: knowledgeBaseId,
          kb_snapshot_id: kbSnapshotId,
          deploy_hash: deployHash,
          actor_user_id: null,
          display_name: '客户',
          source_table_name: 'customers',
          reference_name: 'customers',
          ref_sql: 'select * from customers',
          cached: false,
          refresh_time: null,
          properties: JSON.stringify({ description: '客户维度表' }),
          created_at: now,
          updated_at: now,
        },
      ])
      .returning(['id', 'reference_name']);

    const modelIdByName = Object.fromEntries(
      insertedModels.map((model) => [model.reference_name, model.id]),
    ) as Record<string, number>;

    const insertedColumns = await db('model_column')
      .insert([
        {
          model_id: modelIdByName.orders,
          is_calculated: false,
          display_name: '订单编号',
          source_column_name: 'order_id',
          reference_name: 'order_id',
          aggregation: null,
          lineage: null,
          type: 'integer',
          not_null: true,
          is_pk: true,
          properties: JSON.stringify({ description: '订单主键' }),
          created_at: now,
          updated_at: now,
        },
        {
          model_id: modelIdByName.orders,
          is_calculated: false,
          display_name: '客户编号',
          source_column_name: 'customer_id',
          reference_name: 'customer_id',
          aggregation: null,
          lineage: null,
          type: 'integer',
          not_null: true,
          is_pk: false,
          properties: JSON.stringify({ description: '下单客户编号' }),
          created_at: now,
          updated_at: now,
        },
        {
          model_id: modelIdByName.orders,
          is_calculated: false,
          display_name: '订单金额',
          source_column_name: 'amount',
          reference_name: 'amount',
          aggregation: null,
          lineage: null,
          type: 'decimal',
          not_null: false,
          is_pk: false,
          properties: JSON.stringify({ description: '订单支付金额' }),
          created_at: now,
          updated_at: now,
        },
        {
          model_id: modelIdByName.customers,
          is_calculated: false,
          display_name: '客户编号',
          source_column_name: 'customer_id',
          reference_name: 'customer_id',
          aggregation: null,
          lineage: null,
          type: 'integer',
          not_null: true,
          is_pk: true,
          properties: JSON.stringify({ description: '客户主键' }),
          created_at: now,
          updated_at: now,
        },
        {
          model_id: modelIdByName.customers,
          is_calculated: false,
          display_name: '客户名称',
          source_column_name: 'customer_name',
          reference_name: 'customer_name',
          aggregation: null,
          lineage: null,
          type: 'varchar',
          not_null: true,
          is_pk: false,
          properties: JSON.stringify({ description: '客户名称' }),
          created_at: now,
          updated_at: now,
        },
      ])
      .returning(['id', 'model_id', 'reference_name']);

    const orderCustomerIdColumn = insertedColumns.find(
      (column) =>
        column.model_id === modelIdByName.orders &&
        column.reference_name === 'customer_id',
    );
    const customerPrimaryKeyColumn = insertedColumns.find(
      (column) =>
        column.model_id === modelIdByName.customers &&
        column.reference_name === 'customer_id',
    );

    if (orderCustomerIdColumn?.id && customerPrimaryKeyColumn?.id) {
      await db('relation').insert({
        project_id: runtimeProjectId,
        workspace_id: workspaceId,
        knowledge_base_id: knowledgeBaseId,
        kb_snapshot_id: kbSnapshotId,
        deploy_hash: deployHash,
        actor_user_id: null,
        name: 'orders_customer_id_to_customers_customer_id',
        join_type: 'MANY_TO_ONE',
        from_column_id: orderCustomerIdColumn.id,
        to_column_id: customerPrimaryKeyColumn.id,
        properties: JSON.stringify({ description: '订单关联客户' }),
        created_at: now,
        updated_at: now,
      });
    }

    const manifest = {
      catalog: 'wrenai',
      schema: 'public',
      dataSource: 'DUCKDB',
      models: [
        {
          name: 'orders',
          columns: [
            {
              name: 'order_id',
              type: 'INTEGER',
              isCalculated: false,
              notNull: true,
              properties: {
                displayName: '订单编号',
                description: '订单主键',
              },
            },
            {
              name: 'customer_id',
              type: 'INTEGER',
              isCalculated: false,
              notNull: true,
              properties: {
                displayName: '客户编号',
                description: '下单客户编号',
              },
            },
            {
              name: 'amount',
              type: 'DECIMAL',
              isCalculated: false,
              notNull: false,
              properties: {
                displayName: '订单金额',
                description: '订单支付金额',
              },
            },
            {
              name: 'customers',
              type: 'customers',
              isCalculated: false,
              notNull: false,
              relationship: 'orders_customer_id_to_customers_customer_id',
              properties: {},
            },
          ],
          tableReference: {
            catalog: 'memory',
            schema: 'main',
            table: 'orders',
          },
          cached: false,
          properties: {
            displayName: '订单',
            description: '订单事实表',
          },
          primaryKey: 'order_id',
        },
        {
          name: 'customers',
          columns: [
            {
              name: 'customer_id',
              type: 'INTEGER',
              isCalculated: false,
              notNull: true,
              properties: {
                displayName: '客户编号',
                description: '客户主键',
              },
            },
            {
              name: 'customer_name',
              type: 'VARCHAR',
              isCalculated: false,
              notNull: true,
              properties: {
                displayName: '客户名称',
                description: '客户名称',
              },
            },
          ],
          tableReference: {
            catalog: 'memory',
            schema: 'main',
            table: 'customers',
          },
          cached: false,
          properties: {
            displayName: '客户',
            description: '客户维度表',
          },
          primaryKey: 'customer_id',
        },
      ],
      relationships: [
        {
          name: 'orders_customer_id_to_customers_customer_id',
          models: ['orders', 'customers'],
          joinType: 'MANY_TO_ONE',
          condition: '"orders".customer_id = "customers".customer_id',
          properties: {
            description: '订单关联客户',
          },
        },
      ],
      views: [],
    };

    await db('deploy_log').insert({
      project_id: runtimeProjectId,
      workspace_id: workspaceId,
      knowledge_base_id: knowledgeBaseId,
      kb_snapshot_id: kbSnapshotId,
      deploy_hash: deployHash,
      actor_user_id: null,
      manifest: JSON.stringify(manifest),
      hash: deployHash,
      status: 'SUCCESS',
      error: null,
      created_at: now,
      updated_at: now,
    });

    return {
      workspaceId,
      knowledgeBaseId,
      kbSnapshotId,
      deployHash,
    };
  } finally {
    await db.destroy();
  }
};

export const waitForJsonResponse = async (
  { page }: { page: Page },
  {
    urlIncludes,
    validateResponseData = (data: any) => data !== undefined,
  }: {
    urlIncludes: string;
    validateResponseData?: (data: any) => boolean;
  },
) => {
  await page.waitForResponse(
    async (response) => {
      try {
        const responseBody = await response.json();
        const responseData = responseBody;

        return (
          response.url().includes(urlIncludes) &&
          response.status() === 200 &&
          responseBody &&
          validateResponseData(responseData)
        );
      } catch (error) {
        console.error('Error fetching response body:', error);
      }
    },
    { timeout: 100000 },
  );
};

export const expectPathname = async ({
  page,
  pathname,
  timeout = 60_000,
}: {
  page: Page;
  pathname: string | RegExp;
  timeout?: number;
}) => {
  if (pathname instanceof RegExp) {
    await expect(page).toHaveURL(pathname, { timeout });
    return;
  }

  const escapedPath = pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await expect(page).toHaveURL(new RegExp(`${escapedPath}(?:\\?.*)?$`), {
    timeout,
  });
};

export const readRuntimeScopeSelector = async (page: Page) =>
  page.evaluate(() => {
    const raw = window.localStorage.getItem('wren.runtimeScope');
    return raw ? JSON.parse(raw) : {};
  });

export const gotoRuntimeScopedPath = async ({
  page,
  pathname,
  selector,
}: {
  page: Page;
  pathname: string;
  selector?: Partial<RuntimeScopeFixture> &
    Record<string, string | undefined | null>;
}) => {
  const effectiveSelector =
    selector ||
    (await ensureMutableRuntimeScopeForUser({
      email: E2E_OWNER_EMAIL,
    }));
  const searchParams = new URLSearchParams();

  Object.entries(effectiveSelector).forEach(([key, value]) => {
    if (value) {
      searchParams.set(key, value);
    }
  });

  if (searchParams.size === 0) {
    await page.goto(pathname);
    return;
  }

  await page.goto(`${pathname}?${searchParams.toString()}`);
  await page.evaluate((nextSelector) => {
    window.localStorage.setItem(
      'wren.runtimeScope',
      JSON.stringify(nextSelector),
    );
  }, effectiveSelector);
};

export const startSampleDatasetViaRest = async ({
  page,
  name,
  selector,
}: {
  page: Page;
  name: SampleDatasetName;
  selector?: RuntimeScopeFixture;
}) => {
  const effectiveSelector =
    selector ||
    (await ensureMutableRuntimeScopeForUser({
      email: E2E_OWNER_EMAIL,
    }));

  await page.evaluate((nextSelector) => {
    window.localStorage.setItem(
      'wren.runtimeScope',
      JSON.stringify(nextSelector),
    );
  }, effectiveSelector);

  const response = await page.evaluate(
    async ({ nextDatasetName, nextSelector }) => {
      const searchParams = new URLSearchParams();

      Object.entries(
        nextSelector as Record<string, string | undefined>,
      ).forEach(([key, value]) => {
        if (value) {
          searchParams.set(key, value);
        }
      });

      const request = await fetch(
        `/api/v1/settings/sample-dataset?${searchParams.toString()}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: nextDatasetName }),
        },
      );

      const text = await request.text();
      return {
        ok: request.ok,
        status: request.status,
        text,
      };
    },
    { nextDatasetName: name, nextSelector: effectiveSelector },
  );

  expect(
    response.ok,
    `start sample dataset failed (${response.status}): ${response.text}`,
  ).toBeTruthy();

  return JSON.parse(response.text);
};

export const expectSampleDatasetImportRejectedViaRest = async ({
  page,
  name,
  selector,
}: {
  page: Page;
  name: SampleDatasetName;
  selector?: RuntimeScopeFixture;
}) => {
  const effectiveSelector =
    selector ||
    (await ensureMutableRuntimeScopeForUser({
      email: E2E_OWNER_EMAIL,
    }));

  await page.evaluate((nextSelector) => {
    window.localStorage.setItem(
      'wren.runtimeScope',
      JSON.stringify(nextSelector),
    );
  }, effectiveSelector);

  const response = await page.evaluate(
    async ({ nextDatasetName, nextSelector }) => {
      const searchParams = new URLSearchParams();

      Object.entries(
        nextSelector as Record<string, string | undefined>,
      ).forEach(([key, value]) => {
        if (value) {
          searchParams.set(key, value);
        }
      });

      const request = await fetch(
        `/api/v1/settings/sample-dataset?${searchParams.toString()}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: nextDatasetName }),
        },
      );

      const text = await request.text();
      return {
        ok: request.ok,
        status: request.status,
        text,
      };
    },
    { nextDatasetName: name, nextSelector: effectiveSelector },
  );

  expect(response.ok).toBeFalsy();
  expect(response.status).toBe(403);
  expect(response.text).toContain('业务工作区不再支持导入样例数据');

  return response;
};
