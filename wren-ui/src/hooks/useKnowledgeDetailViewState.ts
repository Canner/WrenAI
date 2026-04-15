import { useCallback, useState } from 'react';
import type { KnowledgeDetailFieldFilter } from './useKnowledgeAssetDetail';

export const createDefaultKnowledgeDetailViewState = () => ({
  detailTab: 'overview' as const,
  detailFieldKeyword: '',
  detailFieldFilter: 'all' as const,
});

export const resetKnowledgeDetailViewState = ({
  setDetailTab,
  setDetailFieldKeyword,
  setDetailFieldFilter,
}: {
  setDetailTab: (value: 'overview' | 'fields' | 'usage') => void;
  setDetailFieldKeyword: (value: string) => void;
  setDetailFieldFilter: (value: KnowledgeDetailFieldFilter) => void;
}) => {
  const defaults = createDefaultKnowledgeDetailViewState();
  setDetailTab(defaults.detailTab);
  setDetailFieldKeyword(defaults.detailFieldKeyword);
  setDetailFieldFilter(defaults.detailFieldFilter);
};

export default function useKnowledgeDetailViewState() {
  const defaults = createDefaultKnowledgeDetailViewState();
  const [detailTab, setDetailTab] = useState<'overview' | 'fields' | 'usage'>(
    defaults.detailTab,
  );
  const [detailFieldKeyword, setDetailFieldKeyword] = useState(
    defaults.detailFieldKeyword,
  );
  const [detailFieldFilter, setDetailFieldFilter] =
    useState<KnowledgeDetailFieldFilter>(defaults.detailFieldFilter);

  const resetDetailViewState = useCallback(() => {
    resetKnowledgeDetailViewState({
      setDetailTab,
      setDetailFieldKeyword,
      setDetailFieldFilter,
    });
  }, []);

  return {
    detailTab,
    setDetailTab,
    detailFieldKeyword,
    setDetailFieldKeyword,
    detailFieldFilter,
    setDetailFieldFilter,
    resetDetailViewState,
  };
}
