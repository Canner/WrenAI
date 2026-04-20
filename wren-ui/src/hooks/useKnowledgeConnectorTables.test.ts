import {
  buildKnowledgeConnectorTablesErrorKey,
  buildKnowledgeConnectorTablesUrl,
  normalizeKnowledgeConnectorTablesPayload,
} from './useKnowledgeConnectorTables';

describe('useKnowledgeConnectorTables helpers', () => {
  it('builds a workspace-scoped connector tables url', () => {
    expect(
      buildKnowledgeConnectorTablesUrl({
        buildRuntimeScopeUrl: (path, _query, selector) =>
          `${path}?workspaceId=${selector?.workspaceId}`,
        connectorId: 'connector-1',
        workspaceId: 'workspace-1',
      }),
    ).toBe('/api/v1/connectors/connector-1/tables?workspaceId=workspace-1');
  });

  it('returns null when connector id or workspace scope is missing', () => {
    expect(
      buildKnowledgeConnectorTablesUrl({
        buildRuntimeScopeUrl: (path) => path,
        connectorId: null,
        workspaceId: 'workspace-1',
      }),
    ).toBeNull();

    expect(
      buildKnowledgeConnectorTablesUrl({
        buildRuntimeScopeUrl: (path) => path,
        connectorId: 'connector-1',
        workspaceId: null,
      }),
    ).toBeNull();
  });

  it('normalizes non-array payloads to empty connector table list', () => {
    expect(normalizeKnowledgeConnectorTablesPayload({})).toEqual([]);
    expect(
      normalizeKnowledgeConnectorTablesPayload([
        { name: 'orders', columns: [] },
      ]),
    ).toEqual([{ name: 'orders', columns: [] }]);
  });

  it('builds a stable error key for duplicate toast suppression', () => {
    expect(
      buildKnowledgeConnectorTablesErrorKey({
        requestUrl: '/api/v1/connectors/connector-1/tables?workspaceId=ws-1',
        error: new Error('boom'),
      }),
    ).toBe('/api/v1/connectors/connector-1/tables?workspaceId=ws-1|boom');

    expect(
      buildKnowledgeConnectorTablesErrorKey({
        requestUrl: null,
        error: new Error('boom'),
      }),
    ).toBeNull();
  });
});
