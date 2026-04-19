import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useSkillsPageData from './useSkillsPageData';

const mockUseProtectedRuntimeScopePage = jest.fn();
const mockUseRuntimeScopeNavigation = jest.fn();
const mockUseRuntimeSelectorState = jest.fn();
const mockUseSkillsControlPlaneData = jest.fn();
const mockUseSkillConnectors = jest.fn();

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

jest.mock('@/hooks/useSkillsControlPlaneData', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseSkillsControlPlaneData(...args),
}));

jest.mock('./useSkillConnectors', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseSkillConnectors(...args),
}));

describe('useSkillsPageData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseProtectedRuntimeScopePage.mockReturnValue({
      guarding: false,
      hasRuntimeScope: true,
    });
    mockUseRuntimeScopeNavigation.mockReturnValue({
      selector: { workspaceId: 'workspace-1' },
      hrefWorkspace: jest.fn((path: string) => `workspace:${path}`),
    });
    mockUseRuntimeSelectorState.mockReturnValue({
      runtimeSelectorState: {
        currentWorkspace: { id: 'workspace-1', name: 'Demo Workspace' },
        currentKnowledgeBase: { id: 'kb-1', name: 'Sales KB' },
        currentKbSnapshot: { id: 'snap-1' },
        kbSnapshots: [],
      },
    });
    mockUseSkillsControlPlaneData.mockReturnValue({
      data: {
        marketplaceCatalogSkills: [{ id: 'catalog-1', name: 'Revenue Helper' }],
        skillDefinitions: [
          { id: 'skill-1', catalogId: 'catalog-1', isEnabled: true },
          { id: 'skill-2', catalogId: 'catalog-2', isEnabled: false },
          { id: 'skill-3', catalogId: null, isEnabled: true },
        ],
      },
      loading: false,
      refetch: jest.fn().mockResolvedValue(undefined),
    });
    mockUseSkillConnectors.mockReturnValue({
      connectors: [
        {
          id: 'connector-1',
          workspaceId: 'workspace-1',
          type: 'postgres',
          displayName: 'Warehouse',
        },
      ],
      loading: false,
    });
  });

  const renderHookHarness = (): ReturnType<typeof useSkillsPageData> => {
    let current: ReturnType<typeof useSkillsPageData> | null = null;

    const Harness = () => {
      current = useSkillsPageData();
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error('Failed to initialize useSkillsPageData');
    }

    return current as ReturnType<typeof useSkillsPageData>;
  };

  it('derives connector options, catalog ids, enabled count, and refresh action', async () => {
    const hookValue = renderHookHarness();

    expect(hookValue.runtimeScopePage.hasRuntimeScope).toBe(true);
    expect(hookValue.runtimeSelectorState?.currentWorkspace?.id).toBe(
      'workspace-1',
    );
    expect(hookValue.marketplaceCatalogSkills).toHaveLength(1);
    expect(hookValue.skillDefinitions).toHaveLength(3);
    expect([...hookValue.installedCatalogIds]).toEqual([
      'catalog-1',
      'catalog-2',
    ]);
    expect(hookValue.enabledSkillCount).toBe(2);
    expect(hookValue.connectorOptions).toEqual([
      { label: '无连接器', value: '' },
      { label: 'Warehouse (postgres)', value: 'connector-1' },
    ]);
    expect(hookValue.connectorsHref).toBe('workspace:/settings/connectors');

    await hookValue.refresh();

    expect(
      mockUseSkillsControlPlaneData.mock.results[0].value.refetch,
    ).toHaveBeenCalledTimes(1);
  });

  it('passes runtime scope selector and enabled state to data loaders', () => {
    renderHookHarness();

    expect(mockUseSkillsControlPlaneData).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        runtimeScopeSelector: { workspaceId: 'workspace-1' },
      }),
    );
    expect(mockUseSkillConnectors).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        runtimeScopeSelector: { workspaceId: 'workspace-1' },
      }),
    );
  });
});
