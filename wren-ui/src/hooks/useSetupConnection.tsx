import { useState, useEffect } from 'react';
import { Path, SETUP } from '@/utils/enum';
import { useRouter } from 'next/router';
import { parseGraphQLError } from '@/utils/errorHandler';
import {
  useSaveDataSourceMutation,
  useStartSampleDatasetMutation,
} from '@/apollo/client/graphql/dataSource.generated';
import {
  DataSourceName,
  SampleDatasetName,
} from '@/apollo/client/graphql/__types__';
import { ONBOARDING_STATUS } from '@/apollo/client/graphql/onboarding';

const PASSWORD_PLACEHOLDER = '************';

export const transformFormToProperties = (
  properties: Record<string, any>,
  dataSourceType: DataSourceName,
) => {
  if (dataSourceType === DataSourceName.DUCKDB) {
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

  return {
    ...properties,
    // remove password placeholder if user doesn't change the password
    password:
      properties?.password === PASSWORD_PLACEHOLDER
        ? undefined
        : properties?.password,
  };
};

export const transformPropertiesToForm = (
  properties: Record<string, any>,
  dataSourceType: DataSourceName,
) => {
  if (dataSourceType === DataSourceName.BIG_QUERY) {
    return { ...properties, credentials: undefined };
  } else if (dataSourceType === DataSourceName.DUCKDB) {
    const configurations = Object.entries(properties?.configurations || {}).map(
      ([key, value]) => ({ key, value }),
    );
    const extensions = properties?.extensions || [];
    return {
      ...properties,
      // If there are no configurations or extensions, add an empty one, or the form properties will break
      configurations: configurations.length
        ? configurations
        : [{ key: '', value: '' }],
      extensions: extensions.length ? extensions : [''],
    };
  }

  return {
    ...properties,
    // provide a password placeholder to UI
    password: properties?.password || PASSWORD_PLACEHOLDER,
  };
};

export default function useSetupConnection() {
  const [stepKey, setStepKey] = useState(SETUP.STARTER);
  const [dataSource, setDataSource] = useState<DataSourceName>();
  const [connectError, setConnectError] = useState(null);
  const router = useRouter();

  useEffect(() => {
    if (stepKey === SETUP.CREATE_DATA_SOURCE) {
      setConnectError(null);
    }
  }, [stepKey]);

  const [saveDataSourceMutation, { loading, error }] =
    useSaveDataSourceMutation({
      onError: (error) => console.error(error),
      onCompleted: () => router.push(Path.OnboardingModels),
    });

  const [startSampleDatasetMutation, { loading: startSampleDatasetLoading }] =
    useStartSampleDatasetMutation({
      onError: (error) => console.error(error),
      onCompleted: () => router.push(Path.Modeling),
      refetchQueries: [{ query: ONBOARDING_STATUS }],
      awaitRefetchQueries: true,
    });

  useEffect(() => {
    setConnectError(parseGraphQLError(error));
  }, [error]);

  const submitDataSource = async (properties: JSON) => {
    await saveDataSourceMutation({
      variables: {
        data: {
          type: dataSource,
          properties: transformFormToProperties(properties, dataSource),
        },
      },
    });
  };

  const submitTemplate = async (template: SampleDatasetName) => {
    await startSampleDatasetMutation({
      variables: {
        data: { name: template },
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
    template?: SampleDatasetName;
    properties?: JSON;
  }) => {
    if (stepKey === SETUP.STARTER) {
      if (data.dataSource) {
        setDataSource(data?.dataSource);
        setStepKey(SETUP.CREATE_DATA_SOURCE);
      } else {
        submitTemplate(data.template);
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
    submitting: loading || startSampleDatasetLoading,
    connectError,
  };
}
