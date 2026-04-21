import type { ComponentRef, RefObject, UIEvent } from 'react';
import BookOutlined from '@ant-design/icons/BookOutlined';
import CloseOutlined from '@ant-design/icons/CloseOutlined';
import FundViewOutlined from '@ant-design/icons/FundViewOutlined';
import PaperClipOutlined from '@ant-design/icons/PaperClipOutlined';
import ToolOutlined from '@ant-design/icons/ToolOutlined';
import Prompt from '@/components/pages/home/prompt';
import type useAskPrompt from '@/hooks/useAskPrompt';
import type { CreateThreadInput } from '@/types/home';
import {
  ComposerAtMark,
  ComposerCard,
  ComposerKnowledgeAction,
  ComposerPassiveChip,
  ComposerPrompt,
  ComposerScopeRow,
  ComposerShell,
  ComposerToolButton,
  HeroGreeting,
  HeroPanel,
  HeroTitle,
  SourceChip,
  SourceChipRemove,
  Stage,
} from '@/features/home/homePageStyles';
import { getReferenceDisplayKnowledgeName } from '@/utils/referenceDemoKnowledge';
import HomeKnowledgePickerDropdown from './HomeKnowledgePickerDropdown';
import HomeRecommendationSectionBlock, {
  type HomeRecommendationCard,
} from './HomeRecommendationSection';
import HomeSkillPickerModal from './HomeSkillPickerModal';
import type { HomeSkillOption } from '../homeSkillOptions';

type KnowledgeBaseSummary = {
  id: string;
  name?: string | null;
};

type Props = {
  heroUserName: string | null;
  composerShellRef: RefObject<HTMLDivElement | null>;
  promptRef: RefObject<ComponentRef<typeof Prompt> | null>;
  askPrompt: ReturnType<typeof useAskPrompt>;
  selectedKnowledgeBases: KnowledgeBaseSummary[];
  selectedSkillLabel: string | null;
  knowledgePickerOpen: boolean;
  knowledgeKeyword: string;
  filteredKnowledgeBases: KnowledgeBaseSummary[];
  selectedKnowledgeBaseIds: string[];
  visibleKnowledgeBases: KnowledgeBaseSummary[];
  shouldVirtualizeKnowledgeList: boolean;
  knowledgeTopSpacerHeight: number;
  knowledgeBottomSpacerHeight: number;
  knowledgeListViewportRef: RefObject<HTMLDivElement | null>;
  homePromptPlaceholder: string;
  recommendationCards: HomeRecommendationCard[];
  recommendationSourceHint: string;
  skillPickerOpen: boolean;
  skillKeyword: string;
  skillOptionsLoading: boolean;
  skillOptionsError: string | null;
  filteredSkillOptions: HomeSkillOption[];
  draftSelectedSkillIds: string[];
  currentKnowledgeBases: KnowledgeBaseSummary[];
  onPromptSubmit: (value: string) => Promise<void>;
  onCreateResponse: (payload: CreateThreadInput) => Promise<void>;
  onToggleKnowledgePicker: () => void;
  onOpenKnowledgePicker: () => void;
  onRemoveKnowledgeSelection: (knowledgeBaseId: string) => void;
  onKnowledgeKeywordChange: (value: string) => void;
  onKnowledgeListScroll: (event: UIEvent<HTMLDivElement>) => void;
  onToggleKnowledgeBase: (knowledgeBaseId: string) => void;
  onSelectQuestion: (card: HomeRecommendationCard) => void;
  onOpenSkillPicker: () => void;
  onSkillKeywordChange: (value: string) => void;
  onToggleDraftSkill: (skillId: string) => void;
  onApplySkillSelection: () => void;
  onCloseSkillPicker: () => void;
  onNavigateToSkills: () => void;
};

