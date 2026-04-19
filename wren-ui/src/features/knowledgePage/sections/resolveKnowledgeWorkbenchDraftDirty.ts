import type { KnowledgeWorkbenchSectionKey } from './knowledgeWorkbenchShared';

type ResolveKnowledgeWorkbenchDraftDirtyArgs = {
  isRuleDraftDirty: boolean;
  isSqlDraftDirty: boolean;
  section: KnowledgeWorkbenchSectionKey;
};

export default function resolveKnowledgeWorkbenchDraftDirty({
  isRuleDraftDirty,
  isSqlDraftDirty,
  section,
}: ResolveKnowledgeWorkbenchDraftDirtyArgs) {
  if (section === 'instructions') {
    return isRuleDraftDirty;
  }

  if (section === 'sqlTemplates') {
    return isSqlDraftDirty;
  }

  return false;
}
