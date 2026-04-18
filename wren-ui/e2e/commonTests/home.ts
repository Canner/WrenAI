import { Page, expect } from '@playwright/test';
import type { RuntimeScopeFixture } from '../helper';
import * as helper from '../helper';

const HOME_PROMPT_PLACEHOLDER = '输入问题，@ 指定知识库';
const THREAD_PROMPT_PLACEHOLDER = '继续追问以深入分析你的数据';
const HOME_SEND_BUTTON_NAME = '发送问题';
const HOME_SAVE_AS_VIEW_BUTTON_NAME = '保存为视图';
const HOME_ANSWER_TAB_NAME = '回答';
const HOME_SQL_TAB_NAME = 'SQL 查询';

const getPromptInput = (page: Page) =>
  page
    .getByRole('textbox', {
      name: new RegExp(
        `${HOME_PROMPT_PLACEHOLDER}|${THREAD_PROMPT_PLACEHOLDER}`,
      ),
    })
    .first();

type AskSuggestionQuestionArgs = {
  page: Page;
  suggestedQuestion: string;
  selector?: RuntimeSelector;
};

type AskQuestionArgs = {
  page: Page;
  question: string;
  selector?: RuntimeSelector;
};

type FollowUpQuestionArgs = {
  page: Page;
  question: string;
  openingQuestion: string;
  selector?: RuntimeSelector;
};

type RuntimeSelector = Partial<RuntimeScopeFixture> &
  Record<string, string | undefined | null>;

