import { AskingService } from '../askingService';

describe('AskingService', () => {
  describe('createAskingTask', () => {
    it('reuses persisted thread runtime identity for follow-up asks', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn().mockResolvedValue({
          id: 101,
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        }),
      };
      service.askingTaskTracker = {
        createAskingTask: jest.fn().mockResolvedValue({ queryId: 'query-1' }),
      };
      service.getAskingHistory = jest.fn().mockResolvedValue([]);
      service.getDeployId =
        AskingService.prototype['getDeployId'].bind(service);
      service.deployService = {
        getLastDeploymentByRuntimeIdentity: jest.fn(),
      };

      await service.createAskingTask(
        { question: 'follow up' },
        {
          threadId: 101,
          runtimeIdentity: {
            projectId: 999,
            workspaceId: 'workspace-other',
            knowledgeBaseId: 'kb-other',
            kbSnapshotId: 'snapshot-other',
            deployHash: 'deploy-other',
            actorUserId: 'user-other',
          },
          language: 'en',
        },
      );

      expect(service.askingTaskTracker.createAskingTask).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'follow up',
          histories: [],
          deployId: 'deploy-1',
          runtimeScopeId: 'deploy-1',
          configurations: { language: 'en' },
          rerunFromCancelled: undefined,
          previousTaskId: undefined,
          threadResponseId: undefined,
          runtimeIdentity: expect.objectContaining({
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-1',
            actorUserId: 'user-1',
          }),
          retrievalScopeIds: ['deploy-1'],
        }),
      );
      expect(
        service.deployService.getLastDeploymentByRuntimeIdentity,
      ).not.toHaveBeenCalled();
    });

    it('resolves deploy hash from payload runtime identity for first asks', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn(),
      };
      service.askingTaskTracker = {
        createAskingTask: jest.fn().mockResolvedValue({ queryId: 'query-2' }),
      };
      service.getAskingHistory = jest.fn();
      service.getDeployId =
        AskingService.prototype['getDeployId'].bind(service);
      service.deployService = {
        getLastDeploymentByRuntimeIdentity: jest
          .fn()
          .mockResolvedValue({ hash: 'deploy-2' }),
      };
      service.resolveAskingRuntimeIdentity =
        AskingService.prototype['resolveAskingRuntimeIdentity'].bind(service);

      await service.createAskingTask(
        { question: 'fresh ask' },
        {
          runtimeScopeId: 'legacy-runtime-42',
          runtimeIdentity: {
            projectId: 42,
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            actorUserId: 'user-1',
          },
          language: 'en',
        },
      );

      expect(
        service.deployService.getLastDeploymentByRuntimeIdentity,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          actorUserId: 'user-1',
        }),
      );
      expect(service.askingTaskTracker.createAskingTask).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'fresh ask',
          histories: undefined,
          deployId: 'deploy-2',
          runtimeScopeId: 'legacy-runtime-42',
          configurations: { language: 'en' },
          runtimeIdentity: {
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-2',
            actorUserId: 'user-1',
          },
        }),
      );
    });

    it('pins runtime identity to selected knowledge base when scope is workspace-only', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn(),
      };
      service.askingTaskTracker = {
        createAskingTask: jest
          .fn()
          .mockResolvedValue({ queryId: 'query-workspace-scope' }),
      };
      service.getAskingHistory = jest.fn();
      service.getDeployId =
        AskingService.prototype['getDeployId'].bind(service);
      service.resolveAskingRuntimeIdentity =
        AskingService.prototype['resolveAskingRuntimeIdentity'].bind(service);
      service.deployService = {
        getLastDeploymentByRuntimeIdentity: jest
          .fn()
          .mockResolvedValue({ hash: 'deploy-kb-2' }),
      };
      service.skillService = {};

      await service.createAskingTask(
        {
          question: 'workspace scoped ask',
          knowledgeBaseIds: ['kb-2'],
        },
        {
          runtimeIdentity: {
            projectId: null,
            workspaceId: 'workspace-1',
            knowledgeBaseId: null,
            kbSnapshotId: null,
            deployHash: null,
            actorUserId: 'user-1',
          },
          language: 'zh-CN',
        },
      );

      expect(
        service.deployService.getLastDeploymentByRuntimeIdentity,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-2',
          kbSnapshotId: null,
          deployHash: null,
          projectId: null,
        }),
      );
      expect(service.askingTaskTracker.createAskingTask).toHaveBeenCalledWith(
        expect.objectContaining({
          deployId: 'deploy-kb-2',
          runtimeScopeId: 'deploy-kb-2',
          runtimeIdentity: {
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-2',
            kbSnapshotId: null,
            deployHash: 'deploy-kb-2',
            actorUserId: 'user-1',
          },
          retrievalScopeIds: ['deploy-kb-2'],
        }),
      );
    });

    it('persists a placeholder asking task record immediately for first asks', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn(),
      };
      service.askingTaskTracker = {
        createAskingTask: jest.fn().mockResolvedValue({ queryId: 'query-2a' }),
      };
      service.askingTaskRepository = {
        findByQueryId: jest.fn().mockResolvedValue(null),
        createOne: jest.fn().mockResolvedValue({ id: 9, queryId: 'query-2a' }),
      };
      service.getAskingHistory = jest.fn();
      service.getDeployId =
        AskingService.prototype['getDeployId'].bind(service);
      service.deployService = {
        getLastDeploymentByRuntimeIdentity: jest
          .fn()
          .mockResolvedValue({ hash: 'deploy-2' }),
      };
      service.resolveAskingRuntimeIdentity =
        AskingService.prototype['resolveAskingRuntimeIdentity'].bind(service);

      await service.createAskingTask(
        { question: 'fresh ask' },
        {
          runtimeScopeId: 'legacy-runtime-42',
          runtimeIdentity: {
            projectId: 42,
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            actorUserId: 'user-1',
          },
          language: 'en',
        },
      );

      expect(service.askingTaskRepository.findByQueryId).toHaveBeenCalledWith(
        'query-2a',
      );
      expect(service.askingTaskRepository.createOne).toHaveBeenCalledWith(
        expect.objectContaining({
          queryId: 'query-2a',
          question: 'fresh ask',
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-2',
          detail: {
            type: null,
            status: 'UNDERSTANDING',
            response: [],
            error: null,
          },
        }),
      );
    });

    it('allows first asks to proceed with deployHash-only runtime identity', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn(),
      };
      service.askingTaskTracker = {
        createAskingTask: jest
          .fn()
          .mockResolvedValue({ queryId: 'query-deploy-only' }),
      };
      service.getAskingHistory = jest.fn();
      service.resolveAskingRuntimeIdentity =
        AskingService.prototype['resolveAskingRuntimeIdentity'].bind(service);
      service.skillService = {};

      await service.createAskingTask(
        { question: 'fresh ask with deploy only' },
        {
          runtimeIdentity: {
            projectId: 999,
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-42',
            actorUserId: 'user-1',
          },
          language: 'en',
        },
      );

      expect(service.askingTaskTracker.createAskingTask).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'fresh ask with deploy only',
          histories: undefined,
          deployId: 'deploy-42',
          runtimeScopeId: 'deploy-42',
          configurations: { language: 'en' },
          rerunFromCancelled: undefined,
          previousTaskId: undefined,
          threadResponseId: undefined,
          runtimeIdentity: {
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-42',
            actorUserId: 'user-1',
          },
          skills: [],
          retrievalScopeIds: ['deploy-42'],
        }),
      );
    });

    it('resolves first asks from canonical runtime scope without a project bridge when deployment history exists', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn(),
      };
      service.askingTaskTracker = {
        createAskingTask: jest.fn().mockResolvedValue({ queryId: 'query-5' }),
      };
      service.getAskingHistory = jest.fn();
      service.getDeployId =
        AskingService.prototype['getDeployId'].bind(service);
      service.deployService = {
        getLastDeploymentByRuntimeIdentity: jest
          .fn()
          .mockResolvedValue({ hash: 'deploy-runtime-1', projectId: 77 }),
      };
      service.resolveAskingRuntimeIdentity =
        AskingService.prototype['resolveAskingRuntimeIdentity'].bind(service);
      service.skillService = {};
      await service.createAskingTask(
        { question: 'fresh ask from runtime scope' },
        {
          runtimeIdentity: {
            projectId: null,
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: null,
            actorUserId: 'user-1',
          },
          language: 'en',
        },
      );

      expect(
        service.deployService.getLastDeploymentByRuntimeIdentity,
      ).toHaveBeenCalledWith({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: null,
        actorUserId: 'user-1',
      });
      expect(service.askingTaskTracker.createAskingTask).toHaveBeenCalledWith(
        expect.objectContaining({
          deployId: 'deploy-runtime-1',
          runtimeScopeId: 'deploy-runtime-1',
          runtimeIdentity: {
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-runtime-1',
            actorUserId: 'user-1',
          },
        }),
      );
    });
  });
});
