import { useState, useCallback } from 'react';
import { message } from 'antd';
import {
  Path,
  REDSHIFT_AUTH_METHOD,
  DATABRICKS_AUTH_METHOD,
} from '@/utils/enum';
import { DataSourceName } from '@/apollo/client/graphql/__types__';
import { saveDataSource as saveDataSourceRest } from '@/utils/modelingRest';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';

const PASSWORD_PLACEHOLDER = '************';

export default function useSetupConnectionDataSource() {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [selected, setSelected] = useState<DataSourceName>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const completedDataSourceSave = useCallback(async () => {
    runtimeScopeNavigation.push(Path.OnboardingModels);
  }, [runtimeScopeNavigation]);

  const selectDataSourceNext = useCallback(
    (payload: { dataSource: DataSourceName; dispatch?: () => void }) => {
      setSelected(payload.dataSource);
      payload?.dispatch?.();
    },
    [],
  );

  const saveDataSource = useCallback(
    async (properties?: Record<string, any>) => {
      if (!selected) {
        message.error('请先选择数据源类型');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        await saveDataSourceRest(runtimeScopeNavigation.selector, {
          type: selected,
          properties: transformFormToProperties(properties, selected),
        });
        await completedDataSourceSave();
      } catch (nextError) {
        const resolvedError =
          nextError instanceof Error
            ? nextError
            : new Error('保存数据源失败，请稍后重试');
        setError(resolvedError);
        message.error(resolvedError.message || '保存数据源失败，请稍后重试');
      } finally {
        setLoading(false);
      }
    },
    [completedDataSourceSave, runtimeScopeNavigation.selector, selected],
  );

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
  properties?: Record<string, any>,
  dataSourceType?: DataSourceName,
) => {
  const normalizedProperties = properties || {};
  if (dataSourceType === DataSourceName.DUCKDB) {
    const rawConfigurations = Array.isArray(normalizedProperties.configurations)
      ? normalizedProperties.configurations
      : [];
    const configurations = rawConfigurations.reduce(
      (
        acc: Record<string, any>,
        cur: { key?: string; value?: string | number | boolean | null },
      ) => {
        if (cur.key && cur.value) {
          acc[cur.key] = cur.value;
        }

        return acc;
      },
      {},
    );
    const extensions = Array.isArray(normalizedProperties.extensions)
      ? normalizedProperties.extensions.filter((value: unknown) =>
          Boolean(value),
        )
      : [];

    return {
      ...normalizedProperties,
      configurations,
      extensions,
    };
  } else if (dataSourceType === DataSourceName.SNOWFLAKE) {
    return {
      ...normalizedProperties,
      ...getSnowflakeAuthentication(normalizedProperties),
    };
  } else if (dataSourceType === DataSourceName.DATABRICKS) {
    return {
      ...normalizedProperties,
      ...getDatabricksAuthentication(normalizedProperties),
    };
  } else if (dataSourceType === DataSourceName.ATHENA) {
    return {
      ...normalizedProperties,
      ...getAthenaAuthentication(normalizedProperties),
    };
  }

  return {
    ...normalizedProperties,
    // remove password placeholder if user doesn't change the password
    password:
      normalizedProperties?.password === PASSWORD_PLACEHOLDER
        ? undefined
        : normalizedProperties?.password,

    awsSecretKey:
      normalizedProperties?.awsSecretKey === PASSWORD_PLACEHOLDER
        ? undefined
        : normalizedProperties?.awsSecretKey,
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
  } else if (dataSourceType === DataSourceName.DATABRICKS) {
    return {
      ...properties,
      ...(properties?.databricksType ===
      DATABRICKS_AUTH_METHOD.service_principal
        ? {
            clientSecret: properties?.clientSecret || PASSWORD_PLACEHOLDER,
          }
        : {
            accessToken: properties?.accessToken || PASSWORD_PLACEHOLDER,
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

function getDatabricksAuthentication(properties: Record<string, any>) {
  if (properties?.databricksType === DATABRICKS_AUTH_METHOD.service_principal) {
    return {
      clientSecret:
        properties?.clientSecret === PASSWORD_PLACEHOLDER
          ? undefined
          : properties?.clientSecret,
    };
  }

  return {
    accessToken:
      properties?.accessToken === PASSWORD_PLACEHOLDER
        ? undefined
        : properties?.accessToken,
  };
}

function getAthenaAuthentication(properties: Record<string, any>) {
  if (properties?.webIdentityToken) {
    return {
      webIdentityToken:
        properties?.webIdentityToken === PASSWORD_PLACEHOLDER
          ? undefined
          : properties?.webIdentityToken,
    };
  }

  return {
    awsSecretKey:
      properties?.awsSecretKey === PASSWORD_PLACEHOLDER
        ? undefined
        : properties?.awsSecretKey,
  };
}
