import { expect, Page } from '@playwright/test';

type IgnorePattern = RegExp | string;

type BrowserHealthCollectorOptions = {
  ignorePageErrors?: IgnorePattern[];
  ignoreConsoleErrors?: IgnorePattern[];
};

type MeasureStepArgs<T> = {
  label: string;
  action: () => Promise<T> | T;
  ready?: () => Promise<void> | void;
};

const matchesIgnorePattern = (
  value: string,
  patterns: IgnorePattern[] = [],
) =>
  patterns.some((pattern) =>
    typeof pattern === 'string' ? value.includes(pattern) : pattern.test(value),
  );

export const attachBrowserHealthCollector = (
  page: Page,
  options: BrowserHealthCollectorOptions = {},
) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on('pageerror', (error) => {
    if (matchesIgnorePattern(error.message, options.ignorePageErrors)) {
      return;
    }

    pageErrors.push(error.message);
  });

  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }

    const text = message.text();
    if (matchesIgnorePattern(text, options.ignoreConsoleErrors)) {
      return;
    }

    consoleErrors.push(text);
  });

  return {
    assertClean() {
      expect(pageErrors, 'unexpected browser page errors').toEqual([]);
      expect(consoleErrors, 'unexpected browser console errors').toEqual([]);
    },
  };
};

export const measureStep = async <T>({
  label,
  action,
  ready,
}: MeasureStepArgs<T>) => {
  const startedAt = Date.now();
  const value = await action();
  if (ready) {
    await ready();
  }

  return {
    label,
    durationMs: Date.now() - startedAt,
    value,
  };
};

export const expectStepDurationWithin = ({
  label,
  durationMs,
  thresholdMs,
}: {
  label: string;
  durationMs: number;
  thresholdMs: number;
}) => {
  expect(
    durationMs,
    `${label} exceeded budget (${durationMs}ms > ${thresholdMs}ms)`,
  ).toBeLessThanOrEqual(thresholdMs);
};

export const expectNoHorizontalOverflow = async ({
  page,
  testId,
}: {
  page: Page;
  testId: string;
}) => {
  expect(
    await page
      .getByTestId(testId)
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
};
