import { Page, expect, test } from '@playwright/test';
import { SampleDatasetName } from '@/types/dataSource';
import { REFERENCE_DEMO_KNOWLEDGE_BASES } from '@/utils/referenceDemoKnowledge';
import { DEFAULT_WORKSPACE_NAME } from '@/utils/workspaceGovernance';
import * as helper from '../helper';
import * as frontendHealth from '../commonTests/frontendHealth';
import * as homeHelper from '../commonTests/home';

const OWNER_EMAIL = 'admin@example.com';
const HOME_PROMPT_PLACEHOLDER = '输入问题，@ 指定知识库';
const THREAD_PROMPT_PLACEHOLDER = '继续追问以深入分析你的数据';
const FIRST_CHART_QUESTION =
  'What is the total value of payments made by customers from each state?';
const SECOND_SESSION_QUESTION =
  'What are the names of the managers and the departments they manage?';

const RETAIL_WORKSPACE = {
  slug: 'retail-workspace',
  name: '零售分析工作空间',
};

const RETAIL_COMMERCE_KB = {
  slug: 'retail-commerce-kb',
  name: '电商分析知识库',
};

const RETAIL_HR_KB = {
  slug: 'retail-hr-kb',
  name: '人力分析知识库',
};

const OPS_WORKSPACE = {
  slug: 'ops-workspace',
  name: '运营工作空间',
};

const OPS_HR_KB = {
  slug: 'ops-hr-kb',
  name: '运营人力知识库',
};

const ECOMMERCE_DISPLAY_NAME = REFERENCE_DEMO_KNOWLEDGE_BASES.find(
  (item) => item.id === 'demo-kb-ecommerce',
)!.name;
const HR_DISPLAY_NAME = REFERENCE_DEMO_KNOWLEDGE_BASES.find(
  (item) => item.id === 'demo-kb-hr',
)!.name;

type SeededRuntimeScopes = {
  retailCommerce: helper.RuntimeScopeFixture;
  retailHr: helper.RuntimeScopeFixture;
  opsHr: helper.RuntimeScopeFixture;
};

const getPromptInput = (page: Page) =>
  page
    .getByRole('textbox', {
      name: new RegExp(
        `${HOME_PROMPT_PLACEHOLDER}|${THREAD_PROMPT_PLACEHOLDER}`,
      ),
    })
    .first();

const getWorkspaceCard = (page: Page, name: string) =>
  page
    .getByText(name, { exact: true })
    .locator(
      'xpath=ancestor::*[.//button[normalize-space()="切换到此工作空间"] or .//button[normalize-space()="进入当前工作空间"]][1]',
    )
    .first();

const seedRuntimeScopes = async (): Promise<SeededRuntimeScopes> => {
  const retailCommerce = await helper.ensureRuntimeScopeFixtureForUser({
    email: OWNER_EMAIL,
    workspaceSlug: RETAIL_WORKSPACE.slug,
    workspaceName: RETAIL_WORKSPACE.name,
    knowledgeBaseSlug: RETAIL_COMMERCE_KB.slug,
    knowledgeBaseName: RETAIL_COMMERCE_KB.name,
    setDefaultWorkspace: true,
  });

  const retailHr = await helper.ensureRuntimeScopeFixtureForUser({
    email: OWNER_EMAIL,
    workspaceSlug: RETAIL_WORKSPACE.slug,
    workspaceName: RETAIL_WORKSPACE.name,
    knowledgeBaseSlug: RETAIL_HR_KB.slug,
    knowledgeBaseName: RETAIL_HR_KB.name,
  });

  const opsHr = await helper.ensureRuntimeScopeFixtureForUser({
    email: OWNER_EMAIL,
    workspaceSlug: OPS_WORKSPACE.slug,
    workspaceName: OPS_WORKSPACE.name,
    knowledgeBaseSlug: OPS_HR_KB.slug,
    knowledgeBaseName: OPS_HR_KB.name,
  });

  return {
    retailCommerce,
    retailHr,
    opsHr,
  };
};

