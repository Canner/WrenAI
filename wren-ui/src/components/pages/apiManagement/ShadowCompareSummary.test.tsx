import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  deriveShadowCompareRolloutReadiness,
  default as ShadowCompareSummary,
} from './ShadowCompareSummary';
import { ApiType } from '@/types/api';

jest.mock('antd', () => {
  const React = jest.requireActual('react');

  return {
    Alert: ({ message, description }: any) =>
      React.createElement(
        'div',
        { 'data-kind': 'alert' },
        message,
        description ? React.createElement('div', null, description) : null,
      ),
    Card: ({ title, children }: any) =>
      React.createElement(
        'section',
        { 'data-kind': 'card' },
        title ? React.createElement('h3', null, title) : null,
        children,
      ),
    Row: ({ children }: any) => React.createElement('div', null, children),
    Col: ({ children }: any) => React.createElement('div', null, children),
    Tag: ({ children }: any) =>
      React.createElement('span', { 'data-kind': 'tag' }, children),
    Typography: {
      Text: ({ children }: any) => React.createElement('span', null, children),
    },
  };
});

describe('ShadowCompareSummary', () => {
  it('derives rollout readiness using the same canary gate semantics as ask service', () => {
    expect(
      deriveShadowCompareRolloutReadiness({
        total: 0,
        withDiagnostics: 0,
        enabled: 0,
        executed: 0,
        comparable: 0,
        matched: 0,
        mismatched: 0,
        errorCount: 0,
        byAskPath: [],
        byShadowErrorType: [],
        trends: [],
      }),
    ).toEqual({
      status: 'no_data',
      recommendedMode: 'keep_legacy',
      reason: '还没有记录到影子对比样本。',
      comparableMatchRate: 0,
      comparableMismatchRate: 0,
      errorRate: 0,
    });

    expect(
      deriveShadowCompareRolloutReadiness({
        total: 8,
        withDiagnostics: 8,
        enabled: 8,
        executed: 4,
        comparable: 3,
        matched: 2,
        mismatched: 1,
        errorCount: 0,
        byAskPath: [],
        byShadowErrorType: [],
        trends: [],
      }),
    ).toMatchObject({
      status: 'blocked_on_comparable_mismatches',
      recommendedMode: 'keep_legacy',
      comparableMatchRate: 2 / 3,
      comparableMismatchRate: 1 / 3,
    });

    expect(
      deriveShadowCompareRolloutReadiness({
        total: 6,
        withDiagnostics: 6,
        enabled: 6,
        executed: 6,
        comparable: 6,
        matched: 6,
        mismatched: 0,
        errorCount: 0,
        byAskPath: [],
        byShadowErrorType: [],
        trends: [],
      }),
    ).toMatchObject({
      status: 'ready_for_canary',
      recommendedMode: 'canary_deepagents',
      comparableMatchRate: 1,
      comparableMismatchRate: 0,
      errorRate: 0,
    });
  });

  it('renders rollout metrics and buckets', () => {
    const html = renderToStaticMarkup(
      React.createElement(ShadowCompareSummary, {
        stats: {
          total: 8,
          withDiagnostics: 6,
          enabled: 5,
          executed: 4,
          comparable: 3,
          matched: 2,
          mismatched: 1,
          errorCount: 1,
          byAskPath: [
            { key: 'skill', count: 4 },
            { key: 'nl2sql', count: 2 },
          ],
          byShadowErrorType: [{ key: 'timeout', count: 1 }],
          trends: [
            {
              date: '2026-04-01',
              total: 3,
              executed: 2,
              comparable: 2,
              matched: 1,
              mismatched: 1,
              errorCount: 0,
            },
            {
              date: '2026-04-02',
              total: 5,
              executed: 2,
              comparable: 1,
              matched: 1,
              mismatched: 0,
              errorCount: 1,
            },
          ],
        },
      }),
    );

    expect(html).toContain('影子对比发布看板');
    expect(html).toContain('建议策略：保留旧链路');
    expect(html).toContain('影子对比已经记录到旧链路的影子执行错误。');
    expect(html).toContain('75% (6/8)');
    expect(html).toContain('80% (4/5)');
    expect(html).toContain('67% (2/3)');
    expect(html).toContain('skill: 4');
    expect(html).toContain('timeout: 1');
    expect(html).toContain('最近趋势');
    expect(html).toContain('2026-04-02');
    expect(html).toContain('总数 5 · 已执行 2 · 已匹配 1');
  });

  it('renders an info alert when current filter is not ask-based', () => {
    const html = renderToStaticMarkup(
      React.createElement(ShadowCompareSummary, {
        unsupportedApiType: ApiType.RUN_SQL,
      }),
    );

    expect(html).toContain('data-kind="alert"');
    expect(html).toContain('ASK / STREAM_ASK');
    expect(html).toContain('run_sql');
  });
});
