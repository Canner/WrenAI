import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import KnowledgeWorkbenchPageFrame from './KnowledgeWorkbenchPageFrame';

jest.mock('@/components/reference/DirectShellPageFrame', () => ({
  __esModule: true,
  default: ({ children, flushBottomPadding, stretchContent }: any) => (
    <div
      data-shell
      data-flush-bottom={String(Boolean(flushBottomPadding))}
      data-stretch-content={String(Boolean(stretchContent))}
    >
      {children}
    </div>
  ),
}));

jest.mock('./sections/KnowledgeWorkbenchStage', () => ({
  __esModule: true,
  default: ({ loading }: any) => <div data-stage>{String(loading)}</div>,
}));

describe('KnowledgeWorkbenchPageFrame', () => {
  it('wraps the workbench stage inside the direct shell frame', () => {
    const html = renderToStaticMarkup(
      <KnowledgeWorkbenchPageFrame
        loading={false}
        sidebarProps={{
          knowledgeTab: 'workspace',
          onChangeKnowledgeTab: jest.fn(),
          visibleKnowledgeItems: [],
          visibleKnowledgeBaseId: 'kb-1',
          activeKnowledgeBaseId: 'kb-1',
          activeAssetCount: 0,
          switchKnowledgeBase: jest.fn(),
          buildKnowledgeSwitchUrl: jest.fn(() => '/knowledge'),
          canCreateKnowledgeBase: true,
          createKnowledgeBaseBlockedReason: '',
          onCreateKnowledgeBase: jest.fn(),
        }}
        mainStageProps={{
          activeWorkbenchSection: 'overview',
          onChangeWorkbenchSection: jest.fn(),
          previewFieldCount: 0,
          isSnapshotReadonlyKnowledgeBase: false,
          isReadonlyKnowledgeBase: false,
          isKnowledgeMutationDisabled: false,
          knowledgeMutationHint: null,
          knowledgeDescription: null,
          showKnowledgeAssetsLoading: false,
          detailAssets: [],
          activeDetailAsset: null,
          detailTab: 'overview',
          detailFieldKeyword: '',
          detailFieldFilter: 'all',
          detailAssetFields: [],
          onOpenAssetWizard: jest.fn(),
          onOpenKnowledgeEditor: jest.fn(),
          onOpenAssetDetail: jest.fn(),
          onCloseAssetDetail: jest.fn(),
          onChangeDetailTab: jest.fn(),
          onChangeFieldKeyword: jest.fn(),
          onChangeFieldFilter: jest.fn(),
          historicalSnapshotReadonlyHint: 'readonly',
          ruleList: [],
          sqlList: [],
          ruleManageLoading: false,
          sqlManageLoading: false,
          onOpenRuleDetail: jest.fn(),
          onOpenSqlTemplateDetail: jest.fn(),
          onDeleteRule: jest.fn(),
          onDeleteSqlTemplate: jest.fn(),
          editingInstruction: null,
          editingSqlPair: null,
          ruleForm: {} as any,
          sqlTemplateForm: {} as any,
          createInstructionLoading: false,
          updateInstructionLoading: false,
          createSqlPairLoading: false,
          updateSqlPairLoading: false,
          onSubmitRuleDetail: jest.fn(),
          onSubmitSqlTemplateDetail: jest.fn(),
          onResetRuleDetailEditor: jest.fn(),
          onResetSqlTemplateEditor: jest.fn(),
          modelingWorkspaceKey: 'key',
          modelingSummary: { modelCount: 0, viewCount: 0, relationCount: 0 },
          onOpenModeling: jest.fn(),
        }}
        overlaysProps={{
          knowledgeBaseModalProps: {
            visible: false,
            editingKnowledgeBase: null,
            form: {} as any,
            canSaveKnowledgeBase: false,
            creatingKnowledgeBase: false,
            onCancel: jest.fn(),
            onSave: jest.fn(),
          },
          assetWizardModalProps: {
            visible: false,
            assetWizardStep: 0,
            onChangeAssetWizardStep: jest.fn(),
            activeKnowledgeBase: null,
            knowledgeBases: [],
            sourceOptions: [],
            selectedSourceType: 'database',
            setSelectedSourceType: jest.fn(),
            isDemoSource: false,
            connectorsLoading: false,
            selectedDemoKnowledge: null,
            selectedConnectorId: undefined,
            setSelectedConnectorId: jest.fn(),
            selectedDemoTable: undefined,
            setSelectedDemoTable: jest.fn(),
            assetDatabaseOptions: [],
            assetTableOptions: [],
            canContinueAssetWizard: false,
            moveAssetWizardToConfig: jest.fn(),
            assetDraft: { name: '', description: '', important: true },
            setAssetDraft: jest.fn(),
            assetDraftPreview: null,
            assetDraftPreviews: [],
            canContinueAssetConfiguration: false,
            commitAssetDraftToOverview: jest.fn(),
            savingAssetDraft: false,
            displayKnowledgeName: 'KB',
            closeAssetModal: jest.fn(),
            onNavigateModeling: jest.fn(),
          },
        }}
      />,
    );

    expect(html).toContain('data-shell');
    expect(html).toContain('data-flush-bottom="true"');
    expect(html).toContain('data-stretch-content="true"');
    expect(html).toContain('data-stage');
  });
});