export default function HomeLandingStage({
  heroUserName,
  composerShellRef,
  promptRef,
  askPrompt,
  selectedKnowledgeBases,
  selectedSkillLabel,
  knowledgePickerOpen,
  knowledgeKeyword,
  filteredKnowledgeBases,
  selectedKnowledgeBaseIds,
  visibleKnowledgeBases,
  shouldVirtualizeKnowledgeList,
  knowledgeTopSpacerHeight,
  knowledgeBottomSpacerHeight,
  knowledgeListViewportRef,
  homePromptPlaceholder,
  recommendationCards,
  recommendationSourceHint,
  skillPickerOpen,
  skillKeyword,
  skillOptionsLoading,
  skillOptionsError,
  filteredSkillOptions,
  draftSelectedSkillIds,
  currentKnowledgeBases,
  onPromptSubmit,
  onCreateResponse,
  onToggleKnowledgePicker,
  onOpenKnowledgePicker,
  onRemoveKnowledgeSelection,
  onKnowledgeKeywordChange,
  onKnowledgeListScroll,
  onToggleKnowledgeBase,
  onSelectQuestion,
  onOpenSkillPicker,
  onSkillKeywordChange,
  onToggleDraftSkill,
  onApplySkillSelection,
  onCloseSkillPicker,
  onNavigateToSkills,
}: Props) {
  return (
    <Stage>
      <HeroPanel>
        <HeroGreeting level={1}>
          {heroUserName ? `你好，${heroUserName}` : '你好'}
        </HeroGreeting>
        <HeroTitle level={2}>我是你的数据AI助手，我能为你做什么？</HeroTitle>

        <ComposerShell
          ref={composerShellRef}
          $dropdownOpen={knowledgePickerOpen}
        >
          <ComposerCard>
            <ComposerScopeRow>
              {selectedKnowledgeBases.map((knowledgeBase) => (
                <SourceChip key={knowledgeBase.id}>
                  <BookOutlined />
                  <span>
                    {getReferenceDisplayKnowledgeName(knowledgeBase.name)}
                  </span>
                  <SourceChipRemove
                    type="button"
                    aria-label={`移除知识库 ${getReferenceDisplayKnowledgeName(
                      knowledgeBase.name,
                    )}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onRemoveKnowledgeSelection(knowledgeBase.id);
                    }}
                  >
                    <CloseOutlined />
                  </SourceChipRemove>
                </SourceChip>
              ))}
              <ComposerKnowledgeAction
                type="button"
                onClick={onToggleKnowledgePicker}
              >
                <ComposerAtMark>@</ComposerAtMark>
                <span>指定知识库</span>
              </ComposerKnowledgeAction>
              {selectedSkillLabel ? (
                <ComposerPassiveChip>
                  <ToolOutlined />
                  <span>{selectedSkillLabel}</span>
                </ComposerPassiveChip>
              ) : null}
            </ComposerScopeRow>

            <ComposerPrompt
              ref={promptRef}
              {...askPrompt}
              onSubmit={onPromptSubmit}
              onCreateResponse={onCreateResponse}
              showInlineResult={false}
              inputProps={{
                ...askPrompt.inputProps,
                placeholder: homePromptPlaceholder,
              }}
              variant="embedded"
              buttonMode="icon"
              inputLayout="stacked"
              onAtTrigger={onOpenKnowledgePicker}
              footerContent={
                <>
                  <ComposerToolButton type="button" disabled>
                    <FundViewOutlined />
                    <span>模式</span>
                  </ComposerToolButton>
                  <ComposerToolButton
                    type="button"
                    onClick={onOpenSkillPicker}
                    disabled={skillOptionsLoading}
                  >
                    <ToolOutlined />
                    <span>技能</span>
                  </ComposerToolButton>
                  <ComposerToolButton type="button" disabled>
                    <PaperClipOutlined />
                    <span>文件</span>
                  </ComposerToolButton>
                </>
              }
            />
          </ComposerCard>

          {knowledgePickerOpen ? (
            <HomeKnowledgePickerDropdown
              keyword={knowledgeKeyword}
              filteredKnowledgeBases={filteredKnowledgeBases}
              selectedKnowledgeBaseIds={selectedKnowledgeBaseIds}
              visibleKnowledgeBases={visibleKnowledgeBases}
              shouldVirtualize={shouldVirtualizeKnowledgeList}
              topSpacerHeight={knowledgeTopSpacerHeight}
              bottomSpacerHeight={knowledgeBottomSpacerHeight}
              viewportRef={knowledgeListViewportRef}
              onKeywordChange={onKnowledgeKeywordChange}
              onScroll={onKnowledgeListScroll}
              onToggleKnowledgeBase={onToggleKnowledgeBase}
            />
          ) : null}
        </ComposerShell>
      </HeroPanel>

      <HomeRecommendationSectionBlock
        cards={recommendationCards}
        sourceHint={recommendationSourceHint}
        onSelectQuestion={onSelectQuestion}
      />

      <HomeSkillPickerModal
        open={skillPickerOpen}
        searchValue={skillKeyword}
        loading={skillOptionsLoading}
        error={skillOptionsError}
        options={filteredSkillOptions}
        selectedSkillIds={draftSelectedSkillIds}
        knowledgeBases={currentKnowledgeBases}
        onSearchChange={onSkillKeywordChange}
        onToggleSkill={onToggleDraftSkill}
        onApply={onApplySkillSelection}
        onClose={onCloseSkillPicker}
        onNavigateToSkills={onNavigateToSkills}
      />
    </Stage>
  );
}
