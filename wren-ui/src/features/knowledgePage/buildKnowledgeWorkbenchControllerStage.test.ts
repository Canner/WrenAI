import { buildKnowledgeWorkbenchControllerStage } from './buildKnowledgeWorkbenchControllerStage';

describe('buildKnowledgeWorkbenchControllerStage', () => {
  it('maps grouped controller state into page stage props', () => {
    const switchKnowledgeBase = jest.fn();
    const result = buildKnowledgeWorkbenchControllerStage({
      actions: {
        buildKnowledgeRuntimeSelector: jest.fn(),
        closeAssetModal: jest.fn(),
        closeKnowledgeBaseModal: jest.fn(),
        creatingKnowledgeBase: false,
        editingKnowledgeBase: null,
        handleSaveKnowledgeBase: jest.fn(),
        kbModalOpen: true,
        openConnectorConsole: jest.fn(),
        openCreateKnowledgeBaseModal: jest.fn(),
        openEditKnowledgeBaseModal: jest.fn(),
      },
      contentData: {
        canContinueAssetWizard: true,
        connectorsLoading: false,
        isDemoSource: false,
        previewFieldCount: 4,
        selectedConnectorId: 'connector-1',
        selectedDemoKnowledge: null,
        selectedDemoTable: 'orders',
        selectedSourceType: 'database',
        setSelectedConnectorId: jest.fn(),
        setSelectedDemoTable: jest.fn(),
        setSelectedSourceType: jest.fn(),
      },
      knowledgeState: {
        activeKnowledgeBase: {
          id: 'kb-1',
          name: 'Revenue',
          slug: 'revenue',
          workspaceId: 'ws-1',
        },
        canCreateKnowledgeBase: true,
        createKnowledgeBaseBlockedReason: null,
        displayKnowledgeName: 'Revenue',
        isKnowledgeMutationDisabled: false,
        isReadonlyKnowledgeBase: false,
        isSnapshotReadonlyKnowledgeBase: false,
        knowledgeBases: [],
        knowledgeDescription: 'Demo',
        knowledgeMutationHint: null,
        knowledgeSourceOptions: [],
        switchKnowledgeBase,
      },
      localState: {
        canSaveKnowledgeBase: true,
        knowledgeTab: 'workspace',
        setKnowledgeTab: jest.fn(),
        detailTab: 'overview',
        detailFieldKeyword: 'order',
        detailFieldFilter: 'all',
        setDetailTab: jest.fn(),
        setDetailFieldKeyword: jest.fn(),
        setDetailFieldFilter: jest.fn(),
        kbForm: {} as any,
        ruleForm: {} as any,
        sqlTemplateForm: {} as any,
        assetModalOpen: true,
        assetWizardStep: 1,
        setAssetWizardStep: jest.fn(),
        assetDraft: { name: 'orders', description: '', important: true },
        setAssetDraft: jest.fn(),
      },
      modelingState: {
        committedModelingWorkspaceKey: 'kb-1:snap-1:deploy-1',
        modelingSummary: {
          modelCount: 3,
          relationCount: 2,
          viewCount: 1,
        },
      },
      ruleSqlState: {
        createInstructionLoading: false,
        createSqlPairLoading: false,
        editingInstruction: null,
        editingSqlPair: null,
        handleDeleteRule: jest.fn(),
        handleDeleteSqlTemplate: jest.fn(),
        openRuleDetail: jest.fn(),
        openSqlTemplateDetail: jest.fn(),
        resetRuleDetailEditor: jest.fn(),
        resetSqlTemplateEditor: jest.fn(),
        ruleList: [{ id: 'rule-1' }],
        ruleManageLoading: false,
        sqlList: [{ id: 'sql-1' }],
        sqlManageLoading: false,
        submitRuleDetail: jest.fn(),
        submitSqlTemplateDetail: jest.fn(),
        updateInstructionLoading: false,
        updateSqlPairLoading: false,
      },
      viewState: {
        activeDetailAsset: null,
        activeWorkbenchSection: 'overview',
        assetDatabaseOptions: [],
        assetDraftPreview: null,
        assetTableOptions: [],
        buildKnowledgeSwitchUrl: jest.fn(
          () => '/knowledge?knowledgeBaseId=kb-1',
        ),
        canContinueAssetConfiguration: true,
        commitAssetDraftToOverview: jest.fn(),
        detailAssetFields: [],
        detailAssets: [
          {
            id: 'asset-1',
            name: 'orders',
            kind: 'model',
            fieldCount: 3,
            fields: [],
          },
        ],
        handleChangeWorkbenchSection: jest.fn(),
        handleCloseAssetDetail: jest.fn(),
        handleNavigateModeling: jest.fn(),
        handleOpenAssetWizard: jest.fn(),
        moveAssetWizardToConfig: jest.fn(),
        openAssetDetail: jest.fn(),
        showKnowledgeAssetsLoading: false,
        visibleKnowledgeBaseId: 'kb-1',
        visibleKnowledgeItems: [],
      },
    });

    expect(result.sidebarProps.switchKnowledgeBase).toBe(switchKnowledgeBase);
    expect(result.sidebarProps.activeAssetCount).toBe(1);
    expect(result.mainStageProps.modelingWorkspaceKey).toBe(
      'kb-1:snap-1:deploy-1',
    );
    expect(result.mainStageProps.previewFieldCount).toBe(4);
    expect(
      result.overlaysProps.knowledgeBaseModalProps?.canSaveKnowledgeBase,
    ).toBe(true);
    expect(result.overlaysProps.assetWizardModalProps?.selectedSourceType).toBe(
      'database',
    );
  });
});
