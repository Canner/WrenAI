import { buildKnowledgeWorkbenchActionsInputs } from './buildKnowledgeWorkbenchControllerActionsInputs';
import { buildKnowledgeWorkbenchRuleSqlInputs } from './buildKnowledgeWorkbenchControllerRuleSqlInputs';

const baseArgs = {
  activeKnowledgeBase: {
    id: 'kb-1',
    name: 'Demo KB',
    slug: 'demo-kb',
    workspaceId: 'ws-1',
  },
  activeKnowledgeRuntimeSelector: { workspaceId: 'ws-1' },
  buildRuntimeScopeUrl: (path: string) => path,
  canCreateKnowledgeBase: true,
  createKnowledgeBaseBlockedReason: '',
  currentKnowledgeBaseId: 'kb-1',
  isKnowledgeMutationDisabled: false,
  isReadonlyKnowledgeBase: false,
  isSnapshotReadonlyKnowledgeBase: false,
  kbForm: {} as any,
  loadKnowledgeBases: jest.fn(async () => []),
  pushRoute: jest.fn(),
  refetchRuntimeSelector: jest.fn(async () => undefined),
  resetAssetDraft: jest.fn(),
  router: { push: jest.fn() } as any,
  routerAsPath: '/knowledge',
  ruleForm: {} as any,
  ruleSqlCacheScopeKey: 'ws-1|kb-1',
  runtimeNavigationSelector: { workspaceId: 'ws-1' } as any,
  setAssetModalOpen: jest.fn(),
  setAssetWizardStep: jest.fn(),
  setDetailAsset: jest.fn(),
  setSelectedKnowledgeBaseId: jest.fn(),
  snapshotReadonlyHint: 'readonly',
  sqlTemplateForm: {} as any,
} as const;

describe('buildKnowledgeWorkbenchControllerOperationsInputs', () => {
  it('builds workbench actions inputs', () => {
    const inputs = buildKnowledgeWorkbenchActionsInputs(baseArgs as any);

    expect(inputs).toEqual(
      expect.objectContaining({
        currentKnowledgeBaseId: 'kb-1',
        snapshotReadonlyHint: 'readonly',
        resolveLifecycleActionLabel: expect.any(Function),
      }),
    );
  });

  it('builds rule/sql inputs', () => {
    const inputs = buildKnowledgeWorkbenchRuleSqlInputs(baseArgs as any);

    expect(inputs).toEqual({
      cacheScopeKey: 'ws-1|kb-1',
      runtimeSelector: { workspaceId: 'ws-1' },
      ruleForm: {},
      sqlTemplateForm: {},
    });
  });
});
