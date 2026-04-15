import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { Form, Radio, Skeleton, Space } from 'antd';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import { buildRuntimeScopeUrl } from '@/apollo/client/runtimeScope';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import DolaAppShell from '@/components/reference/DolaAppShell';
import { usePersistentShellEmbedded } from '@/components/reference/PersistentShellContext';
import { buildNovaShellNavItems } from '@/components/reference/novaShellNavigation';
import useAuthSession from '@/hooks/useAuthSession';
import useKnowledgeAssetDetail from '@/hooks/useKnowledgeAssetDetail';
import useKnowledgeAssetDraftState from '@/hooks/useKnowledgeAssetDraftState';
import useKnowledgeActiveKnowledgeBaseSwitch from '@/hooks/useKnowledgeActiveKnowledgeBaseSwitch';
import useKnowledgeAssets from '@/hooks/useKnowledgeAssets';
import useKnowledgeAssetInteractions from '@/hooks/useKnowledgeAssetInteractions';
import useKnowledgeAssetSelectOptions from '@/hooks/useKnowledgeAssetSelectOptions';
import useKnowledgeAssetWizard from '@/hooks/useKnowledgeAssetWizard';
import useKnowledgeBaseListCache from '@/hooks/useKnowledgeBaseListCache';
import useKnowledgeBaseLifecycle from '@/hooks/useKnowledgeBaseLifecycle';
import useKnowledgeBaseMeta from '@/hooks/useKnowledgeBaseMeta';
import useKnowledgeBaseModal from '@/hooks/useKnowledgeBaseModal';
import useKnowledgeConnectors from '@/hooks/useKnowledgeConnectors';
import useKnowledgeDataLoaders from '@/hooks/useKnowledgeDataLoaders';
import useKnowledgeDerivedCollections from '@/hooks/useKnowledgeDerivedCollections';
import useKnowledgeDetailViewState from '@/hooks/useKnowledgeDetailViewState';
import useKnowledgeDiagramData from '@/hooks/useKnowledgeDiagramData';
import {
  canShowKnowledgeLifecycleAction,
  getKnowledgeLifecycleActionLabel,
  resolveKnowledgeNavBadgeCount,
  resolveVisibleKnowledgeBaseId,
  shouldCommitPendingKnowledgeBaseSwitch,
  shouldRouteSwitchKnowledgeBase,
  shouldShowKnowledgeAssetsLoading,
} from '@/hooks/useKnowledgePageHelpers';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import useKnowledgeBaseSelection from '@/hooks/useKnowledgeBaseSelection';
import useKnowledgePendingSwitchSync from '@/hooks/useKnowledgePendingSwitchSync';
import useKnowledgePageActions, {
  resolveKnowledgeRuntimeSelector,
} from '@/hooks/useKnowledgePageActions';
import useKnowledgeRouteActions from '@/hooks/useKnowledgeRouteActions';
import useKnowledgeRuleSqlManager, {
  type RuleDetailFormValues,
  type SqlTemplateFormValues,
} from '@/hooks/useKnowledgeRuleSqlManager';
import useKnowledgeRuleSqlMutations from '@/hooks/useKnowledgeRuleSqlMutations';
import useKnowledgeRuntimeContext from '@/hooks/useKnowledgeRuntimeContext';
import useKnowledgeSelectorFallback from '@/hooks/useKnowledgeSelectorFallback';
import useKnowledgeSummaryActions from '@/hooks/useKnowledgeSummaryActions';
import useKnowledgeSwitchReset from '@/hooks/useKnowledgeSwitchReset';
import useKnowledgeSidebarData from '@/hooks/useKnowledgeSidebarData';
import { shouldSyncKnowledgeRuntimeScopeData } from '@/hooks/useKnowledgeRuntimeSync';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useRuntimeScopeTransition from '@/hooks/useRuntimeScopeTransition';
import { Path } from '@/utils/enum';
import { HISTORICAL_SNAPSHOT_READONLY_HINT } from '@/utils/runtimeSnapshot';
import {
  RailTabs,
  KbList,
  KbCreateButton,
  KbCreateInlineWrap,
  LibraryStage,
  WorkbenchGrid,
  SidePanel,
} from './index.styles';
import {
  blurActiveElement,
  CONNECTOR_SOURCE_OPTIONS,
  KNOWLEDGE_TABS,
  openModalSafely,
  resolveReferenceOwner,
} from './constants';
import AssetDetailModal from './assetDetailModal';
import AssetWizardModal from './assetWizardModal';
import KnowledgeBaseModal from './knowledgeBaseModal';
import { SidebarKnowledgeList } from './lists';
import KnowledgeMainStage from './mainStage';
import RuleSqlModals from './ruleSqlModals';
import type { AssetView, ConnectorView, KnowledgeBaseRecord } from './types';

