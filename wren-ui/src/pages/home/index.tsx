import {
  ComponentRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Skeleton, Space } from 'antd';
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
import { Stage } from '@/features/home/homePageStyles';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import useHomeThreadCreation from '@/features/home/useHomeThreadCreation';
import type { HomeRecommendationCard } from '@/features/home/components/HomeRecommendationSection';
export {
  resolveAskRuntimeAvailability,
  resolveAskRuntimeSelector,
  resolveCreatedThreadRuntimeSelector,
} from '@/features/home/homePageRuntime';

type KnowledgeBaseSummary = {
  id: string;
  name?: string | null;
};

const areStringListsEqual = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

export const resolveActiveSelectedKnowledgeBaseIds = ({
  selectedKnowledgeBaseIds,
  knowledgeBases,
}: {
  selectedKnowledgeBaseIds: string[];
  knowledgeBases: KnowledgeBaseSummary[];
}) => {
  const availableKnowledgeBaseIds = new Set(
    knowledgeBases.map((knowledgeBase) => knowledgeBase.id),
  );

  return selectedKnowledgeBaseIds.filter((knowledgeBaseId) =>
    availableKnowledgeBaseIds.has(knowledgeBaseId),
  );
};

export default function Home() {
  const $prompt = useRef<ComponentRef<typeof Prompt>>(null);
  const composerShellRef = useRef<HTMLDivElement>(null);
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const authSession = useAuthSession({ includeWorkspaceQuery: false });
  const refetchPersistentShellHistory = usePersistentShellHistoryRefetch();
  const [knowledgePickerOpen, setKnowledgePickerOpen] = useState(false);
  const [knowledgeKeyword, setKnowledgeKeyword] = useState('');
  const [selectedKnowledgeBaseIds, setSelectedKnowledgeBaseIds] = useState<
    string[]
  >([]);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skillKeyword, setSkillKeyword] = useState('');
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [draftSelectedSkillIds, setDraftSelectedSkillIds] = useState<string[]>(
    [],
  );
  const [knowledgeListScrollTop, setKnowledgeListScrollTop] = useState(0);
  const [knowledgeListViewportHeight, setKnowledgeListViewportHeight] =
    useState(0);

  const runtimeSelector = useRuntimeSelectorState();
  const runtimeSelectorState = runtimeSelector.runtimeSelectorState;
  const currentWorkspaceId = runtimeSelectorState?.currentWorkspace?.id || null;
  const previousWorkspaceIdRef = useRef<string | null>(null);
  const currentKnowledgeBases = runtimeSelectorState?.knowledgeBases || [];

  useEffect(() => {
    const previousWorkspaceId = previousWorkspaceIdRef.current;
    previousWorkspaceIdRef.current = currentWorkspaceId;

    if (
      !previousWorkspaceId ||
      !currentWorkspaceId ||
      previousWorkspaceId === currentWorkspaceId
    ) {
      return;
    }

    setSelectedKnowledgeBaseIds([]);
    setKnowledgeKeyword('');
    setKnowledgePickerOpen(false);
    setSelectedSkillIds([]);
    setDraftSelectedSkillIds([]);
    setSkillKeyword('');
    setSkillPickerOpen(false);
  }, [currentWorkspaceId]);

  const activeSelectedKnowledgeBaseIds = useMemo(
    () =>
      resolveActiveSelectedKnowledgeBaseIds({
        selectedKnowledgeBaseIds,
        knowledgeBases: currentKnowledgeBases,
      }),
    [currentKnowledgeBases, selectedKnowledgeBaseIds],
  );

  useEffect(() => {
    if (
      areStringListsEqual(
        selectedKnowledgeBaseIds,
        activeSelectedKnowledgeBaseIds,
      )
    ) {
      return;
    }

    setSelectedKnowledgeBaseIds(activeSelectedKnowledgeBaseIds);
  }, [activeSelectedKnowledgeBaseIds, selectedKnowledgeBaseIds]);

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

  const homePageLoading = runtimeScopePage.guarding;

  if (homePageLoading) {
    const loadingContent = (
      <Stage>
        <Space
          direction="vertical"
          size={20}
          style={{ width: '100%', maxWidth: 720 }}
        >
          <Skeleton active title={{ width: '38%' }} paragraph={{ rows: 5 }} />
          <Skeleton.Button
            active
            block
            style={{ height: 148, width: '100%' }}
          />
        </Space>
      </Stage>
    );

    return (
      <DirectShellPageFrame activeNav="home">
        {loadingContent}
      </DirectShellPageFrame>
    );
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
