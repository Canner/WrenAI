import { useState, useCallback } from 'react';

import { appMessage as message } from '@/utils/antdAppBridge';
import { DataSourceName } from '@/types/dataSource';
import {
  DATABRICKS_AUTH_METHOD,
  Path,
  REDSHIFT_AUTH_METHOD,
} from '@/utils/enum';
import { saveKnowledgeConnection } from '@/utils/modelingRest';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';

const PASSWORD_PLACEHOLDER = '************';

export default function useSetupConnectionType() {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [selectedConnectionType, setSelectedConnectionType] =
    useState<DataSourceName>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const completedConnectionSave = useCallback(async () => {
    runtimeScopeNavigation.push(Path.OnboardingModels);
  }, [runtimeScopeNavigation.push]);

  const selectConnectionType = useCallback(
    (payload: { connectionType: DataSourceName; dispatch?: () => void }) => {
      setSelectedConnectionType(payload.connectionType);
      payload?.dispatch?.();
    },
    [],
  );

  const saveConnection = useCallback(
    async (properties?: Record<string, any>) => {
      if (!selectedConnectionType) {
        message.error('请先选择连接类型');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        await saveKnowledgeConnection(runtimeScopeNavigation.selector, {
          type: selectedConnectionType,
          properties: transformConnectionFormToProperties(
            properties,
            selectedConnectionType,
          ),
        });
        message.success('知识库连接已保存，正在进入资产选择');
        await completedConnectionSave();
      } catch (nextError) {
        const resolvedError =
          nextError instanceof Error
            ? nextError
            : new Error('保存知识库连接失败，请稍后重试');
        setError(resolvedError);
        message.error(
          resolvedError.message || '保存知识库连接失败，请稍后重试',
        );
      } finally {
        setLoading(false);
      }
    },
    [
      completedConnectionSave,
      runtimeScopeNavigation.selector,
      selectedConnectionType,
    ],
  );

  return {
    loading,
    error,
    selectedConnectionType,
    saveConnection,
    selectConnectionType,
    completedConnectionSave,
    reset: () => setSelectedConnectionType(undefined),
  };
}

export const transformConnectionFormToProperties = (
  properties?: Record<string, any>,
  connectionType?: DataSourceName,
) => {
  const normalizedProperties = properties || {};
  if (connectionType === DataSourceName.DUCKDB) {
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
  } else if (connectionType === DataSourceName.SNOWFLAKE) {
    return {
      ...normalizedProperties,
      ...getSnowflakeAuthentication(normalizedProperties),
    };
  } else if (connectionType === DataSourceName.DATABRICKS) {
    return {
      ...normalizedProperties,
      ...getDatabricksAuthentication(normalizedProperties),
    };
  } else if (connectionType === DataSourceName.ATHENA) {
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

export const transformConnectionPropertiesToForm = (
  properties: Record<string, any>,
  connectionType: DataSourceName,
) => {
  if (connectionType === DataSourceName.BIG_QUERY) {
  } else if (connectionType === DataSourceName.DUCKDB) {
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
  } else if (connectionType === DataSourceName.REDSHIFT) {
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
  } else if (connectionType === DataSourceName.DATABRICKS) {
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
