import { AskingService } from '../askingService';

describe('AskingService', () => {
  describe('thread response runtime identity', () => {
    it('fills missing response runtime fields from the parent thread', async () => {
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
      service.getThreadById =
        AskingService.prototype['getThreadById'].bind(service);
      service.getThreadResponseRuntimeIdentity =
        AskingService.prototype['getThreadResponseRuntimeIdentity'].bind(
          service,
        );

      const runtimeIdentity = await service.getThreadResponseRuntimeIdentity({
        id: 202,
        threadId: 101,
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: null,
        actorUserId: null,
        question: 'follow up',
      });

      expect(runtimeIdentity).toEqual({
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      });
    });

    it('falls back to the parent thread project identity when response uses legacy-null project bridge', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn().mockResolvedValue({
          id: 101,
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-thread',
          actorUserId: 'user-1',
        }),
      };
      service.getThreadById =
        AskingService.prototype['getThreadById'].bind(service);
      service.getThreadResponseRuntimeIdentity =
        AskingService.prototype['getThreadResponseRuntimeIdentity'].bind(
          service,
        );

      const runtimeIdentity = await service.getThreadResponseRuntimeIdentity({
        id: 202,
        threadId: 101,
        projectId: null,
        workspaceId: null,
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
        actorUserId: null,
        question: 'follow up',
      });

      expect(runtimeIdentity).toEqual({
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-thread',
        actorUserId: 'user-1',
      });
    });

    it('resolves project and deployment from deploy hash when runtime identity project bridge is absent', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.projectService = {
        getProjectById: jest
          .fn()
          .mockResolvedValue({ id: 42, type: 'POSTGRES' }),
      };
      service.deployService = {
        getDeploymentByRuntimeIdentity: jest.fn().mockResolvedValue({
          id: 12,
          projectId: 42,
          hash: 'deploy-42',
          manifest: { models: [] },
        }),
      };
      service.getProjectAndDeployment =
        AskingService.prototype['getProjectAndDeployment'].bind(service);

      await expect(
        service.getProjectAndDeployment({
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-42',
          actorUserId: 'user-1',
        }),
      ).resolves.toEqual({
        project: { id: 42, type: 'POSTGRES' },
        deployment: {
          id: 12,
          projectId: 42,
          hash: 'deploy-42',
          manifest: { models: [] },
        },
      });
      expect(
        service.deployService.getDeploymentByRuntimeIdentity,
      ).toHaveBeenCalledWith({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-42',
        actorUserId: 'user-1',
      });
      expect(service.projectService.getProjectById).toHaveBeenCalledWith(42);
    });

    it('rebuilds project metadata from deployment manifest when the project row is missing', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.projectService = {
        getProjectById: jest.fn().mockResolvedValue(null),
      };
      service.deployService = {
        getDeploymentByRuntimeIdentity: jest.fn().mockResolvedValue({
          id: 12,
          projectId: 42,
          hash: 'deploy-42',
          manifest: {
            catalog: 'wrenai',
            schema: 'public',
            dataSource: 'POSTGRES',
            models: [],
          },
        }),
      };
      service.buildManifestBackedProject =
        AskingService.prototype['buildManifestBackedProject'].bind(service);
      service.mapManifestDataSourceToProjectType =
        AskingService.prototype['mapManifestDataSourceToProjectType'].bind(
          service,
        );
      service.getProjectAndDeployment =
        AskingService.prototype['getProjectAndDeployment'].bind(service);

      await expect(
        service.getProjectAndDeployment({
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-42',
          actorUserId: 'user-1',
        }),
      ).resolves.toEqual({
        project: expect.objectContaining({
          id: 42,
          type: 'POSTGRES',
          catalog: 'wrenai',
          schema: 'public',
        }),
        deployment: {
          id: 12,
          projectId: 42,
          hash: 'deploy-42',
          manifest: {
            catalog: 'wrenai',
            schema: 'public',
            dataSource: 'POSTGRES',
            models: [],
          },
        },
      });
    });
  });

  describe('listThreads', () => {
    it('filters threads by runtime identity', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        listAllTimeDescOrderByScope: jest.fn().mockResolvedValue([
          {
            id: 1,
            projectId: 42,
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-1',
          },
          {
            id: 3,
            projectId: 42,
            workspaceId: null,
            knowledgeBaseId: null,
            kbSnapshotId: null,
            deployHash: null,
          },
        ]),
      };

      const threads = await service.listThreads({
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      });

      expect(threads.map((thread: { id: number }) => thread.id)).toEqual([
        1, 3,
      ]);
      expect(
        service.threadRepository.listAllTimeDescOrderByScope,
      ).toHaveBeenCalledWith({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      });
    });

    it('allows listing threads with deployHash-only runtime identity', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        listAllTimeDescOrderByScope: jest.fn().mockResolvedValue([]),
      };

      await service.listThreads({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      });

      expect(
        service.threadRepository.listAllTimeDescOrderByScope,
      ).toHaveBeenCalledWith({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      });
    });
  });
});
