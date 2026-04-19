import type { KnowledgeWorkbenchSectionKey } from './knowledgeWorkbenchShared';

type BuildKnowledgeWorkbenchEditorOpenPlanParams = {
  activeWorkbenchSection: KnowledgeWorkbenchSectionKey;
  targetSection: Extract<
    KnowledgeWorkbenchSectionKey,
    'instructions' | 'sqlTemplates'
  >;
  currentEditingId?: string | number | null;
  nextEditingId?: string | number | null;
  hasDraftValues: boolean;
  drawerOpen: boolean;
  currentSectionDirty: boolean;
  counterpartSectionDirty: boolean;
  switchSection?: boolean;
};

export const buildKnowledgeWorkbenchEditorOpenPlan = ({
  activeWorkbenchSection,
  targetSection,
  currentEditingId,
  nextEditingId,
  hasDraftValues,
  drawerOpen,
  currentSectionDirty,
  counterpartSectionDirty,
  switchSection = true,
}: BuildKnowledgeWorkbenchEditorOpenPlanParams) => {
  const isSwitchingEditor =
    (nextEditingId || null) !== (currentEditingId || null) ||
    hasDraftValues ||
    Boolean(switchSection);

  const dirtyBeforeOpen =
    switchSection && activeWorkbenchSection !== targetSection
      ? counterpartSectionDirty
      : isSwitchingEditor
        ? currentSectionDirty
        : false;

  return {
    dirtyBeforeOpen,
    isSwitchingEditor,
    shouldOnlyEnsureDrawerOpen: !isSwitchingEditor && drawerOpen,
  };
};
