import crypto from 'crypto';
import { test, expect, Page, Locator } from '@playwright/test';
import knex from 'knex';
import * as helper from '../helper';
import * as frontendHealth from '../commonTests/frontendHealth';
import * as homeHelper from '../commonTests/home';
import * as modelingHelper from '../commonTests/modeling';
import { testDbConfig } from '../config';
import { encryptConnectionInfo } from '@/server/dataSource';
import { DataSourceName } from '@/types/dataSource';

const OWNER_EMAIL = 'admin@example.com';
const RUN_ID = Date.now();

const WORKSPACE_SLUG = 'knowledge-workbench';
const WORKSPACE_NAME = '知识库工作台验证空间';
const KNOWLEDGE_BASE_SLUG = 'knowledge-workbench-kb';
const KNOWLEDGE_BASE_NAME = '知识库工作台验证知识库';
const SECOND_KNOWLEDGE_BASE_SLUG = 'knowledge-workbench-kb-secondary';
const SECOND_KNOWLEDGE_BASE_NAME = '知识库工作台第二知识库';
const SWITCHED_WORKSPACE_SLUG = 'knowledge-workbench-switched';
const SWITCHED_WORKSPACE_NAME = '知识库切换目标空间';
const SWITCHED_KNOWLEDGE_BASE_SLUG = 'knowledge-workbench-switched-kb';
const SWITCHED_KNOWLEDGE_BASE_NAME = '知识库切换目标知识库';
const CREATED_KNOWLEDGE_BASE_NAME = '知识库工作台新增知识库';
const CREATED_KNOWLEDGE_BASE_DESCRIPTION =
  '用于验证知识库创建后可以继续回到已有工作台接入连接器与沉淀规则。';
const SWITCHED_CREATED_KNOWLEDGE_BASE_NAME = '切换后新增知识库';
const SWITCHED_CREATED_KNOWLEDGE_BASE_DESCRIPTION =
  '验证工作空间切换后仍可在目标空间继续创建知识库。';
const CONNECTOR_DISPLAY_NAME = 'E2E PostgreSQL 连接器';
const SWITCHED_CONNECTOR_DISPLAY_NAME = '切换后 PostgreSQL 连接器';
const SQL_TEMPLATE_TITLE = '统计订单数量';
const SQL_TEMPLATE_SQL = 'select 1 as order_count';
const RULE_SUMMARY = '订单口径说明';
const RULE_CONTENT =
  '当问题涉及订单规模时，请统一使用 orders 表作为订单事实来源，并优先通过 customer_id 关联 customers 表补充客户信息。';
const SWITCHED_SQL_TEMPLATE_TITLE = '切换后统计客户数量';
const SWITCHED_SQL_TEMPLATE_SQL = 'select 1 as customer_count';
const SWITCHED_RULE_SUMMARY = '切换后客户口径说明';
const SWITCHED_RULE_CONTENT =
  '切换工作空间后，如果问题涉及客户规模，请优先使用 customers 表并以 customer_id 作为主键。';
const POSTGRES_KNOWLEDGE_BASE_SLUG = 'knowledge-workbench-kb-postgres';
const POSTGRES_KNOWLEDGE_BASE_NAME = '知识库工作台 PostgreSQL 知识库';
const POSTGRES_SQL_TEMPLATE_QUESTION =
  'Which customers have the highest total order amount?';
const POSTGRES_SQL_TEMPLATE_TITLE = POSTGRES_SQL_TEMPLATE_QUESTION;
const POSTGRES_SQL_TEMPLATE_SQL = `select customers.customer_name, sum(orders.amount) as total_amount
from orders
join customers on orders.customer_id = customers.customer_id
group by customers.customer_name
order by total_amount desc`;
const POSTGRES_RULE_SUMMARY = 'E2E 全局客户统计规则';
const POSTGRES_RULE_CONTENT =
  '当问题涉及客户统计时，请优先从 customers 模型出发，并使用可解释的聚合 SQL 返回结果。';
const POSTGRES_RULE_QUESTION =
  'How many customers are available in this knowledge base?';

type KnowledgeWorkbenchSelector = helper.RuntimeScopeFixture & {
  kbSnapshotId?: string;
  deployHash?: string;
  runtimeScopeId?: string;
  schemaName?: string;
  projectId?: number;
};

type PersistedAskingTaskRecord = {
  id: number;
  queryId: string;
  question: string;
  detail: {
    askPath?: string | null;
    error?: {
      code?: string | null;
      message?: string | null;
    } | null;
    response?: Array<{
      sql?: string | null;
      sqlpairId?: number | null;
      type?: string | null;
      viewId?: number | null;
    }> | null;
    status?: string | null;
  } | null;
  threadId?: number | null;
  threadResponseId?: number | null;
};

const buildScopedSlug = (base: string, scopeKey: string) =>
  `${base}-${RUN_ID}-${scopeKey}`;

const buildScopedName = (base: string, scopeKey: string) =>
  `${base} ${scopeKey}`;

let workspaceSlug = buildScopedSlug(WORKSPACE_SLUG, 'bootstrap');
let workspaceName = buildScopedName(WORKSPACE_NAME, 'bootstrap');
let knowledgeBaseSlug = buildScopedSlug(KNOWLEDGE_BASE_SLUG, 'bootstrap');
let knowledgeBaseName = buildScopedName(KNOWLEDGE_BASE_NAME, 'bootstrap');
let secondaryKnowledgeBaseSlug = buildScopedSlug(
  SECOND_KNOWLEDGE_BASE_SLUG,
  'bootstrap',
);
let secondaryKnowledgeBaseName = buildScopedName(
  SECOND_KNOWLEDGE_BASE_NAME,
  'bootstrap',
);
let switchedWorkspaceSlug = buildScopedSlug(
  SWITCHED_WORKSPACE_SLUG,
  'bootstrap',
);
let switchedWorkspaceName = buildScopedName(
  SWITCHED_WORKSPACE_NAME,
  'bootstrap',
);
let switchedKnowledgeBaseSlug = buildScopedSlug(
  SWITCHED_KNOWLEDGE_BASE_SLUG,
  'bootstrap',
);
let switchedKnowledgeBaseName = buildScopedName(
  SWITCHED_KNOWLEDGE_BASE_NAME,
  'bootstrap',
);
let createdKnowledgeBaseName = buildScopedName(
  CREATED_KNOWLEDGE_BASE_NAME,
  'bootstrap',
);
let switchedCreatedKnowledgeBaseName = buildScopedName(
  SWITCHED_CREATED_KNOWLEDGE_BASE_NAME,
  'bootstrap',
);
let postgresKnowledgeBaseSlug = buildScopedSlug(
  POSTGRES_KNOWLEDGE_BASE_SLUG,
  'bootstrap',
);
let postgresKnowledgeBaseName = buildScopedName(
  POSTGRES_KNOWLEDGE_BASE_NAME,
  'bootstrap',
);

const toKnowledgeBaseScopeSelector = (
  selector: KnowledgeWorkbenchSelector,
): helper.RuntimeScopeFixture => ({
  workspaceId: selector.workspaceId,
  knowledgeBaseId: selector.knowledgeBaseId,
});

