import { WREN_AI_CONNECTION_INFO } from './repositories';
import { DataSourceName } from './types';
import { getConfig } from './config';
import { Encryptor } from './utils';
import type { DataSourceConnectionRegistry } from './dataSourceTypes';

const config = getConfig();
const encryptor = new Encryptor(config);

export const encryptScopedConnectionInfo = (
  dataSourceType: DataSourceName,
  connectionInfo: WREN_AI_CONNECTION_INFO,
  registry: DataSourceConnectionRegistry,
) => {
  const rawConnectionInfo = connectionInfo as Record<string, any>;
  return registry[dataSourceType].sensitiveProps.reduce((acc, prop: string) => {
    const value = rawConnectionInfo[prop];
    if (value) {
      const encryption = encryptor.encrypt(
        JSON.parse(JSON.stringify({ [prop]: value })),
      );
      return { ...acc, [prop]: encryption };
    }
    return acc;
  }, connectionInfo);
};

export const decryptScopedConnectionInfo = (
  dataSourceType: DataSourceName,
  connectionInfo: WREN_AI_CONNECTION_INFO,
  registry: DataSourceConnectionRegistry,
): WREN_AI_CONNECTION_INFO => {
  const rawConnectionInfo = connectionInfo as Record<string, any>;
  return registry[dataSourceType].sensitiveProps.reduce((acc, prop: string) => {
    const value = rawConnectionInfo[prop];
    if (value) {
      const decryption = encryptor.decrypt(value);
      const decryptedValue = JSON.parse(decryption)[prop];
      return { ...acc, [prop]: decryptedValue };
    }
    return acc;
  }, connectionInfo);
};
