import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useKnowledgeWorkbenchSyncEffects from './useKnowledgeWorkbenchSyncEffects';

const mockUseKnowledgePendingSwitchSync = jest.fn();
const mockUseKnowledgeSwitchReset = jest.fn();
const mockUseKnowledgeActiveKnowledgeBaseSwitch = jest.fn();
const mockUseKnowledgeWorkbenchBootstrap = jest.fn();

jest.mock('@/hooks/useKnowledgePendingSwitchSync', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgePendingSwitchSync(...args),
}));

jest.mock('@/hooks/useKnowledgeSwitchReset', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeSwitchReset(...args),
}));

jest.mock('@/hooks/useKnowledgeActiveKnowledgeBaseSwitch', () => ({
  __esModule: true,
  default: (...args: any[]) =>
    mockUseKnowledgeActiveKnowledgeBaseSwitch(...args),
}));

jest.mock('./useKnowledgeWorkbenchBootstrap', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeWorkbenchBootstrap(...args),
}));

describe('useKnowledgeWorkbenchSyncEffects', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseKnowledgeSwitchReset.mockReturnValue(jest.fn());
  });

  const renderHookHarness = () => {
    const Harness = () => {
      useKnowledgeWorkbenchSyncEffects({
        activeKnowledgeBaseId: 'kb-1',
        activeKnowledgeSnapshotId: 'snapshot-1',
        currentKnowledgeBaseId: 'kb-1',
        hasRuntimeScope: true,
        loadRuleList: jest.fn(async () => undefined),
        loadSqlList: jest.fn(async () => undefined),
        pendingKnowledgeBaseId: 'kb-1',
        refetchReady: true,
        resetAssetDraft: jest.fn(),
        resetDetailViewState: jest.fn(),
        resetRuleSqlManagerState: jest.fn(),
        routeKnowledgeBaseId: 'kb-1',
        routeRuntimeSyncing: false,
        setAssetModalOpen: jest.fn(),
        setAssetWizardStep: jest.fn(),
        setDetailAsset: jest.fn(),
        setDraftAssets: jest.fn(),
        setPendingKnowledgeBaseId: jest.fn(),
        setSelectedConnectorId: jest.fn(),
        setSelectedDemoTable: jest.fn(),
        setSelectedKnowledgeBaseId: jest.fn(),
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));
  };

  it('wires pending-switch sync, reset effects and bootstrap orchestration', () => {
    renderHookHarness();

    expect(mockUseKnowledgePendingSwitchSync).toHaveBeenCalled();
    expect(mockUseKnowledgeSwitchReset).toHaveBeenCalled();
    expect(mockUseKnowledgeActiveKnowledgeBaseSwitch).toHaveBeenCalled();
    expect(mockUseKnowledgeWorkbenchBootstrap).toHaveBeenCalled();
  });
});