const toKnowledgeRouteSelector = (
  selector: KnowledgeWorkbenchSelector,
): Record<string, string> => ({
  workspaceId: selector.workspaceId,
  knowledgeBaseId: selector.knowledgeBaseId,
  ...(selector.kbSnapshotId ? { kbSnapshotId: selector.kbSnapshotId } : {}),
  ...(selector.deployHash ? { deployHash: selector.deployHash } : {}),
});

const attachPageErrorCollectors = (page: Page) => {
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];
  const debugErrors = process.env.E2E_DEBUG_ERRORS === '1';
  const isRetriableDuckDbPoolShutdown = (message: string) =>
    message.includes('HikariDataSource') && message.includes('has been closed');

  page.on('pageerror', (error) => {
    if (isRetriableDuckDbPoolShutdown(error.message)) {
      return;
    }
    pageErrors.push(error.message);
    if (debugErrors) {
      console.log(`[e2e-pageerror] ${error.message}`);
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      const url = new URL(response.url());
      const summary = `${response.status()} ${response.url()}`;
      const shouldInspectRetriableSqlPairFailure =
        response.request().method() === 'POST' &&
        url.pathname === '/api/v1/knowledge/sql_pairs';

      if (shouldInspectRetriableSqlPairFailure) {
        void response
          .text()
          .then((body) => {
            if (isRetriableDuckDbPoolShutdown(body)) {
              return;
            }

            serverErrors.push(summary);
            if (debugErrors) {
              console.log(
                `[e2e-http] ${summary}\n${body.slice(0, 400) || '<empty body>'}`,
              );
            }
          })
          .catch(() => {
            serverErrors.push(summary);
          });
        return;
      }

      serverErrors.push(summary);
      if (debugErrors) {
        void response
          .text()
          .then((body) =>
            console.log(
              `[e2e-http] ${summary}\n${body.slice(0, 400) || '<empty body>'}`,
            ),
          )
          .catch(() => null);
      }
    }
  });

  return {
    assertClean() {
      expect(pageErrors).toEqual([]);
      expect(serverErrors).toEqual([]);
    },
  };
};

const currentWorkspaceId = (page: Page) =>
  new URL(page.url()).searchParams.get('workspaceId');

const getKnowledgeAssetCardByName = (page: Page, assetName: string) =>
  page
    .locator(
      `[data-testid="knowledge-asset-card"][data-asset-name="${assetName}"]`,
    )
    .first();

const expectKnowledgeRouteSelector = async ({
  page,
  selector,
}: {
  page: Page;
  selector: KnowledgeWorkbenchSelector;
}) => {
  await expect
    .poll(() => {
      const url = new URL(page.url());
      return {
        workspaceId: url.searchParams.get('workspaceId'),
        knowledgeBaseId: url.searchParams.get('knowledgeBaseId'),
        kbSnapshotId: url.searchParams.get('kbSnapshotId'),
        deployHash: url.searchParams.get('deployHash'),
      };
    })
    .toEqual({
      workspaceId: selector.workspaceId,
      knowledgeBaseId: selector.knowledgeBaseId,
      kbSnapshotId: selector.kbSnapshotId || null,
      deployHash: selector.deployHash || null,
    });
};

const expectKnowledgeWorkbenchLoaded = async ({
  page,
  selector,
  knowledgeBaseName,
}: {
  page: Page;
  selector?: KnowledgeWorkbenchSelector;
  knowledgeBaseName?: string;
}) => {
  await expect(
    page.getByTestId('knowledge-workbench-tab-overview'),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('资产数')).toBeVisible({ timeout: 60_000 });

  if (selector) {
    await expectKnowledgeRouteSelector({ page, selector });
  }

  if (knowledgeBaseName) {
    await expect(page.getByText(knowledgeBaseName)).toBeVisible({
      timeout: 60_000,
    });
  }
};

const expectModelingWorkbenchLoaded = async ({
  page,
  waitForDiagram = true,
}: {
  page: Page;
  waitForDiagram?: boolean;
}) => {
  const modelingTree = page.locator('[role="tree"]').first();
  const viewTree = page.locator('[role="tree"]').nth(1);

  await expect(modelingTree).toContainText('数据模型', {
    timeout: 60_000,
  });
  await expect(viewTree).toContainText('视图', {
    timeout: 60_000,
  });

  if (waitForDiagram) {
    await modelingHelper.waitForModelingDataLoaded(page);
  }
};

const getSqlTemplateTitleInput = (page: Page) =>
  page.getByLabel('模板名称 / 典型问法');
const getSqlTemplateSqlInput = (page: Page) => page.getByLabel('SQL 代码');
const getInstructionSummaryInput = (page: Page) =>
  page.getByLabel('规则名称 / 首条问法');
const getInstructionContentInput = (page: Page) =>
  page.getByLabel('分析规则内容');
const getWorkbenchTab = (
  page: Page,
  tab:
    | 'overview'
    | 'modeling'
    | 'sqlTemplates'
    | 'instructions',
) => page.getByTestId(`knowledge-workbench-tab-${tab}`);
const clickWorkbenchAction = async (locator: Locator) => {
  await locator.scrollIntoViewIfNeeded();
  await locator.evaluate((node: HTMLElement) => node.click());
};
const clickWorkbenchTab = async (
  page: Page,
  tab:
    | 'overview'
    | 'modeling'
    | 'sqlTemplates'
    | 'instructions',
) => clickWorkbenchAction(getWorkbenchTab(page, tab));

const sanitizeSchemaName = (value: string) =>
  value.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();

