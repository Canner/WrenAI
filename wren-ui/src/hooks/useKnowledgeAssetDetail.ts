import { useEffect, useMemo } from 'react';

export type KnowledgeDetailFieldFilter =
  | 'all'
  | 'primary'
  | 'calculated'
  | 'noted';

export type KnowledgeDetailField = {
  aiName?: string | null;
  fieldName: string;
  fieldType?: string | null;
  note?: string | null;
  sourceColumnName?: string | null;
  isPrimaryKey?: boolean;
  isCalculated?: boolean;
};

export type KnowledgeDetailAsset<TField extends KnowledgeDetailField> = {
  id: string;
  fields: TField[];
};

export const resolveActiveKnowledgeDetailAsset = <
  TField extends KnowledgeDetailField,
  TAsset extends KnowledgeDetailAsset<TField>,
>(
  detailAssets: TAsset[],
  detailAsset?: TAsset | null,
) => {
  if (!detailAsset) {
    return null;
  }

  return (
    detailAssets.find((asset) => asset.id === detailAsset.id) || detailAsset
  );
};

export const filterKnowledgeDetailFields = <
  TField extends KnowledgeDetailField,
>({
  fields,
  keyword,
  filter,
}: {
  fields: TField[];
  keyword: string;
  filter: KnowledgeDetailFieldFilter;
}) => {
  const normalizedKeyword = keyword.trim().toLowerCase();

  return fields.filter((field) => {
    if (filter === 'primary' && !field.isPrimaryKey) {
      return false;
    }
    if (filter === 'calculated' && !field.isCalculated) {
      return false;
    }
    if (filter === 'noted' && !field.note) {
      return false;
    }

    if (!normalizedKeyword) {
      return true;
    }

    const haystack = [
      field.aiName,
      field.fieldName,
      field.fieldType,
      field.note,
      field.sourceColumnName,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalizedKeyword);
  });
};

export default function useKnowledgeAssetDetail<
  TField extends KnowledgeDetailField,
  TAsset extends KnowledgeDetailAsset<TField>,
>({
  detailAssets,
  detailAsset,
  detailFieldKeyword,
  detailFieldFilter,
  resetDetailViewState,
}: {
  detailAssets: TAsset[];
  detailAsset?: TAsset | null;
  detailFieldKeyword: string;
  detailFieldFilter: KnowledgeDetailFieldFilter;
  resetDetailViewState: () => void;
}) {
  const activeDetailAsset = useMemo(
    () => resolveActiveKnowledgeDetailAsset(detailAssets, detailAsset),
    [detailAsset, detailAssets],
  );

  const detailAssetFields = useMemo(
    () =>
      filterKnowledgeDetailFields({
        fields: activeDetailAsset?.fields || [],
        keyword: detailFieldKeyword,
        filter: detailFieldFilter,
      }),
    [activeDetailAsset?.fields, detailFieldFilter, detailFieldKeyword],
  );

  useEffect(() => {
    if (!detailAsset) {
      resetDetailViewState();
    }
  }, [detailAsset, resetDetailViewState]);

  return {
    activeDetailAsset,
    detailAssetFields,
  };
}
