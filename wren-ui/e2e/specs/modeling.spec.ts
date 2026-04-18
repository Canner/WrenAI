import knex from 'knex';
import { test, expect, Page } from '@playwright/test';
import * as helper from '../helper';
import * as modelingHelper from '../commonTests/modeling';
import { testDbConfig } from '../config';
import { ExpressionName } from '@/types/calculatedField';
import { RelationType } from '@/types/modeling';
import { SyncStatus } from '@/types/project';

const OWNER_EMAIL = 'admin@example.com';
const MODEL_ALIAS = '客户档案';
const MODEL_DESCRIPTION = '用于 E2E 验证的客户模型别名。';
const VIEW_DISPLAY_NAME = '订单汇总视图';
const VIEW_ALIAS = '订单汇总视图（已编辑）';
const VIEW_DESCRIPTION = '用于验证视图元数据更新。';
const CALCULATED_FIELD_NAME = '订单金额累计';

type RuntimeScopedSelector = helper.RuntimeScopeFixture & Record<string, string>;

type ModelingState = {
  customersModelId: number;
  ordersModelId: number;
  orderCustomerColumnId: number;
  customerPrimaryKeyColumnId: number;
  orderAmountColumnId: number;
  relationId: number;
  relationType: string;
  calculatedFieldId?: number;
  viewId: number;
};

const buildScopedPath = (
  pathname: string,
  selector: Record<string, string | undefined | null>,
) => {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(selector)) {
    if (value) {
      searchParams.set(key, String(value));
    }
  }
  return `${pathname}?${searchParams.toString()}`;
};

const requestScopedJson = async <T,>(
  page: Page,
  selector: Record<string, string | undefined | null>,
  pathname: string,
  init?: Parameters<Page['request']['fetch']>[1],
): Promise<T> => {
  const response = await page.request.fetch(buildScopedPath(pathname, selector), init);
  const text = await response.text();
  expect(
    response.ok(),
    `${init?.method || 'GET'} ${pathname} failed (${response.status()}): ${text}`,
  ).toBeTruthy();
  return (text ? JSON.parse(text) : {}) as T;
};

const gotoModelingWorkbench = async ({
  page,
  selector,
}: {
  page: Page;
  selector: RuntimeScopedSelector;
}) => {
  await helper.gotoRuntimeScopedPath({
    page,
    pathname: '/knowledge',
    selector: {
      ...selector,
      section: 'modeling',
    },
  });
  await helper.expectPathname({ page, pathname: '/knowledge' });
  await expect
    .poll(() => new URL(page.url()).searchParams.get('section'))
    .toBe('modeling');
  await expect(page.getByText('数据模型')).toBeVisible({ timeout: 60_000 });
  await modelingHelper.waitForModelingDataLoaded(page);
};

const loadModelingState = async (
  selector: helper.RuntimeScopeFixture,
): Promise<ModelingState> => {
  const db = knex(testDbConfig);
  try {
    const models = await db('model')
      .select('id', 'reference_name', 'properties')
      .where({ knowledge_base_id: selector.knowledgeBaseId });
    const ordersModel = models.find((model) => model.reference_name === 'orders');
    const customersModel = models.find(
      (model) => model.reference_name === 'customers',
    );
    expect(ordersModel?.id).toBeTruthy();
    expect(customersModel?.id).toBeTruthy();

    const modelColumns = await db('model_column')
      .select('id', 'model_id', 'reference_name', 'is_calculated')
      .whereIn('model_id', [ordersModel!.id, customersModel!.id]);
    const relation = await db('relation')
      .select('id', 'from_column_id', 'to_column_id', 'join_type')
      .where({ knowledge_base_id: selector.knowledgeBaseId })
      .first();
    const ordersCustomerColumn = modelColumns.find(
      (column) =>
        column.model_id === ordersModel!.id &&
        column.reference_name === 'customer_id' &&
        !column.is_calculated,
    );
    const customerPrimaryKeyColumn = modelColumns.find(
      (column) =>
        column.model_id === customersModel!.id &&
        column.reference_name === 'customer_id' &&
        !column.is_calculated,
    );
    const orderAmountColumn = modelColumns.find(
      (column) =>
        column.model_id === ordersModel!.id &&
        column.reference_name === 'amount' &&
        !column.is_calculated,
    );
    const calculatedField = modelColumns.find(
      (column) =>
        column.model_id === ordersModel!.id &&
        column.reference_name === CALCULATED_FIELD_NAME,
    );
    const view = await db('view')
      .select('id')
      .where({ knowledge_base_id: selector.knowledgeBaseId })
      .first();

    expect(ordersCustomerColumn?.id).toBeTruthy();
    expect(customerPrimaryKeyColumn?.id).toBeTruthy();
    expect(orderAmountColumn?.id).toBeTruthy();
    expect(relation?.id).toBeTruthy();
    expect(view?.id).toBeTruthy();

    return {
      customersModelId: Number(customersModel!.id),
      ordersModelId: Number(ordersModel!.id),
      orderCustomerColumnId: Number(ordersCustomerColumn!.id),
      customerPrimaryKeyColumnId: Number(customerPrimaryKeyColumn!.id),
      orderAmountColumnId: Number(orderAmountColumn!.id),
      relationId: Number(relation!.id),
      relationType: String(relation!.join_type),
      calculatedFieldId: calculatedField?.id ? Number(calculatedField.id) : undefined,
      viewId: Number(view!.id),
    };
  } finally {
    await db.destroy();
  }
};

