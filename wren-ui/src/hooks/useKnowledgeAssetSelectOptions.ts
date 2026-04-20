import { useMemo } from 'react';
import type { CompactTable } from '@/types/dataSource';
import {
  getCompactTableQualifiedName,
  getCompactTableScopedName,
} from '@/utils/compactTable';

type ConnectorLike = {
  id: string;
  displayName: string;
  type: string;
};

type AssetLike = {
  sourceTableName?: string | null;
};

export type KnowledgeAssetSelectOption = {
  disabled?: boolean;
  imported?: boolean;
  label: string;
  value: string;
};

export const resolveKnowledgeConnectorOptions = (
  connectors: ConnectorLike[],
): KnowledgeAssetSelectOption[] =>
  connectors.map((connector) => ({
    label: `${connector.displayName} · ${connector.type}`,
    value: connector.id,
  }));

export const resolveKnowledgeAssetDatabaseOptions = ({
  isDemoSource,
  demoDatabaseOptions,
  connectorOptions,
}: {
  isDemoSource: boolean;
  demoDatabaseOptions: KnowledgeAssetSelectOption[];
  connectorOptions: KnowledgeAssetSelectOption[];
}) => (isDemoSource ? demoDatabaseOptions : connectorOptions);

export const resolveImportedConnectorTableNames = (assets: AssetLike[] = []) =>
  new Set(
    assets
      .map((asset) => asset.sourceTableName?.trim())
      .filter((value): value is string => Boolean(value)),
  );

export const resolveKnowledgeAssetTableOptions = ({
  assets,
  isDemoSource,
  demoTableOptions,
  connectorTables,
}: {
  assets?: AssetLike[];
  isDemoSource: boolean;
  demoTableOptions: KnowledgeAssetSelectOption[];
  connectorTables: CompactTable[];
}): KnowledgeAssetSelectOption[] => {
  if (isDemoSource) {
    return demoTableOptions;
  }

  const importedSourceTableNames = resolveImportedConnectorTableNames(assets);

  return connectorTables.map((table) => {
    const qualifiedName = getCompactTableQualifiedName(table);
    const scopedName = getCompactTableScopedName(table);
    const imported =
      importedSourceTableNames.has(table.name) ||
      importedSourceTableNames.has(scopedName) ||
      importedSourceTableNames.has(qualifiedName);

    return {
      disabled: imported,
      imported,
      label: imported ? `${qualifiedName} · 已导入` : qualifiedName,
      value: qualifiedName,
    };
  });
};

export default function useKnowledgeAssetSelectOptions({
  assets,
  connectors,
  isDemoSource,
  demoDatabaseOptions,
  demoTableOptions,
  connectorTables,
}: {
  assets: AssetLike[];
  connectors: ConnectorLike[];
  isDemoSource: boolean;
  demoDatabaseOptions: KnowledgeAssetSelectOption[];
  demoTableOptions: KnowledgeAssetSelectOption[];
  connectorTables: CompactTable[];
}) {
  const connectorOptions = useMemo(
    () => resolveKnowledgeConnectorOptions(connectors),
    [connectors],
  );
  const assetDatabaseOptions = useMemo(
    () =>
      resolveKnowledgeAssetDatabaseOptions({
        isDemoSource,
        demoDatabaseOptions,
        connectorOptions,
      }),
    [connectorOptions, demoDatabaseOptions, isDemoSource],
  );
  const assetTableOptions = useMemo(
    () =>
      resolveKnowledgeAssetTableOptions({
        assets,
        isDemoSource,
        demoTableOptions,
        connectorTables,
      }),
    [assets, connectorTables, demoTableOptions, isDemoSource],
  );

  return {
    connectorOptions,
    assetDatabaseOptions,
    assetTableOptions,
  };
}