const askQuestionFromCurrentPage = async ({
  page,
  question,
}: {
  page: Page;
  question: string;
}) => {
  await getPromptInput(page).fill(question);
  await page.getByRole('button', { name: '发送问题' }).click();

  await homeHelper.checkAskingProcess(page, question);
  await homeHelper.waitingForAskingTask(page);
  const answerTab = page.getByRole('tab', { name: /回答/ });
  const failedAskState = page
    .locator('.ant-timeline')
    .filter({
      hasText:
        /Failed to generate SQL statement|Clarification needed|Internal server error|Try a different query|回答生成失败/,
    })
    .first();
  const timeoutAt = Date.now() + 60_000;

  while (Date.now() < timeoutAt) {
    const [hasAnswerTab, hasFailedAskState] = await Promise.all([
      answerTab
        .isVisible()
        .then(Boolean)
        .catch(() => false),
      failedAskState
        .isVisible()
        .then(Boolean)
        .catch(() => false),
    ]);

    if (hasAnswerTab) {
      break;
    }

    if (hasFailedAskState) {
      const errorText =
        (await failedAskState.textContent().catch(() => null))?.trim() ||
        'ask flow entered an error state';
      throw new Error(`${errorText} for question: ${question}`);
    }

    await page.waitForTimeout(500);
  }

  await homeHelper.checkThreadResponseSkeletonLoading(page);
  await expect(page.getByRole('heading', { name: question })).toBeVisible({
    timeout: 60_000,
  });

  const threadId = new URL(page.url()).pathname.match(/\/home\/(\d+)/)?.[1];
  expect(threadId).toBeTruthy();
  return Number(threadId);
};

const askQuestionInScope = async ({
  page,
  selector,
  question,
  sampleDataset,
}: {
  page: Page;
  selector: helper.RuntimeScopeFixture;
  question: string;
  sampleDataset?: SampleDatasetName;
}) => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (sampleDataset) {
      await helper.ensureSystemSampleRuntimeScope({ page, sampleDataset });
    }
    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/home',
      selector,
    });
    await helper.expectPathname({ page, pathname: '/home' });

    try {
      return await askQuestionFromCurrentPage({ page, question });
    } catch (error) {
      lastError = error;
      const isRetriableSqlFailure =
        sampleDataset &&
        error instanceof Error &&
        (error.message.includes('Failed to generate SQL statement') ||
          error.message.includes('Clarification needed'));

      if (!isRetriableSqlFailure || attempt === 3) {
        throw error;
      }

      await helper.ensureSystemSampleRuntimeScope({ page, sampleDataset });
      await page.waitForTimeout(1_000 * attempt);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to ask question in scope: ${question}`);
};

const startNewConversationInScope = async ({
  page,
  selector,
}: {
  page: Page;
  selector: helper.RuntimeScopeFixture;
}) => {
  await page.getByRole('menuitem', { name: /新对话/ }).click();
  await helper.expectPathname({ page, pathname: '/home' });
  await expect
    .poll(() => new URL(page.url()).searchParams.get('workspaceId'))
    .toBe(selector.workspaceId);
  await expect
    .poll(() => new URL(page.url()).searchParams.get('knowledgeBaseId'))
    .toBe(selector.knowledgeBaseId);
  await expect(getPromptInput(page)).toBeVisible({ timeout: 60_000 });
};

const askQuestionInNewConversationWithRetry = async ({
  page,
  selector,
  question,
  sampleDataset,
  prepareBeforeAsk,
}: {
  page: Page;
  selector: helper.RuntimeScopeFixture;
  question: string;
  sampleDataset?: SampleDatasetName;
  prepareBeforeAsk?: () => Promise<void>;
}) => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (sampleDataset) {
      await helper.ensureSystemSampleRuntimeScope({ page, sampleDataset });
    }
    await startNewConversationInScope({ page, selector });
    if (prepareBeforeAsk) {
      await prepareBeforeAsk();
    }

    try {
      return await askQuestionFromCurrentPage({ page, question });
    } catch (error) {
      lastError = error;
      const isRetriableSqlFailure =
        error instanceof Error &&
        (error.message.includes('Failed to generate SQL statement') ||
          error.message.includes('Clarification needed'));

      if (!isRetriableSqlFailure || attempt === 3) {
        throw error;
      }

      if (sampleDataset) {
        await helper.ensureSystemSampleRuntimeScope({ page, sampleDataset });
      }
      await page.waitForTimeout(1_000 * attempt);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to ask question: ${question}`);
};

