import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { Path } from '@/utils/enum';
import {
  buildKnowledgeWorkbenchUrl,
  buildKnowledgeWorkbenchParams,
  type KnowledgeWorkbenchRouteKnowledgeBase,
  resolveKnowledgeWorkbenchSection,
  type KnowledgeWorkbenchSection,
} from '@/utils/knowledgeWorkbench';
import { blurActiveElement } from './constants';

export default function useKnowledgeWorkbenchSectionRouting<
  TKnowledgeBase extends KnowledgeWorkbenchRouteKnowledgeBase,
>({
  routerQuery,
  replaceWorkspace,
  buildRuntimeScopeUrl,
  buildKnowledgeRuntimeSelector,
}: {
  routerQuery: Record<string, string | string[] | undefined>;
  replaceWorkspace: (
    path: string,
    params?: Record<string, string | number | boolean | null | undefined>,
  ) => Promise<unknown>;
  buildRuntimeScopeUrl: (
    path: string,
    query?: Record<string, string | number | boolean | null | undefined>,
    selector?: ClientRuntimeScopeSelector,
  ) => string;
  buildKnowledgeRuntimeSelector: (
    knowledgeBase?: TKnowledgeBase | null,
  ) => ClientRuntimeScopeSelector;
}) {
  const [activeWorkbenchSection, setActiveWorkbenchSection] =
    useState<KnowledgeWorkbenchSection>(() =>
      resolveKnowledgeWorkbenchSection(routerQuery.section),
    );
  const queryWorkbenchSection = useMemo(
    () => resolveKnowledgeWorkbenchSection(routerQuery.section),
    [routerQuery.section],
  );

  const handleChangeWorkbenchSection = useCallback(
    (nextSection: KnowledgeWorkbenchSection) => {
      setActiveWorkbenchSection(nextSection);
      blurActiveElement();
      return replaceWorkspace(
        Path.Knowledge,
        buildKnowledgeWorkbenchParams(nextSection),
      );
    },
    [replaceWorkspace],
  );

  const buildKnowledgeSwitchUrl = useCallback(
    (knowledgeBase: TKnowledgeBase) =>
      buildKnowledgeWorkbenchUrl({
        buildRuntimeScopeUrl,
        knowledgeBase,
        fallbackSelector: buildKnowledgeRuntimeSelector(),
        section: activeWorkbenchSection,
      }),
    [
      activeWorkbenchSection,
      buildKnowledgeRuntimeSelector,
      buildRuntimeScopeUrl,
    ],
  );

  const handleNavigateModeling = useCallback(
    () => handleChangeWorkbenchSection('modeling'),
    [handleChangeWorkbenchSection],
  );

  useEffect(() => {
    const hasModelingIntent = Boolean(
      routerQuery.openModelDrawer ||
      routerQuery.openMetadata ||
      routerQuery.openRelationModal,
    );

    if (hasModelingIntent) {
      setActiveWorkbenchSection('modeling');
      return;
    }

    setActiveWorkbenchSection((currentSection) =>
      currentSection === queryWorkbenchSection
        ? currentSection
        : queryWorkbenchSection,
    );
  }, [
    queryWorkbenchSection,
    routerQuery.openMetadata,
    routerQuery.openModelDrawer,
    routerQuery.openRelationModal,
  ]);

  return {
    activeWorkbenchSection,
    handleChangeWorkbenchSection,
    buildKnowledgeSwitchUrl,
    handleNavigateModeling,
  };
}
