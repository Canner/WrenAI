import { AskingService } from '../askingService';

describe('AskingService', () => {
  describe('scope guard', () => {
    it('rejects thread access outside current runtime scope', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneByIdWithRuntimeScope: jest.fn().mockResolvedValue(null),
        findOneBy: jest.fn().mockResolvedValue({
          id: 101,
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-2',
          kbSnapshotId: 'snapshot-2',
          deployHash: 'deploy-2',
        }),
      };

      await expect(
        service.assertThreadScope(101, {
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        }),
      ).rejects.toThrow(
        'Thread 101 does not belong to the current runtime scope',
      );
    });

    it('returns thread when repository scoped lookup succeeds', async () => {
      const service = Object.create(AskingService.prototype) as any;
      const thread = {
        id: 101,
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      };
      const runtimeIdentity = {
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      };
      const normalizedRuntimeIdentity = {
        ...runtimeIdentity,
        projectId: null,
      };
      service.threadRepository = {
        findOneByIdWithRuntimeScope: jest.fn().mockResolvedValue(thread),
        findOneBy: jest.fn(),
      };

      await expect(
        service.assertThreadScope(101, runtimeIdentity),
      ).resolves.toEqual(thread);
      expect(
        service.threadRepository.findOneByIdWithRuntimeScope,
      ).toHaveBeenCalledWith(101, normalizedRuntimeIdentity);
      expect(service.threadRepository.findOneBy).not.toHaveBeenCalled();
    });

    it('accepts thread access when repository matches runtime scope through legacy-null project bridge', async () => {
      const service = Object.create(AskingService.prototype) as any;
      const thread = {
        id: 101,
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      };
      const runtimeIdentity = {
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      };
      const normalizedRuntimeIdentity = {
        ...runtimeIdentity,
        projectId: null,
      };
      service.threadRepository = {
        findOneByIdWithRuntimeScope: jest.fn().mockResolvedValue(thread),
        findOneBy: jest.fn(),
      };

      await expect(
        service.assertThreadScope(101, runtimeIdentity),
      ).resolves.toEqual(thread);
      expect(
        service.threadRepository.findOneByIdWithRuntimeScope,
      ).toHaveBeenCalledWith(101, normalizedRuntimeIdentity);
      expect(service.threadRepository.findOneBy).not.toHaveBeenCalled();
    });

    it('accepts asking task access when repository matches runtime scope through legacy-null project bridge', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.askingTaskRepository = {
        findByQueryIdWithRuntimeScope: jest.fn().mockResolvedValue({
          id: 303,
          queryId: 'query-1',
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
        }),
        findByQueryId: jest.fn(),
      };

      const runtimeIdentity = {
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      };
      const normalizedRuntimeIdentity = {
        ...runtimeIdentity,
        projectId: null,
      };

      await expect(
        service.assertAskingTaskScope('query-1', runtimeIdentity),
      ).resolves.toBeUndefined();
      expect(
        service.askingTaskRepository.findByQueryIdWithRuntimeScope,
      ).toHaveBeenCalledWith('query-1', normalizedRuntimeIdentity);
      expect(service.askingTaskRepository.findByQueryId).not.toHaveBeenCalled();
    });

    it('accepts asking task access when a newly created task is still only tracked in memory', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.askingTaskRepository = {
        findByQueryIdWithRuntimeScope: jest.fn().mockResolvedValue(null),
        findByQueryId: jest.fn().mockResolvedValue(null),
      };
      service.askingTaskTracker = {
        getTrackedRuntimeIdentity: jest.fn().mockResolvedValue({
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        }),
      };

      await expect(
        service.assertAskingTaskScope('query-1', {
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        }),
      ).resolves.toBeUndefined();

      expect(
        service.askingTaskTracker.getTrackedRuntimeIdentity,
      ).toHaveBeenCalledWith('query-1');
      expect(service.askingTaskRepository.findByQueryId).not.toHaveBeenCalled();
    });

    it('rejects asking task access outside current runtime scope', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.askingTaskRepository = {
        findByQueryIdWithRuntimeScope: jest.fn().mockResolvedValue(null),
        findByQueryId: jest.fn().mockResolvedValue({
          id: 303,
          queryId: 'query-1',
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-2',
          kbSnapshotId: 'snapshot-2',
          deployHash: 'deploy-2',
        }),
      };

      await expect(
        service.assertAskingTaskScope('query-1', {
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        }),
      ).rejects.toThrow(
        'Asking task query-1 does not belong to the current runtime scope',
      );
    });

    it('rejects response access outside current runtime scope', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadResponseRepository = {
        findOneByIdWithRuntimeScope: jest.fn().mockResolvedValue(null),
        findOneBy: jest.fn().mockResolvedValue({
          id: 202,
          threadId: 101,
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-2',
          kbSnapshotId: 'snapshot-2',
          deployHash: 'deploy-2',
        }),
      };

      await expect(
        service.assertResponseScope(202, {
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        }),
      ).rejects.toThrow(
        'Thread response 202 does not belong to the current runtime scope',
      );
    });

    it('accepts response access when repository matches runtime scope through legacy-null project bridge', async () => {
      const service = Object.create(AskingService.prototype) as any;
      const response = {
        id: 202,
        threadId: 101,
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      };
      const runtimeIdentity = {
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      };
      const normalizedRuntimeIdentity = {
        ...runtimeIdentity,
        projectId: null,
      };
      service.threadResponseRepository = {
        findOneByIdWithRuntimeScope: jest.fn().mockResolvedValue(response),
        findOneBy: jest.fn(),
      };

      await expect(
        service.assertResponseScope(202, runtimeIdentity),
      ).resolves.toEqual(response);
      expect(
        service.threadResponseRepository.findOneByIdWithRuntimeScope,
      ).toHaveBeenCalledWith(202, normalizedRuntimeIdentity);
      expect(service.threadResponseRepository.findOneBy).not.toHaveBeenCalled();
    });
  });
});
