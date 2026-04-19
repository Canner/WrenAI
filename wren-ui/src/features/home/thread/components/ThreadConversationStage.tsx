import BookOutlined from '@ant-design/icons/BookOutlined';
import type { ComponentProps, RefObject } from 'react';
import Prompt from '@/components/pages/home/prompt';
import PromptThread from '@/components/pages/home/promptThread';
import ReferenceConversationPreview from '@/features/home/thread/components/ReferenceConversationPreview';
import {
  ComposerAssistRow,
  ComposerDock,
  ComposerFrame,
  ComposerHintText,
  ComposerSelectedKnowledgeChip,
  ComposerSelectedScopeRow,
  ConversationBody,
  ConversationPane,
  ThreadScene,
} from '@/features/home/thread/threadPageStyles';

type ThreadConversationStageProps = {
  promptRef: RefObject<{
    submit?: (value: string) => void;
    close?: () => void;
  } | null>;
  primaryQuestion: string;
  selectedKnowledgeBaseNames: string[];
  shouldUseReferencePreview: boolean;
  hasExecutableRuntime: boolean;
  readonlyHint: string;
  unavailableHint: string;
  isHistoricalRuntimeReadonly: boolean;
  onCreateResponse: ComponentProps<typeof Prompt>['onCreateResponse'];
  promptProps: Omit<ComponentProps<typeof Prompt>, 'ref' | 'onCreateResponse'>;
};

export default function ThreadConversationStage({
  promptRef,
  primaryQuestion,
  selectedKnowledgeBaseNames,
  shouldUseReferencePreview,
  hasExecutableRuntime,
  readonlyHint,
  unavailableHint,
  isHistoricalRuntimeReadonly,
  onCreateResponse,
  promptProps,
}: ThreadConversationStageProps) {
  return (
    <ThreadScene>
      <ConversationPane>
        <ConversationBody>
          {shouldUseReferencePreview ? (
            <ReferenceConversationPreview
              question={primaryQuestion}
              onSelectSuggestedQuestion={(value) => {
                promptRef.current?.submit?.(value);
              }}
            />
          ) : (
            <PromptThread />
          )}
        </ConversationBody>

        <ComposerDock>
          <ComposerFrame>
            {selectedKnowledgeBaseNames.length > 0 ? (
              <ComposerSelectedScopeRow>
                {selectedKnowledgeBaseNames.map((knowledgeBaseName) => (
                  <ComposerSelectedKnowledgeChip key={knowledgeBaseName}>
                    <BookOutlined />
                    <span>{knowledgeBaseName}</span>
                  </ComposerSelectedKnowledgeChip>
                ))}
              </ComposerSelectedScopeRow>
            ) : null}
            {hasExecutableRuntime ? (
              <Prompt
                ref={promptRef as never}
                {...promptProps}
                onCreateResponse={onCreateResponse}
                variant="embedded"
                buttonMode="icon"
              />
            ) : (
              <ComposerAssistRow>
                <ComposerHintText>
                  {isHistoricalRuntimeReadonly ? readonlyHint : unavailableHint}
                </ComposerHintText>
              </ComposerAssistRow>
            )}
          </ComposerFrame>
        </ComposerDock>
      </ConversationPane>
    </ThreadScene>
  );
}
