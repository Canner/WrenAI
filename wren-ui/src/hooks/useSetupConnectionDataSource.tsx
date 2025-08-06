import { useRouter } from 'next/router';
import { useState, useCallback } from 'react';
import { Path, REDSHIFT_AUTH_METHOD } from '@/utils/enum';
import { useSaveDataSourceMutation } from '@/apollo/client/graphql/dataSource.generated';
import { DataSourceName } from '@/apollo/client/graphql/__types__';

const PASSWORD_PLACEHOLDER = '************';

export default function useSetupConnectionDataSource() {
  const router = useRouter();
  const [selected, setSelected] = useState<DataSourceName>();

  const [saveDataSourceMutation, { loading, error }] =
    useSaveDataSourceMutation({
      onError: (error) => console.error(error),
      onCompleted: () => completedDataSourceSave(),
    });

  const selectDataSourceNext = useCallback(
    (payload: { dataSource: DataSourceName; dispatch?: () => void }) => {
      setSelected(payload.dataSource);
      payload?.dispatch?.();
    },
    [router],
  );

  const saveDataSource = useCallback(
    async (properties?: Record<string, any>) => {
      await saveDataSourceMutation({
        variables: {
          data: {
            type: selected,
            properties: transformFormToProperties(properties, selected),
          },
        },
      });
    },
    [selected, saveDataSourceMutation],
  );

  const completedDataSourceSave = useCallback(async () => {
    router.push(Path.OnboardingModels);
  }, [selected, router]);

  return {
    loading,
    error,
    selected,
    saveDataSource,
    selectDataSourceNext,
    completedDataSourceSave,
    reset: () => setSelected(undefined),
  };
}

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
  } else if (dataSourceType === DataSourceName.SNOWFLAKE) {
    return {
      ...properties,
      ...getSnowflakeAuthentication(properties),
    };
  }

  return {
    ...properties,
    // remove password placeholder if user doesn't change the password
    password:
      properties?.password === PASSWORD_PLACEHOLDER
        ? undefined
        : properties?.password,

    awsSecretKey:
      properties?.awsSecretKey === PASSWORD_PLACEHOLDER
        ? undefined
        : properties?.awsSecretKey,
  };
};

export const transformPropertiesToForm = (
  properties: Record<string, any>,
  dataSourceType: DataSourceName,
) => {
  if (dataSourceType === DataSourceName.BIG_QUERY) {
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
  } else if (dataSourceType === DataSourceName.REDSHIFT) {
    return {
      ...properties,
      ...(properties?.redshiftType === REDSHIFT_AUTH_METHOD.redshift
        ? {
            password: properties?.password || PASSWORD_PLACEHOLDER,
          }
        : {
            awsSecretKey: properties?.awsSecretKey || PASSWORD_PLACEHOLDER,
          }),
    };
  }

  return {
    ...properties,
    // provide a password placeholder to UI
    password: properties?.password || PASSWORD_PLACEHOLDER,
    privateKey: properties?.privateKey || undefined,
  };
};

function getSnowflakeAuthentication(properties: Record<string, any>) {
  // Set password or private key to null if only one of them is provided
  if (properties?.privateKey) {
    return {
      privateKey: properties?.privateKey,
      password: null,
    };
  }
  if (properties?.password && properties?.password !== PASSWORD_PLACEHOLDER) {
    return {
      password: properties?.password,
      privateKey: null,
    };
  }
  return {};
}
