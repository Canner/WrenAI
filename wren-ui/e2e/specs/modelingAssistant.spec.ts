import { test, expect } from '@playwright/test';
import * as helper from '../helper';
import * as modelingHelper from '../commonTests/modeling';

const OWNER_EMAIL = 'admin@example.com';

test.describe('modeling assistant routes', () => {
  test.describe.configure({ timeout: 240_000 });

  test('supports launcher, relationships result/save, and semantics wizard flows', async ({
    page,
  }) => {
    const suffix = `${Date.now()}`;
    const selector = await helper.ensureRuntimeScopeFixtureForUser({
      email: OWNER_EMAIL,
      workspaceSlug: `modeling-assistant-e2e-workspace-${suffix}`,
      workspaceName: '建模助手 E2E 工作空间',
      knowledgeBaseSlug: `modeling-assistant-e2e-kb-${suffix}`,
      knowledgeBaseName: '建模助手 E2E 知识库',
      setDefaultWorkspace: true,
    });
    const seeded = await helper.seedKnowledgeWorkbenchFixture(selector);
    const runtimeSelector = {
      workspaceId: selector.workspaceId,
      knowledgeBaseId: selector.knowledgeBaseId,
      kbSnapshotId: seeded.kbSnapshotId,
      deployHash: seeded.deployHash,
    };

    let relationshipResultPollCount = 0;
    let relationshipSavePayload: any = null;
    let semanticsResultPollCount = 0;
    const semanticsSavePayloads: any[] = [];

    await page.route(
      '**/api/v1/relationship-recommendations**',
      async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ id: 'rel-task-1' }),
          });
          return;
        }
        await route.fallback();
      },
    );

    await page.route(
      '**/api/v1/relationship-recommendations/rel-task-1**',
      async (route) => {
        relationshipResultPollCount += 1;
        if (relationshipResultPollCount === 1) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: 'rel-task-1',
              status: 'GENERATING',
              response: null,
              error: null,
            }),
          });
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'rel-task-1',
            status: 'FINISHED',
            response: {
              relationships: [
                {
                  name: 'OrdersCustomer',
                  fromModel: 'orders',
                  fromColumn: 'customer_id',
                  toModel: 'customers',
                  toColumn: 'customer_id',
                  type: 'MANY_TO_ONE',
                  reason: 'Connect orders to customers.',
                },
              ],
            },
            error: null,
          }),
        });
      },
    );

    await page.route('**/api/v1/relationships/import**', async (route) => {
      relationshipSavePayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.route('**/api/v1/semantics-descriptions**', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'sem-task-1' }),
        });
        return;
      }
      await route.fallback();
    });

    await page.route(
      '**/api/v1/semantics-descriptions/sem-task-1**',
      async (route) => {
        semanticsResultPollCount += 1;
        if (semanticsResultPollCount === 1) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: 'sem-task-1',
              status: 'GENERATING',
              response: null,
              error: null,
            }),
          });
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'sem-task-1',
            status: 'FINISHED',
            response: [
              {
                name: 'orders',
                description: 'Order facts for commerce analytics',
                columns: [
                  {
                    name: 'order_id',
                    description: 'Primary key for each order',
                  },
                  {
                    name: 'customer_id',
                    description: 'Customer foreign key',
                  },
                ],
              },
            ],
            error: null,
          }),
        });
      },
    );

    await page.route('**/api/v1/models/*/metadata**', async (route) => {
      semanticsSavePayloads.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/knowledge',
      selector: {
        ...runtimeSelector,
        section: 'modeling',
      },
    });
    await helper.expectPathname({ page, pathname: '/knowledge' });
    await expect
      .poll(() => new URL(page.url()).searchParams.get('section'))
      .toBe('modeling');
    await modelingHelper.waitForModelingDataLoaded(page);

    await expect(page.getByText('Modeling AI Assistant')).toBeVisible();

    await page.getByRole('button', { name: /Modeling AI Assistant/i }).click();
    await page
      .getByRole('button', { name: /Recommend relationships/i })
      .click();
    await helper.expectPathname({ page, pathname: '/recommend-relationships' });
    await expect(page.getByText('Generate relationships')).toBeVisible();
    await expect(page.getByText('orders.customer_id')).toBeVisible();
    await expect(page.getByText('customers.customer_id')).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();

    await helper.expectPathname({ page, pathname: '/knowledge' });
    await expect
      .poll(() => new URL(page.url()).searchParams.get('section'))
      .toBe('modeling');
    expect(relationshipSavePayload?.relations).toHaveLength(1);
    expect(relationshipSavePayload.relations[0]).toMatchObject({
      type: 'MANY_TO_ONE',
      description: 'Connect orders to customers.',
    });

    await page.getByRole('button', { name: /Modeling AI Assistant/i }).click();
    await page.getByRole('button', { name: /Recommend semantics/i }).click();
    await helper.expectPathname({ page, pathname: '/recommend-semantics' });
    await expect(page.getByText('Generate semantics')).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(
      page.getByText('Please select at least one model.'),
    ).toBeVisible();
    await page.getByRole('checkbox', { name: /订单.*orders/ }).check();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Example prompt')).toBeVisible();
    await expect(page.getByText('College')).toBeVisible();
    await page.getByRole('button', { name: 'Generate' }).click();
    await expect(page.getByText('Generated semantics')).toBeVisible();
    await expect(
      page.getByText('Order facts for commerce analytics'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();

    await helper.expectPathname({ page, pathname: '/knowledge' });
    await expect
      .poll(() => new URL(page.url()).searchParams.get('section'))
      .toBe('modeling');
    expect(semanticsSavePayloads).toHaveLength(1);
    expect(semanticsSavePayloads[0]).toMatchObject({
      description: 'Order facts for commerce analytics',
      columns: [
        expect.objectContaining({
          description: 'Primary key for each order',
        }),
        expect.objectContaining({
          description: 'Customer foreign key',
        }),
      ],
    });
  });
});
