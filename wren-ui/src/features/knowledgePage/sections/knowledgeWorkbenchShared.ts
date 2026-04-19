import type { AssetView } from '@/features/knowledgePage/types';

export type KnowledgeWorkbenchSectionKey =
  | 'overview'
  | 'modeling'
  | 'sqlTemplates'
  | 'instructions';

export type KnowledgeWorkbenchDetailTab = 'overview' | 'fields' | 'usage';

export type KnowledgeWorkbenchModelingSummary = {
  modelCount: number;
  viewCount: number;
  relationCount: number;
};

export type KnowledgeAssetDetailField = {
  key?: string;
  fieldName: string;
  fieldType?: string | null;
  aiName?: string | null;
  example?: string | null;
  enumValue?: string | null;
  note?: string | null;
  sourceColumnName?: string | null;
  isPrimaryKey?: boolean;
  isCalculated?: boolean;
  aggregation?: string | null;
  lineage?: number[] | null;
  nestedFields?: AssetView['fields'][number]['nestedFields'];
};

export const WORKBENCH_EDITOR_DRAWER_WIDTH = 640;
export const WORKBENCH_EDITOR_DRAWER_BODY_STYLE = {
  padding: 0,
  background: '#ffffff',
  display: 'flex',
  flexDirection: 'column' as const,
  height: '100%',
};
export const WORKBENCH_EDITOR_DRAWER_CONTENT_STYLE = {
  flex: 1,
  overflowY: 'auto' as const,
  padding: '16px 16px 96px',
};
export const WORKBENCH_EDITOR_DRAWER_FOOTER_STYLE = {
  position: 'sticky' as const,
  bottom: 0,
  zIndex: 2,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '14px 16px',
  borderTop: '1px solid #eef2f7',
  background: '#ffffff',
};
export const WORKBENCH_EDITOR_DRAWER_FOOTER_GROUP_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};
