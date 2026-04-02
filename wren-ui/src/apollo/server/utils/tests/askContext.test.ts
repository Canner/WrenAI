import { buildAskRuntimeContext } from '../askContext';

describe('buildAskRuntimeContext', () => {
  it('returns runtime identity and resolved skills/connectors/secrets for knowledge base scope', async () => {
    const skillService = {
      listSkillBindingsByKnowledgeBase: jest.fn().mockResolvedValue([
        {
          id: 'binding-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: null,
          skillDefinitionId: 'skill-1',
          connectorId: 'connector-1',
          bindingConfig: { timeoutSec: 20 },
          enabled: true,
        },
        {
          id: 'binding-2',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-x',
          skillDefinitionId: 'skill-2',
          connectorId: null,
          bindingConfig: { ignored: true },
          enabled: true,
        },
      ]),
      getSkillDefinitionById: jest.fn().mockImplementation(async (id: string) => ({
        id,
        workspaceId: 'workspace-1',
        name: id === 'skill-1' ? 'sales_skill' : 'ignored_skill',
        runtimeKind: 'isolated_python',
        sourceType: 'inline',
        sourceRef: `skills/${id}`,
        entrypoint: 'main.py',
      })),
    } as any;

    const connectorService = {
      getResolvedConnector: jest.fn().mockResolvedValue({
        id: 'connector-1',
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        type: 'postgres',
        displayName: 'Warehouse',
        configJson: { schema: 'public' },
        secretRecordId: 'secret-1',
        secret: { password: 'test' },
      }),
    } as any;

    const result = await buildAskRuntimeContext({
      runtimeIdentity: {
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      },
      actorClaims: {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workspaceMemberId: 'member-1',
        roleKeys: ['owner'],
        permissionScopes: ['knowledge_base:*'],
      },
      skillService,
      connectorService,
    });

    expect(result.runtimeIdentity).toEqual(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      }),
    );
    expect(result.actorClaims).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        workspaceMemberId: 'member-1',
      }),
    );
    expect(result.skills).toEqual([
      expect.objectContaining({
        skillId: 'skill-1',
        skillName: 'sales_skill',
        skillConfig: { timeoutSec: 20 },
      }),
    ]);
    expect(result.connectors).toEqual([
      expect.objectContaining({
        id: 'connector-1',
        type: 'postgres',
        displayName: 'Warehouse',
      }),
    ]);
    expect(result.secrets).toEqual([
      expect.objectContaining({
        id: 'secret-1',
        name: 'Warehouse',
        values: { password: 'test' },
      }),
    ]);
  });

  it('falls back to runtime identity only when skill lookup fails', async () => {
    const result = await buildAskRuntimeContext({
      runtimeIdentity: {
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
      },
      skillService: {
        listSkillBindingsByKnowledgeBase: jest
          .fn()
          .mockRejectedValue(new Error('db down')),
        getSkillDefinitionById: jest.fn(),
      } as any,
    });

    expect(result.runtimeIdentity).toEqual(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
      }),
    );
    expect(result.skills).toBeUndefined();
    expect(result.connectors).toBeUndefined();
    expect(result.secrets).toBeUndefined();
  });
});
