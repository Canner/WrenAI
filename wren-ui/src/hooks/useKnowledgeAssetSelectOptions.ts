import { useMemo } from 'react';

type ConnectorLike = {
  id: string;
  displayName: string;
  type: string;
};

type Option = {
  label: string;
  value: string;
};

type AssetLike = {
  id: string;
  name: string;
};

export const resolveKnowledgeConnectorOptions = (
  connectors: ConnectorLike[],
): Option[] =>
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
  demoDatabaseOptions: Option[];
  connectorOptions: Option[];
}) => (isDemoSource ? demoDatabaseOptions : connectorOptions);

export const resolveKnowledgeAssetTableOptions = ({
  isDemoSource,
  demoTableOptions,
  assets,
}: {
  isDemoSource: boolean;
  demoTableOptions: Option[];
  assets: AssetLike[];
}): Option[] =>
  isDemoSource
    ? demoTableOptions
    : assets.slice(0, 8).map((asset) => ({
        label: asset.name,
        value: asset.id,
      }));

export default function useKnowledgeAssetSelectOptions({
  connectors,
  isDemoSource,
  demoDatabaseOptions,
  demoTableOptions,
  assets,
}: {
  connectors: ConnectorLike[];
  isDemoSource: boolean;
  demoDatabaseOptions: Option[];
  demoTableOptions: Option[];
  assets: AssetLike[];
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
        isDemoSource,
        demoTableOptions,
        assets,
      }),
    [assets, demoTableOptions, isDemoSource],
  );

  return {
    connectorOptions,
    assetDatabaseOptions,
    assetTableOptions,
  };
}
