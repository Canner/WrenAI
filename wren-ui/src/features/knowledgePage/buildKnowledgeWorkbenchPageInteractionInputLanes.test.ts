import { buildKnowledgeWorkbenchPageInteractionContentInputs } from './buildKnowledgeWorkbenchPageInteractionContentInputs';
import { buildKnowledgeWorkbenchPageInteractionKnowledgeInputs } from './buildKnowledgeWorkbenchPageInteractionKnowledgeInputs';
import { buildKnowledgeWorkbenchPageInteractionLocalInputs } from './buildKnowledgeWorkbenchPageInteractionLocalInputs';

describe('buildKnowledgeWorkbenchPageInteractionInputLanes', () => {
  it('builds local-state inputs', () => {
    const inputs = buildKnowledgeWorkbenchPageInteractionLocalInputs({
      assetDraft: { name: '', description: '', important: true },
      detailAsset: null,
      detailFieldFilter: 'all',
      detailFieldKeyword: '',
      kbForm: {} as any,
      knowledgeTab: 'workspace',
      resetAssetDraft: jest.fn(),
      resetDetailViewState: jest.fn(),
      ruleForm: {} as any,
      setAssetDraft: jest.fn(),
      setAssetModalOpen: jest.fn(),
      setAssetWizardStep: jest.fn(),
      setDetailAsset: jest.fn(),
      setDraftAssets: jest.fn(),
      sqlTemplateForm: {} as any,
    });

    expect(inputs).toEqual(
      expect.objectContaining({
        detailFieldFilter: 'all',
        knowledgeTab: 'workspace',
      }),
    );
  });

  it('builds knowledge-state inputs', () => {
    const inputs = buildKnowledgeWorkbenchPageInteractionKnowledgeInputs({
      activeKnowledgeBase: {
        id: 'kb-1',
        name: 'Demo KB',
        slug: 'demo-kb',
        workspaceId: 'ws-1',
      },
      activeKnowledgeBaseExecutable: true,
      activeKnowledgeRuntimeSelector: { workspaceId: 'ws-1' },
      activeKnowledgeSnapshotId: 'snap-1',
      canCreateKnowledgeBase: true,
      createKnowledgeBaseBlockedReason: null,
      currentKnowledgeBaseId: 'kb-1',
      isKnowledgeMutationDisabled: false,
      isReadonlyKnowledgeBase: false,
      isSnapshotReadonlyKnowledgeBase: false,
      knowledgeBases: [],
      knowledgeOwner: 'owner',
      loadKnowledgeBases: jest.fn(async () => undefined),
      pendingKnowledgeBaseId: null,
      refetchRuntimeSelector: jest.fn(async () => undefined),
      routeKnowledgeBaseId: 'kb-1',
      ruleSqlCacheScopeKey: 'scope-1',
      setPendingKnowledgeBaseId: jest.fn(),
      setSelectedKnowledgeBaseId: jest.fn(),
    } as any);

    expect(inputs).toEqual(
      expect.objectContaining({
        activeKnowledgeSnapshotId: 'snap-1',
        ruleSqlCacheScopeKey: 'scope-1',
      }),
    );
  });

  it('builds content-state inputs', () => {
    const inputs = buildKnowledgeWorkbenchPageInteractionContentInputs({
      assets: [],
      connectors: [],
      demoDatabaseOptions: [],
      demoTableOptions: [],
      diagramData: { diagram: {} },
      diagramLoading: false,
      isDemoSource: false,
      overviewPreviewAsset: null,
      routeRuntimeSyncing: false,
      selectedConnectorId: undefined,
      selectedDemoKnowledge: null,
      selectedDemoTable: undefined,
      setSelectedConnectorId: jest.fn(),
      setSelectedDemoTable: jest.fn(),
    } as any);

    expect(inputs).toEqual(
      expect.objectContaining({
        diagramLoading: false,
        overviewPreviewAsset: null,
      }),
    );
  });
});
