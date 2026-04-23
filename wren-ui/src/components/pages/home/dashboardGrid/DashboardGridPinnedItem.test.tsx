import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DashboardGridPinnedItem } from './DashboardGridPinnedItem';

const capturedButtons: any[] = [];

jest.mock('next/dynamic', () => () => {
  const React = jest.requireActual('react');
  return function MockDynamicChart() {
    return React.createElement('div', null, 'chart');
  };
});

jest.mock('antd', () => {
  const React = jest.requireActual('react');
  return {
    Alert: ({ children }: any) => React.createElement('div', null, children),
    Button: (props: any) => {
      capturedButtons.push(props);
      return React.createElement('button', props, props.children);
    },
  };
});

jest.mock('@/components/PageLoading', () => ({
  LoadingWrapper: ({ children }: any) => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, children);
  },
}));

jest.mock('@/utils/antdAppBridge', () => ({
  appMessage: {
    error: jest.fn(),
  },
}));

jest.mock('@/components/diagram/CustomDropdown', () => ({
  DashboardItemDropdown: ({ children }: any) => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, children);
  },
}));

jest.mock('./DashboardGridPinnedItemTitle', () => ({
  DashboardGridPinnedItemTitle: ({ title }: { title: string }) => {
    const React = jest.requireActual('react');
    return React.createElement('span', null, title);
  },
}));

const runtimeScopeSelector = {
  workspaceId: 'ws-1',
  knowledgeBaseId: 'kb-1',
  kbSnapshotId: 'snap-1',
  deployHash: 'deploy-1',
};

describe('DashboardGridPinnedItem', () => {
  beforeEach(() => {
    capturedButtons.length = 0;
  });

  it('stops drag propagation on source-thread button interactions and navigates on click', async () => {
    const onNavigateToThread = jest.fn().mockResolvedValue(undefined);

    renderToStaticMarkup(
      <DashboardGridPinnedItem
        item={{
          id: 1,
          dashboardId: 10,
          type: 'chart',
          displayName: '部门薪资图',
          layout: { x: 0, y: 0, w: 4, h: 3 },
          detail: {
            sql: 'select 1',
            chartSchema: { title: '部门薪资图' },
            sourceThreadId: 5,
            sourceResponseId: 20,
            validationErrors: [],
          },
        }}
        isSupportCached
        runtimeScopeSelector={runtimeScopeSelector}
        onDelete={jest.fn().mockResolvedValue(undefined)}
        onItemUpdated={jest.fn()}
        onNavigateToThread={onNavigateToThread}
      />,
    );

    const sourceThreadButton = capturedButtons.find(
      (props) => props.children === '来源线程',
    );

    expect(sourceThreadButton).toBeTruthy();

    const mouseDownEvent = { stopPropagation: jest.fn() };
    sourceThreadButton.onMouseDown(mouseDownEvent);
    expect(mouseDownEvent.stopPropagation).toHaveBeenCalledTimes(1);

    const touchStartEvent = { stopPropagation: jest.fn() };
    sourceThreadButton.onTouchStart(touchStartEvent);
    expect(touchStartEvent.stopPropagation).toHaveBeenCalledTimes(1);

    const clickEvent = { stopPropagation: jest.fn() };
    sourceThreadButton.onClick(clickEvent);

    expect(clickEvent.stopPropagation).toHaveBeenCalledTimes(1);
    expect(onNavigateToThread).toHaveBeenCalledWith(5, 20);
  });
});
