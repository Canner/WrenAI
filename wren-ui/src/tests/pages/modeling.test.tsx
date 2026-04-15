import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ModelingPage from '../../pages/modeling';

const mockUseProtectedRuntimeScopePage = jest.fn();
const mockUseRuntimeScopeNavigation = jest.fn();
const mockUseRuntimeSelectorState = jest.fn();
const mockUseDeployStatusRest = jest.fn();
const mockBuildKnowledgeDiagramUrl = jest.fn();
const mockLoadKnowledgeDiagramPayload = jest.fn();
const mockUseSearchParams = jest.fn();
const mockUseDrawerAction = jest.fn();
const mockUseModalAction = jest.fn();
const mockUseRelationshipModal = jest.fn();

let capturedSidebarProps: any = null;
let capturedDiagramProps: any = null;
let capturedMetadataDrawerProps: any = null;

const setModelingStateOverrides = (overrides: Partial<Record<number, any>>) => {
  let callIndex = 0;
  const spy = jest.spyOn(React, 'useState' as any) as jest.SpyInstance;
  return spy.mockImplementation(((initial: any) => {
    callIndex += 1;
    if (Object.prototype.hasOwnProperty.call(overrides, callIndex)) {
      return [overrides[callIndex], jest.fn()];
    }
    return [typeof initial === 'function' ? initial() : initial, jest.fn()];
  }) as any);
};

jest.mock('next/dynamic', () => {
  const React = jest.requireActual('react');

  return () =>
    React.forwardRef((props: any, ref: any) => {
      capturedDiagramProps = props;
      React.useImperativeHandle(ref, () => ({
        fitView: jest.fn(),
        getNodes: jest.fn().mockReturnValue([]),
      }));
      return React.createElement(
        'div',
        null,
        props.readOnly ? 'DiagramReadonly' : 'DiagramWritable',
      );
    });
});

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockUseSearchParams(),
}));

jest.mock('antd', () => ({
  message: {
    info: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/components/reference/ConsoleShellLayout', () => ({
  __esModule: true,
  default: ({ title, description, children }: any) => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, title, description, children);
  },
}));

jest.mock('@/components/sidebar/Modeling', () => ({
  __esModule: true,
  default: (props: any) => {
    capturedSidebarProps = props;
    const React = jest.requireActual('react');
    return React.createElement(
      'div',
      null,
      props.readOnly ? 'SidebarReadonly' : 'SidebarWritable',
    );
  },
}));

jest.mock('@/components/pages/modeling/MetadataDrawer', () => ({
  __esModule: true,
  default: (props: any) => {
    capturedMetadataDrawerProps = props;
    const React = jest.requireActual('react');
    return React.createElement('div', null, 'MetadataDrawer');
  },
}));

jest.mock('@/components/pages/modeling/EditMetadataModal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/pages/modeling/ModelDrawer', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/modals/CalculatedFieldModal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/modals/RelationModal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/hooks/useProtectedRuntimeScopePage', () => ({
  __esModule: true,
  default: () => mockUseProtectedRuntimeScopePage(),
}));

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => mockUseRuntimeScopeNavigation(),
}));

jest.mock('@/hooks/useRuntimeSelectorState', () => ({
  __esModule: true,
  default: () => mockUseRuntimeSelectorState(),
}));

jest.mock('@/hooks/useDeployStatusRest', () => ({
  __esModule: true,
  default: () => mockUseDeployStatusRest(),
}));

jest.mock('@/hooks/useDrawerAction', () => ({
  __esModule: true,
  default: () => mockUseDrawerAction(),
}));

jest.mock('@/hooks/useModalAction', () => ({
  __esModule: true,
  default: () => mockUseModalAction(),
}));

jest.mock('@/hooks/useRelationshipModal', () => ({
  __esModule: true,
  default: () => mockUseRelationshipModal(),
}));

jest.mock('@/utils/knowledgeDiagramRest', () => ({
  buildKnowledgeDiagramUrl: (...args: any[]) =>
    mockBuildKnowledgeDiagramUrl(...args),
  loadKnowledgeDiagramPayload: (...args: any[]) =>
    mockLoadKnowledgeDiagramPayload(...args),
}));

jest.mock('@/utils/viewRest', () => ({
  deleteViewById: jest.fn(),
}));

