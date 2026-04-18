import { test, expect, Locator, Page } from '@playwright/test';
import * as helper from '../helper';

const OWNER_EMAIL = 'admin@example.com';
const CONNECTOR_NAME = 'E2E PostgreSQL Connector';
const UPDATED_CONNECTOR_NAME = 'E2E PostgreSQL Connector Updated';
const modalSaveButtonName = /保\s*存/;
const modalTestButtonName = /连\s*接测试/;
const editButtonName = /编\s*辑/;
const testButtonName = /测\s*试/;
const deleteButtonName = /删\s*除/;
const connectorTestApiPath = '/api/v1/connectors/test';

const fillPostgresConnectorForm = async ({
  page,
  modal,
  displayName,
  port = '9432',
  password = 'postgres',
}: {
  page: Page;
  modal: Locator;
  displayName: string;
  port?: string;
  password?: string;
}) => {
  const connectorTypeField = modal
    .locator('.ant-form-item')
    .filter({ hasText: '连接器类型' })
    .first();
  await connectorTypeField.locator('.ant-select-selector').click();
  await page
    .locator('.ant-select-dropdown')
    .last()
    .getByText('数据库', { exact: true })
    .click();

  await expect(modal.getByText('数据库 Provider')).toBeVisible({
    timeout: 60_000,
  });
  await expect(modal.getByLabel('Host')).toBeVisible({ timeout: 60_000 });

  await modal.getByLabel('显示名称').fill(displayName);
  await modal.getByLabel('Host').fill('127.0.0.1');
  await modal.getByLabel('Port').fill(port);
  await modal.getByLabel('数据库名').fill('wrenai_e2e');
  await modal.getByLabel('用户名').fill('postgres');
  await modal.getByLabel('Schema').fill('public');
  await modal.getByLabel('密码').fill(password);
};

test.describe('Settings connectors', () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeEach(async () => {
    await helper.resetDatabase();
  });

  test('creates, edits, tests, and deletes a PostgreSQL connector', async ({
    page,
  }) => {
    const selector = await helper.ensureRuntimeScopeFixtureForUser({
      email: OWNER_EMAIL,
      workspaceSlug: 'settings-connectors-workspace',
      workspaceName: '连接器设置工作空间',
      knowledgeBaseSlug: 'settings-connectors-kb',
      knowledgeBaseName: '连接器设置知识库',
      setDefaultWorkspace: true,
    });

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/settings/connectors',
      selector,
    });
    await helper.expectPathname({ page, pathname: '/settings/connectors' });
    await expect(
      page.getByRole('heading', { name: /数据连接器/ }),
    ).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: '添加连接器' }).click();
    const createModal = page.locator('.ant-modal').filter({ hasText: '添加连接器' });
    await expect(createModal).toBeVisible({ timeout: 60_000 });
    await fillPostgresConnectorForm({
      page,
      modal: createModal,
      displayName: CONNECTOR_NAME,
    });

    await createModal.getByRole('button', { name: modalTestButtonName }).click();
    await expect(
      page.getByText(/数据库连接测试成功|连接测试成功/),
    ).toBeVisible({ timeout: 60_000 });

    await createModal.getByRole('button', { name: modalSaveButtonName }).click();
    await expect(page.getByText(CONNECTOR_NAME)).toBeVisible({ timeout: 60_000 });

    const connectorRow = page.locator('tr').filter({ hasText: CONNECTOR_NAME }).first();
    await connectorRow.getByRole('button', { name: editButtonName }).click();
    const editModal = page.locator('.ant-modal').filter({ hasText: '编辑连接器' });
    await expect(editModal).toBeVisible({ timeout: 60_000 });
    await editModal.getByLabel('显示名称').fill(UPDATED_CONNECTOR_NAME);
    await editModal.getByRole('button', { name: modalSaveButtonName }).click();

    await expect(page.getByText(UPDATED_CONNECTOR_NAME)).toBeVisible({
      timeout: 60_000,
    });

    const updatedRow = page.locator('tr').filter({ hasText: UPDATED_CONNECTOR_NAME }).first();
    await updatedRow.getByRole('button', { name: testButtonName }).click();
    await expect(
      page.getByText(/数据库连接测试成功|连接测试成功/),
    ).toBeVisible({ timeout: 60_000 });

    await updatedRow.getByRole('button', { name: deleteButtonName }).click();
    await expect(page.getByText('确认删除这个连接器吗？')).toBeVisible({
      timeout: 60_000,
    });
    await page.locator('.ant-popover-buttons .ant-btn-primary').click();
    await expect(page.getByText('连接器已删除。')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('tr').filter({ hasText: UPDATED_CONNECTOR_NAME })).toHaveCount(0);
  });

  test('shows an error when connector test uses invalid PostgreSQL credentials', async ({
    page,
  }) => {
    const selector = await helper.ensureRuntimeScopeFixtureForUser({
      email: OWNER_EMAIL,
      workspaceSlug: 'settings-connectors-failure-workspace',
      workspaceName: '连接器失败工作空间',
      knowledgeBaseSlug: 'settings-connectors-failure-kb',
      knowledgeBaseName: '连接器失败知识库',
      setDefaultWorkspace: true,
    });

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/settings/connectors',
      selector,
    });
    await helper.expectPathname({ page, pathname: '/settings/connectors' });

    await page.getByRole('button', { name: '添加连接器' }).click();
    const modal = page.locator('.ant-modal').filter({ hasText: '添加连接器' });
    await expect(modal).toBeVisible({ timeout: 60_000 });
    await fillPostgresConnectorForm({
      page,
      modal,
      displayName: 'Broken PostgreSQL Connector',
      port: '1',
      password: 'wrong-password',
    });

    const failedTestResponse = page.waitForResponse(
      (response) =>
        response.url().includes(connectorTestApiPath) &&
        response.request().method() === 'POST',
      { timeout: 60_000 },
    );

    await modal.getByRole('button', { name: modalTestButtonName }).click();
    const response = await failedTestResponse;
    expect(response.ok()).toBeFalsy();

    const payload = await response.json().catch(() => null);
    expect(JSON.stringify(payload || {})).toMatch(
      /连接测试失败|ECONNREFUSED|authentication failed|password|connect/i,
    );

    await expect(
      page
        .locator('.ant-message-notice')
        .filter({
          hasText: /连接测试失败|ECONNREFUSED|authentication failed|password|connect/i,
        })
        .last(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
