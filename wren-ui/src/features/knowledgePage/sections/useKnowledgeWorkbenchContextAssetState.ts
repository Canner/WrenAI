import { useEffect, useMemo, useState } from 'react';
import type { AssetView } from '@/features/knowledgePage/types';
import {
  buildKnowledgeWorkbenchContextAssetOptions,
  resolveKnowledgeWorkbenchContextAsset,
} from './knowledgeWorkbenchContextAssetUtils';

export function useKnowledgeWorkbenchContextAssetState({
  detailAssets,
}: {
  detailAssets: AssetView[];
}) {
  const [sqlContextAssetId, setSqlContextAssetId] = useState<string>();
  const [ruleContextAssetId, setRuleContextAssetId] = useState<string>();

  const sqlContextAsset = useMemo(
    () =>
      resolveKnowledgeWorkbenchContextAsset(detailAssets, sqlContextAssetId),
    [detailAssets, sqlContextAssetId],
  );
  const ruleContextAsset = useMemo(
    () =>
      resolveKnowledgeWorkbenchContextAsset(detailAssets, ruleContextAssetId),
    [detailAssets, ruleContextAssetId],
  );

  const sqlTemplateAssetOptions = useMemo(
    () => buildKnowledgeWorkbenchContextAssetOptions(detailAssets),
    [detailAssets],
  );

  useEffect(() => {
    if (sqlContextAssetId && !sqlContextAsset) {
      setSqlContextAssetId(undefined);
    }
  }, [sqlContextAsset, sqlContextAssetId]);

  useEffect(() => {
    if (ruleContextAssetId && !ruleContextAsset) {
      setRuleContextAssetId(undefined);
    }
  }, [ruleContextAsset, ruleContextAssetId]);

  return {
    ruleContextAsset,
    ruleContextAssetId,
    setRuleContextAssetId,
    setSqlContextAssetId,
    sqlContextAsset,
    sqlContextAssetId,
    sqlTemplateAssetOptions,
  };
}