const seedPostgresKnowledgeWorkbenchFixture = async ({
  workspaceId,
  knowledgeBaseId,
}: helper.RuntimeScopeFixture) => {
  const db = knex(testDbConfig);

  try {
    const schemaName = sanitizeSchemaName(
      `e2e_pg_${knowledgeBaseId.slice(0, 12)}`,
    );
    const kbSnapshotId = crypto.randomUUID();
    const deployHash = crypto.randomBytes(20).toString('hex');
    const now = new Date().toISOString();
    const encryptedConnectionInfo = encryptConnectionInfo(
      DataSourceName.POSTGRES,
      {
        host: '127.0.0.1',
        port: 9432,
        database: 'wrenai_e2e',
        user: 'postgres',
        password: 'postgres',
        ssl: false,
      },
    );

    await db.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await db.raw(`CREATE SCHEMA "${schemaName}"`);
    await db.raw(`
      CREATE TABLE "${schemaName}"."customers" (
        customer_id INTEGER PRIMARY KEY,
        customer_name VARCHAR NOT NULL
      )
    `);
    await db.raw(`
      CREATE TABLE "${schemaName}"."orders" (
        order_id INTEGER PRIMARY KEY,
        customer_id INTEGER NOT NULL,
        amount DECIMAL(10, 2) NOT NULL
      )
    `);
    await db.raw(`
      INSERT INTO "${schemaName}"."customers" (customer_id, customer_name) VALUES
        (1, 'Alice'),
        (2, 'Bob'),
        (3, 'Carol')
    `);
    await db.raw(`
      INSERT INTO "${schemaName}"."orders" (order_id, customer_id, amount) VALUES
        (1001, 1, 120.50),
        (1002, 1, 88.00),
        (1003, 2, 45.25)
    `);

    const [runtimeProjectRow] = await db('project')
      .insert({
        display_name: `[internal] ${knowledgeBaseId} e2e postgres runtime`,
        type: DataSourceName.POSTGRES,
        catalog: 'wrenai_e2e',
        schema: schemaName,
        connection_info: JSON.stringify(encryptedConnectionInfo),
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
      snapshot_key: 'e2e-postgres-knowledge-workbench',
      display_name: 'PostgreSQL 运行时快照',
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
          ref_sql: `select * from "${schemaName}"."orders"`,
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
          ref_sql: `select * from "${schemaName}"."customers"`,
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
          not_null: true,
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
      catalog: 'wrenai_e2e',
      schema: schemaName,
      dataSource: DataSourceName.POSTGRES,
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
              notNull: true,
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
            catalog: 'wrenai_e2e',
            schema: schemaName,
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
            catalog: 'wrenai_e2e',
            schema: schemaName,
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
      runtimeScopeId: deployHash,
      schemaName,
      projectId: runtimeProjectId,
    };
  } finally {
    await db.destroy();
  }
};

const askQuestionInKnowledgeScope = async ({
  page,
  selector,
  question,
  expectedAskPath,
  maxAttempts = 4,
}: {
  page: Page;
  selector: KnowledgeWorkbenchSelector;
  question: string;
  expectedAskPath?: string;
  maxAttempts?: number;
}) => {
  let lastTask: PersistedAskingTaskRecord | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/home',
      selector: toKnowledgeRouteSelector(selector),
    });
    await helper.expectPathname({ page, pathname: '/home' });
    await expect(page.getByPlaceholder('输入问题，@ 指定知识库')).toBeVisible({
      timeout: 60_000,
    });

    await page.getByPlaceholder('输入问题，@ 指定知识库').fill(question);
    await page.getByRole('button', { name: '发送问题' }).click();

    await homeHelper.checkAskingProcess(page, question);

    const threadId = new URL(page.url()).pathname.match(/\/home\/(\d+)/)?.[1];
    expect(threadId).toBeTruthy();

    lastTask = await waitForAskingTaskRecord({
      selector,
      question,
      timeoutMs: 120_000,
      allowFailedFinalStatus: true,
    });

    const askPathMatched = expectedAskPath
      ? lastTask.detail?.askPath === expectedAskPath
      : Boolean(lastTask.detail?.askPath);

    if (askPathMatched) {
      await expect(page.getByRole('heading', { name: question })).toBeVisible({
        timeout: 60_000,
      });

      if (!lastTask.detail?.error?.code) {
        await homeHelper.waitingForAskingTask(page);
        await homeHelper.checkThreadResponseSkeletonLoading(page);
      } else {
        await expect(page.getByText('Try a different query')).toBeVisible({
          timeout: 60_000,
        });
      }

      return {
        threadId: Number(threadId),
        task: lastTask,
      };
    }

    const canRetry =
      attempt < maxAttempts - 1 &&
      (lastTask.detail?.error?.code === 'NO_RELEVANT_DATA' ||
        !lastTask.detail?.askPath ||
        (expectedAskPath &&
          lastTask.detail?.askPath !== expectedAskPath &&
          !lastTask.detail?.response?.length));

    if (!canRetry) {
      break;
    }

    await page.waitForTimeout(5_000);
  }

  throw new Error(
    `Ask did not reach expected path "${expectedAskPath || 'any'}" for "${question}": ${JSON.stringify(
      lastTask?.detail || null,
    )}`,
  );
};

const waitForAskingTaskRecord = async ({
  selector,
  question,
  timeoutMs = 60_000,
  allowFailedFinalStatus = false,
}: {
  selector: KnowledgeWorkbenchSelector;
  question: string;
  timeoutMs?: number;
  allowFailedFinalStatus?: boolean;
}) => {
  const db = knex(testDbConfig);
  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline) {
      const record = (await db('asking_task')
        .select(
          'id',
          'query_id as queryId',
          'question',
          'detail',
          'thread_id as threadId',
          'thread_response_id as threadResponseId',
        )
        .where({
          workspace_id: selector.workspaceId,
          knowledge_base_id: selector.knowledgeBaseId,
          question,
        })
        .orderBy('created_at', 'desc')
        .first()) as PersistedAskingTaskRecord | undefined;

      if (record?.detail?.status === 'FINISHED') {
        return record;
      }

      if (record?.detail?.status === 'FAILED' && allowFailedFinalStatus) {
        return record;
      }

      if (record?.detail?.status === 'FAILED') {
        throw new Error(
          `Asking task failed for question "${question}": ${JSON.stringify(
            record.detail,
          )}`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    throw new Error(`Timed out waiting for asking task record: ${question}`);
  } finally {
    await db.destroy();
  }
};

const getWorkspaceCard = ({ page, slug }: { page: Page; slug: string }) =>
  page
    .getByText(slug, { exact: true })
    .locator(
      'xpath=ancestor::*[.//button[normalize-space()="切换到此工作空间"] or .//button[normalize-space()="进入当前工作空间"]][1]',
    )
    .first();

const createKnowledgeBase = async ({
  page,
  name,
  description,
  expectedWorkspaceId,
}: {
  page: Page;
  name: string;
  description: string;
  expectedWorkspaceId: string;
}) => {
  const createKnowledgeRequest = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.status() === 201 &&
      response.request().method() === 'POST' &&
      url.pathname === '/api/v1/knowledge/bases'
    );
  });

  await clickWorkbenchAction(page.getByRole('button', { name: '创建知识库' }));
  const knowledgeBaseModal = page.locator('.ant-modal').last();
  await expect(knowledgeBaseModal).toContainText('添加知识库');
  await knowledgeBaseModal.getByLabel('知识库名称').fill(name);
  await knowledgeBaseModal.getByLabel('AI 描述').fill(description);
  await knowledgeBaseModal.getByRole('button', { name: /保\s*存/ }).click();
  const createKnowledgeResponse = await createKnowledgeRequest;
  const createdKnowledgeBase = await createKnowledgeResponse.json();

  await expect(page.getByText('知识库已创建')).toBeVisible({ timeout: 60_000 });
  expect(createdKnowledgeBase.id).toBeTruthy();
  expect(createdKnowledgeBase.workspaceId).toBe(expectedWorkspaceId);
  expect(createdKnowledgeBase.name).toBe(name);

  return createdKnowledgeBase as {
    id: string;
    workspaceId: string;
    name: string;
  };
};

