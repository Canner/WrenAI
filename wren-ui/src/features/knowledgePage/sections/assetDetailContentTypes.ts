import type { AssetFieldView } from '@/features/knowledgePage/types';

export type AssetDetailFieldRow = {
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
  nestedFields?: AssetFieldView['nestedFields'];
};
