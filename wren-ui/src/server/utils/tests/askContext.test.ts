import { buildAskRuntimeContext } from '../askContext';

describe('buildAskRuntimeContext', () => {
  it('returns runtime identity and inject-only skills for selected definitions', async () => {
    const skillService = {
      getSkillDefinitionById: jest.fn().mockResolvedValue({
        id: 'skill-1',
        workspaceId: 'workspace-1',
        name: 'sales_skill',
        instruction: '仅统计已支付订单',
        executionMode: 'inject_only',
        isEnabled: true,
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
      selectedSkillIds: ['skill-1'],
      skillService,
    });

    expect(result).toEqual({
      runtimeIdentity: {
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      },
      skills: [
        {
          skillId: 'skill-1',
          skillName: 'sales_skill',
          instruction: '仅统计已支付订单',
          executionMode: 'inject_only',
        },
      ],
    });
  });

  it('filters out skills from other workspaces or disabled skills', async () => {
    const skillService = {
      getSkillDefinitionById: jest
        .fn()
        .mockResolvedValueOnce({
          id: 'skill-1',
          workspaceId: 'workspace-2',
          name: 'other_workspace_skill',
          instruction: 'ignore me',
          isEnabled: true,
        })
        .mockResolvedValueOnce({
          id: 'skill-2',
          workspaceId: 'workspace-1',
          name: 'disabled_skill',
          instruction: 'ignore me too',
          isEnabled: false,
        }),
    } as any;

    const result = await buildAskRuntimeContext({
      runtimeIdentity: {
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
      },
      selectedSkillIds: ['skill-1', 'skill-2'],
      skillService,
    });

    expect(result).toEqual({
      runtimeIdentity: {
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: null,
        deployHash: null,
        actorUserId: null,
      },
      skills: [],
    });
  });

  it('returns empty skills when nothing is selected or runtime identity is missing', async () => {
    await expect(
      buildAskRuntimeContext({
        runtimeIdentity: {
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
        },
        selectedSkillIds: [],
        skillService: {
          getSkillDefinitionById: jest.fn(),
        } as any,
      }),
    ).resolves.toEqual({
      runtimeIdentity: {
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: null,
        deployHash: null,
        actorUserId: null,
      },
      skills: [],
    });

    await expect(
      buildAskRuntimeContext({
        runtimeIdentity: null,
        selectedSkillIds: ['skill-1'],
        skillService: {
          getSkillDefinitionById: jest.fn(),
        } as any,
      }),
    ).resolves.toEqual({
      runtimeIdentity: undefined,
    });
  });
});
