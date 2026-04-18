import crypto from 'crypto';
import knex from 'knex';
import { test, expect } from '@playwright/test';
import * as helper from '../helper';
import { testDbConfig } from '../config';
import { ApiType } from '@/types/apiHistory';

const OWNER_EMAIL = 'admin@example.com';
const DIAGNOSTICS_SQL_OK = 'select 200 as status_ok';
const DIAGNOSTICS_SQL_FAIL = 'select 500 as status_fail';
const DASHBOARD_NAME = 'E2E 定时刷新看板';

const ROUTE_CASES: Array<{
  pathname: string;
  title: string;
  url?: RegExp;
}> = [
  { pathname: '/settings', title: '个人资料' },
  { pathname: '/settings/users', title: '用户管理' },
  { pathname: '/settings/access', title: '用户管理' },
  { pathname: '/settings/permissions', title: '权限管理' },
  { pathname: '/settings/skills', title: '技能管理' },
  { pathname: '/settings/automation', title: '自动化身份' },
  { pathname: '/settings/connectors', title: '数据连接器' },
  { pathname: '/settings/identity', title: '身份与目录' },
  { pathname: '/settings/audit', title: '审计日志' },
  { pathname: '/settings/diagnostics', title: '调用诊断' },
  { pathname: '/api-management/history', title: '调用诊断' },
  { pathname: '/settings/system-tasks', title: '系统任务' },
  { pathname: '/workspace/schedules', title: '系统任务' },
  { pathname: '/settings/workspace', title: '工作空间' },
  { pathname: '/workspace', title: '工作空间' },
  { pathname: '/settings/security', title: '个人资料', url: /\/settings(?:\?.*)?$/ },
];

