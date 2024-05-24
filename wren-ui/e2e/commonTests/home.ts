import { Page, expect } from '@playwright/test';
import {
  AskingTask,
  AskingTaskStatus,
  ThreadResponse,
} from '@/apollo/client/graphql/__types__';

export const checkAskingProcess = async (page: Page, question: string) => {
  // check process state
  await expect(page.getByText('Searching data')).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect(page.getByPlaceholder('Ask to explore your data')).toHaveValue(
    question,
  );
  await expect(page.getByRole('button', { name: 'Ask' })).toBeDisabled();
};

export const waitingForAskingTask = async (page: Page, baseURL) => {
  await page.waitForResponse(
    async (response) => {
      const responseBody = await response.json();
      const responseData: AskingTask = responseBody?.data?.askingTask;
      return (
        response.url() === `${baseURL}/api/graphql` &&
        response.status() === 200 &&
        responseBody &&
        [AskingTaskStatus.FAILED, AskingTaskStatus.FINISHED].includes(
          responseData?.status,
        )
      );
    },
    { timeout: 100000 },
  );
};

export const checkCandidatesResult = async (page: Page) => {
  await expect(
    page.locator('div').filter({ hasText: 'result(s) found' }).last(),
  ).toBeVisible();
  await expect(page.getByText('result(s) found')).toBeVisible();
};

export const getFirstCandidatesResultSummary = async (page: Page) => {
  const candidatesResultHandle = await page.evaluateHandle(
    (document) => {
      const nodes: any = Array.from(
        document.querySelectorAll('div[role="row"]'),
      );
      const node = nodes[nodes.length - 1];
      const firstResult = node.firstElementChild.lastElementChild;

      return firstResult.childNodes[1].innerText;
    },
    await page.evaluateHandle(() => document),
  );

  const firstResultSummary = await candidatesResultHandle.jsonValue();
  await candidatesResultHandle.dispose();

  return firstResultSummary;
};

export const checkSkeletonLoading = async (page: Page, isShow: boolean) => {
  await expect(page.locator('.ant-skeleton-content')).toBeVisible({
    visible: isShow,
  });
};

export const waitingForThreadResponse = async (page: Page, baseURL: string) => {
  await page.waitForResponse(
    async (response) => {
      const responseBody = await response.json();
      const responseData: ThreadResponse = responseBody?.data?.threadResponse;
      return (
        response.url() === `${baseURL}/api/graphql` &&
        response.status() === 200 &&
        responseBody &&
        [AskingTaskStatus.FAILED, AskingTaskStatus.FINISHED].includes(
          responseData?.status,
        )
      );
    },
    { timeout: 100000 },
  );
};
