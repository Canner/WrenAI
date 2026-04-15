import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ModelingPage from '../../pages/modeling';

const mockUseProtectedRuntimeScopePage = jest.fn();
const mockUseRuntimeScopeNavigation = jest.fn();
const mockUseRuntimeSelectorStateQuery = jest.fn();
const mockUseDiagramQuery = jest.fn();
const mockUseDeployStatusQuery = jest.fn();
const mockUseSearchParams = jest.fn();
const mockUseDrawerAction = jest.fn();
const mockUseModalAction = jest.fn();
const mockUseRelationshipModal = jest.fn();

let capturedSidebarProps: any = null;
let capturedDiagramProps: any = null;
let capturedMetadataDrawerProps: any = null;

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

jest.mock('@/apollo/client/graphql/runtimeScope.generated', () => ({
  useRuntimeSelectorStateQuery: (...args: any[]) =>
    mockUseRuntimeSelectorStateQuery(...args),
}));

jest.mock('@/apollo/client/graphql/diagram.generated', () => ({
  useDiagramQuery: (...args: any[]) => mockUseDiagramQuery(...args),
}));

jest.mock('@/apollo/client/graphql/deploy.generated', () => ({
  useDeployStatusQuery: (...args: any[]) => mockUseDeployStatusQuery(...args),
}));

jest.mock('@/apollo/client/graphql/model.generated', () => ({
  useCreateModelMutation: () => [jest.fn(), { loading: false }],
  useDeleteModelMutation: () => [jest.fn()],
  useUpdateModelMutation: () => [jest.fn(), { loading: false }],
}));

jest.mock('@/apollo/client/graphql/metadata.generated', () => ({
  useUpdateModelMetadataMutation: () => [jest.fn(), { loading: false }],
  useUpdateViewMetadataMutation: () => [jest.fn(), { loading: false }],
}));

jest.mock('@/apollo/client/graphql/calculatedField.generated', () => ({
  useCreateCalculatedFieldMutation: () => [jest.fn(), { loading: false }],
  useUpdateCalculatedFieldMutation: () => [jest.fn(), { loading: false }],
  useDeleteCalculatedFieldMutation: () => [jest.fn()],
}));

jest.mock('@/apollo/client/graphql/relationship.generated', () => ({
  useCreateRelationshipMutation: () => [jest.fn(), { loading: false }],
  useDeleteRelationshipMutation: () => [jest.fn()],
  useUpdateRelationshipMutation: () => [jest.fn(), { loading: false }],
}));

jest.mock('@/utils/viewRest', () => ({
  deleteViewById: jest.fn(),
}));

const renderPage = () =>
  renderToStaticMarkup(React.createElement(ModelingPage));

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
      selector: {
        workspaceId: 'ws-1',
        runtimeScopeId: 'scope-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      },
    });
    mockUseRuntimeSelectorStateQuery.mockReturnValue({
      data: {
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
      },
    });
    mockUseDiagramQuery.mockReturnValue({
      data: {
        diagram: {
          models: [],
          views: [],
        },
      },
      refetch: jest.fn(),
    });
    mockUseDeployStatusQuery.mockReturnValue({
      refetch: jest.fn(),
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
    const markup = renderPage();

    expect(markup).not.toContain(
      '当前正在查看历史快照，仅支持浏览，不支持编辑或执行。',
    );
    expect(capturedSidebarProps?.readOnly).toBe(false);
    expect(capturedDiagramProps?.readOnly).toBe(false);
    expect(capturedMetadataDrawerProps?.readOnly).toBe(false);
    expect(markup).toContain('SidebarWritable');
    expect(markup).toContain('DiagramWritable');
  });

  it('marks modeling as readonly on historical snapshots', () => {
    mockUseRuntimeSelectorStateQuery.mockReturnValue({
      data: {
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
      },
    });

    const markup = renderPage();

    expect(markup).toContain(
      '当前正在查看历史快照，仅支持浏览，不支持编辑或执行。',
    );
    expect(capturedSidebarProps?.readOnly).toBe(true);
    expect(capturedDiagramProps?.readOnly).toBe(true);
    expect(capturedMetadataDrawerProps?.readOnly).toBe(true);
    expect(markup).toContain('SidebarReadonly');
    expect(markup).toContain('DiagramReadonly');
  });
});
