const { chromium } = require('@playwright/test');

const BASE_URL = 'http://127.0.0.1:3002';
const LOGIN_EMAIL = 'admin@example.com';
const LOGIN_PASSWORD = 'Admin@123';

const WORKSPACES = {
  tidb: {
    workspaceId: '3c4f940d-d904-4316-88dd-39f3f6a9b178',
    workspaceName: 'TiDB 业务需求测试空间',
    kbId: '5464cce5-d846-48c3-b9a3-dbe76215e63a',
    kbName: 'TiDB 业务知识库',
    expectedQuestion: '查询 990001 平台 990011 渠道的名称、渠道商和折扣比例',
    expectedRule: '汇总口径',
    askQuestion: '查询 990001 平台 990011 渠道的名称、渠道商和折扣比例',
  },
  hr: {
    workspaceId: '44341493-1a3a-44c3-8542-2329f9aa87d1',
    workspaceName: 'PostgreSQL HR 测试空间',
    kbName: 'PostgreSQL HR 知识库',
    expectedQuestion: '各岗位的平均薪资分别是多少？',
    expectedRule: '当前有效薪资口径',
    askQuestion: '各岗位的平均薪资分别是多少？',
  },
};

function selectorToQuery(selector) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(selector || {})) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

function buildUrl(pathname, selector) {
  const query = selectorToQuery(selector);
  return `${BASE_URL}${pathname}${query ? `?${query}` : ''}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(page, pathname, selector, init = {}) {
  const response = await page.request.fetch(buildUrl(pathname, selector), {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    data: init.body,
  });
  const text = await response.text();
  try {
    return { status: response.status(), body: JSON.parse(text) };
  } catch {
    return { status: response.status(), body: text };
  }
}

async function waitFor(condition, { timeoutMs = 90000, intervalMs = 1000, label = 'condition' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await condition();
    if (result) return result;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function login(page) {
  const response = await page.request.post(`${BASE_URL}/api/auth/login`, {
    data: { email: LOGIN_EMAIL, password: LOGIN_PASSWORD },
  });
  if (!response.ok()) {
    throw new Error(`Login failed: ${response.status()} ${await response.text()}`);
  }
  await page.goto(`${BASE_URL}/home`, { waitUntil: 'networkidle' });
}

async function resolveSelector(page, workspaceId, knowledgeBaseId) {
  const result = await api(page, '/api/v1/runtime/scope/current', {
    workspaceId,
    knowledgeBaseId,
  });
  if (result.status !== 200) {
    throw new Error(`Failed to resolve selector for ${workspaceId}: ${JSON.stringify(result.body)}`);
  }
  return {
    workspaceId: result.body.currentWorkspace?.id || workspaceId,
    knowledgeBaseId: result.body.currentKnowledgeBase?.id || knowledgeBaseId,
    kbSnapshotId: result.body.currentKbSnapshot?.id,
    deployHash: result.body.currentKbSnapshot?.deployHash,
  };
}

function parseStat(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`${escaped}\\s*([0-9]+(?:/800)?)`));
  if (!match) {
    throw new Error(`Failed to parse stat "${label}" from text:\n${text}`);
  }
  return match[1];
}

async function getOverviewMetrics(page) {
  const text = await page.locator('body').innerText();
  return {
    assetCount: Number(parseStat(text, '资产数')),
    fieldBudget: parseStat(text, '字段预算'),
    sqlPairCount: Number(parseStat(text, 'SQL 模板')),
    ruleCount: Number(parseStat(text, '分析规则')),
    modelCount: Number(parseStat(text, '模型')),
  };
}

async function getSidebarBadgeCount(page, kbName) {
  const list = await page.locator('[data-testid="knowledge-sidebar-list"]').innerText();
  const escaped = kbName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = list.match(new RegExp(`${escaped}\\s*(\\d+)`));
  if (!match) {
    throw new Error(`Failed to parse sidebar badge for ${kbName} from:\n${list}`);
  }
  return Number(match[1]);
}

async function verifyOverview(page, selector, expected) {
  await page.goto(buildUrl('/knowledge', selector), { waitUntil: 'networkidle' });
  await waitFor(async () => (await page.locator('body').innerText()).includes('资产数'), {
    label: `${expected.workspaceName} overview`,
  });

  const metrics = await getOverviewMetrics(page);
  const badgeCount = await getSidebarBadgeCount(page, expected.kbName);

  if (metrics.assetCount !== expected.assetCount) {
    throw new Error(`[${expected.workspaceName}] expected assetCount ${expected.assetCount}, got ${metrics.assetCount}`);
  }
  if (metrics.modelCount !== expected.modelCount) {
    throw new Error(`[${expected.workspaceName}] expected modelCount ${expected.modelCount}, got ${metrics.modelCount}`);
  }
  if (metrics.sqlPairCount !== expected.sqlPairCount) {
    throw new Error(`[${expected.workspaceName}] expected sqlPairCount ${expected.sqlPairCount}, got ${metrics.sqlPairCount}`);
  }
  if (metrics.ruleCount !== expected.ruleCount) {
    throw new Error(`[${expected.workspaceName}] expected ruleCount ${expected.ruleCount}, got ${metrics.ruleCount}`);
  }
  if (badgeCount !== expected.assetCount) {
    throw new Error(`[${expected.workspaceName}] expected sidebar badge ${expected.assetCount}, got ${badgeCount}`);
  }

  console.log(`VERIFY overview ${expected.workspaceName}`);
  console.log(JSON.stringify({ metrics, badgeCount }, null, 2));
}

async function switchWorkspaceViaUi(page, workspaceName, expectedWorkspaceId) {
  await page.locator('.runtime-scope-workspace .ant-select-selector').click();
  const option = page.locator('.ant-select-dropdown .ant-select-item-option').filter({ hasText: workspaceName }).first();
  await option.waitFor({ state: 'visible', timeout: 20000 });
  await option.click();
  await waitFor(async () => {
    const current = new URL(page.url()).searchParams.get('workspaceId');
    return current === expectedWorkspaceId;
  }, { label: `switch to ${workspaceName}` });
  await waitFor(async () => {
    const text = await page.locator('body').innerText();
    return text.includes(workspaceName);
  }, { label: `${workspaceName} content after switch` });
}

async function verifySectionContent(page, selector, expectedQuestion, expectedAbsentQuestion, expectedRule, expectedAbsentRule) {
  await page.goto(buildUrl('/knowledge', { ...selector, section: 'sqlTemplates' }), {
    waitUntil: 'networkidle',
  });
  await waitFor(async () => (await page.locator('body').innerText()).includes('SQL 模板'), {
    label: `${expectedQuestion} SQL section`,
  });
  const sqlText = await page.locator('body').innerText();
  if (!sqlText.includes(expectedQuestion)) {
    throw new Error(`Expected SQL template "${expectedQuestion}" to be visible`);
  }
  if (expectedAbsentQuestion && sqlText.includes(expectedAbsentQuestion)) {
    throw new Error(`Unexpected SQL template "${expectedAbsentQuestion}" leaked into current KB`);
  }

  await page.goto(buildUrl('/knowledge', { ...selector, section: 'instructions' }), {
    waitUntil: 'networkidle',
  });
  await waitFor(async () => (await page.locator('body').innerText()).includes('分析规则'), {
    label: `${expectedRule} instruction section`,
  });
  const ruleText = await page.locator('body').innerText();
  if (!ruleText.includes(expectedRule)) {
    throw new Error(`Expected rule "${expectedRule}" to be visible`);
  }
  if (expectedAbsentRule && ruleText.includes(expectedAbsentRule)) {
    throw new Error(`Unexpected rule "${expectedAbsentRule}" leaked into current KB`);
  }

  console.log(`VERIFY content ${expectedQuestion} / ${expectedRule}`);
}

async function askQuestion(page, selector, workspaceName, question) {
  await page.goto(buildUrl('/home', selector), { waitUntil: 'networkidle' });
  const input = page
    .getByRole('textbox', {
      name: /输入问题，@ 指定知识库|继续追问以深入分析你的数据/,
    })
    .first();
  await input.waitFor({ state: 'visible', timeout: 30000 });
  await input.fill(question);
  await page.getByRole('button', { name: '发送问题' }).click();

  const failedState = page
    .locator('.ant-timeline')
    .filter({
      hasText:
        /Failed to generate SQL statement|Clarification needed|Internal server error|Try a different query|回答生成失败/,
    })
    .first();

  await waitFor(async () => {
    const headingVisible = await page
      .getByRole('heading', { name: question })
      .isVisible()
      .catch(() => false);
    if (headingVisible) {
      return true;
    }

    const failedVisible = await failedState.isVisible().catch(() => false);
    if (failedVisible) {
      const text = (await failedState.textContent().catch(() => 'unknown ask failure')) || 'unknown ask failure';
      throw new Error(`[${workspaceName}] ask flow failed for "${question}": ${text.trim()}`);
    }

    return false;
  }, { timeoutMs: 120000, intervalMs: 1500, label: `${workspaceName} ask flow` });

  console.log(`VERIFY ask ${workspaceName}: ${question}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  page.setDefaultTimeout(40000);

  try {
    await login(page);

    const tidbSelector = await resolveSelector(
      page,
      WORKSPACES.tidb.workspaceId,
      WORKSPACES.tidb.kbId,
    );
    const hrKbs = await api(page, '/api/v1/knowledge/bases', {
      workspaceId: WORKSPACES.hr.workspaceId,
    });
    if (hrKbs.status !== 200) {
      throw new Error(`Failed to load HR knowledge bases: ${JSON.stringify(hrKbs.body)}`);
    }
    const hrKb = hrKbs.body.find((item) => item.name === WORKSPACES.hr.kbName);
    if (!hrKb) {
      throw new Error('HR knowledge base not found');
    }
    const hrSelector = await resolveSelector(page, WORKSPACES.hr.workspaceId, hrKb.id);

    const tidbExpected = await Promise.all([
      api(page, '/api/v1/models/list', tidbSelector),
      api(page, '/api/v1/knowledge/sql_pairs', tidbSelector),
      api(page, '/api/v1/knowledge/instructions', tidbSelector),
    ]);
    const hrExpected = await Promise.all([
      api(page, '/api/v1/models/list', hrSelector),
      api(page, '/api/v1/knowledge/sql_pairs', hrSelector),
      api(page, '/api/v1/knowledge/instructions', hrSelector),
    ]);

    await verifyOverview(page, tidbSelector, {
      workspaceName: WORKSPACES.tidb.workspaceName,
      kbName: WORKSPACES.tidb.kbName,
      assetCount: tidbExpected[0].body.length,
      modelCount: tidbExpected[0].body.length,
      sqlPairCount: tidbExpected[1].body.length,
      ruleCount: tidbExpected[2].body.length,
    });
    await verifySectionContent(
      page,
      tidbSelector,
      WORKSPACES.tidb.expectedQuestion,
      WORKSPACES.hr.expectedQuestion,
      WORKSPACES.tidb.expectedRule,
      WORKSPACES.hr.expectedRule,
    );

    await page.goto(buildUrl('/knowledge', { ...tidbSelector, section: 'sqlTemplates' }), {
      waitUntil: 'networkidle',
    });
    await switchWorkspaceViaUi(
      page,
      WORKSPACES.hr.workspaceName,
      WORKSPACES.hr.workspaceId,
    );

    await verifyOverview(page, hrSelector, {
      workspaceName: WORKSPACES.hr.workspaceName,
      kbName: WORKSPACES.hr.kbName,
      assetCount: hrExpected[0].body.length,
      modelCount: hrExpected[0].body.length,
      sqlPairCount: hrExpected[1].body.length,
      ruleCount: hrExpected[2].body.length,
    });
    await verifySectionContent(
      page,
      hrSelector,
      WORKSPACES.hr.expectedQuestion,
      WORKSPACES.tidb.expectedQuestion,
      WORKSPACES.hr.expectedRule,
      WORKSPACES.tidb.expectedRule,
    );

    await askQuestion(page, tidbSelector, WORKSPACES.tidb.workspaceName, WORKSPACES.tidb.askQuestion);
    await askQuestion(page, hrSelector, WORKSPACES.hr.workspaceName, WORKSPACES.hr.askQuestion);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