const ensureHistoryItemVisible = async (page: Page, question: string) => {
  const historyScroller = page.getByTestId('shell-history-scroller');
  await historyScroller.click({ position: { x: 12, y: 12 } });
  await expect(
    historyScroller.getByRole('button', { name: question }),
  ).toBeVisible({ timeout: 60_000 });
  return historyScroller.getByRole('button', { name: question });
};

const waitForChartRequest = (page: Page) =>
  page
    .waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return (
          response.ok() &&
          response.request().method() === 'POST' &&
          /\/api\/v1\/thread-responses\/\d+\/generate-chart$/.test(
            url.pathname,
          )
        );
      },
      { timeout: 15_000 },
    )
    .catch(() => null);

const waitForChartState = async (page: Page) => {
  const chartSurface = page.locator('.adm-chart svg, .adm-chart canvas').first();
  const chartError = page.getByRole('alert').filter({
    hasText:
      /The initializing SQL seems to be invalid|Internal server error|图表数据加载失败/,
  });
  const timeoutAt = Date.now() + 120_000;

  while (Date.now() < timeoutAt) {
    const [hasChart, hasChartError] = await Promise.all([
      chartSurface
        .isVisible()
        .then(Boolean)
        .catch(() => false),
      chartError
        .first()
        .isVisible()
        .then(Boolean)
        .catch(() => false),
    ]);

    if (hasChart) {
      return 'chart' as const;
    }

    if (hasChartError) {
      return 'error' as const;
    }

    await page.waitForTimeout(500);
  }

  throw new Error('Timed out waiting for chart result state');
};

const openChartTab = async (page: Page) => {
  const chartRequest = waitForChartRequest(page);
  await page.getByRole('tab', { name: /图表/ }).click();
  await chartRequest;
};

const regenerateChart = async (page: Page) => {
  await page.getByRole('button', { name: /^重新生成$/ }).first().click();
  const confirmButton = page
    .getByRole('dialog')
    .getByRole('button', { name: /^重新生成$/ });
  await expect(confirmButton).toBeVisible({ timeout: 15_000 });
  const chartRequest = waitForChartRequest(page);
  await confirmButton.click();
  await chartRequest;
};

const ensureChartRenderedWithRetry = async ({
  page,
  sampleDataset,
}: {
  page: Page;
  sampleDataset: SampleDatasetName;
}) => {
  await helper.ensureSystemSampleRuntimeScope({ page, sampleDataset });
  await openChartTab(page);
  if ((await waitForChartState(page)) === 'chart') {
    return;
  }

  await helper.ensureSystemSampleRuntimeScope({ page, sampleDataset });
  await regenerateChart(page);
  await expect(
    page.locator('.adm-chart svg, .adm-chart canvas').first(),
  ).toBeVisible({ timeout: 120_000 });
};

