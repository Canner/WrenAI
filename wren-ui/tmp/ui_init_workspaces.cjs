const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://127.0.0.1:3002';
const LOGIN_EMAIL = 'admin@example.com';
const LOGIN_PASSWORD = 'Admin@123';

const WORKSPACES = {
  tidb: {
    workspaceId: '3c4f940d-d904-4316-88dd-39f3f6a9b178',
    workspaceName: 'TiDB 业务需求测试空间',
    kbName: 'TiDB 业务知识库',
    kbDescription: '通过纯 UI 初始化的 TiDB 业务需求知识库',
    dataSourceType: 'MySQL',
    connection: {
      displayName: 'TiDB 业务数据源',
      host: 'host.docker.internal',
      port: '4000',
      user: 'root',
      password: '',
      database: 'tidb_business_demo',
    },
    tables: [
      'dwd_player_login_log',
      'dim_player',
      'dwd_order_deposit',
      'dwd_order_withdrawal',
      'dwd_bet_order',
      'dwd_order_rebate',
      'dwd_order_add_or_sub',
      'dwd_order_activity',
      'dwd_order_task',
      'dwd_order_promote_activity',
      'dwd_order_lottery',
      'dwd_order_vip_award',
      'channel',
    ],
  },
  hr: {
    workspaceId: '44341493-1a3a-44c3-8542-2329f9aa87d1',
    workspaceName: 'PostgreSQL HR 测试空间',
    kbName: 'PostgreSQL HR 知识库',
    kbDescription: '通过纯 UI 初始化的 PostgreSQL HR 知识库',
    dataSourceType: 'PostgreSQL',
    connection: {
      displayName: 'PostgreSQL HR 数据源',
      host: 'host.docker.internal',
      port: '9432',
      user: 'postgres',
      password: 'postgres',
      database: 'hr_demo_sample',
    },
    tables: ['departments', 'dept_emp', 'dept_manager', 'employees', 'salaries', 'titles'],
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
  const url = buildUrl(pathname, selector);
  const response = await page.request.fetch(url, {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    data: init.body,
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status(), body };
}

async function waitFor(condition, { timeoutMs = 90000, intervalMs = 1500, label = 'condition' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await condition();
    if (result) return result;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function extractSqlFromMarkdown(markdown) {
  const match = markdown.match(/```sql\s*([\s\S]*?)```/i);
  if (!match) throw new Error('Failed to extract SQL block');
  return match[1].trim();
}

function substituteNamedParams(sql, replacements) {
  let result = sql;
  for (const [key, value] of Object.entries(replacements || {})) {
    result = result.replace(new RegExp(`:${key}\\b`, 'g'), value);
  }
  return result;
}

function normalizeSqlForTemplate(sql) {
  const compact = (sql || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/;+\s*$/, '');
  if (compact.length > 10000) {
    throw new Error(`SQL template exceeds UI limit after compaction (${compact.length} > 10000)`);
  }
  return compact;
}

function loadTidbArtifacts() {
  const sqlMd = fs.readFileSync(
    path.resolve(__dirname, '../../docs/业务需求/knowledge-base/sql-templates/T02_渠道与折扣映射.md'),
    'utf8',
  );
  const ruleMd = fs.readFileSync(
    path.resolve(__dirname, '../../docs/业务需求/knowledge-base/analysis-rules/R01_汇总口径.md'),
    'utf8',
  );
  const ruleContentMatch = ruleMd.match(/## 规则内容\s*([\s\S]*?)\n## /);
  if (!ruleContentMatch) throw new Error('Failed to extract rule content');
  return {
    sqlTemplate: {
      question: '查询 990001 平台 990011 渠道的名称、渠道商和折扣比例',
      sql: normalizeSqlForTemplate(
        substituteNamedParams(extractSqlFromMarkdown(sqlMd), {
          tenant_plat_id: '990001',
          channel_id: '990011',
          channel_partner_id: 'NULL',
        }).replace(/\(\s*NULL\s+IS\s+NULL\s+OR\s+[^)]+\)/gi, 'TRUE'),
      ),
    },
    rule: {
      summary: '汇总口径',
      content: ruleContentMatch[1].trim(),
    },
  };
}

const hrArtifacts = {
  sqlTemplate: {
    question: '各岗位的平均薪资分别是多少？',
    sql: normalizeSqlForTemplate(
      `SELECT\n  t.title,\n  ROUND(AVG(s.salary), 2) AS avg_salary,\n  COUNT(DISTINCT s.emp_no) AS employee_count\nFROM salaries s\nJOIN titles t\n  ON s.emp_no = t.emp_no\nWHERE s.to_date = DATE '9999-01-01'\n  AND t.to_date = DATE '9999-01-01'\nGROUP BY t.title\nORDER BY avg_salary DESC;`,
    ),
  },
  rule: {
    summary: '当前有效薪资口径',
    content:
      "岗位薪资分析只统计当前有效记录（to_date = DATE '9999-01-01'）；人数按 emp_no 去重，平均薪资基于当前有效薪资记录计算。",
  },
};

async function login(page) {
  const loginResponse = await page.request.post(`${BASE_URL}/api/auth/login`, {
    data: {
      email: LOGIN_EMAIL,
      password: LOGIN_PASSWORD,
    },
  });
  if (!loginResponse.ok()) {
    throw new Error(`Login failed: ${loginResponse.status()} ${await loginResponse.text()}`);
  }
  await page.goto(`${BASE_URL}/home`, { waitUntil: 'networkidle' });
}

async function getKnowledgeBases(page, workspaceId) {
  const result = await api(page, '/api/v1/knowledge/bases', { workspaceId });
  if (result.status !== 200) throw new Error(`Failed to load KBs for ${workspaceId}: ${JSON.stringify(result.body)}`);
  return result.body;
}

async function resolveSelector(page, workspaceId, knowledgeBaseId, fallback) {
  const result = await api(page, '/api/v1/runtime/scope/current', { workspaceId, knowledgeBaseId, ...(fallback || {}) });
  if (result.status !== 200) throw new Error(`Failed to resolve runtime scope: ${JSON.stringify(result.body)}`);
  const body = result.body || {};
  return {
    workspaceId: body.currentWorkspace?.id || workspaceId,
    knowledgeBaseId: body.currentKnowledgeBase?.id || knowledgeBaseId,
    kbSnapshotId: body.currentKbSnapshot?.id || fallback?.kbSnapshotId,
    deployHash: body.currentKbSnapshot?.deployHash || fallback?.deployHash,
  };
}

async function ensureKnowledgeBase(page, config) {
  let knowledgeBases = await getKnowledgeBases(page, config.workspaceId);
  let kb = knowledgeBases.find((item) => item.name === config.kbName) || knowledgeBases[0] || null;
  if (!kb) {
    console.log(`[${config.workspaceName}] creating knowledge base`);
    await page.goto(buildUrl('/knowledge', { workspaceId: config.workspaceId }), { waitUntil: 'networkidle' });
    await waitFor(async () => {
      const body = await page.locator('body').innerText();
      return body.includes(config.workspaceName) || body.includes('创建知识库');
    }, {
      label: `${config.workspaceName} knowledge page`,
      timeoutMs: 20000,
    });
    const createButton = page.getByRole('button', { name: '创建知识库' });
    await createButton.waitFor({ state: 'visible', timeout: 15000 });
    await createButton.click();
    await page.getByLabel('知识库名称').fill(config.kbName);
    await page.getByLabel('AI 描述').fill(config.kbDescription);
    await page.getByRole('button', { name: /保\s*存|保存/ }).click();
    kb = await waitFor(async () => {
      const list = await getKnowledgeBases(page, config.workspaceId);
      return list.find((item) => item.name === config.kbName) || null;
    }, { label: `${config.kbName} creation` });
  }

  const selector = await resolveSelector(page, config.workspaceId, kb.id, {
    kbSnapshotId: kb.defaultKbSnapshot?.id || kb.defaultKbSnapshotId || undefined,
    deployHash: kb.defaultKbSnapshot?.deployHash || undefined,
  });
  console.log(`[${config.workspaceName}] selector`, selector);
  return { kb, selector };
}

async function fillConnectionForm(page, connection) {
  await page.getByLabel('显示名称').fill(connection.displayName);
  await page.getByLabel('主机地址').fill(connection.host);
  await page.getByLabel('端口').fill(connection.port);
  await page.getByLabel('用户名').fill(connection.user);
  if (connection.password) {
    await page.getByLabel('密码').fill(connection.password);
  }
  await page.getByLabel('数据库名称').fill(connection.database);
}

async function selectTablesInUi(page, tables) {
  const searchInput = page.getByPlaceholder('搜索数据表');
  for (const table of tables) {
    await searchInput.fill(table);
    await sleep(300);
    const row = page.locator('tr.ant-table-row').filter({ hasText: table }).first();
    await row.waitFor({ state: 'visible', timeout: 20000 });
    const checkbox = row.locator('input.ant-checkbox-input').first();
    const checked = await checkbox.isChecked().catch(() => false);
    if (!checked) {
      await checkbox.check({ force: true });
    }
    await searchInput.fill('');
    await sleep(200);
  }
}

async function ensureConnectionAndModels(page, selector, config) {
  const settings = await api(page, '/api/v1/settings', selector);
  const existingDataSource = settings.status === 200 ? settings.body?.dataSource : null;
  const models = await api(page, '/api/v1/models/list', selector);
  const existingModels = models.status === 200 ? models.body || [] : [];

  if (existingDataSource && existingModels.length >= config.tables.length) {
    console.log(`[${config.workspaceName}] data source/models already present (${existingModels.length})`);
    return;
  }

  console.log(`[${config.workspaceName}] running UI setup flow`);
  await page.goto(buildUrl('/setup/connection', selector), { waitUntil: 'networkidle' });
  await waitFor(async () => (await page.locator('body').innerText()).includes('连接真实数据源'), {
    label: `${config.workspaceName} setup page`,
  });

  await page.getByRole('button', { name: config.dataSourceType }).click();
  await waitFor(async () => (await page.locator('body').innerText()).includes('连接当前数据源'), {
    label: `${config.workspaceName} connection form`,
  });
  await fillConnectionForm(page, config.connection);
  await page.getByRole('button', { name: '下一步' }).click();

  const navigationOutcome = await waitFor(async () => {
    if (page.url().includes('/setup/models')) {
      return { ok: true };
    }

    const errorAlert = page.locator('.ant-alert-error, .ant-message-error').first();
    const validationError = page
      .locator('.ant-form-item-explain-error')
      .filter({ hasText: /失败|错误|请输入|不能为空|无效|连接/ })
      .first();

    if (await errorAlert.isVisible().catch(() => false)) {
      return {
        ok: false,
        reason: (await errorAlert.innerText().catch(() => 'unknown alert error')).trim(),
      };
    }

    if (await validationError.isVisible().catch(() => false)) {
      return {
        ok: false,
        reason: (await validationError.innerText().catch(() => 'unknown validation error')).trim(),
      };
    }

    return null;
  }, { label: `${config.workspaceName} setup/models navigation` });

  if (!navigationOutcome.ok) {
    throw new Error(`[${config.workspaceName}] failed to save data source: ${navigationOutcome.reason}`);
  }

  const tableResponse = await waitFor(async () => {
    const result = await api(page, '/api/v1/data-source/tables', selector);
    if (result.status === 200 && Array.isArray(result.body) && result.body.length > 0) return result.body;
    return null;
  }, { label: `${config.workspaceName} table discovery` });
  console.log(`[${config.workspaceName}] discovered ${tableResponse.length} tables`);

  await waitFor(async () => (await page.locator('body').innerText()).includes('选择要建模的数据表'), {
    label: `${config.workspaceName} models UI`,
  });
  await selectTablesInUi(page, config.tables);
  await page.getByRole('button', { name: '下一步' }).click();

  await waitFor(async () => page.url().includes('/setup/relationships'), {
    label: `${config.workspaceName} setup/relationships navigation`,
  });
  await waitFor(async () => {
    const button = page.getByRole('button', { name: '完成配置' });
    return (await button.count()) > 0 && !(await button.isDisabled());
  }, { label: `${config.workspaceName} relationships ready` });
  await page.getByRole('button', { name: '完成配置' }).click();

  await waitFor(async () => page.url().includes('/knowledge'), {
    label: `${config.workspaceName} return to knowledge`,
  });

  const nextModels = await waitFor(async () => {
    const result = await api(page, '/api/v1/models/list', selector);
    if (result.status === 200 && Array.isArray(result.body) && result.body.length > 0) return result.body;
    return null;
  }, { label: `${config.workspaceName} model import persistence` });
  console.log(`[${config.workspaceName}] imported ${nextModels.length} models`);
}

async function deployAndRefreshSelector(page, selector) {
  const deployResult = await api(page, '/api/v1/deploy', selector, { method: 'POST', body: '{}' });
  if (deployResult.status !== 200) throw new Error(`Deploy failed: ${JSON.stringify(deployResult.body)}`);
  const refreshed = await waitFor(async () => {
    const next = await resolveSelector(page, selector.workspaceId, selector.knowledgeBaseId);
    if (next.deployHash) return next;
    return null;
  }, { label: `deploy refresh for ${selector.workspaceId}` });
  console.log(`[deploy] refreshed selector`, refreshed);
  return refreshed;
}

async function ensureSqlTemplate(page, selector, question, sql) {
  const existing = await api(page, '/api/v1/knowledge/sql_pairs', selector);
  if (existing.status === 200 && Array.isArray(existing.body) && existing.body.some((item) => item.question === question)) {
    console.log(`[${selector.workspaceId}] SQL template already exists: ${question}`);
    return;
  }

  await page.goto(buildUrl('/knowledge', { ...selector, section: 'sqlTemplates' }), { waitUntil: 'networkidle' });
  await waitFor(async () => (await page.locator('body').innerText()).includes('SQL 模板'), {
    label: `${question} SQL template section`,
  });
  const create = page.getByText('新建 SQL 模板').first();
  await create.click();
  await page.getByPlaceholder('例如：最近 30 天 GMV 趋势').fill(question);
  await page.getByPlaceholder('请输入可复用的 SQL 示例，建议优先沉淀稳定口径。').fill(sql);
  const saveResponse = page.waitForResponse((response) =>
    response.url().includes('/api/v1/knowledge/sql_pairs') &&
    response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '保存 SQL 模板' }).click();
  const response = await saveResponse;
  if (response.status() >= 400) {
    throw new Error(`[${selector.workspaceId}] failed to create SQL template: ${response.status()} ${await response.text()}`);
  }

  await waitFor(async () => {
    const result = await api(page, '/api/v1/knowledge/sql_pairs', selector);
    return result.status === 200 && Array.isArray(result.body) && result.body.some((item) => item.question === question);
  }, { label: `${question} SQL template persistence` });
  console.log(`[${selector.workspaceId}] created SQL template: ${question}`);
}

async function ensureRule(page, selector, summary, content) {
  const existing = await api(page, '/api/v1/knowledge/instructions', selector);
  if (existing.status === 200 && Array.isArray(existing.body) && existing.body.some((item) => (item.instruction || '').includes(summary))) {
    console.log(`[${selector.workspaceId}] analysis rule already exists: ${summary}`);
    return;
  }

  await page.goto(buildUrl('/knowledge', { ...selector, section: 'instructions' }), { waitUntil: 'networkidle' });
  await waitFor(async () => (await page.locator('body').innerText()).includes('分析规则'), {
    label: `${summary} rule section`,
  });
  const create = page.getByText('新建分析规则').first();
  await create.click();
  await page.getByPlaceholder('例如：GMV 统计口径').fill(summary);
  await page.getByPlaceholder('请描述口径定义、字段约束、过滤条件和特殊说明。').fill(content);
  const saveResponse = page.waitForResponse((response) =>
    response.url().includes('/api/v1/knowledge/instructions') &&
    response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '保存分析规则' }).click();
  const response = await saveResponse;
  if (response.status() >= 400) {
    throw new Error(`[${selector.workspaceId}] failed to create analysis rule: ${response.status()} ${await response.text()}`);
  }

  await waitFor(async () => {
    const result = await api(page, '/api/v1/knowledge/instructions', selector);
    return result.status === 200 && Array.isArray(result.body) && result.body.some((item) => (item.instruction || '').includes(summary));
  }, { label: `${summary} rule persistence` });
  console.log(`[${selector.workspaceId}] created analysis rule: ${summary}`);
}

async function summarizeWorkspace(page, label, selector) {
  const [settings, models, sqlPairs, instructions] = await Promise.all([
    api(page, '/api/v1/settings', selector),
    api(page, '/api/v1/models/list', selector),
    api(page, '/api/v1/knowledge/sql_pairs', selector),
    api(page, '/api/v1/knowledge/instructions', selector),
  ]);
  console.log(`SUMMARY ${label}`);
  console.log(JSON.stringify({
    selector,
    dataSource: settings.body?.dataSource ? {
      type: settings.body.dataSource.type,
      properties: {
        host: settings.body.dataSource.properties?.host,
        port: settings.body.dataSource.properties?.port,
        database: settings.body.dataSource.properties?.database,
        user: settings.body.dataSource.properties?.user,
      },
    } : null,
    modelCount: Array.isArray(models.body) ? models.body.length : null,
    sqlPairCount: Array.isArray(sqlPairs.body) ? sqlPairs.body.length : null,
    instructionCount: Array.isArray(instructions.body) ? instructions.body.length : null,
  }, null, 2));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  page.setDefaultTimeout(40000);

  try {
    await login(page);

    const tidbArtifacts = loadTidbArtifacts();

    const tidb = await ensureKnowledgeBase(page, WORKSPACES.tidb);
    await ensureConnectionAndModels(page, tidb.selector, WORKSPACES.tidb);
    const tidbSelector = await deployAndRefreshSelector(page, tidb.selector);
    await ensureRule(page, tidbSelector, tidbArtifacts.rule.summary, tidbArtifacts.rule.content);
    await ensureSqlTemplate(page, tidbSelector, tidbArtifacts.sqlTemplate.question, tidbArtifacts.sqlTemplate.sql);
    await summarizeWorkspace(page, 'TiDB', tidbSelector);

    const hr = await ensureKnowledgeBase(page, WORKSPACES.hr);
    await ensureConnectionAndModels(page, hr.selector, WORKSPACES.hr);
    const hrSelector = await deployAndRefreshSelector(page, hr.selector);
    await ensureRule(page, hrSelector, hrArtifacts.rule.summary, hrArtifacts.rule.content);
    await ensureSqlTemplate(page, hrSelector, hrArtifacts.sqlTemplate.question, hrArtifacts.sqlTemplate.sql);
    await summarizeWorkspace(page, 'HR', hrSelector);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
