import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ScheduleRunDetailsDrawer from './ScheduleRunDetailsDrawer';

jest.mock('antd', () => {
  const React = jest.requireActual('react');

  return {
    Alert: ({ message, description }: any) =>
      React.createElement('div', null, message, description),
    Drawer: ({ children, title }: any) =>
      React.createElement(
        'div',
        { 'data-kind': 'drawer' },
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

jest.mock('@/components/code/JsonCodeBlock', () => {
  const React = jest.requireActual('react');

  return {
    __esModule: true,
    default: ({ code }: { code: any }) =>
      React.createElement('pre', { 'data-kind': 'json' }, JSON.stringify(code)),
  };
});

describe('ScheduleRunDetailsDrawer', () => {
  it('renders failure, trace and runtime identity details for a run', () => {
    const html = renderToStaticMarkup(
      React.createElement(ScheduleRunDetailsDrawer, {
        visible: true,
        onClose: jest.fn(),
        defaultValue: {
          id: 'run-1',
          scheduleJobId: 'job-1',
          targetType: 'dashboard_refresh',
          targetTypeLabel: '看板缓存刷新',
          targetName: '库存概览',
          status: 'failed',
          startedAt: '2026-04-08T12:00:00.000Z',
          finishedAt: '2026-04-08T12:00:03.500Z',
          traceId: 'trace-1',
          errorMessage: 'refresh failed',
          detailJson: {
            runtimeIdentity: {
              workspaceId: 'ws-1',
              knowledgeBaseId: 'kb-1',
              kbSnapshotId: 'snap-1',
              deployHash: 'deploy-1',
            },
            refreshedItems: 2,
          },
        },
      }),
    );

    expect(html).toContain('运行详情');
    expect(html).toContain('最近一次执行失败');
    expect(html).toContain('trace-1');
    expect(html).toContain('workspaceId');
    expect(html).toContain('kb-1');
    expect(html).toContain('deploy-1');
    expect(html).toContain('detailJson');
    expect(html).toContain('refreshedItems');
  });
});
