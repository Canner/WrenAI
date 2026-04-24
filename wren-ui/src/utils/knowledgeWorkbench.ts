import type { ParsedUrlQuery } from 'querystring';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { Path } from '@/utils/enum';

export const KNOWLEDGE_WORKBENCH_SECTIONS = [
  'overview',
  'modeling',
  'sqlTemplates',
  'instructions',
] as const;

export type KnowledgeWorkbenchSection =
  (typeof KNOWLEDGE_WORKBENCH_SECTIONS)[number];

export const isKnowledgeWorkbenchSection = (
  value: unknown,
): value is KnowledgeWorkbenchSection =>
  typeof value === 'string' &&
  (KNOWLEDGE_WORKBENCH_SECTIONS as readonly string[]).includes(value);

export const resolveKnowledgeWorkbenchSection = (
  value: unknown,
  fallback: KnowledgeWorkbenchSection = 'overview',
): KnowledgeWorkbenchSection => {
  if (value === 'assets') {
    return 'overview';
  }

  return isKnowledgeWorkbenchSection(value) ? value : fallback;
};

export const isKnowledgeWorkbenchRoute = (pathname: string) =>
  pathname.startsWith(Path.Knowledge);

export const isLegacyModelingRoute = (pathname: string) =>
  pathname.startsWith(Path.Modeling);

export const isModelingAssistantRoute = (pathname: string) =>
  pathname.startsWith(Path.RecommendRelationships) ||
  pathname.startsWith(Path.RecommendSemantics);

const MODELING_DEEP_LINK_KEYS = [
  'modelId',
  'viewId',
  'relationId',
  'openAssistant',
  'openMetadata',
  'openModelDrawer',
  'openRelationModal',
] as const;

const readSingleQueryValue = (value: unknown): string | undefined => {
  if (Array.isArray(value)) {
    return readSingleQueryValue(value[0]);
  }

  return typeof value === 'string' && value.trim() ? value : undefined;
};

export const buildKnowledgeModelingRouteParams = (
  query?: ParsedUrlQuery | Record<string, unknown>,
) => {
  const deepLinkParams = Object.fromEntries(
    MODELING_DEEP_LINK_KEYS.flatMap((key) => {
      const value = readSingleQueryValue(query?.[key]);
      return value ? [[key, value]] : [];
    }),
  );

  return buildKnowledgeWorkbenchParams('modeling', deepLinkParams);
};

export const buildKnowledgeWorkbenchParams = (
  section: KnowledgeWorkbenchSection,
  extraParams: Record<string, string | number | boolean> = {},
) =>
  section === 'overview'
    ? extraParams
    : {
        section,
        ...extraParams,
      };

export const isKnowledgeModelingRoute = ({
  pathname,
  query,
}: {
  pathname: string;
  query?: ParsedUrlQuery | Record<string, unknown>;
}) =>
  isKnowledgeWorkbenchRoute(pathname) &&
  resolveKnowledgeWorkbenchSection(query?.section) === 'modeling';

export const isModelingSurfaceRoute = ({
  pathname,
  query,
}: {
  pathname: string;
  query?: ParsedUrlQuery | Record<string, unknown>;
}) =>
  isLegacyModelingRoute(pathname) ||
  isKnowledgeModelingRoute({
    pathname,
    query,
  });

export type KnowledgeWorkbenchRouteKnowledgeBase = {
  id: string;
  workspaceId: string;
  defaultKbSnapshot?: {
    id: string;
    deployHash: string;
  } | null;
};

export const resolveKnowledgeWorkbenchRuntimeSelector = ({
  knowledgeBase,
  fallbackSelector,
}: {
  knowledgeBase?: KnowledgeWorkbenchRouteKnowledgeBase | null;
  fallbackSelector: ClientRuntimeScopeSelector;
}): ClientRuntimeScopeSelector => {
  if (!knowledgeBase) {
    return fallbackSelector;
  }

  return {
    workspaceId: knowledgeBase.workspaceId,
    knowledgeBaseId: knowledgeBase.id,
    ...(knowledgeBase.defaultKbSnapshot?.id
      ? { kbSnapshotId: knowledgeBase.defaultKbSnapshot.id }
      : {}),
    ...(knowledgeBase.defaultKbSnapshot?.deployHash
      ? { deployHash: knowledgeBase.defaultKbSnapshot.deployHash }
      : {}),
  };
};

export const buildKnowledgeWorkbenchUrl = ({
  buildRuntimeScopeUrl,
  knowledgeBase,
  fallbackSelector,
  section = 'overview',
  extraParams = {},
}: {
  buildRuntimeScopeUrl: (
    path: string,
    query?: Record<string, string | number | boolean | null | undefined>,
    selector?: ClientRuntimeScopeSelector,
  ) => string;
  knowledgeBase?: KnowledgeWorkbenchRouteKnowledgeBase | null;
  fallbackSelector: ClientRuntimeScopeSelector;
  section?: KnowledgeWorkbenchSection;
  extraParams?: Record<string, string | number | boolean | null | undefined>;
}) => {
  const normalizedExtraParams = Object.fromEntries(
    Object.entries(extraParams).filter(
      (entry): entry is [string, string | number | boolean] =>
        entry[1] !== undefined && entry[1] !== null,
    ),
  );

  return buildRuntimeScopeUrl(
    Path.Knowledge,
    buildKnowledgeWorkbenchParams(section, normalizedExtraParams),
    resolveKnowledgeWorkbenchRuntimeSelector({
      knowledgeBase,
      fallbackSelector,
    }),
  );
};
