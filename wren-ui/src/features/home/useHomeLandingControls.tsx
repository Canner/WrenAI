import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
  type UIEvent,
} from 'react';
import type { HomeSkillOption } from './homeSkillOptions';
import {
  HOME_KNOWLEDGE_PICKER_ITEM_ESTIMATED_HEIGHT,
  HOME_KNOWLEDGE_PICKER_VIRTUALIZATION_THRESHOLD,
  HOME_KNOWLEDGE_PICKER_VIRTUAL_OVERSCAN,
} from './homePageRuntime';
import { getReferenceDisplayKnowledgeName } from '@/utils/referenceDemoKnowledge';

type KnowledgeBaseSummary = {
  id: string;
  name?: string | null;
};

export function useHomeLandingControls({
  composerShellRef,
  currentKnowledgeBases,
  draftSelectedSkillIds,
  knowledgeKeyword,
  knowledgeListScrollTop,
  knowledgeListViewportHeight,
  knowledgePickerOpen,
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
  skillOptions,
  skillKeyword,
}: {
  composerShellRef: RefObject<HTMLDivElement>;
  currentKnowledgeBases: KnowledgeBaseSummary[];
  draftSelectedSkillIds: string[];
  knowledgeKeyword: string;
  knowledgeListScrollTop: number;
  knowledgeListViewportHeight: number;
  knowledgePickerOpen: boolean;
  selectedKnowledgeBaseIds: string[];
  selectedSkillIds: string[];
  setDraftSelectedSkillIds: Dispatch<SetStateAction<string[]>>;
  setKnowledgeKeyword: Dispatch<SetStateAction<string>>;
  setKnowledgeListScrollTop: Dispatch<SetStateAction<number>>;
  setKnowledgeListViewportHeight: Dispatch<SetStateAction<number>>;
  setKnowledgePickerOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedKnowledgeBaseIds: Dispatch<SetStateAction<string[]>>;
  setSelectedSkillIds: Dispatch<SetStateAction<string[]>>;
  setSkillKeyword: Dispatch<SetStateAction<string>>;
  setSkillPickerOpen: Dispatch<SetStateAction<boolean>>;
  skillOptions: HomeSkillOption[];
  skillKeyword: string;
}) {
  const knowledgeListViewportRef = useRef<HTMLDivElement>(null);

  const sortedSkillOptions = useMemo(
    () =>
      skillOptions
        .map((option) => ({
          ...option,
          recommendationScore: option.knowledgeBaseIds.filter(
            (knowledgeBaseId) =>
              selectedKnowledgeBaseIds.includes(knowledgeBaseId),
          ).length,
        }))
        .sort((left, right) => {
          const scoreDiff =
            right.recommendationScore - left.recommendationScore;
          if (scoreDiff !== 0) {
            return scoreDiff;
          }

          return left.name.localeCompare(right.name, 'zh-CN');
        })
        .map(
          ({ recommendationScore: _recommendationScore, ...option }) => option,
        ),
    [selectedKnowledgeBaseIds, skillOptions],
  );

  const selectedKnowledgeBases = useMemo(() => {
    return selectedKnowledgeBaseIds
      .map((id) =>
        currentKnowledgeBases.find((knowledgeBase) => knowledgeBase.id === id),
      )
      .filter(
        (
          knowledgeBase,
        ): knowledgeBase is NonNullable<
          (typeof currentKnowledgeBases)[number]
        > => Boolean(knowledgeBase),
      );
  }, [currentKnowledgeBases, selectedKnowledgeBaseIds]);

  const filteredKnowledgeBases = useMemo(() => {
    const query = knowledgeKeyword.trim().toLowerCase();
    if (!query) {
      return currentKnowledgeBases;
    }

    return currentKnowledgeBases.filter((knowledgeBase) => {
      const displayName = getReferenceDisplayKnowledgeName(knowledgeBase.name);
      return (
        knowledgeBase.name?.toLowerCase().includes(query) ||
        displayName.toLowerCase().includes(query)
      );
    });
  }, [currentKnowledgeBases, knowledgeKeyword]);

  const shouldVirtualizeKnowledgeList =
    filteredKnowledgeBases.length >=
    HOME_KNOWLEDGE_PICKER_VIRTUALIZATION_THRESHOLD;

  const knowledgeVirtualWindow = useMemo(() => {
    if (!shouldVirtualizeKnowledgeList) {
      return {
        startIndex: 0,
        endIndex: filteredKnowledgeBases.length,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      };
    }

    const viewportHeight = Math.max(
      knowledgeListViewportHeight,
      HOME_KNOWLEDGE_PICKER_ITEM_ESTIMATED_HEIGHT,
    );
    const visibleCount = Math.max(
      1,
      Math.ceil(viewportHeight / HOME_KNOWLEDGE_PICKER_ITEM_ESTIMATED_HEIGHT),
    );
    const startIndex = Math.max(
      0,
      Math.floor(
        knowledgeListScrollTop / HOME_KNOWLEDGE_PICKER_ITEM_ESTIMATED_HEIGHT,
      ) - HOME_KNOWLEDGE_PICKER_VIRTUAL_OVERSCAN,
    );
    const endIndex = Math.min(
      filteredKnowledgeBases.length,
      startIndex + visibleCount + HOME_KNOWLEDGE_PICKER_VIRTUAL_OVERSCAN * 2,
    );

    return {
      startIndex,
      endIndex,
      topSpacerHeight: startIndex * HOME_KNOWLEDGE_PICKER_ITEM_ESTIMATED_HEIGHT,
      bottomSpacerHeight:
        (filteredKnowledgeBases.length - endIndex) *
        HOME_KNOWLEDGE_PICKER_ITEM_ESTIMATED_HEIGHT,
    };
  }, [
    filteredKnowledgeBases.length,
    knowledgeListScrollTop,
    knowledgeListViewportHeight,
    shouldVirtualizeKnowledgeList,
  ]);

  const visibleKnowledgeBases = useMemo(
    () =>
      filteredKnowledgeBases.slice(
        knowledgeVirtualWindow.startIndex,
        knowledgeVirtualWindow.endIndex,
      ),
    [
      filteredKnowledgeBases,
      knowledgeVirtualWindow.endIndex,
      knowledgeVirtualWindow.startIndex,
    ],
  );

  const filteredSkillOptions = useMemo(() => {
    const query = skillKeyword.trim().toLowerCase();
    if (!query) {
      return sortedSkillOptions;
    }

    return sortedSkillOptions.filter((option) => {
      const knowledgeNames = option.knowledgeBaseIds
        .map((knowledgeBaseId) => {
          const matchedKnowledgeBase = currentKnowledgeBases.find(
            (knowledgeBase) => knowledgeBase.id === knowledgeBaseId,
          );
          return getReferenceDisplayKnowledgeName(
            matchedKnowledgeBase?.name || knowledgeBaseId,
          );
        })
        .join(' ');

      return (
        option.name.toLowerCase().includes(query) ||
        `${option.runtimeKind || ''} ${option.sourceType || ''} ${knowledgeNames}`
          .toLowerCase()
          .includes(query)
      );
    });
  }, [currentKnowledgeBases, skillKeyword, sortedSkillOptions]);

  useEffect(() => {
    setSelectedSkillIds((previous) =>
      previous.filter((skillId) =>
        skillOptions.some((option) => option.id === skillId),
      ),
    );
  }, [skillOptions]);

  useEffect(() => {
    if (!knowledgePickerOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (
        composerShellRef.current &&
        !composerShellRef.current.contains(event.target as Node)
      ) {
        setKnowledgePickerOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [composerShellRef, knowledgePickerOpen]);

  useEffect(() => {
    if (!knowledgePickerOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setKnowledgePickerOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [knowledgePickerOpen]);

  useEffect(() => {
    if (!knowledgePickerOpen || !shouldVirtualizeKnowledgeList) {
      setKnowledgeListScrollTop(0);
      return;
    }

    const viewport = knowledgeListViewportRef.current;
    if (!viewport) {
      return;
    }

    const measureViewport = () => {
      setKnowledgeListViewportHeight(viewport.clientHeight);
    };

    viewport.scrollTop = 0;
    measureViewport();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      measureViewport();
    });
    observer.observe(viewport);

    return () => {
      observer.disconnect();
    };
  }, [
    filteredKnowledgeBases.length,
    knowledgePickerOpen,
    shouldVirtualizeKnowledgeList,
  ]);

  useEffect(() => {
    if (!knowledgePickerOpen) {
      return;
    }

    setKnowledgeListScrollTop(0);
    if (knowledgeListViewportRef.current) {
      knowledgeListViewportRef.current.scrollTop = 0;
    }
  }, [knowledgeKeyword, knowledgePickerOpen]);

  const handleKnowledgeListScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (!shouldVirtualizeKnowledgeList) {
        return;
      }
      setKnowledgeListScrollTop(event.currentTarget.scrollTop);
    },
    [shouldVirtualizeKnowledgeList],
  );

  const openKnowledgePicker = useCallback(() => {
    setKnowledgeKeyword('');
    setKnowledgeListScrollTop(0);
    setKnowledgePickerOpen(true);
  }, []);

  const toggleKnowledgePicker = useCallback(() => {
    if (knowledgePickerOpen) {
      setKnowledgePickerOpen(false);
      return;
    }

    openKnowledgePicker();
  }, [knowledgePickerOpen, openKnowledgePicker]);

  const openSkillPicker = useCallback(() => {
    setDraftSelectedSkillIds(selectedSkillIds);
    setSkillKeyword('');
    setSkillPickerOpen(true);
  }, [selectedSkillIds]);

  const toggleDraftSkill = useCallback((skillId: string) => {
    setDraftSelectedSkillIds((previous) =>
      previous.includes(skillId)
        ? previous.filter((item) => item !== skillId)
        : [...previous, skillId],
    );
  }, []);

  const applyKnowledgeSelection = useCallback((knowledgeBaseId: string) => {
    if (!knowledgeBaseId) {
      return;
    }

    setSelectedKnowledgeBaseIds((previous) =>
      previous.includes(knowledgeBaseId)
        ? previous.filter((item) => item !== knowledgeBaseId)
        : [...previous, knowledgeBaseId],
    );
  }, []);

  const removeKnowledgeSelection = useCallback((knowledgeBaseId: string) => {
    if (!knowledgeBaseId) {
      return;
    }

    setSelectedKnowledgeBaseIds((previous) =>
      previous.filter((item) => item !== knowledgeBaseId),
    );
  }, []);

  const applySkillSelection = useCallback(() => {
    setSelectedSkillIds(draftSelectedSkillIds);
    setSkillPickerOpen(false);
  }, [draftSelectedSkillIds]);

  return {
    applyKnowledgeSelection,
    applySkillSelection,
    closeSkillPicker: () => setSkillPickerOpen(false),
    filteredKnowledgeBases,
    filteredSkillOptions,
    handleKnowledgeListScroll,
    knowledgeBottomSpacerHeight: knowledgeVirtualWindow.bottomSpacerHeight,
    knowledgeListViewportRef,
    knowledgeTopSpacerHeight: knowledgeVirtualWindow.topSpacerHeight,
    openKnowledgePicker,
    openSkillPicker,
    removeKnowledgeSelection,
    selectedKnowledgeBases,
    shouldVirtualizeKnowledgeList,
    toggleDraftSkill,
    toggleKnowledgePicker,
    visibleKnowledgeBases,
  };
}
