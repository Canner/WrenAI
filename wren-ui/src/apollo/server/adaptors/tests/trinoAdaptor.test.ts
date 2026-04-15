import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { TrinoAdaptor } from '../trinoAdaptor';

describe('TrinoAdaptor', () => {
  it('writes catalog files in static mode', async () => {
    const catalogDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'trino-adaptor-'),
    );
    const adaptor = new TrinoAdaptor({ catalogDir });

    await adaptor.ensureCatalog({
      catalogName: 'catalog_a',
      properties: {
        'connector.name': 'postgresql',
        'connection-url': 'jdbc:postgresql://db.internal:5432/analytics',
        'connection-user': 'postgres',
      },
    });

    await expect(adaptor.listCatalogs()).resolves.toEqual(['catalog_a']);
    await expect(
      fs.readFile(path.join(catalogDir, 'catalog_a.properties'), 'utf8'),
    ).resolves.toContain('connector.name=postgresql');
  });

  it('creates catalogs via SQL in dynamic mode', async () => {
    const post = jest
      .fn()
      .mockResolvedValueOnce({ data: { data: [['system'], ['tpch']] } })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({
        data: { data: [['catalog_a'], ['system'], ['tpch']] },
      });
    const get = jest.fn();
    const adaptor = new TrinoAdaptor({
      catalogDir: '/tmp/unused',
      managementMode: 'dynamic',
      runtimeHost: 'trino',
      runtimePort: 8080,
      runtimeUser: 'wrenai',
      runtimePassword: '',
      runtimeSsl: false,
      httpClient: { post, get } as any,
    });

    await adaptor.ensureCatalog({
      catalogName: 'catalog_a',
      properties: {
        'connector.name': 'postgresql',
        'connection-url': 'jdbc:postgresql://db.internal:5432/analytics',
        'connection-user': 'postgres',
        'connection-password': 'postgres',
      },
    });

    expect(post).toHaveBeenNthCalledWith(
      1,
      'http://trino:8080/v1/statement',
      'SHOW CATALOGS',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Trino-User': 'wrenai',
        }),
      }),
    );
    expect(post).toHaveBeenNthCalledWith(
      2,
      'http://trino:8080/v1/statement',
      expect.stringContaining(
        'CREATE CATALOG "catalog_a" USING postgresql WITH ("connection-password" = \'postgres\', "connection-url" = \'jdbc:postgresql://db.internal:5432/analytics\', "connection-user" = \'postgres\')',
      ),
      expect.any(Object),
    );
  });
});
