import { buildKnowledgeWorkbenchPageInteractionArgs } from './buildKnowledgeWorkbenchPageControllerInteractionArgs';
import { buildKnowledgeWorkbenchPageStageArgs } from './buildKnowledgeWorkbenchPageStageArgs';

const localState = {
  assetDraft: { name: 'orders', description: '', important: true },
  assetModalOpen: true,
  assetWizardStep: 1,
  detailAsset: { id: 'asset-1', name: 'orders' },
  detailFieldFilter: 'all',
  detailFieldKeyword: 'order',
  detailTab: 'overview',
  draftAssets: [{ id: 'asset-1', name: 'orders' }],
  kbForm: {} as any,
  kbNameValue: 'Revenue',
  knowledgeTab: 'workspace',
  resetAssetDraft: jest.fn(),
  resetDetailViewState: jest.fn(),
  ruleForm: {} as any,
  setAssetDraft: jest.fn(),
  setAssetModalOpen: jest.fn(),
  setAssetWizardStep: jest.fn(),
  setDetailAsset: jest.fn(),
  setDetailFieldFilter: jest.fn(),
  setDetailFieldKeyword: jest.fn(),
  setDetailTab: jest.fn(),
  setDraftAssets: jest.fn(),
  setKnowledgeTab: jest.fn(),
  sqlTemplateForm: {} as any,
} as any;

const controllerDataState = {
  contentData: { previewFieldCount: 4 },
  knowledgeState: { activeKnowledgeBase: { id: 'kb-1' } },
  modelingState: { committedModelingWorkspaceKey: 'ws:key' },
} as any;

const interactionState = {
  actions: { openCreateKnowledgeBaseModal: jest.fn() },
  ruleSqlState: { ruleList: [] },
  viewState: { activeWorkbenchSection: 'overview' },
} as any;

describe('knowledge workbench page-controller builders', () => {
  it('builds page-interaction args with only the interaction local-state subset', () => {
    const args = buildKnowledgeWorkbenchPageInteractionArgs({
      buildRuntimeScopeUrl: (path: string) => path,
      controllerDataState,
      hasRuntimeScope: true,
      localState,
      pushRoute: jest.fn(),
      replaceWorkspace: jest.fn(),
      router: { asPath: '/knowledge', query: {} },
      routerAsPath: '/knowledge',
      routerQuery: { knowledgeBaseId: 'kb-1' },
      runtimeNavigationSelector: { workspaceId: 'ws-1' },
      snapshotReadonlyHint: 'readonly',
    } as any);

    expect(args.localState).toEqual(
      expect.objectContaining({
        assetDraft: localState.assetDraft,
        detailAsset: localState.detailAsset,
        kbForm: localState.kbForm,
        sqlTemplateForm: localState.sqlTemplateForm,
      }),
    );
    expect(args.localState).not.toHaveProperty('kbNameValue');
    expect(args.localState).not.toHaveProperty('assetModalOpen');
  });

  it('builds stage args from controller data, interaction state, and save capability', () => {
    const args = buildKnowledgeWorkbenchPageStageArgs({
      canSaveKnowledgeBase: true,
      controllerDataState,
      interactionState,
      localState,
    });

    expect(args).toEqual(
      expect.objectContaining({
        actions: interactionState.actions,
        contentData: controllerDataState.contentData,
        knowledgeState: controllerDataState.knowledgeState,
        modelingState: controllerDataState.modelingState,
        ruleSqlState: interactionState.ruleSqlState,
        viewState: interactionState.viewState,
      }),
    );
    expect(args.localState.canSaveKnowledgeBase).toBe(true);
    expect(args.localState.knowledgeTab).toBe('workspace');
  });
});
