import { Page, expect } from '@playwright/test';
import * as helper from '../helper';
import {
  AskingTask,
  AskingTaskStatus,
} from '@/apollo/client/graphql/__types__';
import * as modelingHelper from './modeling';

export const checkAskingProcess = async (page: Page, question: string) => {
  // check process state
  await expect(page.getByTestId('prompt__result')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect(page.getByPlaceholder('Ask to explore your data')).toHaveValue(
    question,
  );
  await expect(page.getByRole('button', { name: 'Ask' })).toBeDisabled();
};

export const waitingForAskingTask = async (page: Page) => {
  await helper.waitForGraphQLResponse({ page }, 'askingTask', (data) =>
    [AskingTaskStatus.FAILED, AskingTaskStatus.FINISHED].includes(data?.status),
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

export const checkThreadResponseSkeletonLoading = async (page: Page) => {
  await expect(page.locator('.ant-skeleton-content').last()).toBeVisible({
    timeout: 60000,
  });
  await expect(page.locator('.ant-skeleton-content').last()).toBeHidden({
    timeout: 60000,
  });
};

const checkThreadResponseBreakdownContent = async (page: Page) => {
  // switch to the View SQL tab
  await page
    .locator('div')
    .filter({ hasText: /^View SQL$/ })
    .last()
    .click();

  // View SQL tab content
  await expect(
    page.getByLabel('View SQL').locator('.ant-skeleton-content').last(),
  ).toBeVisible();

  await expect(
    page.getByLabel('View SQL').locator('.ant-skeleton-content').last(),
  ).toBeHidden({ timeout: 60000 });

  // check show preview data table as default open
  await expect(
    page.getByLabel('View SQL').locator('.ant-table').last(),
  ).toBeVisible();
  await expect(page.getByText('Showing up to 500 rows').last()).toBeVisible();

  // check up-circle icon with Collapse button
  await expect(
    page.getByLabel('View SQL').getByLabel('up-circle').locator('svg').last(),
  ).toBeVisible();
  await expect(
    page
      .getByLabel('View SQL')
      .getByRole('button', { name: 'Collapse' })
      .last(),
  ).toBeVisible();

  // click View Full SQL button
  await page
    .getByLabel('View SQL')
    .getByRole('button', { name: 'View Full SQL' })
    .last()
    .click();
  await expect(
    page.getByLabel('View SQL').locator('.ace_editor'),
  ).toBeVisible();

  // check collapse and copy button
  await expect(
    page.getByLabel('View SQL').getByLabel('up-circle').locator('svg').last(),
  ).toBeVisible();
  await expect(
    page
      .getByLabel('View SQL')
      .getByRole('button', { name: 'Collapse' })
      .last(),
  ).toBeVisible();
  await expect(
    page.getByLabel('View SQL').getByLabel('copy').locator('svg'),
  ).toBeVisible();
  await expect(
    page.getByLabel('View SQL').getByRole('button', { name: 'Copy' }),
  ).toBeVisible();
};

export const askSuggestionQuestionTest = async ({
  page,
  suggestedQuestion,
}) => {
  await page.goto('/home');
  await expect(page).toHaveURL('/home', { timeout: 60000 });

  await page.getByText(suggestedQuestion).click();

  // check asking process state and wait for asking task to finish
  await checkAskingProcess(page, suggestedQuestion);
  await waitingForAskingTask(page);
  await checkThreadResponseSkeletonLoading(page);

  // check question block
  await expect(page.getByLabel('message').locator('svg')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: suggestedQuestion }),
  ).toBeVisible();

  // check answer result basic UI elements
  await expect(
    page.locator('#rc-tabs-0-tab-answer').getByText('Answer'),
  ).toBeVisible();
  await expect(
    page.locator('#rc-tabs-0-tab-view-sql').getByText('View SQL'),
  ).toBeVisible();

  // check save icon button
  await expect(page.getByLabel('save').locator('svg')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save as View' }),
  ).toBeVisible();

  // Answer tab content
  await expect(page.getByLabel('Answer').locator('div').first()).toBeVisible();

  await checkThreadResponseBreakdownContent(page);
};

export const followUpQuestionTest = async ({ page, question }) => {
  await page.goto('/home');
  await expect(page).toHaveURL('/home', { timeout: 60000 });

  // click existing thread
  await page.locator('.adm-treeTitle__title').first().click();
  await expect(page).toHaveURL(/.*\/home\/\d+/, { timeout: 60000 });

  // ask follow up question
  await page.getByPlaceholder('Ask to explore your data').fill(question);
  await page.getByRole('button', { name: 'Ask' }).click();

  // check asking process state and wait for asking task to finish
  await checkAskingProcess(page, question);
  await waitingForAskingTask(page);
  await checkThreadResponseSkeletonLoading(page);

  // check question block
  await expect(page.getByLabel('message').locator('svg').last()).toBeVisible();
  await expect(page.getByRole('heading', { name: question })).toBeVisible();

  await checkThreadResponseBreakdownContent(page);
};

export const saveAsView = async (
  { page, baseURL }: { page: Page; baseURL: string },
  { question, viewName }: { question: string; viewName: string },
) => {
  await page.goto('/home');
  await expect(page).toHaveURL('/home', { timeout: 60000 });

  await page.getByPlaceholder('Ask to explore your data').fill(question);
  await page.getByRole('button', { name: 'Ask' }).click();

  // check asking process state and wait for asking task to finish
  await checkAskingProcess(page, question);
  await waitingForAskingTask(page);
  await checkThreadResponseSkeletonLoading(page);

  // click save as view button
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
  await page.getByPlaceholder('Ask to explore your data').fill(question);
  await page.getByRole('button', { name: 'Ask' }).click();

  // check asking process state and wait for asking task to finish
  await checkAskingProcess(page, question);
  await waitingForAskingTask(page);
  await checkThreadResponseSkeletonLoading(page);

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
