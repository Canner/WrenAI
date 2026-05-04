import { useState } from 'react';
import { useGetSettingsQuery } from '@/apollo/client/graphql/settings.generated';
import { useGetNativeSqlLazyQuery } from '@/apollo/client/graphql/home.generated';
import { DataSourceName } from '@/apollo/client/graphql/__types__';

export interface NativeSQLResult {
  data: string;
  dataSourceType: DataSourceName;
  hasNativeSQL: boolean;
  loading: boolean;
  nativeSQLMode: boolean;
  setNativeSQLMode: (value: boolean) => void;
}

// we assume that not having a sample dataset means supporting native SQL
function useNativeSQLInfo() {
  const { data: settingsQueryResult } = useGetSettingsQuery();
  const settings = settingsQueryResult?.settings;
  const dataSourceType = settings?.dataSource.type;
  const sampleDataset = settings?.dataSource.sampleDataset;

  return {
    hasNativeSQL: !Boolean(sampleDataset),
    dataSourceType,
  };
}

export default function useNativeSQL() {
  const nativeSQLInfo = useNativeSQLInfo();

  const [nativeSQLMode, setNativeSQLMode] = useState<boolean>(false);

  const [fetchNativeSQL, { data, loading }] = useGetNativeSqlLazyQuery({
    fetchPolicy: 'cache-and-network',
  });

  const nativeSQL = data?.nativeSql || '';
  const nativeSQLResult: NativeSQLResult = {
    ...nativeSQLInfo,
    data: nativeSQL,
    loading,
    nativeSQLMode,
    setNativeSQLMode,
  };

  return {
    fetchNativeSQL,
    nativeSQLResult,
  };
}
