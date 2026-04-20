import {
  resolveKnowledgeInitialSourceType,
  resolveKnowledgeSourceOptions,
  resolveKnowledgeConnectorScopeKey,
  shouldLoadKnowledgeConnectors,
} from './useKnowledgeConnectors';

describe('useKnowledgeConnectors helpers', () => {
  const createSourceOption = (key: string, category: 'demo' | 'connector') => ({
    key,
    category,
    label: key,
    meta: category,
    icon: null,
  });

  it('resolves connector scope key by workspace', () => {
    expect(
      resolveKnowledgeConnectorScopeKey({
        hasRuntimeScope: true,
        activeWorkspaceId: 'ws-1',
      }),
    ).toBe('ws-1');

    expect(
      resolveKnowledgeConnectorScopeKey({
        hasRuntimeScope: true,
        activeWorkspaceId: null,
      }),
    ).toBeNull();

    expect(
      resolveKnowledgeConnectorScopeKey({
        hasRuntimeScope: false,
        activeWorkspaceId: 'ws-1',
      }),
    ).toBeNull();
  });

  it('loads connectors only when modal is open and source category is connector', () => {
    const sourceOptions = [
      createSourceOption('demo_ecommerce', 'demo'),
      createSourceOption('database', 'connector'),
    ];

    expect(
      shouldLoadKnowledgeConnectors({
        assetModalOpen: true,
        connectorScopeKey: 'ws-1',
        selectedSourceType: 'database',
        sourceOptions,
      }),
    ).toBe(true);

    expect(
      shouldLoadKnowledgeConnectors({
        assetModalOpen: false,
        connectorScopeKey: 'ws-1',
        selectedSourceType: 'database',
        sourceOptions,
      }),
    ).toBe(false);

    expect(
      shouldLoadKnowledgeConnectors({
        assetModalOpen: true,
        connectorScopeKey: 'ws-1',
        selectedSourceType: 'demo_ecommerce',
        sourceOptions,
      }),
    ).toBe(false);
  });

  it('filters out sample asset sources for regular workspaces', () => {
    const sourceOptions = [
      createSourceOption('demo_ecommerce', 'demo'),
      createSourceOption('demo_hr', 'demo'),
      createSourceOption('database', 'connector'),
      createSourceOption('api', 'connector'),
    ];

    expect(
      resolveKnowledgeSourceOptions({
        workspaceKind: 'regular',
        sourceOptions,
      }).map((option) => option.key),
    ).toEqual(['database', 'api']);

    expect(
      resolveKnowledgeSourceOptions({
        workspaceKind: 'default',
        sourceOptions,
      }).map((option) => option.key),
    ).toEqual(['demo_ecommerce', 'demo_hr', 'database', 'api']);

    expect(
      resolveKnowledgeInitialSourceType(
        resolveKnowledgeSourceOptions({
          workspaceKind: 'regular',
          sourceOptions,
        }),
      ),
    ).toBe('database');
  });
});
