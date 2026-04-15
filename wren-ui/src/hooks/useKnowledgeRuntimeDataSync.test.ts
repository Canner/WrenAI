import { buildKnowledgeRuntimeSyncAction } from './useKnowledgeRuntimeDataSync';

describe('useKnowledgeRuntimeDataSync helpers', () => {
  it('builds sync action that refetches runtime selector and diagram together', async () => {
    const refetchRuntimeSelector = jest.fn().mockResolvedValue({ ok: true });
    const refetchDiagram = jest.fn().mockResolvedValue({ ok: true });

    const sync = buildKnowledgeRuntimeSyncAction({
      refetchRuntimeSelector,
      refetchDiagram,
    });
    const result = await sync();

    expect(refetchRuntimeSelector).toHaveBeenCalledTimes(1);
    expect(refetchDiagram).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
  });
});