const createPostgresConnector = async ({
  page,
  selector,
  displayName = CONNECTOR_DISPLAY_NAME,
}: {
  page: Page;
  selector: KnowledgeWorkbenchSelector;
  displayName?: string;
}) => {
  await helper.gotoRuntimeScopedPath({
    page,
    pathname: '/settings/connectors',
    selector: toKnowledgeRouteSelector(selector),
  });
  await helper.expectPathname({ page, pathname: '/settings/connectors' });
  await expect(page.getByRole('heading', { name: /数据连接器/ })).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole('button', { name: '添加连接器' }).click();
  const connectorModal = page.locator('.ant-modal').last();
  await expect(connectorModal).toContainText('添加连接器');

  const connectorTypeField = connectorModal
    .locator('.ant-form-item')
    .filter({ hasText: '连接器类型' })
    .first();
  await connectorTypeField.locator('.ant-select-selector').click();
  await page
    .locator('.ant-select-dropdown')
    .last()
    .locator('.ant-select-item-option')
    .filter({ hasText: /^数据库$/ })
    .click();
  await expect(
    connectorModal
      .locator('.ant-form-item')
      .filter({ hasText: '数据库 Provider' }),
  ).toBeVisible();
  await expect(connectorModal.getByLabel('Host')).toBeVisible();

  await connectorModal.getByLabel('显示名称').fill(displayName);
  await connectorModal.getByLabel('Host').fill('127.0.0.1');
  await connectorModal.getByLabel('Port').fill('9432');
  await connectorModal.getByLabel('数据库名').fill('wrenai_e2e');
  await connectorModal.getByLabel('用户名').fill('postgres');
  await connectorModal.getByLabel('Schema').fill('public');
  await connectorModal.getByLabel('密码').fill('postgres');

  const testConnectorRequest = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'POST' &&
      url.pathname === '/api/v1/connectors/test'
    );
  });
  await connectorModal.getByRole('button', { name: '连接测试' }).click();
  const testConnectorResponse = await testConnectorRequest;
  const testConnectorBody = await testConnectorResponse.text();
  expect(testConnectorResponse.status(), testConnectorBody).toBe(200);
  await expect(page.getByText(/数据库连接测试成功/)).toBeVisible({
    timeout: 60_000,
  });

  const createConnectorRequest = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'POST' &&
      url.pathname === '/api/v1/connectors'
    );
  });
  await connectorModal.getByRole('button', { name: /保\s*存/ }).click();
  const createConnectorResponse = await createConnectorRequest;
  const createConnectorBody = await createConnectorResponse.text();
  expect(createConnectorResponse.status(), createConnectorBody).toBe(201);

  const connectorListSearchParams = new URLSearchParams();
  Object.entries(toKnowledgeBaseScopeSelector(selector)).forEach(
    ([key, value]) => {
      if (value) {
        connectorListSearchParams.set(key, value);
      }
    },
  );

  const connectorListResponse = await page.request.get(
    `/api/v1/connectors?${connectorListSearchParams.toString()}`,
  );
  const connectorListBody = await connectorListResponse.text();
  expect(connectorListResponse.status(), connectorListBody).toBe(200);
  const connectorListPayload = JSON.parse(connectorListBody) as Array<{
    displayName?: string | null;
  }>;
  expect(
    connectorListPayload.some(
      (connector) => connector.displayName === displayName,
    ),
  ).toBeTruthy();
};

const importConnectorAsset = async ({
  page,
  selector,
  connectorDisplayName,
}: {
  page: Page;
  selector: KnowledgeWorkbenchSelector;
  connectorDisplayName: string;
}) => {
  const importedAssetName = `${connectorDisplayName} / 待引入资产`;

  await helper.gotoRuntimeScopedPath({
    page,
    pathname: '/knowledge',
    selector: toKnowledgeRouteSelector(selector),
  });
  await helper.expectPathname({ page, pathname: '/knowledge' });
  await expectKnowledgeWorkbenchLoaded({
    page,
    selector,
  });

  await clickWorkbenchTab(page, 'overview');
  await page.getByTestId('knowledge-add-asset-card').click();

  const assetModal = page.locator('.ant-modal, [role="dialog"]').filter({
    hasText: '引入资产',
  });
  await expect(assetModal).toBeVisible({ timeout: 60_000 });

  await assetModal.getByRole('button', { name: 'MySQL' }).click();
  await assetModal
    .getByRole('combobox', { name: '选择数据库' })
    .click();
  await page.getByRole('option', { name: new RegExp(connectorDisplayName) }).click();
  await expect(
    assetModal.getByRole('button', { name: '下一步' }),
  ).toBeEnabled({ timeout: 60_000 });
  await assetModal.getByRole('button', { name: '下一步' }).click();

  await assetModal.getByPlaceholder('请输入资产名称').fill(importedAssetName);
  await assetModal
    .getByPlaceholder('补充该资产在当前知识库中的用途、口径与注意事项')
    .fill(`围绕 ${connectorDisplayName} 补充真实数据资产验证。`);
  await assetModal.getByRole('button', { name: '保存配置' }).click();

  await expect(page.getByText(importedAssetName).first()).toBeVisible({
    timeout: 60_000,
  });
  await assetModal.getByRole('button', { name: '返回知识库' }).click();
  await expect(
    page.getByText('已返回知识库概览，可继续补充规则与 SQL 模板。'),
  ).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    getKnowledgeAssetCardByName(page, importedAssetName),
  ).toBeVisible({
    timeout: 60_000,
  });
};

const dismissNextRuntimeErrorOverlay = async (page: Page) => {
  const runtimeErrorDialog = page.getByRole('dialog', {
    name: 'Unhandled Runtime Error',
  });

  if (!(await runtimeErrorDialog.isVisible().catch(() => false))) {
    return;
  }

  const closeButton = runtimeErrorDialog.getByRole('button', { name: 'Close' });
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  } else {
    await page.keyboard.press('Escape').catch(() => null);
  }

  await expect(runtimeErrorDialog).toBeHidden({ timeout: 15_000 });
};

const createSqlTemplate = async ({
  page,
  knowledgeBaseId,
  title,
  sql,
}: {
  page: Page;
  knowledgeBaseId: string;
  title: string;
  sql: string;
}) => {
  const loadSqlPairsRequest = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.ok() &&
      response.request().method() === 'GET' &&
      url.pathname === '/api/v1/knowledge/sql_pairs' &&
      url.searchParams.get('knowledgeBaseId') === knowledgeBaseId
    );
  });

  await clickWorkbenchTab(page, 'sqlTemplates');
  await loadSqlPairsRequest;
  await expect(page.getByText('正在加载 SQL 模板…')).toBeHidden({
    timeout: 60_000,
  });
  await expect(page.getByRole('button', { name: '新建 SQL 模板' })).toBeVisible(
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: '新建 SQL 模板' }).click();
  await expect(getSqlTemplateSqlInput(page)).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByRole('button', { name: '保存 SQL 模板' }),
  ).toBeVisible();
  await getSqlTemplateSqlInput(page).fill(sql);
  await getSqlTemplateTitleInput(page).fill(title);
  let createSqlPairResponse = null as Awaited<
    ReturnType<typeof page.waitForResponse>
  > | null;
  let createSqlPairBody = '';

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await dismissNextRuntimeErrorOverlay(page);

    const createSqlPairRequest = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'POST' &&
        url.pathname === '/api/v1/knowledge/sql_pairs'
      );
    });
    await clickWorkbenchAction(
      page.getByRole('button', { name: '保存 SQL 模板' }),
    );
    createSqlPairResponse = await createSqlPairRequest;
    createSqlPairBody = await createSqlPairResponse.text();

    if (createSqlPairResponse.status() === 201) {
      break;
    }

    const shouldRetry =
      createSqlPairResponse.status() === 400 &&
      createSqlPairBody.includes('HikariDataSource') &&
      createSqlPairBody.includes('has been closed') &&
      attempt < 4;

    if (!shouldRetry) {
      break;
    }

    await dismissNextRuntimeErrorOverlay(page);
    await page.waitForTimeout(1_000 * (attempt + 1));
  }

  expect(createSqlPairResponse?.status(), createSqlPairBody).toBe(201);
  await expect(page.getByText('已添加 SQL 模板')).toBeVisible({
    timeout: 60_000,
  });
  await expect(getSqlTemplateTitleInput(page)).toHaveValue(title);
  await expect(
    page.getByRole('button', { name: new RegExp(title) }).first(),
  ).toBeVisible({ timeout: 60_000 });
};

