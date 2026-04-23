export type HomeIntentKind =
  | 'ASK'
  | 'CHART'
  | 'RECOMMEND_QUESTIONS'
  | 'GENERAL_HELP'
  | 'USER_GUIDE'
  | 'MISLEADING_QUERY';

export type HomeIntentMode = 'NEW' | 'FOLLOW_UP' | 'EXPLICIT_ACTION';

export type HomeResultTarget =
  | 'THREAD_RESPONSE'
  | 'THREAD_SIDECAR'
  | 'EXISTING_RESPONSE';

export type InlineArtifactKind = 'preview_teaser' | 'chart_teaser';

export type WorkbenchArtifactKind = 'preview' | 'sql' | 'chart';

export type ThreadConversationAidKind = 'suggested_questions';

export type ConversationAidInteractionMode =
  | 'draft_to_composer'
  | 'execute_intent';

export type ResponseConversationAidKind =
  | 'TRIGGER_CHART_FOLLOWUP'
  | 'TRIGGER_RECOMMEND_QUESTIONS'
  | 'TRIGGER_CHART_REFINE';

export type ConversationAidItem = {
  interactionMode: ConversationAidInteractionMode;
  kind: ResponseConversationAidKind;
  label: string;
  prompt: string;
  sourceResponseId?: number | null;
  suggestedIntent?: HomeIntentKind | null;
};

export type ConversationAidPlan = {
  responseAids?: ConversationAidItem[] | null;
  threadAids?: ThreadConversationAidKind[] | null;
};

export type WorkbenchHeaderActionKind =
  | 'close'
  | 'open_spreadsheet'
  | 'copy_sql'
  | 'adjust_sql'
  | 'pin_dashboard';

export type ComposerDraftIntent = {
  draftKey: string;
  draftedAt: string;
  draftedPrompt: string;
  intentHint: HomeIntentKind;
  sourceAidKind?: ResponseConversationAidKind | null;
  sourceResponseId?: number | null;
};

export type HomeIntentEntryPoint =
  | 'composer'
  | 'response_action'
  | 'thread_action'
  | 'workbench_action';

export type ResponseArtifactPlan = {
  teaserArtifacts: InlineArtifactKind[];
  workbenchArtifacts: WorkbenchArtifactKind[];
  primaryTeaser?: InlineArtifactKind | null;
  primaryWorkbenchArtifact?: WorkbenchArtifactKind | null;
};

export type ResponseArtifactLineage = {
  sourceResponseId?: number | null;
  inheritedWorkbenchArtifacts?: WorkbenchArtifactKind[] | null;
};

export type HomeIntentEnvelope = {
  entrypoint: HomeIntentEntryPoint;
  intentHint?: HomeIntentKind | null;
  sourceThreadId?: number | null;
  sourceResponseId?: number | null;
  sourceWorkbenchArtifacts?: WorkbenchArtifactKind[] | null;
  preferredWorkbenchArtifact?: WorkbenchArtifactKind | null;
};

export type ResolvedHomeIntent = {
  kind: HomeIntentKind;
  mode: HomeIntentMode;
  target: HomeResultTarget;
  source: 'explicit' | 'classifier' | 'derived';
  sourceThreadId?: number | null;
  sourceResponseId?: number | null;
  confidence?: number | null;
  artifactPlan?: ResponseArtifactPlan | null;
  conversationAidPlan?: ConversationAidPlan | null;
};