export const checkAskingProcess = async (page: Page, question: string) => {
  await helper.expectPathname({
    page,
    pathname: /\/home\/\d+(?:\?.*)?$/,
    timeout: 60_000,
  });
  const promptResult = page.getByTestId('prompt__result');
  const questionHeading = page.getByRole('heading', { name: question });

  await expect
    .poll(
      async () => {
        const [hasPromptResult, hasQuestionHeading] = await Promise.all([
          promptResult
            .isVisible()
            .then(Boolean)
            .catch(() => false),
          questionHeading
            .isVisible()
            .then(Boolean)
            .catch(() => false),
        ]);

        return hasPromptResult || hasQuestionHeading;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
};

export const waitingForAskingTask = async (page: Page) => {
  const followUpInput = page.getByRole('textbox', {
    name: THREAD_PROMPT_PLACEHOLDER,
  });
  const saveAsViewButton = page.getByRole('button', {
    name: HOME_SAVE_AS_VIEW_BUTTON_NAME,
  });

  await expect
    .poll(
      async () => {
        const [hasSaveAsViewButton, canAskFollowUp] = await Promise.all([
          saveAsViewButton
            .isVisible()
            .then(Boolean)
            .catch(() => false),
          followUpInput
            .isEnabled()
            .then(Boolean)
            .catch(() => false),
        ]);

        return hasSaveAsViewButton || canAskFollowUp;
      },
      { timeout: 240_000 },
    )
    .toBe(true);
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
  await expect(
    page.getByRole('tab', { name: new RegExp(HOME_ANSWER_TAB_NAME) }),
  ).toBeVisible({
    timeout: 60_000,
  });
};

const checkThreadResponseBreakdownContent = async (page: Page) => {
  await page.getByRole('tab', { name: new RegExp(HOME_SQL_TAB_NAME) }).click();
  await expect(page.getByText('Wren SQL').last()).toBeVisible();
  await expect(page.getByRole('button', { name: '调整 SQL' })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看结果' })).toBeVisible();
};

export const askSuggestionQuestionTest = async ({
  page,
  suggestedQuestion,
  selector,
}: AskSuggestionQuestionArgs) => {
  await helper.gotoRuntimeScopedPath({ page, pathname: '/home', selector });
  await helper.expectPathname({ page, pathname: '/home' });

  await page.getByText(suggestedQuestion).click();

  // check asking process state and wait for asking task to finish
  await checkAskingProcess(page, suggestedQuestion);
  await waitingForAskingTask(page);
  await checkThreadResponseSkeletonLoading(page);

  // check question block
  await expect(
    page.getByRole('heading', { name: suggestedQuestion }),
  ).toBeVisible();

  // check answer result basic UI elements
  await expect(
    page.getByRole('tab', { name: new RegExp(HOME_ANSWER_TAB_NAME) }),
  ).toBeVisible();
  await expect(
    page.getByRole('tab', { name: new RegExp(HOME_SQL_TAB_NAME) }),
  ).toBeVisible();

  await expect(
    page.getByRole('button', { name: HOME_SAVE_AS_VIEW_BUTTON_NAME }),
  ).toBeVisible({ timeout: 60_000 });

  // Answer tab content
  await expect(page.getByText('回答').last()).toBeVisible();

  await checkThreadResponseBreakdownContent(page);
};

export const askQuestionTest = async ({
  page,
  question,
  selector,
}: AskQuestionArgs) => {
  await helper.gotoRuntimeScopedPath({ page, pathname: '/home', selector });
  await helper.expectPathname({ page, pathname: '/home' });

  await getPromptInput(page).fill(question);
  await page.getByRole('button', { name: HOME_SEND_BUTTON_NAME }).click();

  await checkAskingProcess(page, question);
  await waitingForAskingTask(page);
  await checkThreadResponseSkeletonLoading(page);

  await expect(page.getByRole('heading', { name: question })).toBeVisible();
  await expect(
    page.getByRole('tab', { name: new RegExp(HOME_ANSWER_TAB_NAME) }),
  ).toBeVisible();
  await expect(
    page.getByRole('tab', { name: new RegExp(HOME_SQL_TAB_NAME) }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: HOME_SAVE_AS_VIEW_BUTTON_NAME }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('回答').last()).toBeVisible();

  await checkThreadResponseBreakdownContent(page);
};

export const followUpQuestionTest = async ({
  page,
  question,
  openingQuestion,
  selector,
}: FollowUpQuestionArgs) => {
  await helper.gotoRuntimeScopedPath({ page, pathname: '/home', selector });
  await helper.expectPathname({ page, pathname: '/home' });

  // click existing thread
  await page.getByRole('button', { name: openingQuestion }).click();
  await helper.expectPathname({ page, pathname: /\/home\/\d+(?:\?.*)?$/ });

  // ask follow up question
  await getPromptInput(page).fill(question);
  await page.getByRole('button', { name: HOME_SEND_BUTTON_NAME }).click();

  // follow-up questions create thread responses directly, so wait for the new
  // response block instead of the home-page asking-task polling endpoint.
  await checkAskingProcess(page, question);
  await expect(page.getByRole('heading', { name: question })).toBeVisible({
    timeout: 60_000,
  });
};

export const saveAsView = async (
  { page, selector }: { page: Page; baseURL?: string; selector?: RuntimeSelector },
  { question, viewName }: { question: string; viewName: string },
) => {
  await helper.gotoRuntimeScopedPath({ page, pathname: '/home', selector });
  await helper.expectPathname({ page, pathname: '/home' });

  await getPromptInput(page).fill(question);
  await page.getByRole('button', { name: HOME_SEND_BUTTON_NAME }).click();

  // check asking process state and wait for asking task to finish
  await checkAskingProcess(page, question);
  await waitingForAskingTask(page);
  await checkThreadResponseSkeletonLoading(page);

  // click save as view button
  await page
    .getByRole('button', { name: HOME_SAVE_AS_VIEW_BUTTON_NAME })
    .click();

  // check save as view modal
  await expect(page.locator('.ant-modal-mask')).toBeVisible();
  await expect(page.locator('div.ant-modal')).toBeVisible();
  await expect(
    page.locator('div.ant-modal-title').filter({ hasText: '保存为视图' }),
  ).toBeVisible();
  await expect(
    page.getByLabel('保存为视图').getByLabel('Close', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('保存后，请前往“建模页”统一部署所有已保存视图。'),
  ).toBeVisible();

  // save as View process
  await page.getByLabel('名称').click();
  await page.getByLabel('名称').fill(viewName);

  await page.getByRole('button', { name: '保存', exact: true }).click();

  // check save as view success
  await expect(page.getByText('视图已创建。')).toBeVisible();

  // ask the saved view question
  await getPromptInput(page).fill(question);
  await page.getByRole('button', { name: HOME_SEND_BUTTON_NAME }).click();

  // check asking process state and wait for asking task to finish
  await checkAskingProcess(page, question);
  await waitingForAskingTask(page);
  await checkThreadResponseSkeletonLoading(page);

  // check offer view info for thread response UI
  await expect(page.getByText('基于已保存视图生成')).toBeVisible();
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