const createInstruction = async ({
  page,
  knowledgeBaseId,
  summary,
  content,
}: {
  page: Page;
  knowledgeBaseId: string;
  summary: string;
  content: string;
}) => {
  const createInstructionRequest = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'POST' &&
      url.pathname === '/api/v1/knowledge/instructions'
    );
  });
  const loadInstructionsRequest = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.ok() &&
      response.request().method() === 'GET' &&
      url.pathname === '/api/v1/knowledge/instructions' &&
      url.searchParams.get('knowledgeBaseId') === knowledgeBaseId
    );
  });

  await clickWorkbenchTab(page, 'instructions');
  await loadInstructionsRequest;
  await expect(page.getByText('正在加载分析规则…')).toBeHidden({
    timeout: 60_000,
  });
  await expect(page.getByRole('button', { name: '新建分析规则' })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: '新建分析规则' }).click();
  await expect(getInstructionSummaryInput(page)).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    page.getByRole('button', { name: '保存分析规则' }),
  ).toBeVisible();
  await getInstructionSummaryInput(page).fill(summary);
  await getInstructionContentInput(page).fill(content);
  await clickWorkbenchAction(page.getByRole('button', { name: '保存分析规则' }));
  const createInstructionResponse = await createInstructionRequest;
  const createInstructionBody = await createInstructionResponse.text();
  expect(createInstructionResponse.status(), createInstructionBody).toBe(201);
  await expect(page.getByText('已添加分析规则')).toBeVisible({
    timeout: 60_000,
  });
  await expect(getInstructionSummaryInput(page)).toHaveValue(summary);
  await expect(getInstructionContentInput(page)).toHaveValue(content);
};

const updateSqlTemplate = async ({
  page,
  title,
  nextTitle,
  nextSql,
}: {
  page: Page;
  title: string;
  nextTitle: string;
  nextSql: string;
}) => {
  await clickWorkbenchTab(page, 'sqlTemplates');
  const card = page
    .locator('button')
    .filter({ hasText: new RegExp(title) })
    .first();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.click();

  await getSqlTemplateTitleInput(page).fill(nextTitle);
  await getSqlTemplateSqlInput(page).fill(nextSql);
  await clickWorkbenchAction(page.getByRole('button', { name: '保存 SQL 模板' }));

  await expect(getSqlTemplateTitleInput(page)).toHaveValue(nextTitle);
  await expect(getSqlTemplateSqlInput(page)).toHaveValue(nextSql);
  await expect(
    page.getByRole('button', { name: new RegExp(nextTitle) }).first(),
  ).toBeVisible({ timeout: 60_000 });
};

