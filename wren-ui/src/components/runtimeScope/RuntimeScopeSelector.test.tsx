import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockUseRouter = jest.fn();
const mockUseRuntimeScopeTransition = jest.fn();
const mockUseRuntimeSelectorState = jest.fn();
const capturedSelectProps: any[] = [];

jest.mock('next/router', () => ({
  useRouter: () => mockUseRouter(),
}));

jest.mock('antd', () => {
  const React = jest.requireActual('react');

  return {
    Select: (props: any) => {
      capturedSelectProps.push(props);
      return React.createElement('div', {
        'data-placeholder': props.placeholder,
        'data-loading': props.loading ? 'true' : 'false',
        'data-disabled': props.disabled ? 'true' : 'false',
      });
    },
    Space: ({ children }: any) => React.createElement('div', null, children),
  };
});

jest.mock('@/hooks/useRuntimeScopeTransition', () => ({
  __esModule: true,
  default: () => mockUseRuntimeScopeTransition(),
}));

jest.mock('@/hooks/useRuntimeSelectorState', () => ({
  __esModule: true,
  default: () => mockUseRuntimeSelectorState(),
}));

import RuntimeScopeSelector from './RuntimeScopeSelector';

describe('RuntimeScopeSelector', () => {
  beforeEach(() => {
    capturedSelectProps.length = 0;
    jest.clearAllMocks();
    mockUseRouter.mockReturnValue({
      pathname: '/knowledge',
      query: {},
    });
    mockUseRuntimeScopeTransition.mockReturnValue({
      transitioning: false,
      transitionTo: jest.fn(),
    });
  });

  it('keeps workspace selector interactive during knowledge-base refetches', () => {
    mockUseRuntimeSelectorState.mockReturnValue({
      runtimeSelectorState: {
        currentWorkspace: {
          id: 'ws-1',
          slug: 'workspace-1',
          name: 'Workspace 1',
        },
        workspaces: [
          { id: 'ws-1', slug: 'workspace-1', name: 'Workspace 1' },
          { id: 'ws-2', slug: 'workspace-2', name: 'Workspace 2' },
        ],
        currentKnowledgeBase: {
          id: 'kb-1',
          slug: 'knowledge-1',
          name: 'Knowledge 1',
        },
        currentKbSnapshot: {
          id: 'snap-1',
          snapshotKey: 'snapshot-1',
          displayName: 'Snapshot 1',
          deployHash: 'deploy-1',
          status: 'ready',
        },
        knowledgeBases: [
          {
            id: 'kb-1',
            slug: 'knowledge-1',
            name: 'Knowledge 1',
          },
        ],
        kbSnapshots: [
          {
            id: 'snap-1',
            snapshotKey: 'snapshot-1',
            displayName: 'Snapshot 1',
            deployHash: 'deploy-1',
            status: 'ready',
          },
        ],
      },
      loading: true,
      initialLoading: false,
    });

    renderToStaticMarkup(React.createElement(RuntimeScopeSelector));

    expect(capturedSelectProps).toHaveLength(3);
    expect(capturedSelectProps[0].placeholder).toBe('工作区');
    expect(capturedSelectProps[0].loading).toBe(false);
    expect(capturedSelectProps[0].disabled).toBe(false);

    expect(capturedSelectProps[1].placeholder).toBe('知识库');
    expect(capturedSelectProps[1].loading).toBe(true);
    expect(capturedSelectProps[1].disabled).toBe(true);

    expect(capturedSelectProps[2].placeholder).toBe('快照');
    expect(capturedSelectProps[2].loading).toBe(true);
    expect(capturedSelectProps[2].disabled).toBe(true);
  });

  it('drops thread params when switching workspace from a thread route', () => {
    const transitionTo = jest.fn();
    mockUseRouter.mockReturnValue({
      pathname: '/home/[id]',
      query: {
        id: 'thread-1',
        workspaceId: 'ws-1',
      },
    });
    mockUseRuntimeScopeTransition.mockReturnValue({
      transitioning: false,
      transitionTo,
    });
    mockUseRuntimeSelectorState.mockReturnValue({
      runtimeSelectorState: {
        currentWorkspace: {
          id: 'ws-1',
          slug: 'workspace-1',
          name: 'Workspace 1',
        },
        workspaces: [
          { id: 'ws-1', slug: 'workspace-1', name: 'Workspace 1' },
          { id: 'ws-2', slug: 'workspace-2', name: 'Workspace 2' },
        ],
        currentKnowledgeBase: null,
        currentKbSnapshot: null,
        knowledgeBases: [],
        kbSnapshots: [],
      },
      loading: false,
      initialLoading: false,
    });

    renderToStaticMarkup(React.createElement(RuntimeScopeSelector));

    capturedSelectProps[0].onChange('ws-2');

    expect(transitionTo).toHaveBeenCalledWith('/home?workspaceId=ws-2');
  });
});
