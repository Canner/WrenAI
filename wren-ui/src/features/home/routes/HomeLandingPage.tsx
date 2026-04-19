import { ComponentRef, useCallback, useMemo, useRef } from 'react';
import { Path } from '@/utils/enum';
import Prompt from '@/components/pages/home/prompt';
import useAskPrompt from '@/hooks/useAskPrompt';
import { usePersistentShellHistoryRefetch } from '@/components/reference/PersistentShellContext';
import DirectShellPageFrame from '@/components/reference/DirectShellPageFrame';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useAuthSession from '@/hooks/useAuthSession';
import {
  HOME_REFERENCE_PROMPT_PLACEHOLDER,
  resolveAskRuntimeAvailability,
  resolveAskRuntimeSelector,
} from '@/features/home/homePageRuntime';
import { useHomeLandingControls } from '@/features/home/useHomeLandingControls';
import useHomeRecommendationAssets from '@/features/home/useHomeRecommendationAssets';
import { useHomeRecommendations } from '@/features/home/useHomeRecommendations';
import useHomeSuggestedQuestions from '@/features/home/useHomeSuggestedQuestions';
import useHomeSkillOptions from '@/features/home/useHomeSkillOptions';
import HomeLandingStage from '@/features/home/components/HomeLandingStage';
import HomeLandingPageLoadingState from '@/features/home/routes/HomeLandingPageLoadingState';
import useHomeLandingPageSelectionState from '@/features/home/routes/useHomeLandingPageSelectionState';
import useHomeThreadCreation from '@/features/home/useHomeThreadCreation';
import type { HomeRecommendationCard } from '@/features/home/components/HomeRecommendationSection';
export {
  resolveAskRuntimeAvailability,
  resolveAskRuntimeSelector,
  resolveCreatedThreadRuntimeSelector,
} from '@/features/home/homePageRuntime';