const deleteSqlTemplate = async ({
  page,
  title,
}: {
  page: Page;
  title: string;
}) => {
  await clickWorkbenchTab(page, 'sqlTemplates');
  const card = page
    .locator('button')
    .filter({ hasText: new RegExp(title) })
    .first();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.locator('button[title="删除 SQL 模板"]').click();

  await expect(page.getByText('删除SQL 模板')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(
    page.getByRole('button', { name: new RegExp(title) }),
  ).toHaveCount(0);
};

const updateInstruction = async ({
  page,
  summary,
  nextSummary,
  nextContent,
}: {
  page: Page;
  summary: string;
  nextSummary: string;
  nextContent: string;
}) => {
  await clickWorkbenchTab(page, 'instructions');
  const card = page
    .locator('button')
    .filter({ hasText: new RegExp(summary) })
    .first();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.click();

  await getInstructionSummaryInput(page).fill(nextSummary);
  await getInstructionContentInput(page).fill(nextContent);
  await clickWorkbenchAction(page.getByRole('button', { name: '保存分析规则' }));

  await expect(getInstructionSummaryInput(page)).toHaveValue(nextSummary);
  await expect(getInstructionContentInput(page)).toHaveValue(nextContent);
  await expect(
    page.locator('button').filter({ hasText: new RegExp(nextSummary) }).first(),
  ).toBeVisible({ timeout: 60_000 });
};

const deleteInstruction = async ({
  page,
  summary,
}: {
  page: Page;
  summary: string;
}) => {
  await clickWorkbenchTab(page, 'instructions');
  const card = page
    .locator('button')
    .filter({ hasText: new RegExp(summary) })
    .first();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.locator('button[title="删除分析规则"]').click();

  await expect(page.getByText('删除分析规则')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(
    page.locator('button').filter({ hasText: new RegExp(summary) }),
  ).toHaveCount(0);
};

test.describe('Knowledge workbench', () => {
  test.describe.configure({ timeout: 240_000 });

  let selector: KnowledgeWorkbenchSelector;
  let secondarySelector: KnowledgeWorkbenchSelector;
  let switchedWorkspaceSelector: KnowledgeWorkbenchSelector;
  let postgresSelector: KnowledgeWorkbenchSelector;

  test.beforeEach(async ({ page }, testInfo) => {
    await helper.resetDatabase();
    const scopeKey = crypto
      .createHash('sha1')
      .update(testInfo.title)
      .digest('hex')
      .slice(0, 8);

    workspaceSlug = buildScopedSlug(WORKSPACE_SLUG, scopeKey);
    workspaceName = buildScopedName(WORKSPACE_NAME, scopeKey);
    knowledgeBaseSlug = buildScopedSlug(KNOWLEDGE_BASE_SLUG, scopeKey);
    knowledgeBaseName = buildScopedName(KNOWLEDGE_BASE_NAME, scopeKey);
    secondaryKnowledgeBaseSlug = buildScopedSlug(
      SECOND_KNOWLEDGE_BASE_SLUG,
      scopeKey,
    );
    secondaryKnowledgeBaseName = buildScopedName(
      SECOND_KNOWLEDGE_BASE_NAME,
      scopeKey,
    );
    switchedWorkspaceSlug = buildScopedSlug(SWITCHED_WORKSPACE_SLUG, scopeKey);
    switchedWorkspaceName = buildScopedName(SWITCHED_WORKSPACE_NAME, scopeKey);
    switchedKnowledgeBaseSlug = buildScopedSlug(
      SWITCHED_KNOWLEDGE_BASE_SLUG,
      scopeKey,
    );
    switchedKnowledgeBaseName = buildScopedName(
      SWITCHED_KNOWLEDGE_BASE_NAME,
      scopeKey,
    );
    createdKnowledgeBaseName = buildScopedName(
      CREATED_KNOWLEDGE_BASE_NAME,
      scopeKey,
    );
    switchedCreatedKnowledgeBaseName = buildScopedName(
      SWITCHED_CREATED_KNOWLEDGE_BASE_NAME,
      scopeKey,
    );
    postgresKnowledgeBaseSlug = buildScopedSlug(
      POSTGRES_KNOWLEDGE_BASE_SLUG,
      scopeKey,
    );
    postgresKnowledgeBaseName = buildScopedName(
      POSTGRES_KNOWLEDGE_BASE_NAME,
      scopeKey,
    );

    selector = await helper.ensureRuntimeScopeFixtureForUser({
      email: OWNER_EMAIL,
      workspaceSlug,
      workspaceName,
      knowledgeBaseSlug,
      knowledgeBaseName,
      setDefaultWorkspace: true,
    });

    const seededSelector = await helper.seedKnowledgeWorkbenchFixture(selector);
    selector = {
      ...seededSelector,
      runtimeScopeId: seededSelector.deployHash,
    };
    const seededSecondarySelector = await helper.seedKnowledgeWorkbenchFixture(
      await helper.ensureRuntimeScopeFixtureForUser({
        email: OWNER_EMAIL,
        workspaceSlug,
        workspaceName,
        knowledgeBaseSlug: secondaryKnowledgeBaseSlug,
        knowledgeBaseName: secondaryKnowledgeBaseName,
      }),
    );
    secondarySelector = {
      ...seededSecondarySelector,
      runtimeScopeId: seededSecondarySelector.deployHash,
    };
    const switchedWorkspaceSeed = await helper.seedKnowledgeWorkbenchFixture(
      await helper.ensureRuntimeScopeFixtureForUser({
        email: OWNER_EMAIL,
        workspaceSlug: switchedWorkspaceSlug,
        workspaceName: switchedWorkspaceName,
        knowledgeBaseSlug: switchedKnowledgeBaseSlug,
        knowledgeBaseName: switchedKnowledgeBaseName,
      }),
    );
    switchedWorkspaceSelector = {
      ...switchedWorkspaceSeed,
      runtimeScopeId: switchedWorkspaceSeed.deployHash,
    };
    const seededPostgresSelector = await seedPostgresKnowledgeWorkbenchFixture(
      await helper.ensureRuntimeScopeFixtureForUser({
        email: OWNER_EMAIL,
        workspaceSlug,
        workspaceName,
        knowledgeBaseSlug: postgresKnowledgeBaseSlug,
        knowledgeBaseName: postgresKnowledgeBaseName,
      }),
    );
    postgresSelector = {
      ...seededPostgresSelector,
      runtimeScopeId: seededPostgresSelector.deployHash,
    };

    await page.addInitScript((nextSelector) => {
      window.localStorage.setItem(
        'wren.runtimeScope',
        JSON.stringify(nextSelector),
      );
    }, selector);
  });

  test('covers the page-start workbench journey without page errors', async ({
    page,
  }) => {
    const errorCollector = attachPageErrorCollectors(page);

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/home',
      selector: toKnowledgeRouteSelector(selector),
    });
    await helper.expectPathname({ page, pathname: '/home' });
    await expect(page.getByPlaceholder('输入问题，@ 指定知识库')).toBeVisible({
      timeout: 60_000,
    });

    await page.getByText('我的知识库').click();
    await helper.expectPathname({ page, pathname: '/knowledge' });
    await expectKnowledgeWorkbenchLoaded({
      page,
      knowledgeBaseName,
    });
    await expect(page.getByTestId('shell-workspace-switcher')).toBeVisible();
    expect(
      await page
        .getByTestId('shell-history-scroller')
        .evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    expect(
      await page
        .getByTestId('knowledge-sidebar-list')
        .evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/knowledge',
      selector: toKnowledgeRouteSelector(selector),
    });
    await helper.expectPathname({ page, pathname: '/knowledge' });
    await expectKnowledgeWorkbenchLoaded({
      page,
      selector,
      knowledgeBaseName,
    });

    await clickWorkbenchTab(page, 'overview');
    await expect(page.getByText('资产数')).toBeVisible();

    await expect(page.getByText('正在同步知识库内容…')).toBeHidden({
      timeout: 60_000,
    });

    const hasSeededAssets =
      (await page.getByTestId('knowledge-asset-card').count()) > 0;
    const firstAssetCard = page.getByTestId('knowledge-asset-card').first();
    if (hasSeededAssets) {
      await firstAssetCard.click();

      await expect(page.getByText('资产详情')).toBeVisible();
      await expect(
        page.getByPlaceholder('搜索字段名、AI 名称、类型、备注'),
      ).toBeVisible();
      await page.getByRole('button', { name: '推荐问法', exact: true }).click();
      await expect(page.getByText('使用建议')).toBeVisible();
      await page.getByRole('button', { name: '去建模' }).first().click();
    } else {
      await expect(
        page.getByRole('heading', { name: '知识库为空' }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: '添加资产' }).last(),
      ).toBeVisible();
      await clickWorkbenchTab(page, 'modeling');
    }

    await expectModelingWorkbenchLoaded({
      page,
      waitForDiagram: hasSeededAssets,
    });

    await clickWorkbenchTab(page, 'sqlTemplates');
    await expect(
      page.getByRole('button', { name: '新建 SQL 模板' }),
    ).toBeVisible();

    await clickWorkbenchTab(page, 'instructions');
    await expect(
      page.getByRole('button', { name: '新建分析规则' }),
    ).toBeVisible();

    await clickWorkbenchTab(page, 'overview');
    await expect(page.getByText('资产数')).toBeVisible();

    errorCollector.assertClean();
  });

  test('switches SQL 模板/分析规则 tabs and keeps section data in sync when switching knowledge bases', async ({
    page,
  }) => {
    const errorCollector = attachPageErrorCollectors(page);

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/knowledge',
      selector: toKnowledgeRouteSelector(selector),
    });
    await helper.expectPathname({ page, pathname: '/knowledge' });
    await expectKnowledgeWorkbenchLoaded({
      page,
      selector,
      knowledgeBaseName,
    });

    await clickWorkbenchTab(page, 'sqlTemplates');
    await expect(
      page.getByRole('button', { name: '新建 SQL 模板' }),
    ).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('section'))
      .toBe('sqlTemplates');

    await clickWorkbenchTab(page, 'instructions');
    await expect(
      page.getByRole('button', { name: '新建分析规则' }),
    ).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('section'))
      .toBe('instructions');

    await clickWorkbenchTab(page, 'modeling');
    await expectModelingWorkbenchLoaded({ page });

    const waitForDiagramResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.ok() &&
        url.pathname === '/api/v1/knowledge/diagram' &&
        url.searchParams.get('knowledgeBaseId') ===
          secondarySelector.knowledgeBaseId
      );
    });

    await page
      .getByRole('button', { name: new RegExp(secondaryKnowledgeBaseName) })
      .click();
    await waitForDiagramResponse;
    await expect
      .poll(() => new URL(page.url()).searchParams.get('knowledgeBaseId'))
      .toBe(secondarySelector.knowledgeBaseId);
    await expect
      .poll(() => new URL(page.url()).searchParams.get('section'))
      .toBe('modeling');

    const waitForSqlResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.ok() &&
        url.pathname === '/api/v1/knowledge/sql_pairs' &&
        url.searchParams.get('knowledgeBaseId') ===
          secondarySelector.knowledgeBaseId
      );
    });
    await clickWorkbenchTab(page, 'sqlTemplates');
    await waitForSqlResponse;
    await expect(
      page.getByRole('button', { name: '新建 SQL 模板' }),
    ).toBeVisible();

    const waitForInstructionResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.ok() &&
        url.pathname === '/api/v1/knowledge/instructions' &&
        url.searchParams.get('knowledgeBaseId') ===
          secondarySelector.knowledgeBaseId
      );
    });
    await clickWorkbenchTab(page, 'instructions');
    await waitForInstructionResponse;
    await expect(
      page.getByRole('button', { name: '新建分析规则' }),
    ).toBeVisible();

    errorCollector.assertClean();
  });

  test('keeps knowledge workbench tab switching responsive and frontend-stable', async ({
    page,
  }) => {
    const errorCollector = attachPageErrorCollectors(page);
    const browserHealth = frontendHealth.attachBrowserHealthCollector(page, {
      ignoreConsoleErrors: [
        /Instance created by `useForm` is not connected to any Form element/,
      ],
    });

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/knowledge',
      selector: toKnowledgeRouteSelector(selector),
    });
    await helper.expectPathname({ page, pathname: '/knowledge' });
    await expectKnowledgeWorkbenchLoaded({
      page,
      selector,
      knowledgeBaseName,
    });

    const assetsStep = await frontendHealth.measureStep({
      label: 'open knowledge overview tab',
      action: () => clickWorkbenchTab(page, 'overview'),
      ready: () => expect(page.getByText('资产数')).toBeVisible(),
    });

    const modelingStep = await frontendHealth.measureStep({
      label: 'open knowledge modeling tab',
      action: () =>
        clickWorkbenchTab(page, 'modeling'),
      ready: async () => expectModelingWorkbenchLoaded({ page }),
    });

    const sqlTemplatesStep = await frontendHealth.measureStep({
      label: 'open knowledge sql templates tab',
      action: () =>
        clickWorkbenchTab(page, 'sqlTemplates'),
      ready: () =>
        expect(
          page.getByRole('button', { name: '新建 SQL 模板' }),
        ).toBeVisible(),
    });

    const instructionsStep = await frontendHealth.measureStep({
      label: 'open knowledge instructions tab',
      action: () =>
        clickWorkbenchTab(page, 'instructions'),
      ready: () =>
        expect(
          page.getByRole('button', { name: '新建分析规则' }),
        ).toBeVisible(),
    });

    await clickWorkbenchTab(page, 'modeling');
    await modelingHelper.waitForModelingDataLoaded(page);

    const switchSecondaryStep = await frontendHealth.measureStep({
      label: 'switch to secondary knowledge base',
      action: () =>
        page
          .getByRole('button', { name: new RegExp(secondaryKnowledgeBaseName) })
          .click(),
      ready: async () => {
        await expect
          .poll(() => new URL(page.url()).searchParams.get('knowledgeBaseId'))
          .toBe(secondarySelector.knowledgeBaseId);
        await expectModelingWorkbenchLoaded({ page });
      },
    });

    const switchPrimaryStep = await frontendHealth.measureStep({
      label: 'switch back to primary knowledge base',
      action: () =>
        page
          .getByRole('button', { name: new RegExp(knowledgeBaseName) })
          .click(),
      ready: async () => {
        await expect
          .poll(() => new URL(page.url()).searchParams.get('knowledgeBaseId'))
          .toBe(selector.knowledgeBaseId);
        await expectModelingWorkbenchLoaded({ page });
      },
    });

    frontendHealth.expectStepDurationWithin({
      label: assetsStep.label,
      durationMs: assetsStep.durationMs,
      thresholdMs: 5_000,
    });
    frontendHealth.expectStepDurationWithin({
      label: modelingStep.label,
      durationMs: modelingStep.durationMs,
      thresholdMs: 20_000,
    });
    frontendHealth.expectStepDurationWithin({
      label: sqlTemplatesStep.label,
      durationMs: sqlTemplatesStep.durationMs,
      thresholdMs: 5_000,
    });
    frontendHealth.expectStepDurationWithin({
      label: instructionsStep.label,
      durationMs: instructionsStep.durationMs,
      thresholdMs: 5_000,
    });
    frontendHealth.expectStepDurationWithin({
      label: switchSecondaryStep.label,
      durationMs: switchSecondaryStep.durationMs,
      thresholdMs: 20_000,
    });
    frontendHealth.expectStepDurationWithin({
      label: switchPrimaryStep.label,
      durationMs: switchPrimaryStep.durationMs,
      thresholdMs: 20_000,
    });

    await frontendHealth.expectNoHorizontalOverflow({
      page,
      testId: 'shell-history-scroller',
    });
    await frontendHealth.expectNoHorizontalOverflow({
      page,
      testId: 'knowledge-sidebar-list',
    });

    browserHealth.assertClean();
    errorCollector.assertClean();
  });

  test('creates a knowledge base, connects a workspace data source, and saves SQL/rule content', async ({
    page,
  }) => {
    const errorCollector = attachPageErrorCollectors(page);

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/knowledge',
      selector: toKnowledgeRouteSelector(selector),
    });
    await helper.expectPathname({ page, pathname: '/knowledge' });
    await expectKnowledgeWorkbenchLoaded({
      page,
      selector,
      knowledgeBaseName,
    });

    await createSqlTemplate({
      page,
      knowledgeBaseId: selector.knowledgeBaseId,
      title: SQL_TEMPLATE_TITLE,
      sql: SQL_TEMPLATE_SQL,
    });

    await createInstruction({
      page,
      knowledgeBaseId: selector.knowledgeBaseId,
      summary: RULE_SUMMARY,
      content: RULE_CONTENT,
    });

    await createKnowledgeBase({
      page,
      name: createdKnowledgeBaseName,
      description: CREATED_KNOWLEDGE_BASE_DESCRIPTION,
      expectedWorkspaceId: selector.workspaceId,
    });
    await expect(currentWorkspaceId(page)).toBe(selector.workspaceId);

    await createPostgresConnector({ page, selector });
    await importConnectorAsset({
      page,
      selector,
      connectorDisplayName: CONNECTOR_DISPLAY_NAME,
    });

    errorCollector.assertClean();
  });

  test('edits and deletes SQL 模板 / 分析规则 from the workbench editor', async ({
    page,
  }) => {
    const errorCollector = attachPageErrorCollectors(page);
    const updatedSqlTitle = `${SQL_TEMPLATE_TITLE}（已编辑）`;
    const updatedSql = 'select 2 as edited_order_count';
    const updatedRuleSummary = `${RULE_SUMMARY}（已编辑）`;
    const updatedRuleContent = `${RULE_CONTENT}\n并在需要时补充 customers 表辅助解释。`;

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/knowledge',
      selector: toKnowledgeRouteSelector(selector),
    });
    await helper.expectPathname({ page, pathname: '/knowledge' });
    await expectKnowledgeWorkbenchLoaded({
      page,
      selector,
      knowledgeBaseName,
    });

    await createSqlTemplate({
      page,
      knowledgeBaseId: selector.knowledgeBaseId,
      title: SQL_TEMPLATE_TITLE,
      sql: SQL_TEMPLATE_SQL,
    });
    await updateSqlTemplate({
      page,
      title: SQL_TEMPLATE_TITLE,
      nextTitle: updatedSqlTitle,
      nextSql: updatedSql,
    });
    await deleteSqlTemplate({
      page,
      title: updatedSqlTitle,
    });

    await createInstruction({
      page,
      knowledgeBaseId: selector.knowledgeBaseId,
      summary: RULE_SUMMARY,
      content: RULE_CONTENT,
    });
    await updateInstruction({
      page,
      summary: RULE_SUMMARY,
      nextSummary: updatedRuleSummary,
      nextContent: updatedRuleContent,
    });
    await deleteInstruction({
      page,
      summary: updatedRuleSummary,
    });

    errorCollector.assertClean();
  });

  test('creates SQL 模板/分析规则 and uses them during ask on a PostgreSQL-backed runtime scope', async ({
    page,
  }) => {
    const errorCollector = attachPageErrorCollectors(page);
    const db = knex(testDbConfig);

    try {
      const runtimeProject = await db('project')
        .select('id', 'type', 'schema')
        .where({ id: postgresSelector.projectId })
        .first();
      expect(runtimeProject?.type).toBe(DataSourceName.POSTGRES);
      expect(runtimeProject?.schema).toBe(postgresSelector.schemaName);
    } finally {
      await db.destroy();
    }

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/knowledge',
      selector: toKnowledgeRouteSelector(postgresSelector),
    });
    await helper.expectPathname({ page, pathname: '/knowledge' });
    await expectKnowledgeWorkbenchLoaded({
      page,
      selector: postgresSelector,
      knowledgeBaseName: postgresKnowledgeBaseName,
    });

    await createSqlTemplate({
      page,
      knowledgeBaseId: postgresSelector.knowledgeBaseId,
      title: POSTGRES_SQL_TEMPLATE_TITLE,
      sql: POSTGRES_SQL_TEMPLATE_SQL,
    });
    await createInstruction({
      page,
      knowledgeBaseId: postgresSelector.knowledgeBaseId,
      summary: POSTGRES_RULE_SUMMARY,
      content: POSTGRES_RULE_CONTENT,
    });

    const sqlTemplateAsk = await askQuestionInKnowledgeScope({
      page,
      selector: postgresSelector,
      question: POSTGRES_SQL_TEMPLATE_QUESTION,
      expectedAskPath: 'sql_pairs',
    });
    expect(sqlTemplateAsk.threadId).toBeGreaterThan(0);

    const sqlTemplateTask = sqlTemplateAsk.task;
    expect(sqlTemplateTask.detail?.askPath).toBe('sql_pairs');
    expect(
      sqlTemplateTask.detail?.response?.[0]?.sqlpairId ||
        sqlTemplateTask.detail?.error?.code === 'NO_RELEVANT_DATA',
    ).toBeTruthy();

    const instructionAsk = await askQuestionInKnowledgeScope({
      page,
      selector: postgresSelector,
      question: POSTGRES_RULE_QUESTION,
      expectedAskPath: 'instructions',
    });
    expect(instructionAsk.threadId).toBeGreaterThan(0);
    expect(instructionAsk.threadId).not.toBe(sqlTemplateAsk.threadId);

    const instructionTask = instructionAsk.task;
    expect(instructionTask.detail?.askPath).toBe('instructions');
    expect(instructionTask.detail?.response?.[0]?.sqlpairId ?? null).toBeNull();

    errorCollector.assertClean();
  });

  test('keeps knowledge base creation, connector setup, and rule/sql editing working after switching workspace', async ({
    page,
  }) => {
    const errorCollector = attachPageErrorCollectors(page);

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/workspace',
      selector: { workspaceId: selector.workspaceId },
    });
    await helper.expectPathname({ page, pathname: '/workspace' });
    await expect(page.getByText('我可访问的工作空间')).toBeVisible({
      timeout: 60_000,
    });

    const switchedWorkspaceCard = getWorkspaceCard({
      page,
      slug: SWITCHED_WORKSPACE_SLUG,
    });
    await expect(switchedWorkspaceCard).toBeVisible({ timeout: 60_000 });
    await switchedWorkspaceCard
      .getByRole('button', { name: '切换到此工作空间' })
      .click();

    await expect
      .poll(() => new URL(page.url()).searchParams.get('workspaceId'), {
        timeout: 60_000,
      })
      .toBe(switchedWorkspaceSelector.workspaceId);
    await expect(
      switchedWorkspaceCard.getByRole('button', { name: '进入当前工作空间' }),
    ).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: '查看我的知识库' }).click();
    await helper.expectPathname({ page, pathname: '/knowledge' });
    await expectKnowledgeWorkbenchLoaded({
      page,
      knowledgeBaseName: switchedKnowledgeBaseName,
    });
    await expect(
      page.getByRole('button', {
        name: new RegExp(switchedKnowledgeBaseName),
      }),
    ).toBeVisible({ timeout: 60_000 });
    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/knowledge',
      selector: toKnowledgeRouteSelector(switchedWorkspaceSelector),
    });
    await helper.expectPathname({ page, pathname: '/knowledge' });
    await expectKnowledgeRouteSelector({
      page,
      selector: switchedWorkspaceSelector,
    });

    await createSqlTemplate({
      page,
      knowledgeBaseId: switchedWorkspaceSelector.knowledgeBaseId,
      title: SWITCHED_SQL_TEMPLATE_TITLE,
      sql: SWITCHED_SQL_TEMPLATE_SQL,
    });

    await createInstruction({
      page,
      knowledgeBaseId: switchedWorkspaceSelector.knowledgeBaseId,
      summary: SWITCHED_RULE_SUMMARY,
      content: SWITCHED_RULE_CONTENT,
    });

    await createKnowledgeBase({
      page,
      name: switchedCreatedKnowledgeBaseName,
      description: SWITCHED_CREATED_KNOWLEDGE_BASE_DESCRIPTION,
      expectedWorkspaceId: switchedWorkspaceSelector.workspaceId,
    });
    await expect(currentWorkspaceId(page)).toBe(
      switchedWorkspaceSelector.workspaceId,
    );

    await createPostgresConnector({
      page,
      selector: switchedWorkspaceSelector,
      displayName: SWITCHED_CONNECTOR_DISPLAY_NAME,
    });
    await importConnectorAsset({
      page,
      selector: switchedWorkspaceSelector,
      connectorDisplayName: SWITCHED_CONNECTOR_DISPLAY_NAME,
    });

    errorCollector.assertClean();
  });
});
