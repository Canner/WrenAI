import fs from 'fs';
import path from 'path';
import { test, expect, type Page } from '@playwright/test';
import { SampleDatasetName } from '@/types/dataSource';
import * as helper from '../helper';

const datasets = [
  SampleDatasetName.HR,
  SampleDatasetName.ECOMMERCE,
  SampleDatasetName.NBA,
] as const;

const reportPath = path.resolve(
  __dirname,
  '../../../docs/modeling-ai-assistant-cloud-ai-quality-evaluation-2026-04-24.md',
);

type RuntimeSelector = helper.RuntimeScopeFixture & Record<string, string>;

type TaskResult = {
  status: string;
  response?: any;
  error?: { message?: string | null } | null;
  traceId?: string | null;
};

const buildScopedUrl = (pathname: string, selector: RuntimeSelector) => {
  const searchParams = new URLSearchParams();
  Object.entries(selector).forEach(([key, value]) => {
    if (value) {
      searchParams.set(key, value);
    }
  });
  return `${pathname}?${searchParams.toString()}`;
};

const requestScopedJson = async <T>(
  page: Page,
  selector: RuntimeSelector,
  pathname: string,
  init?: Parameters<Page['request']['fetch']>[1],
) => {
  const response = await page.request.fetch(
    buildScopedUrl(pathname, selector),
    init,
  );
  const text = await response.text();
  expect(
    response.ok(),
    `${init?.method || 'GET'} ${pathname} failed (${response.status()}): ${text}`,
  ).toBeTruthy();
  return (text ? JSON.parse(text) : {}) as T;
};

const pollTask = async ({
  page,
  selector,
  pathname,
  timeoutMs = 120_000,
}: {
  page: Page;
  selector: RuntimeSelector;
  pathname: string;
  timeoutMs?: number;
}) => {
  const start = Date.now();
  let latest: TaskResult | null = null;
  while (Date.now() - start < timeoutMs) {
    latest = await requestScopedJson<TaskResult>(page, selector, pathname);
    if (latest.status === 'FINISHED' || latest.status === 'FAILED') {
      return latest;
    }
    await page.waitForTimeout(2_000);
  }
  return latest;
};

test.describe('modeling assistant quality evaluation', () => {
  test.skip(
    !process.env.RUN_MODELING_ASSISTANT_QUALITY,
    'manual quality evaluation flow',
  );
  test.describe.configure({ timeout: 600_000 });

  test('evaluates real local assistant outputs across sample datasets', async ({
    page,
  }) => {
    const reportRows: string[] = [
      '# Modeling AI Assistant AI Quality Evaluation (2026-04-24)',
      '',
      '> Generated from local non-mocked assistant task runs against sample datasets.',
      '',
    ];

    for (const dataset of datasets) {
      const selector = (await helper.ensureSystemSampleRuntimeScope({
        page,
        sampleDataset: dataset,
      })) as RuntimeSelector;

      const models = await requestScopedJson<Array<{ referenceName: string }>>(
        page,
        selector,
        '/api/v1/models/list',
      );
      const selectedModels = models
        .slice(0, 2)
        .map((model) => model.referenceName);

      const relationshipTask = await requestScopedJson<{ id: string }>(
        page,
        selector,
        '/api/v1/relationship-recommendations',
        { method: 'POST' },
      );
      const relationshipResult = await pollTask({
        page,
        selector,
        pathname: `/api/v1/relationship-recommendations/${relationshipTask.id}`,
      });

      const semanticsTask = await requestScopedJson<{ id: string }>(
        page,
        selector,
        '/api/v1/semantics-descriptions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          data: {
            selectedModels,
            userPrompt:
              'Generate concise business-friendly model and column descriptions.',
          },
        },
      );
      const semanticsResult = await pollTask({
        page,
        selector,
        pathname: `/api/v1/semantics-descriptions/${semanticsTask.id}`,
      });

      const relationshipCount =
        relationshipResult?.response?.relationships?.length || 0;
      const semanticsCount = semanticsResult?.response?.length || 0;
      const firstRelationship =
        relationshipResult?.response?.relationships?.[0] || null;
      const firstSemanticModel = semanticsResult?.response?.[0] || null;

      reportRows.push(`## ${dataset}`);
      reportRows.push('');
      reportRows.push(
        `- Relationship task status: ${relationshipResult?.status || 'UNKNOWN'}`,
      );
      reportRows.push(
        `- Relationship recommendation count: ${relationshipCount}`,
      );
      if (firstRelationship) {
        reportRows.push(
          `- First relationship: ${firstRelationship.fromModel}.${firstRelationship.fromColumn} -> ${firstRelationship.toModel}.${firstRelationship.toColumn} (${firstRelationship.type})`,
        );
        reportRows.push(
          `- First relationship reason: ${firstRelationship.reason || ''}`,
        );
      }
      if (relationshipResult?.error?.message) {
        reportRows.push(
          `- Relationship error: ${relationshipResult.error.message}`,
        );
      }
      reportRows.push(
        `- Semantics task status: ${semanticsResult?.status || 'UNKNOWN'}`,
      );
      reportRows.push(`- Semantics model count: ${semanticsCount}`);
      if (firstSemanticModel) {
        reportRows.push(`- First semantics model: ${firstSemanticModel.name}`);
        reportRows.push(
          `- First semantics description: ${firstSemanticModel.description || ''}`,
        );
      }
      if (semanticsResult?.error?.message) {
        reportRows.push(`- Semantics error: ${semanticsResult.error.message}`);
      }
      reportRows.push('');
    }

    fs.writeFileSync(reportPath, `${reportRows.join('\n')}\n`, 'utf8');
  });
});