export { resolveActiveSelectedKnowledgeBaseIds } from './useHomeLandingPageSelectionState';
export default function Home() {
  const $prompt = useRef<ComponentRef<typeof Prompt>>(null);
  const composerShellRef = useRef<HTMLDivElement>(null);
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const authSession = useAuthSession({ includeWorkspaceQuery: false });
  const refetchPersistentShellHistory = usePersistentShellHistoryRefetch();
  const {
    activeSelectedKnowledgeBaseIds,
    currentKnowledgeBases,
    draftSelectedSkillIds,
    knowledgeKeyword,
    knowledgeListScrollTop,
    knowledgeListViewportHeight,
    knowledgePickerOpen,
    runtimeSelectorState,
    selectedSkillIds,
    setDraftSelectedSkillIds,
    setKnowledgeKeyword,
    setKnowledgeListScrollTop,
    setKnowledgeListViewportHeight,
    setKnowledgePickerOpen,
    setSelectedKnowledgeBaseIds,
    setSelectedSkillIds,
    setSkillKeyword,
    setSkillPickerOpen,
    skillKeyword,
    skillPickerOpen,
  } = useHomeLandingPageSelectionState();

  const {
    hasExecutableRuntime: hasExecutableAskRuntime,
    isHistoricalRuntimeReadonly: isAskRuntimeHistoricalReadonly,
  } = useMemo(
    () =>
      resolveAskRuntimeAvailability({
        currentSelector: runtimeScopeNavigation.selector,
        selectedKnowledgeBaseIds: activeSelectedKnowledgeBaseIds,
        knowledgeBases: currentKnowledgeBases,
        currentKnowledgeBase: runtimeSelectorState?.currentKnowledgeBase,
        currentKbSnapshot: runtimeSelectorState?.currentKbSnapshot,
      }),
    [
      activeSelectedKnowledgeBaseIds,
      currentKnowledgeBases,
      runtimeScopeNavigation.selector,
      runtimeSelectorState?.currentKbSnapshot,
      runtimeSelectorState?.currentKnowledgeBase,
    ],
  );
  const askRuntimeSelector = useMemo(
    () =>
      resolveAskRuntimeSelector({
        currentSelector: runtimeScopeNavigation.selector,
        selectedKnowledgeBaseIds: activeSelectedKnowledgeBaseIds,
        workspaceId: runtimeSelectorState?.currentWorkspace?.id,
      }),
    [
      activeSelectedKnowledgeBaseIds,
      runtimeScopeNavigation.selector,
      runtimeSelectorState?.currentWorkspace?.id,
    ],
  );
  const askPrompt = useAskPrompt(
    undefined,
    {
      knowledgeBaseIds:
        activeSelectedKnowledgeBaseIds.length > 0
          ? activeSelectedKnowledgeBaseIds
          : undefined,
      selectedSkillIds:
        selectedSkillIds.length > 0 ? selectedSkillIds : undefined,
    },
    undefined,
    askRuntimeSelector,
  );
  const { handlePromptSubmit, onCreateResponse } = useHomeThreadCreation({
    askRuntimeSelector,
    selectedKnowledgeBaseIds: activeSelectedKnowledgeBaseIds,
    selectedSkillIds,
    hasExecutableAskRuntime,
    isAskRuntimeHistoricalReadonly,
    stopAskPolling: askPrompt.onStopPolling,
    runtimeScopeNavigation,
    refetchPersistentShellHistory,
  });
  const { suggestedQuestionsData } = useHomeSuggestedQuestions({
    hasRuntimeScope: runtimeScopePage.hasRuntimeScope,
    hasExecutableAskRuntime,
    askRuntimeSelector,
  });
  const { recommendationAssets } = useHomeRecommendationAssets({
    hasRuntimeScope: runtimeScopePage.hasRuntimeScope,
    hasExecutableAskRuntime,
    currentKnowledgeBases,
    currentKnowledgeBase: runtimeSelectorState?.currentKnowledgeBase,
    currentKbSnapshot: runtimeSelectorState?.currentKbSnapshot,
    selectedKnowledgeBaseIds: activeSelectedKnowledgeBaseIds,
    currentSelector: runtimeScopeNavigation.selector,
  });

  const { skillOptionSource, skillOptionsError, skillOptionsLoading } =
    useHomeSkillOptions({
      workspaceId: runtimeScopeNavigation.selector.workspaceId,
      hasExecutableAskRuntime,
      skillPickerOpen,
      selectedSkillIds,
      setSelectedSkillIds,
    });

  const {
    applyKnowledgeSelection,
    applySkillSelection,
    closeSkillPicker,
    filteredKnowledgeBases,
    filteredSkillOptions,
    handleKnowledgeListScroll,
    knowledgeBottomSpacerHeight,
    knowledgeListViewportRef,
    knowledgeTopSpacerHeight,
    openKnowledgePicker,
    openSkillPicker,
    removeKnowledgeSelection,
    selectedKnowledgeBases,
    shouldVirtualizeKnowledgeList,
    toggleDraftSkill,
    toggleKnowledgePicker,
    visibleKnowledgeBases,
  } = useHomeLandingControls({
    composerShellRef,
    currentKnowledgeBases,
    draftSelectedSkillIds,
    knowledgeKeyword,
    knowledgeListScrollTop,
    knowledgeListViewportHeight,
    knowledgePickerOpen,
    selectedKnowledgeBaseIds: activeSelectedKnowledgeBaseIds,
    selectedSkillIds,
    setDraftSelectedSkillIds,
    setKnowledgeKeyword,
    setKnowledgeListScrollTop,
    setKnowledgeListViewportHeight,
    setKnowledgePickerOpen,
    setSelectedKnowledgeBaseIds,
    setSelectedSkillIds,
    setSkillKeyword,
    setSkillPickerOpen,
    skillOptions: skillOptionSource,
    skillKeyword,
  });

  const { recommendationCards, recommendationSourceHint } =
    useHomeRecommendations({
      currentKnowledgeBases,
      currentKnowledgeBase: runtimeSelectorState?.currentKnowledgeBase,
      selectedKnowledgeBaseIds: activeSelectedKnowledgeBaseIds,
      suggestedQuestionsData,
      knowledgeBaseAssets: recommendationAssets,
    });

  const handleRecommendationSelect = useCallback(
    (card: HomeRecommendationCard) => {
      if (
        card.knowledgeBaseId &&
        currentKnowledgeBases.some(
          (knowledgeBase) => knowledgeBase.id === card.knowledgeBaseId,
        )
      ) {
        setSelectedKnowledgeBaseIds([card.knowledgeBaseId]);
      }

      setKnowledgeKeyword('');
      setKnowledgePickerOpen(false);
      $prompt.current?.setDraft(card.question);
    },
    [currentKnowledgeBases],
  );

  const selectedSkillLabel =
    selectedSkillIds.length > 0
      ? `已选 ${selectedSkillIds.length} 个技能`
      : null;
  const homePromptPlaceholder = HOME_REFERENCE_PROMPT_PLACEHOLDER;
  const heroUserName = useMemo(() => {
    const displayName = authSession.data?.user?.displayName?.trim();
    if (displayName) {
      return displayName;
    }

    const email = authSession.data?.user?.email?.trim();
    if (!email) {
      return null;
    }

    return email.split('@')[0]?.trim() || email;
  }, [authSession.data?.user?.displayName, authSession.data?.user?.email]);

  if (runtimeScopePage.guarding) {
    return <HomeLandingPageLoadingState />;
  }

  const pageContent = (
    <HomeLandingStage
      heroUserName={heroUserName}
      composerShellRef={composerShellRef}
      promptRef={$prompt}
      askPrompt={askPrompt}
      selectedKnowledgeBases={selectedKnowledgeBases}
      selectedSkillLabel={selectedSkillLabel}
      knowledgePickerOpen={knowledgePickerOpen}
      knowledgeKeyword={knowledgeKeyword}
      filteredKnowledgeBases={filteredKnowledgeBases}
      selectedKnowledgeBaseIds={activeSelectedKnowledgeBaseIds}
      visibleKnowledgeBases={visibleKnowledgeBases}
      shouldVirtualizeKnowledgeList={shouldVirtualizeKnowledgeList}
      knowledgeTopSpacerHeight={knowledgeTopSpacerHeight}
      knowledgeBottomSpacerHeight={knowledgeBottomSpacerHeight}
      knowledgeListViewportRef={knowledgeListViewportRef}
      homePromptPlaceholder={homePromptPlaceholder}
      recommendationCards={recommendationCards}
      recommendationSourceHint={recommendationSourceHint}
      skillPickerOpen={skillPickerOpen}
      skillKeyword={skillKeyword}
      skillOptionsLoading={skillOptionsLoading}
      skillOptionsError={skillOptionsError}
      filteredSkillOptions={filteredSkillOptions}
      draftSelectedSkillIds={draftSelectedSkillIds}
      currentKnowledgeBases={currentKnowledgeBases}
      onPromptSubmit={handlePromptSubmit}
      onCreateResponse={onCreateResponse}
      onToggleKnowledgePicker={toggleKnowledgePicker}
      onOpenKnowledgePicker={openKnowledgePicker}
      onRemoveKnowledgeSelection={removeKnowledgeSelection}
      onKnowledgeKeywordChange={setKnowledgeKeyword}
      onKnowledgeListScroll={handleKnowledgeListScroll}
      onToggleKnowledgeBase={applyKnowledgeSelection}
      onSelectQuestion={handleRecommendationSelect}
      onOpenSkillPicker={openSkillPicker}
      onSkillKeywordChange={setSkillKeyword}
      onToggleDraftSkill={toggleDraftSkill}
      onApplySkillSelection={applySkillSelection}
      onCloseSkillPicker={closeSkillPicker}
      onNavigateToSkills={() => {
        closeSkillPicker();
        runtimeScopeNavigation.pushWorkspace(Path.SettingsSkills);
      }}
    />
  );

  return (
    <DirectShellPageFrame activeNav="home">{pageContent}</DirectShellPageFrame>
  );
}
