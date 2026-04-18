import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { Form, Radio, Skeleton, Space } from 'antd';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
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
import {
  resolveKnowledgeInitialSourceType,
  resolveKnowledgeSourceOptions,
} from '@/hooks/useKnowledgeConnectors';
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
import useKnowledgeRuleSqlActions from '@/hooks/useKnowledgeRuleSqlActions';
import useKnowledgeRuntimeContext from '@/hooks/useKnowledgeRuntimeContext';
import useKnowledgeRuntimeDataSync from '@/hooks/useKnowledgeRuntimeDataSync';
import useKnowledgeSelectorFallback from '@/hooks/useKnowledgeSelectorFallback';
import useKnowledgeSwitchReset from '@/hooks/useKnowledgeSwitchReset';
import useKnowledgeSidebarData from '@/hooks/useKnowledgeSidebarData';
import { shouldSyncKnowledgeRuntimeScopeData } from '@/hooks/useKnowledgeRuntimeSync';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useRuntimeScopeTransition from '@/hooks/useRuntimeScopeTransition';
import { Path } from '@/utils/enum';
import { HISTORICAL_SNAPSHOT_READONLY_HINT } from '@/utils/runtimeSnapshot';
import {
  buildKnowledgeWorkbenchParams,
  resolveKnowledgeWorkbenchSection,
  type KnowledgeWorkbenchSection,
} from '@/utils/knowledgeWorkbench';
import {
  RailTabs,
  KbList,
  KbCreateButton,
  KbCreateInlineWrap,
  LibraryStage,
  WorkbenchGrid,
  SidePanel,
} from '@/features/knowledgePage/index.styles';
import {
  blurActiveElement,
  CONNECTOR_SOURCE_OPTIONS,
  KNOWLEDGE_TABS,
  openModalSafely,
  resolveReferenceOwner,
} from '@/features/knowledgePage/constants';
import AssetWizardModal from './assetWizardModal';
import KnowledgeBaseModal from './knowledgeBaseModal';
import { SidebarKnowledgeList } from '@/features/knowledgePage/lists';
import KnowledgeMainStage from './mainStage';
import type {
  AssetView,
  ConnectorView,
  KnowledgeBaseRecord,
} from '@/features/knowledgePage/types';

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
    deferInitialLoad: false,
    loadOnIntent: false,
    disabled: persistentShellEmbedded,
  });
  const [knowledgeTab, setKnowledgeTab] = useState('workspace');
  const [activeWorkbenchSection, setActiveWorkbenchSection] =
    useState<KnowledgeWorkbenchSection>(() =>
      resolveKnowledgeWorkbenchSection(router.query.section),
    );
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
  const knowledgeSourceOptions = useMemo(
    () =>
      resolveKnowledgeSourceOptions({
        workspaceKind: currentWorkspace?.kind,
        sourceOptions: CONNECTOR_SOURCE_OPTIONS,
      }),
    [currentWorkspace?.kind],
  );
  const {
    effectiveRuntimeSelector,
    currentKnowledgeBaseId,
    currentKbSnapshotId,
    routeKnowledgeBaseId,
    routeKbSnapshotId,
    runtimeSyncScopeKey,
  } = useKnowledgeRuntimeContext({
    routerQuery: router.query as Record<string, string | string[] | undefined>,
    routerReady: router.isReady,
    hasRuntimeScope: runtimeScopePage.hasRuntimeScope,
    runtimeSelectorState,
  });
  const { knowledgeBasesUrl, cachedKnowledgeBaseList } =
    useKnowledgeBaseListCache<KnowledgeBaseRecord>({
      hasRuntimeScope: runtimeScopePage.hasRuntimeScope,
      workspaceId: effectiveRuntimeSelector.workspaceId,
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
  const {
    activeKnowledgeBase,
    activeKnowledgeBaseExecutable,
    canCreateKnowledgeBase,
    createKnowledgeBaseBlockedReason,
    isReadonlyKnowledgeBase,
    isSnapshotReadonlyKnowledgeBase,
    isKnowledgeMutationDisabled,
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
  const ruleSqlCacheScopeKey = useMemo(
    () =>
      [
        activeKnowledgeRuntimeSelector.workspaceId || '',
        activeKnowledgeRuntimeSelector.knowledgeBaseId || '',
        activeKnowledgeRuntimeSelector.kbSnapshotId || '',
        activeKnowledgeRuntimeSelector.deployHash || '',
      ].join('|'),
    [
      activeKnowledgeRuntimeSelector.workspaceId,
      activeKnowledgeRuntimeSelector.knowledgeBaseId,
      activeKnowledgeRuntimeSelector.kbSnapshotId,
      activeKnowledgeRuntimeSelector.deployHash,
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
  } = useKnowledgeRuleSqlActions(activeKnowledgeRuntimeSelector);
  const activeKnowledgeSnapshotId =
    activeKnowledgeBase?.defaultKbSnapshot?.id ||
    activeKnowledgeBase?.defaultKbSnapshotId ||
    null;
  const queryWorkbenchSection = useMemo(
    () => resolveKnowledgeWorkbenchSection(router.query.section),
    [router.query.section],
  );

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
    sourceOptions: knowledgeSourceOptions,
    initialSourceType: resolveKnowledgeInitialSourceType(
      knowledgeSourceOptions,
    ),
    fetchConnectors,
    onLoadError: handleConnectorLoadError,
  });
  const { diagramData, diagramLoading, refetchDiagram } =
    useKnowledgeDiagramData({
    hasRuntimeScope: runtimeScopePage.hasRuntimeScope,
    routeKnowledgeBaseId: activeKnowledgeBase?.id || undefined,
    routeKbSnapshotId: activeKnowledgeSnapshotId || undefined,
    effectiveRuntimeSelector: activeKnowledgeRuntimeSelector,
  });
  const { routeRuntimeSyncing: routeRuntimeDataSyncing } =
    useKnowledgeRuntimeDataSync({
      runtimeSyncScopeKey,
      refetchRuntimeSelector,
      refetchDiagram,
    });
  const routeRuntimeSyncing =
    runtimeScopeTransition.transitioning || routeRuntimeDataSyncing;
  useKnowledgePendingSwitchSync({
    currentKnowledgeBaseId,
    routeKnowledgeBaseId,
    pendingKnowledgeBaseId,
    routeRuntimeSyncing,
    shouldCommitPendingSwitch: shouldCommitPendingKnowledgeBaseSwitch,
    setSelectedKnowledgeBaseId,
    setPendingKnowledgeBaseId,
  });

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
  const modelingSummary = useMemo(() => {
    const diagram = diagramData?.diagram;
    const relationIds = new Set<number>();

    (diagram?.models || []).forEach((model) => {
      (model?.relationFields || []).forEach((field) => {
        if (typeof field?.relationId === 'number') {
          relationIds.add(field.relationId);
        }
      });
    });

    return {
      modelCount: diagram?.models?.length || 0,
      viewCount: diagram?.views?.length || 0,
      relationCount: relationIds.size,
    };
  }, [diagramData]);
  const currentModelingWorkspaceKey = useMemo(
    () =>
      `${activeKnowledgeBase?.id || 'none'}:${activeKnowledgeSnapshotId || 'default'}:${runtimeSelectorState?.currentKbSnapshot?.deployHash || 'deploy'}`,
    [
      activeKnowledgeBase?.id,
      activeKnowledgeSnapshotId,
      runtimeSelectorState?.currentKbSnapshot?.deployHash,
    ],
  );
  const [committedModelingWorkspaceKey, setCommittedModelingWorkspaceKey] =
    useState(currentModelingWorkspaceKey);
  useEffect(() => {
    if (routeRuntimeSyncing) {
      return;
    }

    setCommittedModelingWorkspaceKey((previousKey) =>
      previousKey === currentModelingWorkspaceKey
        ? previousKey
        : currentModelingWorkspaceKey,
    );
  }, [currentModelingWorkspaceKey, routeRuntimeSyncing]);
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
  const { creatingKnowledgeBase, handleSaveKnowledgeBase } =
    useKnowledgeBaseLifecycle<KnowledgeBaseRecord>({
      editingKnowledgeBase,
      activeKnowledgeBase,
      kbForm,
      closeKnowledgeBaseModal,
      loadKnowledgeBases,
      refetchRuntimeSelector,
      setSelectedKnowledgeBaseId,
      clearDetailAsset,
      currentKnowledgeBaseId,
      canManageKnowledgeBaseLifecycle: false,
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
    ruleManageLoading,
    ruleList,
    loadRuleList,
    editingInstruction,
    sqlManageLoading,
    sqlList,
    loadSqlList,
    editingSqlPair,
    openRuleDetail,
    openSqlTemplateDetail,
    handleDeleteRule,
    handleDeleteSqlTemplate,
    submitRuleDetail,
    submitSqlTemplateDetail,
    resetRuleDetailEditor,
    resetSqlTemplateEditor,
    resetRuleSqlManagerState,
  } = useKnowledgeRuleSqlManager({
    ruleForm,
    sqlTemplateForm,
    cacheScopeKey: ruleSqlCacheScopeKey,
    refetchInstructions,
    refetchSqlPairs,
    createInstruction,
    updateInstruction,
    deleteInstruction,
    createSqlPair,
    updateSqlPair,
    deleteSqlPair,
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
  const { commitAssetDraftToOverview, openAssetDetail } =
    useKnowledgeAssetInteractions<AssetView>({
      saveAssetDraftToOverview,
      blurActiveElement,
      resetDetailViewState,
      openModalSafely,
      setDetailAsset,
    });
  const { historyItems, visibleKnowledgeItems } = useKnowledgeSidebarData({
    threads: homeSidebar.data?.threads || [],
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
    switchReady: !routeRuntimeSyncing,
    onKnowledgeBaseChanged: resetStateOnKnowledgeBaseSwitch,
  });
  const handleCloseAssetDetail = useCallback(() => {
    setDetailAsset(null);
  }, []);
  const handleChangeWorkbenchSection = useCallback(
    (nextSection: KnowledgeWorkbenchSection) => {
      setActiveWorkbenchSection(nextSection);
      blurActiveElement();
      return runtimeScopeNavigation.replaceWorkspace(
        Path.Knowledge,
        buildKnowledgeWorkbenchParams(nextSection),
      );
    },
    [runtimeScopeNavigation.replaceWorkspace],
  );
  const buildKnowledgeSwitchUrl = useCallback(
    (knowledgeBase: KnowledgeBaseRecord) =>
      buildRuntimeScopeUrl(
        Path.Knowledge,
        buildKnowledgeWorkbenchParams(activeWorkbenchSection),
        buildKnowledgeRuntimeSelector(knowledgeBase),
      ),
    [
      activeWorkbenchSection,
      buildKnowledgeRuntimeSelector,
      buildRuntimeScopeUrl,
    ],
  );
  const handleNavigateModeling = useCallback(
    () => handleChangeWorkbenchSection('modeling'),
    [handleChangeWorkbenchSection],
  );
  const handleOpenAssetWizard = useCallback(() => {
    openAssetWizard();
  }, [openAssetWizard]);
  useEffect(() => {
    const hasModelingIntent = Boolean(
      router.query.openModelDrawer ||
        router.query.openMetadata ||
        router.query.openRelationModal,
    );

    if (hasModelingIntent) {
      setActiveWorkbenchSection('modeling');
      return;
    }

    setActiveWorkbenchSection((currentSection) =>
      currentSection === queryWorkbenchSection
        ? currentSection
        : queryWorkbenchSection,
    );
  }, [
    queryWorkbenchSection,
    router.query.openMetadata,
    router.query.openModelDrawer,
    router.query.openRelationModal,
  ]);

  useEffect(() => {
    if (
      routeRuntimeSyncing ||
      !runtimeScopePage.hasRuntimeScope ||
      !activeKnowledgeBase?.id
    ) {
      return;
    }

    void loadRuleList().catch(() => null);
    void loadSqlList().catch(() => null);
  }, [
    activeKnowledgeBase?.id,
    activeKnowledgeSnapshotId,
    routeRuntimeSyncing,
    runtimeScopePage.hasRuntimeScope,
    loadRuleList,
    loadSqlList,
  ]);

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
          activeWorkbenchSection={activeWorkbenchSection}
          onChangeWorkbenchSection={handleChangeWorkbenchSection}
          previewFieldCount={previewFieldCount}
          isSnapshotReadonlyKnowledgeBase={isSnapshotReadonlyKnowledgeBase}
          isReadonlyKnowledgeBase={isReadonlyKnowledgeBase}
          isKnowledgeMutationDisabled={isKnowledgeMutationDisabled}
          knowledgeMutationHint={knowledgeMutationHint}
          knowledgeDescription={knowledgeDescription}
          showKnowledgeAssetsLoading={showKnowledgeAssetsLoading}
          detailAssets={detailAssets}
          activeDetailAsset={activeDetailAsset}
          detailTab={detailTab}
          detailFieldKeyword={detailFieldKeyword}
          detailFieldFilter={detailFieldFilter}
          detailAssetFields={detailAssetFields}
          onOpenAssetWizard={handleOpenAssetWizard}
          onOpenKnowledgeEditor={openEditKnowledgeBaseModal}
          onOpenAssetDetail={openAssetDetail}
          onCloseAssetDetail={handleCloseAssetDetail}
          onChangeDetailTab={setDetailTab}
          onChangeFieldKeyword={setDetailFieldKeyword}
          onChangeFieldFilter={setDetailFieldFilter}
          historicalSnapshotReadonlyHint={HISTORICAL_SNAPSHOT_READONLY_HINT}
          ruleList={ruleList}
          sqlList={sqlList}
          ruleManageLoading={ruleManageLoading}
          sqlManageLoading={sqlManageLoading}
          onOpenRuleDetail={openRuleDetail}
          onOpenSqlTemplateDetail={openSqlTemplateDetail}
          onDeleteRule={handleDeleteRule}
          onDeleteSqlTemplate={handleDeleteSqlTemplate}
          editingInstruction={editingInstruction}
          editingSqlPair={editingSqlPair}
          ruleForm={ruleForm}
          sqlTemplateForm={sqlTemplateForm}
          createInstructionLoading={createInstructionLoading}
          updateInstructionLoading={updateInstructionLoading}
          createSqlPairLoading={createSqlPairLoading}
          updateSqlPairLoading={updateSqlPairLoading}
          onSubmitRuleDetail={submitRuleDetail}
          onSubmitSqlTemplateDetail={submitSqlTemplateDetail}
          onResetRuleDetailEditor={resetRuleDetailEditor}
          onResetSqlTemplateEditor={resetSqlTemplateEditor}
          modelingWorkspaceKey={committedModelingWorkspaceKey}
          modelingSummary={modelingSummary}
          onOpenModeling={handleNavigateModeling}
        />
      </WorkbenchGrid>

      {kbModalOpen ? (
        <KnowledgeBaseModal
          visible={kbModalOpen}
          editingKnowledgeBase={editingKnowledgeBase}
          form={kbForm}
          canSaveKnowledgeBase={canSaveKnowledgeBase}
          creatingKnowledgeBase={creatingKnowledgeBase}
          onCancel={closeKnowledgeBaseModal}
          onSave={handleSaveKnowledgeBase}
        />
      ) : null}

      {assetModalOpen ? (
        <AssetWizardModal
          visible={assetModalOpen}
          assetWizardStep={assetWizardStep}
          onChangeAssetWizardStep={setAssetWizardStep}
          activeKnowledgeBase={activeKnowledgeBase}
          knowledgeBases={knowledgeBases}
          sourceOptions={knowledgeSourceOptions}
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
      ) : null}
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
      historyLoading={homeSidebar.loading && historyItems.length === 0}
      onHistoryIntent={homeSidebar.ensureLoaded}
    >
      {pageContent}
    </DolaAppShell>
  );
}
