import { useCallback } from 'react';
import type { KnowledgeWorkbenchSectionKey } from './knowledgeWorkbenchShared';
import resolveKnowledgeWorkbenchDraftDirty from './resolveKnowledgeWorkbenchDraftDirty';

export function useKnowledgeWorkbenchSectionChangeGuard({
  activeWorkbenchSection,
  isRuleDraftDirty,
  isSqlDraftDirty,
  onChangeWorkbenchSection,
  runWithDirtyGuard,
  setRuleDrawerOpen,
  setSqlTemplateDrawerOpen,
}: {
  activeWorkbenchSection: KnowledgeWorkbenchSectionKey;
  isRuleDraftDirty: boolean;
  isSqlDraftDirty: boolean;
  onChangeWorkbenchSection: (
    nextSection: KnowledgeWorkbenchSectionKey,
  ) => void | Promise<void>;
  runWithDirtyGuard: (
    dirty: boolean,
    action: () => void | Promise<void>,
  ) => Promise<boolean>;
  setRuleDrawerOpen: (open: boolean) => void;
  setSqlTemplateDrawerOpen: (open: boolean) => void;
}) {
  return useCallback(
    async (nextSection: KnowledgeWorkbenchSectionKey) => {
      if (nextSection === activeWorkbenchSection) {
        return;
      }

      const dirty = resolveKnowledgeWorkbenchDraftDirty({
        isRuleDraftDirty,
        isSqlDraftDirty,
        section: activeWorkbenchSection,
      });

      await runWithDirtyGuard(dirty, () => {
        setSqlTemplateDrawerOpen(false);
        setRuleDrawerOpen(false);
        return onChangeWorkbenchSection(nextSection);
      });
    },
    [
      activeWorkbenchSection,
      isRuleDraftDirty,
      isSqlDraftDirty,
      onChangeWorkbenchSection,
      runWithDirtyGuard,
      setRuleDrawerOpen,
      setSqlTemplateDrawerOpen,
    ],
  );
}
