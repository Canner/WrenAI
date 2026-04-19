import { useEffect, useMemo, useRef, useState } from 'react';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';

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

export default function useHomeLandingPageSelectionState() {
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

  return {
    activeSelectedKnowledgeBaseIds,
    currentKnowledgeBases,
    draftSelectedSkillIds,
    knowledgeKeyword,
    knowledgeListScrollTop,
    knowledgeListViewportHeight,
    knowledgePickerOpen,
    runtimeSelectorState,
    selectedKnowledgeBaseIds,
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
    skillKeyword,
    skillPickerOpen,
  };
}