const seedDiagnosticsAndSchedulesFixture = async (
  selector: helper.RuntimeScopeFixture,
) => {
  const db = knex(testDbConfig);

  try {
    const seeded = await helper.seedKnowledgeWorkbenchFixture(selector);
    const now = new Date();
    const later = new Date(now.getTime() + 30 * 60 * 1000);
    const knowledgeBase = await db('knowledge_base')
      .where({ id: selector.knowledgeBaseId })
      .first('runtime_project_id');
    const runtimeProjectId = Number(knowledgeBase?.runtime_project_id);
    expect(runtimeProjectId).toBeGreaterThan(0);

    await db('api_history').insert([
      {
        id: crypto.randomUUID(),
        project_id: runtimeProjectId,
        workspace_id: selector.workspaceId,
        knowledge_base_id: selector.knowledgeBaseId,
        kb_snapshot_id: seeded.kbSnapshotId,
        deploy_hash: seeded.deployHash,
        thread_id: 'diagnostics-thread-ok',
        api_type: ApiType.RUN_SQL,
        headers: JSON.stringify({ 'x-e2e': 'ok' }),
        request_payload: JSON.stringify({ sql: DIAGNOSTICS_SQL_OK }),
        response_payload: JSON.stringify({ rows: [[200]] }),
        status_code: 200,
        duration_ms: 48,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
      {
        id: crypto.randomUUID(),
        project_id: runtimeProjectId,
        workspace_id: selector.workspaceId,
        knowledge_base_id: selector.knowledgeBaseId,
        kb_snapshot_id: seeded.kbSnapshotId,
        deploy_hash: seeded.deployHash,
        thread_id: 'diagnostics-thread-fail',
        api_type: ApiType.RUN_SQL,
        headers: JSON.stringify({ 'x-e2e': 'fail' }),
        request_payload: JSON.stringify({ sql: DIAGNOSTICS_SQL_FAIL }),
        response_payload: JSON.stringify({ error: 'forced failure' }),
        status_code: 500,
        duration_ms: 113,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
    ]);

    const insertedDashboard = await db('dashboard')
      .insert({
        project_id: runtimeProjectId,
        name: DASHBOARD_NAME,
        cache_enabled: true,
        schedule_frequency: 'Daily',
        schedule_cron: '0 8 * * *',
        schedule_timezone: 'Asia/Shanghai',
        next_scheduled_at: later.toISOString(),
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .returning(['id']);
    const dashboardId = Number(
      typeof insertedDashboard[0] === 'object'
        ? insertedDashboard[0].id
        : insertedDashboard[0],
    );

    const scheduleJobId = crypto.randomUUID();
    await db('schedule_job').insert({
      id: scheduleJobId,
      workspace_id: selector.workspaceId,
      knowledge_base_id: selector.knowledgeBaseId,
      kb_snapshot_id: seeded.kbSnapshotId,
      deploy_hash: seeded.deployHash,
      target_type: 'dashboard_refresh',
      target_id: String(dashboardId),
      cron_expr: '0 8 * * *',
      timezone: 'Asia/Shanghai',
      status: 'active',
      next_run_at: later.toISOString(),
      last_run_at: now.toISOString(),
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });

    await db('schedule_job_run').insert({
      id: crypto.randomUUID(),
      schedule_job_id: scheduleJobId,
      trace_id: 'trace-e2e-schedule-run',
      status: 'succeeded',
      started_at: now.toISOString(),
      finished_at: later.toISOString(),
      detail_json: JSON.stringify({
        runtimeIdentity: {
          workspaceId: selector.workspaceId,
          knowledgeBaseId: selector.knowledgeBaseId,
          kbSnapshotId: seeded.kbSnapshotId,
          deployHash: seeded.deployHash,
        },
      }),
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });

    return {
      ...selector,
      kbSnapshotId: seeded.kbSnapshotId,
      deployHash: seeded.deployHash,
      runtimeScopeId: seeded.deployHash,
    };
  } finally {
    await db.destroy();
  }
};

test.describe('Settings and workspace route coverage', () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeEach(async () => {
    await helper.resetDatabase();
  });

  test('loads the primary settings and workspace routes', async ({ page }) => {
    const selector = await helper.ensureRuntimeScopeFixtureForUser({
      email: OWNER_EMAIL,
      workspaceSlug: 'settings-routes-workspace',
      workspaceName: '设置路由空间',
      knowledgeBaseSlug: 'settings-routes-kb',
      knowledgeBaseName: '设置路由知识库',
      setDefaultWorkspace: true,
    });

    for (const routeCase of ROUTE_CASES) {
      await helper.gotoRuntimeScopedPath({
        page,
        pathname: routeCase.pathname,
        selector,
      });

      if (routeCase.url) {
        await expect(page).toHaveURL(routeCase.url, { timeout: 60_000 });
      } else {
        await helper.expectPathname({ page, pathname: routeCase.pathname });
      }

      await expect(page.getByText(routeCase.title).first()).toBeVisible({
        timeout: 60_000,
      });
    }
  });

  test('shows filtered API history and workspace schedules on the alias routes', async ({
    page,
  }) => {
    const selector = await helper.ensureRuntimeScopeFixtureForUser({
      email: OWNER_EMAIL,
      workspaceSlug: 'settings-observability-workspace',
      workspaceName: '设置观测工作空间',
      knowledgeBaseSlug: 'settings-observability-kb',
      knowledgeBaseName: '设置观测知识库',
      setDefaultWorkspace: true,
    });
    const runtimeSelector = await seedDiagnosticsAndSchedulesFixture(selector);

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/api-management/history',
      selector: {
        ...runtimeSelector,
        apiType: ApiType.RUN_SQL,
        threadId: 'diagnostics-thread-ok',
      },
    });
    await helper.expectPathname({ page, pathname: '/api-management/history' });
    await expect(page.getByText('调用诊断')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(DIAGNOSTICS_SQL_OK)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(DIAGNOSTICS_SQL_FAIL)).toHaveCount(0);

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/api-management/history',
      selector: {
        ...runtimeSelector,
        apiType: ApiType.RUN_SQL,
        threadId: 'diagnostics-thread-fail',
        statusCode: '500',
      },
    });
    await helper.expectPathname({ page, pathname: '/api-management/history' });
    await expect(page.getByText(DIAGNOSTICS_SQL_FAIL)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(DIAGNOSTICS_SQL_OK)).toHaveCount(0);

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/workspace/schedules',
      selector: runtimeSelector,
    });
    await helper.expectPathname({ page, pathname: '/workspace/schedules' });
    await expect(page.getByText('系统任务')).toBeVisible({ timeout: 60_000 });
    await expect(
      page.locator('tr').filter({ hasText: DASHBOARD_NAME }).first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '立即刷新' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '编辑计划' }).first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: '切为仅手动刷新' }).first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '查看详情' }).first()).toBeVisible();
  });
});
