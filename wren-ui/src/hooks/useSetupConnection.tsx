import { useState, useEffect } from 'react';
import { SETUP } from '@/utils/enum';
import { useRouter } from 'next/router';
import { useSaveDataSourceMutation } from '@/apollo/client/graphql/dataSource.generated';
import { DataSourceName } from '@/apollo/client/graphql/__types__';

const transformProperties = (
  properties: Record<string, any>,
  dataSource: DataSourceName,
) => {
  if (dataSource === DataSourceName.Duckdb) {
    const configurations = properties.configurations.reduce((acc, cur) => {
      if (cur.key && cur.value) {
        acc[cur.key] = cur.value;
      }

      return acc;
    }, {});

    return {
      ...properties,
      configurations,
      extensions: properties.extensions.filter((i) => i),
    };
  }

  return properties;
};

export default function useSetupConnection() {
  const [stepKey, setStepKey] = useState(SETUP.STARTER);
  const [dataSource, setDataSource] = useState<DataSourceName>();
  const [connectErrorMessage, setConnectErrorMessage] = useState('');
  const router = useRouter();

  useEffect(() => {
    if (stepKey === SETUP.CREATE_DATA_SOURCE) {
      setConnectErrorMessage('');
    }
  }, [stepKey]);

  const [saveDataSourceMutation, { loading, error }] =
    useSaveDataSourceMutation({
      onError: (error) => console.error(error),
      onCompleted: () => router.push('/setup/models'),
    });

  useEffect(() => {
    setConnectErrorMessage(error?.message || '');
  }, [error?.message]);

  const submitDataSource = async (properties: JSON) => {
    await saveDataSourceMutation({
      variables: {
        data: {
          type: dataSource,
          properties: transformProperties(properties, dataSource),
        },
      },
    });
  };

  const onBack = () => {
    if (stepKey === SETUP.CREATE_DATA_SOURCE) {
      setStepKey(SETUP.STARTER);
    }
  };

  const onNext = (data?: {
    dataSource?: DataSourceName;
    properties?: JSON;
  }) => {
    if (stepKey === SETUP.STARTER) {
      if (data.dataSource) {
        setDataSource(data?.dataSource);
        setStepKey(SETUP.CREATE_DATA_SOURCE);
      } else {
        // TODO: implement template chosen
      }
    } else if (stepKey === SETUP.CREATE_DATA_SOURCE) {
      submitDataSource(data.properties);
    }
  };

  return {
    stepKey,
    dataSource,
    onBack,
    onNext,
    submitting: loading,
    connectErrorMessage,
  };
}
