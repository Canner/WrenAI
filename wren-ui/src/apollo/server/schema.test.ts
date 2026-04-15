import { ApiType } from './repositories/apiHistoryRepository';
import { typeDefs } from './schema';

describe('schema ApiType enum', () => {
  it('includes every api history enum value', () => {
    const schemaSource =
      (typeDefs as any)?.loc?.source?.body || String(typeDefs || '');

    for (const apiType of Object.values(ApiType)) {
      expect(schemaSource).toContain(apiType);
    }
  });
});