describe('modeling page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedSidebarProps = null;
    capturedDiagramProps = null;
    capturedMetadataDrawerProps = null;

    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseProtectedRuntimeScopePage.mockReturnValue({
      guarding: false,
      hasRuntimeScope: true,
    });
    mockUseRuntimeScopeNavigation.mockReturnValue({
      push: jest.fn(),
      replace: jest.fn(),
      pushWorkspace: jest.fn(),
      selector: {
        workspaceId: 'ws-1',
        runtimeScopeId: 'scope-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      },
    });
    mockUseRuntimeSelectorState.mockReturnValue({
      provided: true,
      loading: false,
      refetch: jest.fn(),
      runtimeSelectorState: {
        currentKnowledgeBase: {
          id: 'kb-1',
          name: '订单分析知识库',
          defaultKbSnapshotId: 'snap-1',
        },
        currentKbSnapshot: {
          id: 'snap-1',
          displayName: '默认快照',
          deployHash: 'deploy-1',
          status: 'READY',
        },
      },
    });
    mockUseDeployStatusRest.mockReturnValue({
      data: undefined,
      loading: false,
      refetch: jest.fn().mockResolvedValue({
        data: {
          modelSync: {
            status: 'SYNCRONIZED',
          },
        },
      }),
      startPolling: jest.fn(),
      stopPolling: jest.fn(),
    });
    mockBuildKnowledgeDiagramUrl.mockReturnValue('/api/v1/knowledge/diagram');
    mockLoadKnowledgeDiagramPayload.mockResolvedValue({
      diagram: {
        models: [],
        views: [],
      },
    });
    mockUseDrawerAction.mockReturnValue({
      state: { visible: false, defaultValue: null },
      openDrawer: jest.fn(),
      closeDrawer: jest.fn(),
      updateState: jest.fn(),
    });
    mockUseModalAction.mockReturnValue({
      state: { visible: false, defaultValue: null },
      openModal: jest.fn(),
      closeModal: jest.fn(),
    });
    mockUseRelationshipModal.mockReturnValue({
      state: { visible: false, defaultValue: null },
      openModal: jest.fn(),
      onClose: jest.fn(),
    });
  });

  it('keeps modeling editable on the latest snapshot', () => {
    const useStateSpy = setModelingStateOverrides({
      1: {
        diagram: {
          models: [],
          views: [],
        },
      },
    });

    const markup = renderToStaticMarkup(<ModelingPage />);

    expect(capturedSidebarProps?.readOnly).toBe(false);
    expect(capturedDiagramProps?.readOnly).toBe(false);
    expect(capturedMetadataDrawerProps?.readOnly).toBe(false);
    expect(markup).not.toContain(
      '当前正在查看历史快照，仅支持浏览，不支持编辑或执行。',
    );
    expect(markup).toContain('SidebarWritable');
    expect(markup).toContain('DiagramWritable');

    useStateSpy.mockRestore();
  });

  it('marks modeling as readonly on historical snapshots', () => {
    mockUseRuntimeSelectorState.mockReturnValue({
      provided: true,
      loading: false,
      refetch: jest.fn(),
      runtimeSelectorState: {
        currentKnowledgeBase: {
          id: 'kb-1',
          name: '订单分析知识库',
          defaultKbSnapshotId: 'snap-latest',
        },
        currentKbSnapshot: {
          id: 'snap-old',
          displayName: '旧快照',
          deployHash: 'deploy-old',
          status: 'READY',
        },
      },
    });
    mockUseRuntimeScopeNavigation.mockReturnValue({
      push: jest.fn(),
      replace: jest.fn(),
      pushWorkspace: jest.fn(),
      selector: {
        workspaceId: 'ws-1',
        runtimeScopeId: 'scope-1',
        kbSnapshotId: 'snap-old',
        deployHash: 'deploy-old',
      },
    });

    const useStateSpy = setModelingStateOverrides({
      1: {
        diagram: {
          models: [],
          views: [],
        },
      },
    });

    const markup = renderToStaticMarkup(<ModelingPage />);

    expect(capturedSidebarProps?.readOnly).toBe(true);
    expect(capturedDiagramProps?.readOnly).toBe(true);
    expect(capturedMetadataDrawerProps?.readOnly).toBe(true);
    expect(markup).toContain(
      '当前正在查看历史快照，仅支持浏览，不支持编辑或执行。',
    );
    expect(markup).toContain('SidebarReadonly');
    expect(markup).toContain('DiagramReadonly');

    useStateSpy.mockRestore();
  });
});
