import { test, expect, Page } from '@playwright/test';
import * as helper from '../helper';
import * as homeHelper from '../commonTests/home';
import { SampleDatasetName } from '@/types/dataSource';

const SUGGESTED_QUESTION = '订单量最高的 3 个城市分别是谁？';

const buildScopedThreadUrl = ({
  threadId,
  selector,
}: {
  threadId: string;
  selector: Record<string, string>;
}) => {
  const params = new URLSearchParams(selector);
  return `/api/v1/threads/${threadId}?${params.toString()}`;
};

test.describe('Advanced ask flow coverage', () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async () => {
    await helper.resetDatabase();
  });

  test('runs a suggested question, opens SQL adjustment, previews data, and deletes the thread', async ({
    page,
  }) => {
    const selector = await helper.ensureSystemSampleRuntimeScope({
      page,
      sampleDataset: SampleDatasetName.ECOMMERCE,
    });

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/home',
      selector,
    });
    await helper.expectPathname({ page, pathname: '/home' });

    await homeHelper.askSuggestionQuestionTest({
      page,
      suggestedQuestion: SUGGESTED_QUESTION,
      selector,
    });

    await page.getByRole('button', { name: '调整 SQL' }).click();
    const adjustModal = page.getByRole('dialog', { name: '调整 SQL' });
    await expect(adjustModal).toBeVisible({ timeout: 60_000 });
    await expect(adjustModal.getByText('数据预览（50 行）')).toBeVisible();

    await adjustModal.getByRole('button', { name: '预览数据' }).click();
    await expect(
      adjustModal.locator('.ant-table, .ant-alert').first(),
    )
      .toBeVisible({ timeout: 60_000 })
      .catch(async () => {
        await expect(adjustModal.getByText('暂无数据')).toBeVisible({
          timeout: 60_000,
        });
      });
    await adjustModal.getByRole('button', { name: /取\s*消/ }).click({
      force: true,
    });
    await expect(adjustModal).toHaveCount(0);

    const threadId = page.url().match(/\/home\/(\d+)/)?.[1];
    expect(threadId).toBeTruthy();

    const deleteResponse = await page.request.delete(
      buildScopedThreadUrl({
        threadId: String(threadId),
        selector,
      }),
    );
    expect(deleteResponse.ok()).toBeTruthy();

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/home',
      selector,
    });
    await helper.expectPathname({ page, pathname: '/home' });
    await expect(
      page.getByTestId('shell-history-scroller').getByRole('button', {
        name: SUGGESTED_QUESTION,
      }),
    ).toHaveCount(0);
  });
});
