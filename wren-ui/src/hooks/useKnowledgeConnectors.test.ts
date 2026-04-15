import {
  resolveKnowledgeConnectorScopeKey,
  shouldLoadKnowledgeConnectors,
} from './useKnowledgeConnectors';

describe('useKnowledgeConnectors helpers', () => {
  it('resolves connector scope key by active knowledge base + snapshot', () => {
    expect(
      resolveKnowledgeConnectorScopeKey({
        hasRuntimeScope: true,
        activeKnowledgeBaseId: 'kb-1',
        activeKbSnapshotId: 'snap-1',
      }),
    ).toBe('kb-1:snap-1');

    expect(
      resolveKnowledgeConnectorScopeKey({
        hasRuntimeScope: true,
        activeKnowledgeBaseId: 'kb-1',
        activeKbSnapshotId: null,
      }),
    ).toBeNull();

    expect(
      resolveKnowledgeConnectorScopeKey({
        hasRuntimeScope: false,
        activeKnowledgeBaseId: 'kb-1',
        activeKbSnapshotId: 'snap-1',
      }),
    ).toBeNull();
  });

  it('loads connectors only when modal is open and source category is connector', () => {
    const sourceOptions = [
      { key: 'demo_ecommerce', category: 'demo' as const },
      { key: 'database', category: 'connector' as const },
    ];

    expect(
      shouldLoadKnowledgeConnectors({
        assetModalOpen: true,
        connectorScopeKey: 'kb-1:snap-1',
        selectedSourceType: 'database',
        sourceOptions,
      }),
    ).toBe(true);

    expect(
      shouldLoadKnowledgeConnectors({
        assetModalOpen: false,
        connectorScopeKey: 'kb-1:snap-1',
        selectedSourceType: 'database',
        sourceOptions,
      }),
    ).toBe(false);

    expect(
      shouldLoadKnowledgeConnectors({
        assetModalOpen: true,
        connectorScopeKey: 'kb-1:snap-1',
        selectedSourceType: 'demo_ecommerce',
        sourceOptions,
      }),
    ).toBe(false);
  });
});