export {
  canShowKnowledgeLifecycleAction,
  getKnowledgeLifecycleActionLabel,
  resolveKnowledgeNavBadgeCount,
  resolveVisibleKnowledgeBaseId,
  shouldCommitPendingKnowledgeBaseSwitch,
  shouldRouteSwitchKnowledgeBase,
  shouldShowKnowledgeAssetsLoading,
};
export { shouldSyncKnowledgeRuntimeScopeData };

export default function KnowledgeHomePage() {
  const router = useRouter();
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopeTransition = useRuntimeScopeTransition();
  const authSession = useAuthSession();
  const persistentShellEmbedded = usePersistentShellEmbedded();
  const homeSidebar = useHomeSidebar({
    deferInitialLoad: true,
    loadOnIntent: true,
    disabled: persistentShellEmbedded,
  });
  const [knowledgeTab, setKnowledgeTab] = useState('workspace');
  const [assetModalOpen, setAssetModalOpen] = useState(false);
  const [assetWizardStep, setAssetWizardStep] = useState(0);
  const [detailAsset, setDetailAsset] = useState<AssetView | null>(null);
  const [draftAssets, setDraftAssets] = useState<AssetView[]>([]);
  const { assetDraft, setAssetDraft, resetAssetDraft } =
    useKnowledgeAssetDraftState();
  const {
    detailTab,
    setDetailTab,
    detailFieldKeyword,
    setDetailFieldKeyword,
    detailFieldFilter,
    setDetailFieldFilter,
    resetDetailViewState,
  } = useKnowledgeDetailViewState();
  const [kbForm] = Form.useForm<{ name: string; description?: string }>();
  const [ruleForm] = Form.useForm<RuleDetailFormValues>();
  const [sqlTemplateForm] = Form.useForm<SqlTemplateFormValues>();
  const kbNameValue = Form.useWatch('name', kbForm);

  const runtimeSelector = useRuntimeSelectorState();
  const refetchRuntimeSelector = runtimeSelector.refetch;
  const runtimeSelectorState = runtimeSelector.runtimeSelectorState;
  const currentWorkspace = runtimeSelectorState?.currentWorkspace || null;
  const {
    effectiveRuntimeSelector,
    currentKnowledgeBaseId,
    currentKbSnapshotId,
    routeKnowledgeBaseId,
    routeKbSnapshotId,
  } = useKnowledgeRuntimeContext({
    routerQuery: router.query as Record<string, string | string[] | undefined>,
    routerReady: router.isReady,
    hasRuntimeScope: runtimeScopePage.hasRuntimeScope,
    runtimeSelectorState,
  });
  const { knowledgeBasesUrl, cachedKnowledgeBaseList } =
    useKnowledgeBaseListCache<KnowledgeBaseRecord>({
      hasRuntimeScope: runtimeScopePage.hasRuntimeScope,
      workspaceId: currentWorkspace?.id,
    });
  const selectorKnowledgeBaseFallback = useKnowledgeSelectorFallback({
    runtimeSelectorState,
    routeKnowledgeBaseId,
    effectiveWorkspaceId: effectiveRuntimeSelector.workspaceId,
    currentWorkspaceId: currentWorkspace?.id,
    routeKbSnapshotId,
    currentKbSnapshotId,
  });
  const {
    fetchKnowledgeBaseList,
    handleKnowledgeBaseLoadError,
    fetchConnectors,
    handleConnectorLoadError,
  } = useKnowledgeDataLoaders<KnowledgeBaseRecord, ConnectorView>({
    buildRuntimeScopeUrl,
  });
  const {
    knowledgeBases,
    selectedKnowledgeBaseId,
    pendingKnowledgeBaseId,
    setSelectedKnowledgeBaseId,
    setPendingKnowledgeBaseId,
    loadKnowledgeBases,
    switchKnowledgeBase,
  } = useKnowledgeBaseSelection<KnowledgeBaseRecord>({
    hasRuntimeScope: runtimeScopePage.hasRuntimeScope,
    knowledgeBasesUrl,
    cachedKnowledgeBases: cachedKnowledgeBaseList,
    routeKnowledgeBaseId,
    currentKnowledgeBaseId,
    currentPath: router.asPath,
    fetchKnowledgeBases: fetchKnowledgeBaseList,
    transitionTo: runtimeScopeTransition.transitionTo,
    shouldRouteSwitchKnowledgeBase: shouldRouteSwitchKnowledgeBase,
    onLoadError: handleKnowledgeBaseLoadError,
  });
  useKnowledgePendingSwitchSync({
    currentKnowledgeBaseId,
    routeKnowledgeBaseId,
    pendingKnowledgeBaseId,
    routeRuntimeSyncing: false,
    shouldCommitPendingSwitch: shouldCommitPendingKnowledgeBaseSwitch,
    setSelectedKnowledgeBaseId,
    setPendingKnowledgeBaseId,
  });
  const {
    activeKnowledgeBase,
    activeKnowledgeBaseExecutable,
    canCreateKnowledgeBase,
    createKnowledgeBaseBlockedReason,
    isReadonlyKnowledgeBase,
    isSnapshotReadonlyKnowledgeBase,
    isKnowledgeMutationDisabled,
    canManageKnowledgeBaseLifecycle,
    knowledgeLifecycleActionLabel,
    knowledgeMutationHint,
    matchedDemoKnowledge,
    knowledgeDescription,
    knowledgeOwner,
    displayKnowledgeName,
  } = useKnowledgeBaseMeta<KnowledgeBaseRecord>({
    knowledgeBases,
    selectedKnowledgeBaseId,
    routeKnowledgeBaseId,
    currentKnowledgeBaseId,
    selectorKnowledgeBaseFallback,
    routeKbSnapshotId,
    currentKbSnapshotId,
    workspaceKind: authSession.data?.workspace?.kind,
    roleKey: authSession.data?.membership?.roleKey,
    authorizationActions: authSession.data?.authorization?.actions,
    snapshotReadonlyHint: HISTORICAL_SNAPSHOT_READONLY_HINT,
    canShowKnowledgeLifecycleAction,
    resolveLifecycleActionLabel: getKnowledgeLifecycleActionLabel,
    resolveReferenceOwner,
  });
  const activeKnowledgeRuntimeSelector = useMemo(
    () =>
      resolveKnowledgeRuntimeSelector({
        knowledgeBase: activeKnowledgeBase,
        fallbackSelector: {
          workspaceId:
            effectiveRuntimeSelector.workspaceId ||
            runtimeScopeNavigation.selector.workspaceId,
        },
      }),
    [
      activeKnowledgeBase,
      effectiveRuntimeSelector.workspaceId,
      runtimeScopeNavigation.selector.workspaceId,
    ],
  );
  const {
    createInstructionLoading,
    updateInstructionLoading,
    createSqlPairLoading,
    updateSqlPairLoading,
    createInstruction,
    updateInstruction,
    deleteInstruction,
    createSqlPair,
    updateSqlPair,
    deleteSqlPair,
    refetchInstructions,
    refetchSqlPairs,
  } = useKnowledgeRuleSqlMutations(activeKnowledgeRuntimeSelector);
  const activeKnowledgeSnapshotId =
    activeKnowledgeBase?.defaultKbSnapshot?.id ||
    activeKnowledgeBase?.defaultKbSnapshotId ||
    null;
  const {
    connectors,
    connectorsLoading,
    selectedSourceType,
    setSelectedSourceType,
    selectedConnectorId,
    setSelectedConnectorId,
    selectedDemoTable,
    setSelectedDemoTable,
    selectedDemoKnowledge,
    isDemoSource,
    demoDatabaseOptions,
    demoTableOptions,
    canContinueAssetWizard,
  } = useKnowledgeConnectors<ConnectorView>({
    hasRuntimeScope: runtimeScopePage.hasRuntimeScope,
    activeKnowledgeBaseId: activeKnowledgeBase?.id,
    activeKbSnapshotId: activeKnowledgeSnapshotId,
    connectorRuntimeSelector: activeKnowledgeRuntimeSelector,
    assetModalOpen,
    sourceOptions: CONNECTOR_SOURCE_OPTIONS,
    fetchConnectors,
    onLoadError: handleConnectorLoadError,
  });
  const { diagramData, diagramLoading } = useKnowledgeDiagramData({
    hasRuntimeScope: runtimeScopePage.hasRuntimeScope,
    routeKnowledgeBaseId: activeKnowledgeBase?.id || undefined,
    routeKbSnapshotId: activeKnowledgeSnapshotId || undefined,
    effectiveRuntimeSelector: activeKnowledgeRuntimeSelector,
  });
  const routeRuntimeSyncing = false;

  const canSaveKnowledgeBase = Boolean(kbNameValue?.trim());
  const { assets, overviewPreviewAsset, previewFieldCount } =
    useKnowledgeAssets({
      activeKnowledgeBaseName: activeKnowledgeBase?.name,
      hasActiveKnowledgeBase: Boolean(activeKnowledgeBase),
      activeKnowledgeBaseUsesRuntime: activeKnowledgeBaseExecutable,
      diagramData,
      draftAssets,
      knowledgeOwner,
      matchedDemoKnowledge,
    });
  const {
    kbModalOpen,
    editingKnowledgeBase,
    closeKnowledgeBaseModal,
    openCreateKnowledgeBaseModal,
    openEditKnowledgeBaseModal,
  } = useKnowledgeBaseModal<KnowledgeBaseRecord>({
    canCreateKnowledgeBase,
    createKnowledgeBaseBlockedReason,
    isKnowledgeMutationDisabled,
    isSnapshotReadonlyKnowledgeBase,
    snapshotReadonlyHint: HISTORICAL_SNAPSHOT_READONLY_HINT,
    isReadonlyKnowledgeBase,
    activeKnowledgeBase,
    kbForm,
    openModalSafely,
  });
  const {
    closeAssetModal,
    openConnectorConsole,
    openAssetWizard,
    buildKnowledgeSwitchUrl,
    buildKnowledgeRuntimeSelector,
  } = useKnowledgePageActions({
    activeKnowledgeBase,
    runtimeNavigationSelector: activeKnowledgeRuntimeSelector,
    buildRuntimeScopeUrl,
    pushRoute: (url) => router.push(url, undefined, { scroll: false }),
    isKnowledgeMutationDisabled,
    isSnapshotReadonlyKnowledgeBase,
    snapshotReadonlyHint: HISTORICAL_SNAPSHOT_READONLY_HINT,
    openModalSafely,
    setAssetModalOpen,
    setAssetWizardStep,
    resetAssetDraft,
  });

  const { replaceKnowledgeRoute, clearDetailAsset } =
    useKnowledgeRouteActions<AssetView>({
      router,
      setDetailAsset,
    });
  const {
    creatingKnowledgeBase,
    knowledgeLifecycleSubmitting,
    handleSaveKnowledgeBase,
    handleToggleKnowledgeArchive,
  } = useKnowledgeBaseLifecycle<KnowledgeBaseRecord>({
    editingKnowledgeBase,
    activeKnowledgeBase,
    kbForm,
    closeKnowledgeBaseModal,
    loadKnowledgeBases,
    refetchRuntimeSelector,
    setSelectedKnowledgeBaseId,
    clearDetailAsset,
    currentKnowledgeBaseId,
    canManageKnowledgeBaseLifecycle,
    isSnapshotReadonlyKnowledgeBase,
    snapshotReadonlyHint: HISTORICAL_SNAPSHOT_READONLY_HINT,
    runtimeNavigationSelector: runtimeScopeNavigation.selector,
    routerAsPath: router.asPath,
    buildRuntimeScopeUrl,
    buildKnowledgeRuntimeSelector,
    replaceRoute: replaceKnowledgeRoute,
    resolveLifecycleActionLabel: getKnowledgeLifecycleActionLabel,
  });

  const {
    ruleManageOpen,
    ruleManageLoading,
    ruleList,
    ruleDetailOpen,
    sqlManageOpen,
    sqlManageLoading,
    sqlList,
    sqlDetailOpen,
    openRuleManageModal,
    closeRuleManageModal,
    openSqlManageModal,
    closeSqlManageModal,
    openRuleDetail,
    closeRuleDetail,
    backToRuleManageModal,
    openSqlTemplateDetail,
    closeSqlDetail,
    backToSqlManageModal,
    handleDeleteRule,
    handleDeleteSqlTemplate,
    submitRuleDetail,
    submitSqlTemplateDetail,
    resetRuleSqlManagerState,
  } = useKnowledgeRuleSqlManager({
    ruleForm,
    sqlTemplateForm,
    openModalSafely,
    refetchInstructions,
    refetchSqlPairs,
    createInstruction,
    updateInstruction,
    deleteInstruction,
    createSqlPair,
    updateSqlPair,
    deleteSqlPair,
  });
  const handleSummaryMoreAction = useKnowledgeSummaryActions({
    openRuleManageModal,
    openSqlManageModal,
    openEditKnowledgeBaseModal,
  });
  const { assetDatabaseOptions, assetTableOptions } =
    useKnowledgeAssetSelectOptions({
      connectors,
      isDemoSource,
      demoDatabaseOptions,
      demoTableOptions,
      assets,
    });
  const {
    wizardPreviewAssets,
    visibleKnowledgeBaseId,
    detailAssets,
    showKnowledgeAssetsLoading,
  } = useKnowledgeDerivedCollections({
    assets,
    selectedDemoKnowledge,
    activeKnowledgeBaseId: activeKnowledgeBase?.id,
    pendingKnowledgeBaseId,
    overviewPreviewAsset,
    activeKnowledgeBaseUsesRuntime: activeKnowledgeBaseExecutable,
    diagramLoading,
    hasDiagramData: Boolean(diagramData?.diagram),
    routeRuntimeSyncing,
  });
  const {
    assetDraftPreview,
    canContinueAssetConfiguration,
    moveAssetWizardToConfig,
    saveAssetDraftToOverview,
  } = useKnowledgeAssetWizard({
    assetDraft,
    connectors,
    demoTableOptions,
    isDemoSource,
    knowledgeOwner,
    selectedConnectorId,
    selectedDemoKnowledge,
    selectedDemoTable,
    setAssetDraft,
    setAssetWizardStep,
    setDetailAsset,
    setDraftAssets,
    wizardPreviewAssets,
  });
  const {
    commitAssetDraftToOverview,
    openAssetDetail,
    handleCopyAssetOverview,
  } = useKnowledgeAssetInteractions<AssetView>({
    saveAssetDraftToOverview,
    blurActiveElement,
    resetDetailViewState,
    openModalSafely,
    setDetailAsset,
  });
  const { historyItems, visibleKnowledgeItems } = useKnowledgeSidebarData({
    threads: homeSidebar.data?.threads || [],
    onSelectThread: (threadId, selector) =>
      homeSidebar.onSelect([threadId], selector),
    knowledgeBases,
    activeKnowledgeBase,
    knowledgeTab,
  });
  const { activeDetailAsset, detailAssetFields } = useKnowledgeAssetDetail({
    detailAssets,
    detailAsset,
    detailFieldKeyword,
    detailFieldFilter,
    resetDetailViewState,
  });
  const resetStateOnKnowledgeBaseSwitch = useKnowledgeSwitchReset<AssetView>({
    setDetailAsset,
    resetDetailViewState,
    setDraftAssets,
    setAssetModalOpen,
    setAssetWizardStep,
    resetRuleSqlManagerState,
    setSelectedConnectorId,
    setSelectedDemoTable,
    resetAssetDraft,
  });
  useKnowledgeActiveKnowledgeBaseSwitch({
    activeKnowledgeBaseId: activeKnowledgeBase?.id,
    onKnowledgeBaseChanged: resetStateOnKnowledgeBaseSwitch,
  });
  const handleCloseAssetDetail = useCallback(() => {
    setDetailAsset(null);
  }, []);
  const handleNavigateModeling = useCallback(
    () => runtimeScopeNavigation.pushWorkspace(Path.Modeling),
    [runtimeScopeNavigation.pushWorkspace],
  );

  const knowledgePageLoading = runtimeScopePage.guarding;

  const pageContent = knowledgePageLoading ? (
    <LibraryStage>
      <Space
        direction="vertical"
        size={18}
        style={{ width: '100%', maxWidth: 960 }}
      >
        <Skeleton active title={{ width: '32%' }} paragraph={{ rows: 4 }} />
        <Skeleton active paragraph={{ rows: 8 }} />
      </Space>
    </LibraryStage>
  ) : (
    <LibraryStage>
      <WorkbenchGrid>
        <SidePanel>
          <RailTabs>
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              value={knowledgeTab}
              options={KNOWLEDGE_TABS.map((tab) => ({
                label: tab.label,
                value: tab.key,
              }))}
              onChange={(event) => setKnowledgeTab(String(event.target.value))}
            />
          </RailTabs>

          <KbList>
            <SidebarKnowledgeList
              visibleKnowledgeItems={visibleKnowledgeItems}
              visibleKnowledgeBaseId={visibleKnowledgeBaseId}
              activeKnowledgeBaseId={activeKnowledgeBase?.id}
              activeAssetCount={detailAssets.length}
              switchKnowledgeBase={switchKnowledgeBase}
              buildKnowledgeSwitchUrl={buildKnowledgeSwitchUrl}
            />
            <KbCreateInlineWrap>
              <KbCreateButton
                type="default"
                icon={<PlusOutlined />}
                disabled={!canCreateKnowledgeBase}
                title={
                  canCreateKnowledgeBase
                    ? '创建知识库'
                    : createKnowledgeBaseBlockedReason
                }
                onClick={openCreateKnowledgeBaseModal}
              >
                创建知识库
              </KbCreateButton>
            </KbCreateInlineWrap>
          </KbList>
        </SidePanel>

        <KnowledgeMainStage
          previewFieldCount={previewFieldCount}
          isSnapshotReadonlyKnowledgeBase={isSnapshotReadonlyKnowledgeBase}
          isReadonlyKnowledgeBase={isReadonlyKnowledgeBase}
          isKnowledgeMutationDisabled={isKnowledgeMutationDisabled}
          activeKnowledgeBaseExecutable={activeKnowledgeBaseExecutable}
          canManageKnowledgeBaseLifecycle={canManageKnowledgeBaseLifecycle}
          knowledgeLifecycleActionLabel={knowledgeLifecycleActionLabel}
          knowledgeLifecycleSubmitting={knowledgeLifecycleSubmitting}
          activeKnowledgeBaseArchivedAt={activeKnowledgeBase?.archivedAt}
          knowledgeMutationHint={knowledgeMutationHint}
          knowledgeDescription={knowledgeDescription}
          showKnowledgeAssetsLoading={showKnowledgeAssetsLoading}
          detailAssets={detailAssets}
          activeDetailAsset={activeDetailAsset}
          onOpenAssetWizard={openAssetWizard}
          onSummaryMoreAction={handleSummaryMoreAction}
          onToggleKnowledgeArchive={handleToggleKnowledgeArchive}
          onOpenAssetDetail={openAssetDetail}
          historicalSnapshotReadonlyHint={HISTORICAL_SNAPSHOT_READONLY_HINT}
        />
      </WorkbenchGrid>

      <KnowledgeBaseModal
        visible={kbModalOpen}
        editingKnowledgeBase={editingKnowledgeBase}
        form={kbForm}
        canSaveKnowledgeBase={canSaveKnowledgeBase}
        creatingKnowledgeBase={creatingKnowledgeBase}
        onCancel={closeKnowledgeBaseModal}
        onSave={handleSaveKnowledgeBase}
      />

      <AssetWizardModal
        visible={assetModalOpen}
        assetWizardStep={assetWizardStep}
        onChangeAssetWizardStep={setAssetWizardStep}
        activeKnowledgeBase={activeKnowledgeBase}
        knowledgeBases={knowledgeBases}
        selectedSourceType={selectedSourceType}
        setSelectedSourceType={setSelectedSourceType}
        openConnectorConsole={openConnectorConsole}
        isDemoSource={isDemoSource}
        connectorsLoading={connectorsLoading}
        selectedDemoKnowledge={selectedDemoKnowledge}
        selectedConnectorId={selectedConnectorId}
        setSelectedConnectorId={setSelectedConnectorId}
        selectedDemoTable={selectedDemoTable}
        setSelectedDemoTable={setSelectedDemoTable}
        assetDatabaseOptions={assetDatabaseOptions}
        assetTableOptions={assetTableOptions}
        canContinueAssetWizard={canContinueAssetWizard}
        moveAssetWizardToConfig={moveAssetWizardToConfig}
        assetDraft={assetDraft}
        setAssetDraft={setAssetDraft}
        assetDraftPreview={assetDraftPreview}
        canContinueAssetConfiguration={canContinueAssetConfiguration}
        commitAssetDraftToOverview={commitAssetDraftToOverview}
        displayKnowledgeName={displayKnowledgeName}
        closeAssetModal={closeAssetModal}
        onNavigateModeling={handleNavigateModeling}
      />

      <AssetDetailModal
        detailAsset={detailAsset}
        activeDetailAsset={activeDetailAsset}
        detailAssets={detailAssets}
        detailTab={detailTab}
        detailFieldKeyword={detailFieldKeyword}
        detailFieldFilter={detailFieldFilter}
        detailAssetFields={detailAssetFields}
        onClose={handleCloseAssetDetail}
        onOpenAssetDetail={openAssetDetail}
        onNavigateModeling={handleNavigateModeling}
        onCopyAssetOverview={handleCopyAssetOverview}
        onChangeDetailTab={setDetailTab}
        onChangeFieldKeyword={setDetailFieldKeyword}
        onChangeFieldFilter={setDetailFieldFilter}
      />

      <RuleSqlModals
        ruleManageOpen={ruleManageOpen}
        ruleManageLoading={ruleManageLoading}
        ruleList={ruleList}
        ruleDetailOpen={ruleDetailOpen}
        sqlManageOpen={sqlManageOpen}
        sqlManageLoading={sqlManageLoading}
        sqlList={sqlList}
        sqlDetailOpen={sqlDetailOpen}
        ruleForm={ruleForm}
        sqlTemplateForm={sqlTemplateForm}
        createInstructionLoading={createInstructionLoading}
        updateInstructionLoading={updateInstructionLoading}
        createSqlPairLoading={createSqlPairLoading}
        updateSqlPairLoading={updateSqlPairLoading}
        openRuleDetail={openRuleDetail}
        closeRuleManageModal={closeRuleManageModal}
        closeRuleDetail={closeRuleDetail}
        backToRuleManageModal={backToRuleManageModal}
        handleDeleteRule={handleDeleteRule}
        submitRuleDetail={submitRuleDetail}
        openSqlTemplateDetail={openSqlTemplateDetail}
        closeSqlManageModal={closeSqlManageModal}
        closeSqlDetail={closeSqlDetail}
        backToSqlManageModal={backToSqlManageModal}
        handleDeleteSqlTemplate={handleDeleteSqlTemplate}
        submitSqlTemplateDetail={submitSqlTemplateDetail}
      />
    </LibraryStage>
  );

  if (persistentShellEmbedded) {
    return pageContent;
  }

  return (
    <DolaAppShell
      navItems={buildNovaShellNavItems({
        activeKey: 'knowledge',
        onNavigate: runtimeScopeNavigation.pushWorkspace,
      })}
      historyItems={historyItems}
      onHistoryIntent={homeSidebar.ensureLoaded}
    >
      {pageContent}
    </DolaAppShell>
  );
}
