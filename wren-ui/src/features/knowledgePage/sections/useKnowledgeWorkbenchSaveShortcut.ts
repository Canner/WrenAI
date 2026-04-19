import { useEffect } from 'react';
import type { KnowledgeWorkbenchSectionKey } from './knowledgeWorkbenchShared';

export function useKnowledgeWorkbenchSaveShortcut({
  activeWorkbenchSection,
  handleSubmitRuleDetail,
  handleSubmitSqlTemplateDetail,
  ruleDrawerOpen,
  sqlTemplateDrawerOpen,
}: {
  activeWorkbenchSection: KnowledgeWorkbenchSectionKey;
  handleSubmitRuleDetail: () => Promise<void>;
  handleSubmitSqlTemplateDetail: () => Promise<void>;
  ruleDrawerOpen: boolean;
  sqlTemplateDrawerOpen: boolean;
}) {
  useEffect(() => {
    if (
      activeWorkbenchSection !== 'sqlTemplates' &&
      activeWorkbenchSection !== 'instructions'
    ) {
      return;
    }

    const handler = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== 's'
      ) {
        return;
      }

      event.preventDefault();
      if (activeWorkbenchSection === 'sqlTemplates') {
        if (!sqlTemplateDrawerOpen) {
          return;
        }
        void handleSubmitSqlTemplateDetail();
        return;
      }

      if (!ruleDrawerOpen) {
        return;
      }
      void handleSubmitRuleDetail();
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [
    activeWorkbenchSection,
    handleSubmitRuleDetail,
    handleSubmitSqlTemplateDetail,
    ruleDrawerOpen,
    sqlTemplateDrawerOpen,
  ]);
}
