import { buildKnowledgeWorkbenchControllerOperationsInputs } from './buildKnowledgeWorkbenchControllerInteractionOperationInputs';
import { buildKnowledgeWorkbenchControllerViewStateInputs } from './buildKnowledgeWorkbenchControllerInteractionViewInputs';

const baseArgs = {
  activeKnowledgeBase: {
    id: 'kb-1',
    name: 'Demo KB',
    slug: 'demo-kb',
    workspaceId: 'ws-1',
  },
  activeKnowledgeBaseExecutable: true,
  activeKnowledgeRuntimeSelector: { workspaceId: 'ws-1' },
  activeKnowledgeSnapshotId: 'snap-1',
  assetDraft: { name: '', description: '', important: true },
  assets: [],
  buildRuntimeScopeUrl: (path: string) => path,
  canCreateKnowledgeBase: true,
  createKnowledgeBaseBlockedReason: '',
  connectors: [],
  currentKnowledgeBaseId: 'kb-1',
  demoDatabaseOptions: [],
  demoTableOptions: [],
  detailAsset: null,
  detailFieldFilter: 'all',
  detailFieldKeyword: '',
  diagramData: { diagram: {} },
  diagramLoading: false,
  hasRuntimeScope: true,
  isDemoSource: false,
  isKnowledgeMutationDisabled: false,
  isReadonlyKnowledgeBase: false,
  isSnapshotReadonlyKnowledgeBase: false,
  kbForm: {} as any,
  knowledgeBases: [],
  knowledgeOwner: 'owner',
  knowledgeTab: 'workspace',
  loadKnowledgeBases: jest.fn(async () => []),
  overviewPreviewAsset: null,
  pendingKnowledgeBaseId: null,
  pushRoute: jest.fn(),
  refetchRuntimeSelector: jest.fn(async () => undefined),
  replaceWorkspace: jest.fn(async () => undefined),
  resetAssetDraft: jest.fn(),
  resetDetailViewState: jest.fn(),
  routeKnowledgeBaseId: 'kb-1',
  routeRuntimeSyncing: false,
  router: { push: jest.fn() } as any,
  routerAsPath: '/knowledge',
  routerQuery: { knowledgeBaseId: 'kb-1' },
  ruleForm: {} as any,
  ruleSqlCacheScopeKey: 'ws-1|kb-1',
  runtimeNavigationSelector: { workspaceId: 'ws-1' } as any,
  selectedConnectorId: undefined,
  selectedDemoKnowledge: null,
  selectedDemoTable: undefined,
  setAssetDraft: jest.fn(),
  setAssetModalOpen: jest.fn(),
  setAssetWizardStep: jest.fn(),
  setDetailAsset: jest.fn(),
  setDraftAssets: jest.fn(),
  setPendingKnowledgeBaseId: jest.fn(),
  setSelectedConnectorId: jest.fn(),
  setSelectedDemoTable: jest.fn(),
  setSelectedKnowledgeBaseId: jest.fn(),
  snapshotReadonlyHint: 'readonly',
  sqlTemplateForm: {} as any,
} as any;

describe('buildKnowledgeWorkbenchControllerInteractionInputs', () => {
  it('builds controller operation inputs', () => {
    const inputs = buildKnowledgeWorkbenchControllerOperationsInputs(baseArgs);

    expect(inputs).toEqual(
      expect.objectContaining({
        activeKnowledgeRuntimeSelector: { workspaceId: 'ws-1' },
        snapshotReadonlyHint: 'readonly',
        ruleSqlCacheScopeKey: 'ws-1|kb-1',
      }),
    );
  });

  it('builds controller view-state inputs from operations result', () => {
    const actions = {
      buildKnowledgeRuntimeSelector: jest.fn(() => ({ workspaceId: 'ws-1' })),
      openAssetWizard: jest.fn(),
    };
    const ruleSqlState = {
      loadRuleList: jest.fn(async () => []),
      loadSqlList: jest.fn(async () => []),
      resetRuleSqlManagerState: jest.fn(),
    };

    const inputs = buildKnowledgeWorkbenchControllerViewStateInputs(baseArgs, {
      actions,
      ruleSqlState,
    } as any);

    expect(inputs).toEqual(
      expect.objectContaining({
        actions,
        ruleSqlState,
        activeKnowledgeSnapshotId: 'snap-1',
      }),
    );
  });
});