const seedModelingView = async ({
  workspaceId,
  knowledgeBaseId,
  kbSnapshotId,
  deployHash,
}: helper.RuntimeScopeFixture & { kbSnapshotId: string; deployHash: string }) => {
  const db = knex(testDbConfig);
  try {
    const knowledgeBase = await db('knowledge_base')
.where({ id: knowledgeBaseId })
      .first('runtime_project_id');
    const runtimeProjectId = Number(knowledgeBase?.runtime_project_id);
    expect(runtimeProjectId).toBeGreaterThan(0);

    await db('view').insert({
      project_id: runtimeProjectId,
      workspace_id: workspaceId,
      knowledge_base_id: knowledgeBaseId,
      kb_snapshot_id: kbSnapshotId,
      deploy_hash: deployHash,
      actor_user_id: null,
      name: 'orders_summary_view',
      statement:
        'select customer_id, sum(amount) as total_amount from orders group by customer_id',
      cached: false,
      refresh_time: null,
      properties: JSON.stringify({
        displayName: VIEW_DISPLAY_NAME,
        description: '用于 E2E 验证的订单汇总视图。',
      }),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  } finally {
    await db.destroy();
  }
};

test.describe('Modeling workbench coverage', () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async () => {
    await helper.resetDatabase();
  });

  test('covers model, relationship, calculated field, metadata, and deploy flows through REST-backed modeling', async ({
    page,
  }) => {
    const selector = await helper.ensureRuntimeScopeFixtureForUser({
      email: OWNER_EMAIL,
      workspaceSlug: 'modeling-e2e-workspace',
      workspaceName: '建模 E2E 工作空间',
      knowledgeBaseSlug: 'modeling-e2e-kb',
      knowledgeBaseName: '建模 E2E 知识库',
      setDefaultWorkspace: true,
    });
    const seeded = await helper.seedKnowledgeWorkbenchFixture(selector);
    await seedModelingView({ ...selector, ...seeded });

    const runtimeSelector = {
      workspaceId: selector.workspaceId,
      knowledgeBaseId: selector.knowledgeBaseId,
      kbSnapshotId: seeded.kbSnapshotId,
      deployHash: seeded.deployHash,
    };

    await gotoModelingWorkbench({ page, selector: runtimeSelector });
    await expect(page.getByTestId('diagram__model-node__客户')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId(`diagram__view-node__${VIEW_DISPLAY_NAME}`)).toBeVisible({
      timeout: 60_000,
    });

    let state = await loadModelingState(selector);

    await requestScopedJson(page, runtimeSelector, `/api/v1/models/${state.customersModelId}`, {
      method: 'DELETE',
    });
    await gotoModelingWorkbench({ page, selector: runtimeSelector });
    await expect(page.getByTestId('diagram__model-node__客户')).toHaveCount(0);

    await requestScopedJson(page, runtimeSelector, '/api/v1/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        sourceTableName: 'customers',
        fields: ['customer_id', 'customer_name'],
        primaryKey: 'customer_id',
      },
    });
    await gotoModelingWorkbench({ page, selector: runtimeSelector });
    await expect(page.getByTestId('diagram__model-node__客户')).toBeVisible({
      timeout: 60_000,
    });

    state = await loadModelingState(selector);

    await requestScopedJson(page, runtimeSelector, `/api/v1/models/${state.customersModelId}/metadata`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      data: {
        displayName: MODEL_ALIAS,
        description: MODEL_DESCRIPTION,
      },
    });
    await requestScopedJson(page, runtimeSelector, `/api/v1/views/${state.viewId}/metadata`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      data: {
        displayName: VIEW_ALIAS,
        description: VIEW_DESCRIPTION,
      },
    });
    await requestScopedJson(page, runtimeSelector, '/api/v1/calculated-fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        modelId: state.ordersModelId,
        name: CALCULATED_FIELD_NAME,
        expression: ExpressionName.SUM,
        lineage: [state.orderAmountColumnId],
      },
    });

    await requestScopedJson(page, runtimeSelector, `/api/v1/relationships/${state.relationId}`, {
      method: 'DELETE',
    });
    await requestScopedJson(page, runtimeSelector, '/api/v1/relationships', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        fromModelId: state.ordersModelId,
        fromColumnId: state.orderCustomerColumnId,
        toModelId: state.customersModelId,
        toColumnId: state.customerPrimaryKeyColumnId,
        type: RelationType.ONE_TO_ONE,
      },
    });

    await gotoModelingWorkbench({ page, selector: runtimeSelector });
    await expect(page.getByTestId(`diagram__model-node__${MODEL_ALIAS}`)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId(`diagram__view-node__${VIEW_ALIAS}`)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(CALCULATED_FIELD_NAME)).toBeVisible({
      timeout: 60_000,
    });

    state = await loadModelingState(selector);
    expect(state.relationType).toBe(RelationType.ONE_TO_ONE);
    expect(state.calculatedFieldId).toBeTruthy();

    await requestScopedJson(page, runtimeSelector, `/api/v1/calculated-fields/${state.calculatedFieldId}`, {
      method: 'DELETE',
    });
    await gotoModelingWorkbench({ page, selector: runtimeSelector });
    await expect(page.getByText(CALCULATED_FIELD_NAME)).toHaveCount(0);

    const deployStatusBefore = await requestScopedJson<{ status: SyncStatus }>(
      page,
      runtimeSelector,
      '/api/v1/deploy/status',
    );
    expect(deployStatusBefore.status).toBe(SyncStatus.UNSYNCRONIZED);

    await page.getByRole('button', { name: 'Deploy' }).click();
    await expect
      .poll(async () => {
        const payload = await requestScopedJson<{ status: SyncStatus }>(
          page,
          runtimeSelector,
          '/api/v1/deploy/status',
        );
        return payload.status;
      })
      .toBe(SyncStatus.SYNCRONIZED);
  });
});
