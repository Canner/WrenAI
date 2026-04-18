import crypto from 'crypto';
import knex from 'knex';
import { test, expect, Page } from '@playwright/test';
import * as helper from '../helper';
import { testDbConfig } from '../config';

const OWNER_EMAIL = 'admin@example.com';
const INVITED_EMAIL = 'invited-member@example.com';
const PENDING_EMAIL = 'pending-member@example.com';
const approveButtonName = /批\s*准/;
const removeButtonName = /移\s*除/;
const enableButtonName = /启\s*用/;
const disableButtonName = /停\s*用/;

const findMemberRow = (page: Page, email: string) =>
  page.locator('tr').filter({ hasText: email }).first();

const expectToast = async (page: Page, text: string | RegExp) => {
  await expect(
    page.locator('.ant-message-notice').filter({ hasText: text }).last(),
  ).toBeVisible({ timeout: 60_000 });
};

const findStatusTag = (row: ReturnType<typeof findMemberRow>, label: string) =>
  row.locator('.ant-tag').filter({ hasText: new RegExp(`^${label}$`) }).first();

const waitForMemberRow = async (page: Page, email: string) => {
  const row = findMemberRow(page, email);
  await expect(row).toBeVisible({ timeout: 60_000 });
  return row;
};

const seedWorkspaceUsers = async (selector: helper.RuntimeScopeFixture) => {
  const db = knex(testDbConfig);

  try {
    const owner = await db('user').where({ email: OWNER_EMAIL }).first('id');
    expect(owner?.id).toBeTruthy();

    const ensureUser = async (email: string, displayName: string) => {
      const existing = await db('user').where({ email }).first('id');
      const userId = (existing?.id as string | undefined) || crypto.randomUUID();
      if (!existing?.id) {
        await db('user').insert({
          id: userId,
          email,
          display_name: displayName,
          locale: 'zh-CN',
          status: 'active',
          is_platform_admin: false,
          default_workspace_id: selector.workspaceId,
        });
      }
      return userId;
    };

    const pendingUserId = await ensureUser(PENDING_EMAIL, 'Pending Member');
    await ensureUser(INVITED_EMAIL, 'Invited Member');

    await db('workspace_member').insert({
      id: crypto.randomUUID(),
      workspace_id: selector.workspaceId,
      user_id: pendingUserId,
      role_key: 'member',
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  } finally {
    await db.destroy();
  }
};

test.describe('Settings users', () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeEach(async () => {
    await helper.resetDatabase();
  });

  test('invites members and manages pending or active members', async ({ page }) => {
    const selector = await helper.ensureRuntimeScopeFixtureForUser({
      email: OWNER_EMAIL,
      workspaceSlug: 'settings-users-workspace',
      workspaceName: '成员管理工作空间',
      knowledgeBaseSlug: 'settings-users-kb',
      knowledgeBaseName: '成员管理知识库',
      setDefaultWorkspace: true,
    });
    await seedWorkspaceUsers(selector);

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/settings/users',
      selector,
    });
    await helper.expectPathname({ page, pathname: '/settings/users' });
    await expect(page.getByText('用户管理')).toBeVisible({ timeout: 60_000 });

    await page
      .getByPlaceholder('输入成员邮箱，例如 analyst@example.com')
      .fill(INVITED_EMAIL);
    await page.getByRole('button', { name: '邀请成员' }).click();
    await expectToast(page, '邀请已发送，成员会出现在待处理队列中');

    const invitedRow = await waitForMemberRow(page, INVITED_EMAIL);
    await expect(findStatusTag(invitedRow, '待接受')).toBeVisible();

    const pendingRow = await waitForMemberRow(page, PENDING_EMAIL);
    await expect(findStatusTag(pendingRow, '待审批')).toBeVisible();
    await pendingRow.getByRole('button', { name: approveButtonName }).click();
    await expectToast(page, '已批准加入申请');
    await expect(findStatusTag(pendingRow, '启用')).toBeVisible({
      timeout: 60_000,
    });

    const roleSelect = pendingRow.locator('.ant-select').first();
    await roleSelect.click();
    await page
      .locator('.ant-select-dropdown')
      .last()
      .locator('.ant-select-item-option')
      .filter({ hasText: /^管理员$/ })
      .click();
    await expectToast(page, '成员角色已更新');
    await expect(
      pendingRow.locator('td').nth(1).locator('.ant-select-selection-item'),
    ).toHaveText('管理员');

    await pendingRow.getByRole('button', { name: disableButtonName }).click();
    await expectToast(page, '成员已停用');
    await expect(findStatusTag(pendingRow, '停用')).toBeVisible();

    await pendingRow.getByRole('button', { name: enableButtonName }).click();
    await expectToast(page, '成员已重新启用');
    await expect(findStatusTag(pendingRow, '启用')).toBeVisible();

    await invitedRow.getByRole('button', { name: removeButtonName }).click();
    await expectToast(page, '成员已移除');
    await expect(findMemberRow(page, INVITED_EMAIL)).toHaveCount(0);
  });
});
