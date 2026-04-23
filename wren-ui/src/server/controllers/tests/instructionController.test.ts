import { InstructionController } from '../instructionController';

describe('InstructionController', () => {
  const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

  afterEach(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  const createAuthorizationActor = () => ({
    principalType: 'user',
    principalId: 'user-1',
    workspaceId: 'workspace-1',
    workspaceMemberId: 'member-1',
    workspaceRoleKeys: ['owner'],
    permissionScopes: ['workspace:*'],
    isPlatformAdmin: false,
    platformRoleKeys: [],
  });

  it('rejects instruction mutations on outdated snapshots', async () => {
    const resolver = new InstructionController();
    const createInstruction = jest.fn();

    await expect(
      resolver.createInstruction(
        null,
        {
          data: {
            instruction: 'Always explain churn in business terms.',
            questions: ['本月流失率如何？'],
            isDefault: false,
          },
        },
        {
          runtimeScope: {
            project: { id: 42 },
            workspace: { id: 'workspace-1' },
            knowledgeBase: { id: 'kb-1', defaultKbSnapshotId: 'snapshot-1' },
            kbSnapshot: { id: 'snapshot-old' },
            deployHash: 'deploy-old',
          },
          authorizationActor: createAuthorizationActor(),
          auditEventRepository: { createOne: jest.fn() },
          telemetry: { sendEvent: jest.fn() },
          instructionService: { createInstruction },
          knowledgeBaseRepository: { findOneBy: jest.fn() },
          kbSnapshotRepository: { findOneBy: jest.fn() },
        } as any,
      ),
    ).rejects.toThrow('This snapshot is outdated and cannot be executed');

    expect(createInstruction).not.toHaveBeenCalled();
  });

  it('rejects instruction mutations without knowledge base write permission', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new InstructionController();
    const createInstruction = jest.fn();

    await expect(
      resolver.createInstruction(
        null,
        {
          data: {
            instruction: 'Only use authorized docs.',
            questions: ['本周GMV如何？'],
            isDefault: false,
          },
        },
        {
          runtimeScope: {
            project: { id: 42 },
            workspace: { id: 'workspace-1' },
            knowledgeBase: { id: 'kb-1', defaultKbSnapshotId: 'snapshot-1' },
            kbSnapshot: { id: 'snapshot-1' },
            deployHash: 'deploy-1',
          },
          authorizationActor: {
            ...createAuthorizationActor(),
            workspaceRoleKeys: ['owner'],
            permissionScopes: ['workspace:*'],
            grantedActions: [],
            workspaceRoleSource: 'legacy',
            platformRoleSource: 'legacy',
          },
          auditEventRepository: { createOne: jest.fn() },
          telemetry: { sendEvent: jest.fn() },
          instructionService: { createInstruction },
          knowledgeBaseRepository: { findOneBy: jest.fn() },
          kbSnapshotRepository: { findOneBy: jest.fn() },
        } as any,
      ),
    ).rejects.toThrow('Knowledge base write permission required');

    expect(createInstruction).not.toHaveBeenCalled();
  });

  it('records allowed access audit events for instruction reads', async () => {
    const resolver = new InstructionController();
    const listInstructions = jest.fn().mockResolvedValue([
      {
        id: 7,
        instruction: 'Only use scoped docs.',
        questions: ['GMV?'],
        isDefault: false,
      },
    ]);
    const createOne = jest.fn();

    const result = await resolver.getInstructions(null, null, {
      runtimeScope: {
        project: { id: 42 },
        workspace: { id: 'workspace-1' },
        knowledgeBase: { id: 'kb-1', defaultKbSnapshotId: 'snapshot-1' },
        kbSnapshot: { id: 'snapshot-1' },
        deployHash: 'deploy-1',
      },
      authorizationActor: {
        ...createAuthorizationActor(),
        grantedActions: ['knowledge_base.read'],
        workspaceRoleSource: 'role_binding',
      },
      auditEventRepository: { createOne },
      telemetry: { sendEvent: jest.fn() },
      instructionService: { listInstructions },
    } as any);

    expect(listInstructions).toHaveBeenCalledWith({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: null,
    });
    expect(createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        resourceType: 'knowledge_base',
        resourceId: 'kb-1',
        result: 'allowed',
        payloadJson: {
          operation: 'get_instructions',
        },
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 7,
      }),
    ]);
  });

  it('rejects instruction reads in binding-only mode without granted actions', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new InstructionController();
    const listInstructions = jest.fn();

    await expect(
      resolver.getInstructions(null, null, {
        runtimeScope: {
          project: { id: 42 },
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1', defaultKbSnapshotId: 'snapshot-1' },
          kbSnapshot: { id: 'snapshot-1' },
          deployHash: 'deploy-1',
        },
        authorizationActor: {
          ...createAuthorizationActor(),
          grantedActions: [],
          workspaceRoleSource: 'legacy',
          platformRoleSource: 'legacy',
        },
        auditEventRepository: { createOne: jest.fn() },
        telemetry: { sendEvent: jest.fn() },
        instructionService: { listInstructions },
      } as any),
    ).rejects.toThrow('Knowledge base read permission required');

    expect(listInstructions).not.toHaveBeenCalled();
  });

  it('records succeeded audit events for instruction creation', async () => {
    const resolver = new InstructionController();
    const createInstruction = jest.fn().mockResolvedValue({
      id: 9,
      instruction: 'Use only scoped docs.',
      questions: ['GMV?'],
      isDefault: false,
    });
    const createOne = jest.fn();

    await resolver.createInstruction(
      null,
      {
        data: {
          instruction: 'Use only scoped docs.',
          questions: ['GMV?'],
          isDefault: false,
        },
      },
      {
        runtimeScope: {
          project: { id: 42 },
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1', defaultKbSnapshotId: 'snapshot-1' },
          kbSnapshot: { id: 'snapshot-1' },
          deployHash: 'deploy-1',
        },
        authorizationActor: createAuthorizationActor(),
        auditEventRepository: { createOne },
        telemetry: { sendEvent: jest.fn() },
        instructionService: { createInstruction },
        knowledgeBaseRepository: { findOneBy: jest.fn() },
        kbSnapshotRepository: { findOneBy: jest.fn() },
      } as any,
    );

    expect(createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.update',
        resourceType: 'instruction',
        resourceId: '9',
        result: 'succeeded',
      }),
    );
  });
});
