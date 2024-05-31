import { Page, expect } from '@playwright/test';
import {
  AskingTask,
  AskingTaskStatus,
  ThreadResponse,
} from '@/apollo/client/graphql/__types__';
import * as modelingHelper from './modeling';

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

export const askSuggestionQuestionTest = async ({
  page,
  baseURL,
  suggestedQuestion,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL('/home', { timeout: 60000 });

  await page.getByText(suggestedQuestion).click();

  // check asking process state and wait for asking task to finish
  await checkAskingProcess(page, suggestedQuestion);
  await waitingForAskingTask(page, baseURL);
  await checkCandidatesResult(page);

  const firstResult = await getFirstCandidatesResultSummary(page);
  await page.getByRole('cell', { name: firstResult }).first().click();

  await checkSkeletonLoading(page, true);
  await waitingForThreadResponse(page, baseURL);
  await checkSkeletonLoading(page, false);

  // check question block
  await expect(page.getByLabel('question-circle').locator('svg')).toBeVisible();
  await expect(page.getByText('Question:')).toBeVisible();
  await expect(page.getByText(suggestedQuestion)).toBeVisible();

  // check thread summary
  await expect(page.getByRole('heading', { name: firstResult })).toBeVisible();

  // check show preview data table as default open
  await expect(page.locator('.ant-table')).toBeVisible();
  await expect(page.getByText('Showing up to 500 rows')).toBeVisible();

  // check up-circle icon with Collapse button
  await expect(page.getByLabel('up-circle').locator('svg')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse' })).toBeVisible();

  // click View Full SQL button
  await page.getByRole('button', { name: 'View Full SQL' }).click();
  await expect(page.locator('.ace_editor')).toBeVisible();

  // check collapse and copy button
  await expect(page.getByLabel('up-circle').locator('svg')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse' })).toBeVisible();
  await expect(page.getByLabel('copy').locator('svg')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();

  // check save icon button
  await expect(page.getByLabel('save').locator('svg')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save as View' }),
  ).toBeVisible();
};

export const followUpQuestionTest = async ({ page, baseURL, question }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/home', { timeout: 60000 });

  // click existing thread
  await page
    .getByRole('tree')
    .locator('div')
    .filter({ hasText: /\W/ })
    .nth(2)
    .click();

  // ask follow up question
  await page.getByPlaceholder('Ask to explore your data').fill(question);
  await page.getByRole('button', { name: 'Ask' }).click();

  // check asking process state and wait for asking task to finish
  await checkAskingProcess(page, question);
  await waitingForAskingTask(page, baseURL);
  await checkCandidatesResult(page);

  // click the View SQL
  await page
    .getByRole('cell', { name: 'Result 1 function View SQL' })
    .getByRole('button')
    .click();
  await page.getByLabel('Close', { exact: true }).click();

  const firstResult = await getFirstCandidatesResultSummary(page);

  // select the first suggested question if there are two same results
  await page.getByRole('cell', { name: firstResult }).first().click();

  await checkSkeletonLoading(page, true);
  await waitingForThreadResponse(page, baseURL);
  await checkSkeletonLoading(page, false);

  // check question block
  await expect(
    page.getByLabel('question-circle').locator('svg').last(),
  ).toBeVisible();
  await expect(page.getByText('Question:').last()).toBeVisible();
  await expect(page.getByText(question)).toBeVisible();

  // check thread summary
  await expect(page.getByRole('heading', { name: firstResult })).toBeVisible();

  await expect(page.locator('.ant-table').last()).toBeVisible();
  await expect(page.getByText('Showing up to 500 rows').last()).toBeVisible();

  // check up-circle icon with Collapse button
  await expect(
    page.getByLabel('up-circle').locator('svg').last(),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Collapse' }).last(),
  ).toBeVisible();

  // click View Full SQL button
  await page.getByRole('button', { name: 'View Full SQL' }).last().click();

  await expect(page.locator('.ace_editor')).toBeVisible();

  // check collapse and copy button
  await expect(
    page.getByLabel('up-circle').locator('svg').last(),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Collapse' }).last(),
  ).toBeVisible();
  await expect(page.getByLabel('copy').locator('svg')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();

  // check save icon button
  await expect(page.getByLabel('save').locator('svg').last()).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save as View' }).last(),
  ).toBeVisible();
};

export const saveAsView = async (
  { page, baseURL }: { page: Page; baseURL: string },
  { question, viewName }: { question: string; viewName: string },
) => {
  await askSuggestionQuestionTest({
    page,
    baseURL,
    suggestedQuestion: question,
  });

  await expect(
    page.getByRole('button', { name: 'Save as View' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save as View' }).click();

  // check save as view modal
  await expect(page.locator('.ant-modal-mask')).toBeVisible();
  await expect(page.locator('div.ant-modal')).toBeVisible();
  await expect(
    page.locator('div.ant-modal-title').filter({ hasText: 'Save as View' }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Save as View').getByLabel('Close', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'After saving, make sure you go to "Modeling Page" to deploy all saved views.',
    ),
  ).toBeVisible();

  // save as View process
  await page.getByLabel('Name').click();
  await page.getByLabel('Name').fill(viewName);

  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // check save as view success
  await expect(page.getByText('Successfully created view.')).toBeVisible();

  // go to modeling page
  await page.getByRole('button', { name: 'Modeling' }).click();
  await expect(page).toHaveURL('/modeling', { timeout: 60000 });

  // deploy MDL with view
  await expect(page.getByRole('button', { name: 'Deploy' })).toBeEnabled();
  await modelingHelper.executeDeploy({ page, baseURL });

  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page).toHaveURL('/home', { timeout: 60000 });

  // ask the saved view question
  await page.getByText(question).click();

  // check asking process state and wait for asking task to finish
  await checkAskingProcess(page, question);
  await waitingForAskingTask(page, baseURL);
  await checkCandidatesResult(page);

  // check offer view result
  await expect(page.getByText('Result 1')).toBeVisible();
  await expect(page.getByLabel('file-add').locator('svg')).toBeVisible();
  await expect(page.getByText('Result from a saved view')).toBeVisible();

  // hover the 'Result from a saved view' and show tooltip
  await page.getByText('Result from a saved view').hover();
  await expect(
    page
      .getByRole('tooltip', {
        name: 'This search result corresponds to a saved view:',
      })
      .locator('svg'),
  ).toBeVisible();
  await expect(
    page.getByText('This search result corresponds to a saved view:'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: viewName })).toBeVisible();

  // just waiting to hide the tooltip
  await page.getByRole('button', { name: 'Ask' }).hover();

  const firstResult = await getFirstCandidatesResultSummary(page);
  await page.getByRole('cell', { name: firstResult }).first().click();

  // check offer view info for thread response UI
  await expect(page.getByText('Generated from saved view')).toBeVisible();
  await expect(page.getByRole('link', { name: viewName })).toBeVisible();

  // click the view name link will open a new tab and go to the view metadata of the modeling page
  const newWebPagePromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: viewName }).click();
  const modelingPage = await newWebPagePromise;

  // check view metadata
  await expect(
    modelingPage
      .locator('div.ant-drawer-title')
      .filter({ hasText: new RegExp(`^${viewName}$`) }),
  ).toBeVisible();
  await expect(
    modelingPage.getByTestId('metadata__name').getByText(viewName),
  ).toBeVisible();
  await modelingPage
    .locator('div.ant-drawer')
    .getByLabel('Close', { exact: true })
    .click();

  // check view node in diagram
  await expect(
    modelingPage.getByRole('complementary').getByText(viewName),
  ).toBeVisible();
  await modelingPage.getByRole('complementary').getByText(viewName).click();
  await expect(
    modelingPage.getByTestId(`diagram__view-node__${viewName}`),
  ).toBeVisible();
};
