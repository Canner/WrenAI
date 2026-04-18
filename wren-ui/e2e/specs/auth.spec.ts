import { test, expect, Page } from '@playwright/test';
import * as helper from '../helper';

test.use({ storageState: { cookies: [], origins: [] } });

const loginButton = (page: Page) =>
  page.getByRole('button', { name: /登\s*录/ });

test.describe('Authentication flows', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async () => {
    await helper.resetDatabase();
  });

  test('logs in, persists the session, and logs out cleanly', async ({ page }) => {
    await page.goto('/auth');

    await expect(page.getByLabel('用户名')).toBeVisible({ timeout: 60_000 });
    await page.getByLabel('用户名').fill('admin@example.com');
    await page.getByLabel('密码').fill('Admin@123');
    await loginButton(page).click();

    await expect(page).toHaveURL(/\/home(?:\?.*)?$/, { timeout: 60_000 });

    await page.goto('/auth');
    await expect(page).toHaveURL(/\/home(?:\?.*)?$/, { timeout: 60_000 });

    await page.getByRole('button', { name: '账户菜单' }).click();
    await page.getByRole('menuitem', { name: '退出登录' }).click();

    await expect(page).toHaveURL(/\/auth(?:\?.*)?$/, { timeout: 60_000 });
    await expect(page.getByLabel('用户名')).toBeVisible();
  });

  test('shows the friendly invalid-credential error message', async ({ page }) => {
    await page.goto('/auth');

    await page.getByLabel('用户名').fill('admin@example.com');
    await page.getByLabel('密码').fill('wrong-password');
    await loginButton(page).click();

    await expect(
      page.getByText('用户名或密码不正确，请检查后重试。'),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/auth(?:\?.*)?$/);
  });

  test('reuses the same auth form on /register', async ({ page }) => {
    await page.goto('/register');

    await expect(page).toHaveURL(/\/register(?:\?.*)?$/);
    await expect(page.getByLabel('用户名')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByLabel('密码')).toBeVisible();
    await expect(loginButton(page)).toBeVisible();
  });
});
