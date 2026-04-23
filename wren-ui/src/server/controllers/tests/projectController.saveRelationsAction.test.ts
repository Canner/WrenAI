import { saveRelationsAction } from '../projectControllerModelingActions';

describe('saveRelationsAction', () => {
  it('rejects outdated runtime snapshots before saving relationships', async () => {
    const assertExecutableRuntimeScope = jest
      .fn()
      .mockRejectedValue(new Error('Snapshot outdated'));
    const assertKnowledgeBaseWriteAccess = jest.fn();
    const ensureModelsBelongToActiveRuntime = jest.fn();
    const saveRelationsByRuntimeIdentity = jest.fn();
    const saveRelations = jest.fn();

    await expect(
      saveRelationsAction({
        args: {
          data: {
            relations: [
              {
                fromModelId: 1,
                fromColumnId: 11,
                toModelId: 2,
                toColumnId: 21,
                type: 'MANY_TO_ONE' as any,
              },
            ],
          },
        },
        ctx: {
          modelService: {
            saveRelationsByRuntimeIdentity,
            saveRelations,
          },
          telemetry: {
            sendEvent: jest.fn(),
          },
        } as any,
        deps: {
          getActiveRuntimeProjectOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 99 }),
          assertExecutableRuntimeScope,
          assertKnowledgeBaseWriteAccess,
          ensureModelsBelongToActiveRuntime,
          getCurrentPersistedRuntimeIdentity: jest.fn().mockReturnValue({
            workspaceId: 'ws-1',
            knowledgeBaseId: 'kb-1',
          }),
          deploy: jest.fn(),
          recordKnowledgeBaseWriteAudit: jest.fn(),
        },
      }),
    ).rejects.toThrow('Snapshot outdated');

    expect(assertExecutableRuntimeScope).toHaveBeenCalledTimes(1);
    expect(assertKnowledgeBaseWriteAccess).not.toHaveBeenCalled();
    expect(ensureModelsBelongToActiveRuntime).not.toHaveBeenCalled();
    expect(saveRelationsByRuntimeIdentity).not.toHaveBeenCalled();
    expect(saveRelations).not.toHaveBeenCalled();
  });
});
