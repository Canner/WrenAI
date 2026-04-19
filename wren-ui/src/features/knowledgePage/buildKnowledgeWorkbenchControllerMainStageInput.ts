import type { KnowledgeWorkbenchMainStageProps } from './buildKnowledgeWorkbenchStageProps';
import type { KnowledgeWorkbenchControllerStageArgs } from './knowledgeWorkbenchControllerStageTypes';
import buildKnowledgeWorkbenchMainStageEditorInput from './buildKnowledgeWorkbenchMainStageEditorInput';
import buildKnowledgeWorkbenchMainStageOverviewInput from './buildKnowledgeWorkbenchMainStageOverviewInput';

type KnowledgeWorkbenchControllerMainStageArgs = Omit<
  KnowledgeWorkbenchControllerStageArgs,
  'knowledgeState'
> & {
  knowledgeState: Pick<
    KnowledgeWorkbenchControllerStageArgs['knowledgeState'],
    | 'isSnapshotReadonlyKnowledgeBase'
    | 'isReadonlyKnowledgeBase'
    | 'isKnowledgeMutationDisabled'
    | 'knowledgeMutationHint'
    | 'knowledgeDescription'
  >;
};

export function buildKnowledgeWorkbenchControllerMainStageInput(
  args: KnowledgeWorkbenchControllerMainStageArgs,
): Omit<KnowledgeWorkbenchMainStageProps, 'historicalSnapshotReadonlyHint'> {
  return {
    ...buildKnowledgeWorkbenchMainStageOverviewInput(args),
    ...buildKnowledgeWorkbenchMainStageEditorInput(args),
  };
}

export default buildKnowledgeWorkbenchControllerMainStageInput;
