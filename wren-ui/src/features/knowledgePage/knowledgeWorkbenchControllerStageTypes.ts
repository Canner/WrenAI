import type { ActionsInput } from './knowledgeWorkbenchControllerStageActionsTypes';
import type { ContentDataInput } from './knowledgeWorkbenchControllerStageContentTypes';
import type { KnowledgeStateInput } from './knowledgeWorkbenchControllerStageKnowledgeTypes';
import type { LocalStateInput } from './knowledgeWorkbenchControllerStageLocalTypes';
import type { ModelingStateInput } from './knowledgeWorkbenchControllerStageModelingTypes';
import type { RuleSqlStateInput } from './knowledgeWorkbenchControllerStageRuleSqlTypes';
import type { ViewStateInput } from './knowledgeWorkbenchControllerStageViewTypes';

export type { ActionsInput } from './knowledgeWorkbenchControllerStageActionsTypes';
export type { ContentDataInput } from './knowledgeWorkbenchControllerStageContentTypes';
export type { KnowledgeStateInput } from './knowledgeWorkbenchControllerStageKnowledgeTypes';
export type { LocalStateInput } from './knowledgeWorkbenchControllerStageLocalTypes';
export type { ModelingStateInput } from './knowledgeWorkbenchControllerStageModelingTypes';
export type { RuleSqlStateInput } from './knowledgeWorkbenchControllerStageRuleSqlTypes';
export type { ViewStateInput } from './knowledgeWorkbenchControllerStageViewTypes';

export type KnowledgeWorkbenchControllerStageArgs = {
  actions: ActionsInput;
  contentData: ContentDataInput;
  knowledgeState: KnowledgeStateInput;
  localState: LocalStateInput;
  modelingState: ModelingStateInput;
  ruleSqlState: RuleSqlStateInput;
  viewState: ViewStateInput;
};
