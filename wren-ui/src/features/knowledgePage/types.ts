import type { ReactNode } from 'react';
import type { DiagramModelRecommendation } from '@/types/modeling';

export type KnowledgeBaseRecord = {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  kind?: 'regular' | 'system_sample';
  description?: string | null;
  defaultKbSnapshotId?: string | null;
  createdBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  archivedAt?: string | null;
  snapshotCount?: number;
  assetCount?: number;
  defaultKbSnapshot?: {
    id: string;
    displayName: string;
    deployHash: string;
    status: string;
  } | null;
};

export type ConnectorView = {
  id: string;
  workspaceId: string;
  knowledgeBaseId?: string | null;
  type: string;
  displayName: string;
  config?: Record<string, any> | null;
  hasSecret?: boolean;
  createdBy?: string | null;
};

export type AssetFieldView = {
  key: string;
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
  nestedFields?: Array<{
    id: string;
    referenceName: string;
    displayName?: string | null;
    columnPath?: string[] | null;
    type?: string | null;
    description?: string | null;
  }> | null;
  relation?: {
    type?: string | null;
    modelName?: string | null;
    columnName?: string | null;
  } | null;
};

export type AssetView = {
  id: string;
  name: string;
  description?: string | null;
  kind: 'model' | 'view';
  modelId?: number | null;
  fieldCount: number;
  owner?: string | null;
  recommendation?: DiagramModelRecommendation | null;
  sourceTableName?: string | null;
  sourceSql?: string | null;
  primaryKey?: string | null;
  cached?: boolean;
  refreshTime?: string | null;
  relationCount?: number;
  nestedFieldCount?: number;
  suggestedQuestions?: string[];
  relationFields?: Array<{
    key: string;
    displayName: string;
    type?: string | null;
    modelName?: string | null;
    columnName?: string | null;
    note?: string | null;
  }>;
  fields: AssetFieldView[];
};

export type SelectedAssetTableValue = string | string[];

export type SourceOption = {
  key: string;
  label: string;
  icon: ReactNode;
  meta: string;
  category: 'demo' | 'connector';
};
