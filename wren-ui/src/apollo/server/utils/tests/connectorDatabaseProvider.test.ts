import {
  buildDatabaseConnectorConnectionInfo,
  generateTrinoCatalogName,
} from '../connectorDatabaseProvider';

describe('connectorDatabaseProvider', () => {
  it('generates distinct Trino catalog names for distinct connector ids', () => {
    expect(generateTrinoCatalogName('kb-1', 'connector-1')).toBe(
      'kb_kb1_nnector1',
    );
    expect(generateTrinoCatalogName('kb-1', 'connector-2')).toBe(
      'kb_kb1_nnector2',
    );
  });

  it('builds postgres connection info from generic connector config', () => {
    expect(
      buildDatabaseConnectorConnectionInfo({
        provider: 'postgres',
        config: {
          host: '127.0.0.1',
          port: '5432',
          database: 'analytics',
          user: 'postgres',
          ssl: true,
        },
        secret: {
          password: 'postgres',
        },
      }),
    ).toEqual({
      host: '127.0.0.1',
      port: 5432,
      database: 'analytics',
      user: 'postgres',
      password: 'postgres',
      ssl: true,
    });
  });
});
