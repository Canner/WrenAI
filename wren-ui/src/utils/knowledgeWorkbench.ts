import type { ParsedUrlQuery } from 'querystring';
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

const MODELING_DEEP_LINK_KEYS = [
  'modelId',
  'viewId',
  'relationId',
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
  pathname.startsWith(Path.Knowledge) &&
  resolveKnowledgeWorkbenchSection(query?.section) === 'modeling';