test.describe('Runtime scope knowledge / ask / workspace flows', () => {
  test.describe.configure({ timeout: 240_000 });
  let scopes: SeededRuntimeScopes;

  test.beforeEach(async () => {
    await helper.resetDatabase();
    scopes = await seedRuntimeScopes();
  });

  test('asks in the pinned knowledge base after selecting it from the composer', async ({
    page,
  }) => {
    const question = SECOND_SESSION_QUESTION;
    const ecommerceScope = await helper.ensureSystemSampleRuntimeScope({
      page,
      sampleDataset: SampleDatasetName.ECOMMERCE,
    });

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/home',
      selector: ecommerceScope,
    });
    await helper.expectPathname({ page, pathname: '/home' });

    await page.getByRole('button', { name: /指定知识库/ }).click();
    await page
      .getByRole('button', { name: new RegExp(HR_DISPLAY_NAME) })
      .click();

    await expect(
      page.getByRole('button', {
        name: `移除知识库 ${HR_DISPLAY_NAME}`,
      }),
    ).toBeVisible();
    const hrScope = await helper.ensureSystemSampleRuntimeScope({
      page,
      sampleDataset: SampleDatasetName.HR,
    });

    await getPromptInput(page).fill(question);
    await page.getByRole('button', { name: '发送问题' }).click();

    await homeHelper.checkAskingProcess(page, question);
    await homeHelper.waitingForAskingTask(page);
    await homeHelper.checkThreadResponseSkeletonLoading(page);
    await expect(page.getByRole('heading', { name: question })).toBeVisible();

    await expect
      .poll(() => new URL(page.url()).searchParams.get('knowledgeBaseIds'))
      .toBe(hrScope.knowledgeBaseId);
    await expect
      .poll(() => new URL(page.url()).searchParams.get('knowledgeBaseId'))
      .toBe(hrScope.knowledgeBaseId);
  });

  test('switches workspace from the workspace page and lands in the target knowledge base context', async ({
    page,
  }) => {
    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/workspace',
      selector: { workspaceId: scopes.retailCommerce.workspaceId },
    });
    await helper.expectPathname({ page, pathname: '/workspace' });
    await expect(page.getByText('正在加载工作区...')).toBeHidden({
      timeout: 60_000,
    });
    await expect(
      page.getByPlaceholder('搜索工作空间名称或标识'),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('我可访问的工作空间')).toBeVisible({
      timeout: 60_000,
    });

    const opsWorkspaceCard = getWorkspaceCard(page, OPS_WORKSPACE.name);

    await expect(opsWorkspaceCard).toBeVisible();
    await opsWorkspaceCard
      .getByRole('button', { name: '切换到此工作空间' })
      .click();

    await expect
      .poll(() => new URL(page.url()).searchParams.get('workspaceId'))
      .toBe(scopes.opsHr.workspaceId);
    await expect(
      opsWorkspaceCard.getByRole('button', { name: '进入当前工作空间' }),
    ).toBeVisible();

    await page.getByRole('button', { name: '查看我的知识库' }).click();

    await helper.expectPathname({ page, pathname: '/knowledge' });
    await expect
      .poll(() => new URL(page.url()).searchParams.get('workspaceId'))
      .toBe(scopes.opsHr.workspaceId);
    await expect(
      page.getByTestId('knowledge-workbench-tab-overview'),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('资产数')).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByRole('button', { name: new RegExp(HR_DISPLAY_NAME) }),
    ).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: new RegExp(ECOMMERCE_DISPLAY_NAME) }),
    ).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: new RegExp(OPS_HR_KB.name) }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: new RegExp(RETAIL_HR_KB.name) }),
    ).not.toBeVisible();
  });

  test('keeps workspace, history switching, and tab toggles responsive on the ask flow', async ({
    page,
  }) => {
    const browserHealth = frontendHealth.attachBrowserHealthCollector(page);
    const ecommerceScope = await helper.ensureSystemSampleRuntimeScope({
      page,
      sampleDataset: SampleDatasetName.ECOMMERCE,
    });

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/workspace',
      selector: { workspaceId: scopes.retailCommerce.workspaceId },
    });
    await helper.expectPathname({ page, pathname: '/workspace' });
    await expect(page.getByText('我可访问的工作空间')).toBeVisible({
      timeout: 60_000,
    });

    const systemWorkspaceCard = getWorkspaceCard(page, DEFAULT_WORKSPACE_NAME);
    await expect(systemWorkspaceCard).toBeVisible({ timeout: 60_000 });
    const workspaceSwitchStep = await frontendHealth.measureStep({
      label: 'switch into system sample workspace',
      action: () =>
        systemWorkspaceCard
          .getByRole('button', { name: '切换到此工作空间' })
          .click(),
      ready: async () => {
        await expect
          .poll(() => new URL(page.url()).searchParams.get('workspaceId'))
          .toBe(ecommerceScope.workspaceId);
        await expect(
          systemWorkspaceCard.getByRole('button', { name: '进入当前工作空间' }),
        ).toBeVisible({ timeout: 60_000 });
      },
    });

    const firstThreadId = await askQuestionInScope({
      page,
      selector: ecommerceScope,
      question: FIRST_CHART_QUESTION,
      sampleDataset: SampleDatasetName.ECOMMERCE,
    });
    const secondThreadId = await askQuestionInNewConversationWithRetry({
      page,
      selector: ecommerceScope,
      question: SECOND_SESSION_QUESTION,
      sampleDataset: SampleDatasetName.HR,
      prepareBeforeAsk: async () => {
        await page.getByRole('button', { name: /指定知识库/ }).click();
        await page
          .getByRole('button', { name: new RegExp(HR_DISPLAY_NAME) })
          .click();
        await expect(
          page.getByRole('button', {
            name: `移除知识库 ${HR_DISPLAY_NAME}`,
          }),
        ).toBeVisible({ timeout: 60_000 });
      },
    });

    const firstHistoryButton = await ensureHistoryItemVisible(
      page,
      FIRST_CHART_QUESTION,
    );
    const secondHistoryButton = await ensureHistoryItemVisible(
      page,
      SECOND_SESSION_QUESTION,
    );

    const switchFirstThreadStep = await frontendHealth.measureStep({
      label: 'switch to first thread from sidebar',
      action: () => firstHistoryButton.click(),
      ready: async () => {
        await expect(page).toHaveURL(
          new RegExp(`/home/${firstThreadId}(?:\\?.*)?$`),
          { timeout: 60_000 },
        );
        await expect(
          page.getByRole('heading', { name: FIRST_CHART_QUESTION }),
        ).toBeVisible({ timeout: 60_000 });
      },
    });

    const chartRenderStep = await frontendHealth.measureStep({
      label: 'render chart tab for first thread',
      action: () =>
        ensureChartRenderedWithRetry({
          page,
          sampleDataset: SampleDatasetName.ECOMMERCE,
        }),
    });

    const sqlTabStep = await frontendHealth.measureStep({
      label: 'switch to sql tab on thread detail',
      action: () => page.getByRole('tab', { name: /SQL 查询/ }).click(),
      ready: () => expect(page.getByText('Wren SQL').last()).toBeVisible(),
    });

    const chartTabStep = await frontendHealth.measureStep({
      label: 'switch back to chart tab on thread detail',
      action: () => page.getByRole('tab', { name: /图表/ }).click(),
      ready: () =>
        expect(
          page.locator('.adm-chart svg, .adm-chart canvas').first(),
        ).toBeVisible(),
    });

    const switchSecondThreadStep = await frontendHealth.measureStep({
      label: 'switch to second thread from sidebar',
      action: () => secondHistoryButton.click(),
      ready: async () => {
        await expect(page).toHaveURL(
          new RegExp(`/home/${secondThreadId}(?:\\?.*)?$`),
          { timeout: 60_000 },
        );
        await expect(
          page.getByRole('heading', { name: SECOND_SESSION_QUESTION }),
        ).toBeVisible({ timeout: 60_000 });
      },
    });

    frontendHealth.expectStepDurationWithin({
      label: workspaceSwitchStep.label,
      durationMs: workspaceSwitchStep.durationMs,
      thresholdMs: 20_000,
    });
    frontendHealth.expectStepDurationWithin({
      label: switchFirstThreadStep.label,
      durationMs: switchFirstThreadStep.durationMs,
      thresholdMs: 8_000,
    });
    frontendHealth.expectStepDurationWithin({
      label: chartRenderStep.label,
      durationMs: chartRenderStep.durationMs,
      thresholdMs: 90_000,
    });
    frontendHealth.expectStepDurationWithin({
      label: sqlTabStep.label,
      durationMs: sqlTabStep.durationMs,
      thresholdMs: 5_000,
    });
    frontendHealth.expectStepDurationWithin({
      label: chartTabStep.label,
      durationMs: chartTabStep.durationMs,
      thresholdMs: 5_000,
    });
    frontendHealth.expectStepDurationWithin({
      label: switchSecondThreadStep.label,
      durationMs: switchSecondThreadStep.durationMs,
      thresholdMs: 8_000,
    });

    await frontendHealth.expectNoHorizontalOverflow({
      page,
      testId: 'shell-history-scroller',
    });

    browserHealth.assertClean();
  });

  test('keeps ask, session switching, and chart generation working after switching into the system sample workspace', async ({
    page,
  }) => {
    const ecommerceScope = await helper.ensureSystemSampleRuntimeScope({
      page,
      sampleDataset: SampleDatasetName.ECOMMERCE,
    });
    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/workspace',
      selector: { workspaceId: scopes.retailCommerce.workspaceId },
    });
    await helper.expectPathname({ page, pathname: '/workspace' });
    await expect(page.getByText('我可访问的工作空间')).toBeVisible({
      timeout: 60_000,
    });

    const systemWorkspaceCard = getWorkspaceCard(page, DEFAULT_WORKSPACE_NAME);
    await expect(systemWorkspaceCard).toBeVisible({ timeout: 60_000 });
    await systemWorkspaceCard
      .getByRole('button', { name: '切换到此工作空间' })
      .click();

    await expect
      .poll(() => new URL(page.url()).searchParams.get('workspaceId'))
      .toBe(ecommerceScope.workspaceId);
    await expect(
      systemWorkspaceCard.getByRole('button', { name: '进入当前工作空间' }),
    ).toBeVisible({ timeout: 60_000 });

    const firstThreadId = await askQuestionInScope({
      page,
      selector: ecommerceScope,
      question: FIRST_CHART_QUESTION,
      sampleDataset: SampleDatasetName.ECOMMERCE,
    });
    await ensureHistoryItemVisible(page, FIRST_CHART_QUESTION);

    const secondThreadId = await askQuestionInNewConversationWithRetry({
      page,
      selector: ecommerceScope,
      question: SECOND_SESSION_QUESTION,
      sampleDataset: SampleDatasetName.HR,
      prepareBeforeAsk: async () => {
        await page.getByRole('button', { name: /指定知识库/ }).click();
        await page
          .getByRole('button', { name: new RegExp(HR_DISPLAY_NAME) })
          .click();
        await expect(
          page.getByRole('button', {
            name: `移除知识库 ${HR_DISPLAY_NAME}`,
          }),
        ).toBeVisible({ timeout: 60_000 });
      },
    });
    expect(secondThreadId).not.toBe(firstThreadId);

    const firstHistoryButton = await ensureHistoryItemVisible(
      page,
      FIRST_CHART_QUESTION,
    );
    const secondHistoryButton = await ensureHistoryItemVisible(
      page,
      SECOND_SESSION_QUESTION,
    );

    await firstHistoryButton.click();
    await expect(page).toHaveURL(new RegExp(`/home/${firstThreadId}(?:\\?.*)?$`), {
      timeout: 60_000,
    });
    await expect(
      page.getByRole('heading', { name: FIRST_CHART_QUESTION }),
    ).toBeVisible({ timeout: 60_000 });

    await ensureChartRenderedWithRetry({
      page,
      sampleDataset: SampleDatasetName.ECOMMERCE,
    });

    await secondHistoryButton.click();
    await expect(page).toHaveURL(new RegExp(`/home/${secondThreadId}(?:\\?.*)?$`), {
      timeout: 60_000,
    });
    await expect(
      page.getByRole('heading', { name: SECOND_SESSION_QUESTION }),
    ).toBeVisible({ timeout: 60_000 });
  });
});
