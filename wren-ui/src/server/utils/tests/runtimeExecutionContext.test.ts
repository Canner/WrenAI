import {
  buildRuntimeExecutionContext,
  getRuntimeProjectBridgeId,
  resolveProjectLanguage,
  resolveRuntimeSampleDataset,
  resolveRuntimeExecutionContext,
  resolveRuntimeProject,
} from '../runtimeExecutionContext';

describe('runtimeExecutionContext', () => {
  const runtimeScope = {
    source: 'explicit-request',
    selector: {},
    project: { id: 7, language: 'EN' },
    deployment: {
      hash: 'deploy-1',
      projectId: 9,
      manifest: { models: [] },
    },
    deployHash: null,
    workspace: { id: 'workspace-1' },
    knowledgeBase: { id: 'kb-1' },
    kbSnapshot: { id: 'snapshot-1' },
    actorClaims: null,
    userId: 'user-1',
  } as any;

  it('prefers deployment project id when deriving the runtime project id', () => {
    expect(getRuntimeProjectBridgeId(runtimeScope, 99)).toBe(9);
  });

  it('falls back to runtime scope project id and explicit fallback project id', () => {
    expect(
      getRuntimeProjectBridgeId({
        ...runtimeScope,
        deployment: null,
      } as any),
    ).toBe(7);

    expect(
      getRuntimeProjectBridgeId(
        {
          ...runtimeScope,
          deployment: null,
          project: null,
        } as any,
        99,
      ),
    ).toBe(99);
  });

  it('falls back to knowledge base runtime project id before explicit fallback project id', () => {
    expect(
      getRuntimeProjectBridgeId(
        {
          ...runtimeScope,
          deployment: null,
          project: null,
          knowledgeBase: {
            ...runtimeScope.knowledgeBase,
            runtimeProjectId: 77,
          },
        } as any,
        99,
      ),
    ).toBe(77);
  });

  it('uses selector or explicit fallback project ids without requiring a fully persisted runtime identity', () => {
    expect(
      getRuntimeProjectBridgeId(
        {
          ...runtimeScope,
          deployment: null,
          project: null,
          knowledgeBase: null,
          kbSnapshot: null,
          deployHash: null,
          selector: { bridgeProjectId: 33 },
        } as any,
        99,
      ),
    ).toBe(33);

    expect(
      getRuntimeProjectBridgeId(
        {
          ...runtimeScope,
          deployment: null,
          project: null,
          knowledgeBase: null,
          kbSnapshot: null,
          deployHash: null,
          selector: {},
        } as any,
        99,
      ),
    ).toBe(99);
  });

  it('returns the scoped project without hitting projectService when it is already loaded', async () => {
    const projectService = { getProjectById: jest.fn() };

    await expect(
      resolveRuntimeProject(runtimeScope, projectService as any),
    ).resolves.toBe(runtimeScope.project);
    expect(projectService.getProjectById).not.toHaveBeenCalled();
  });

  it('loads the runtime project from projectService when the runtime scope project is absent', async () => {
    const projectService = {
      getProjectById: jest.fn().mockResolvedValue({ id: 9, language: 'ZH_TW' }),
    };

    await expect(
      resolveRuntimeProject(
        {
          ...runtimeScope,
          project: null,
        } as any,
        projectService as any,
      ),
    ).resolves.toEqual({ id: 9, language: 'ZH_TW' });
    expect(projectService.getProjectById).toHaveBeenCalledWith(9);
  });

  it('falls back to an explicit project id when neither deployment nor runtime scope project is present', async () => {
    const projectService = {
      getProjectById: jest.fn().mockResolvedValue({ id: 99, language: 'EN' }),
    };

    await expect(
      resolveRuntimeProject(
        {
          ...runtimeScope,
          project: null,
          deployment: null,
        } as any,
        projectService as any,
        99,
      ),
    ).resolves.toEqual({ id: 99, language: 'EN' });
    expect(projectService.getProjectById).toHaveBeenCalledWith(99);
  });

  it('builds an execution context with a fetched project and deployment hash backfill', async () => {
    const projectService = {
      getProjectById: jest.fn().mockResolvedValue({ id: 9, language: 'EN' }),
    };

    await expect(
      resolveRuntimeExecutionContext({
        runtimeScope: {
          ...runtimeScope,
          project: null,
        } as any,
        projectService: projectService as any,
      }),
    ).resolves.toEqual({
      runtimeIdentity: {
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      },
      project: { id: 9, language: 'EN' },
      deployment: runtimeScope.deployment,
      manifest: runtimeScope.deployment.manifest,
      language: 'Simplified Chinese',
    });
  });

  it('returns null when execution context cannot resolve a project', () => {
    expect(
      buildRuntimeExecutionContext({
        ...runtimeScope,
        project: null,
      } as any),
    ).toBeNull();
  });

  it('maps project language via adaptor language names', () => {
    expect(resolveProjectLanguage({ language: 'ZH_TW' } as any)).toBe(
      'Traditional Chinese',
    );
  });

  it('prefers knowledge base language and sample dataset runtime traits', () => {
    expect(
      resolveProjectLanguage(
        { language: 'EN' } as any,
        { language: 'ZH_TW' } as any,
      ),
    ).toBe('Traditional Chinese');
    expect(
      resolveRuntimeSampleDataset(
        { sampleDataset: null } as any,
        { sampleDataset: 'ECOMMERCE' } as any,
      ),
    ).toBe('ECOMMERCE');
  });

  it('builds execution context language from knowledge base when available', () => {
    expect(
      buildRuntimeExecutionContext({
        ...runtimeScope,
        knowledgeBase: {
          ...runtimeScope.knowledgeBase,
          language: 'ZH_TW',
        },
      } as any),
    ).toEqual(
      expect.objectContaining({
        language: 'Traditional Chinese',
      }),
    );
  });
});
