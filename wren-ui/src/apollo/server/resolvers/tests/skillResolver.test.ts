import { SkillResolver } from '../skillResolver';

describe('SkillResolver', () => {
  it('lists skill definitions scoped to the active runtime workspace', async () => {
    const resolver = new SkillResolver();
    const listSkillDefinitionsByWorkspace = jest.fn().mockResolvedValue([
      {
        id: 'skill-1',
        workspaceId: 'workspace-1',
        name: 'Weather skill',
        runtimeKind: 'isolated_python',
        sourceType: 'inline',
        manifestJson: { entry: 'main' },
      },
    ]);

    const result = await resolver.getSkillDefinitions(
      null,
      null,
      {
        runtimeScope: { workspace: { id: 'workspace-1' } },
        skillService: { listSkillDefinitionsByWorkspace },
      } as any,
    );

    expect(listSkillDefinitionsByWorkspace).toHaveBeenCalledWith('workspace-1');
    expect(result).toEqual([
      expect.objectContaining({
        id: 'skill-1',
        name: 'Weather skill',
        manifest: { entry: 'main' },
      }),
    ]);
  });

  it('rejects updating a skill definition outside the active runtime workspace', async () => {
    const resolver = new SkillResolver();

    await expect(
      resolver.updateSkillDefinition(
        null,
        {
          where: { id: 'skill-1' },
          data: { name: 'Renamed' },
        },
        {
          runtimeScope: { workspace: { id: 'workspace-1' } },
          skillService: {
            getSkillDefinitionById: jest.fn().mockResolvedValue({
              id: 'skill-1',
              workspaceId: 'workspace-2',
            }),
            updateSkillDefinition: jest.fn(),
          },
        } as any,
      ),
    ).rejects.toThrow('Skill definition not found in active runtime workspace');
  });

  it('creates skill bindings in the active runtime knowledge base and defaults to the current snapshot', async () => {
    const resolver = new SkillResolver();
    const createSkillBinding = jest.fn().mockResolvedValue({
      id: 'binding-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      skillDefinitionId: 'skill-1',
      connectorId: null,
      bindingConfig: { mode: 'tool' },
      enabled: true,
      createdBy: 'user-1',
    });

    const result = await resolver.createSkillBinding(
      null,
      {
        data: {
          skillDefinitionId: 'skill-1',
          enabled: true,
          bindingConfig: { mode: 'tool' },
        },
      },
      {
        runtimeScope: {
          knowledgeBase: { id: 'kb-1' },
          kbSnapshot: { id: 'snap-1' },
          userId: 'user-1',
        },
        skillService: { createSkillBinding },
      } as any,
    );

    expect(createSkillBinding).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      skillDefinitionId: 'skill-1',
      connectorId: undefined,
      bindingConfig: { mode: 'tool' },
      enabled: true,
      createdBy: 'user-1',
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: 'binding-1',
        bindingConfig: { mode: 'tool' },
      }),
    );
  });

  it('rejects deleting a skill binding outside the active knowledge base', async () => {
    const resolver = new SkillResolver();
    const deleteSkillBinding = jest.fn();

    await expect(
      resolver.deleteSkillBinding(
        null,
        { where: { id: 'binding-1' } },
        {
          runtimeScope: { knowledgeBase: { id: 'kb-1' } },
          skillService: {
            getSkillBindingById: jest.fn().mockResolvedValue({
              id: 'binding-1',
              knowledgeBaseId: 'kb-2',
            }),
            deleteSkillBinding,
          },
        } as any,
      ),
    ).rejects.toThrow('Skill binding not found in active runtime knowledge base');

    expect(deleteSkillBinding).not.toHaveBeenCalled();
  });
});
