import {
  createDashboardServiceHarness,
  TestDashboardService,
} from './dashboardService.testSupport';

describe('DashboardService', () => {
  let dashboardService: TestDashboardService;
  let mockDashboardRepository: any;
  let mockTransaction: any;

  beforeEach(() => {
    ({ dashboardService, mockDashboardRepository, mockTransaction } =
      createDashboardServiceHarness());
  });

  describe('project-scoped dashboard access', () => {
    it('should prefer explicit project id when initializing dashboard', async () => {
      mockDashboardRepository.findAllBy.mockResolvedValue([]);
      mockDashboardRepository.createOne.mockResolvedValue({
        id: 1,
        projectId: 42,
        name: 'Dashboard',
      });

      const result = await dashboardService.initDashboard(42);

      expect(mockDashboardRepository.findAllBy).toHaveBeenCalledWith({
        projectId: 42,
      });
      expect(mockDashboardRepository.createOne).toHaveBeenCalledWith({
        isDefault: true,
        name: 'Dashboard',
        projectId: 42,
        workspaceId: null,
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
        createdBy: null,
      });
      expect(result.projectId).toBe(42);
    });

    it('should fetch current dashboard by explicit project id', async () => {
      mockDashboardRepository.findAllBy.mockResolvedValue([
        {
          id: 2,
          projectId: 7,
          name: 'Dashboard',
        },
      ]);

      const result = await dashboardService.getCurrentDashboard(7);

      expect(mockDashboardRepository.findAllBy).toHaveBeenCalledWith({
        projectId: 7,
      });
      expect(result.projectId).toBe(7);
    });

    it('should create an unbound project dashboard instead of reusing a knowledge-base bound dashboard for legacy project scope', async () => {
      mockDashboardRepository.findAllBy.mockResolvedValue([
        {
          id: 20,
          projectId: 7,
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
          name: 'KB Dashboard',
        },
      ]);
      mockDashboardRepository.createOne.mockResolvedValue({
        id: 21,
        projectId: 7,
        workspaceId: null,
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
        createdBy: null,
        isDefault: true,
        name: 'Dashboard',
      });

      const result = await dashboardService.getCurrentDashboardForScope(7);

      expect(mockDashboardRepository.findAllBy).toHaveBeenCalledWith({
        projectId: 7,
      });
      expect(mockDashboardRepository.createOne).toHaveBeenCalledWith({
        isDefault: true,
        name: 'Dashboard',
        projectId: 7,
        workspaceId: null,
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
        createdBy: null,
      });
      expect(result?.id).toBe(21);
      expect(result?.knowledgeBaseId).toBeNull();
    });

    it('should prefer knowledge-base bound dashboard when scope binding exists', async () => {
      mockDashboardRepository.findAllBy.mockResolvedValueOnce([
        {
          id: 3,
          projectId: 7,
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-old',
          deployHash: 'deploy-old',
          createdBy: null,
          name: 'Dashboard',
        },
      ]);
      mockDashboardRepository.findOneBy
        .mockResolvedValueOnce({
          id: 3,
          projectId: 7,
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-old',
          deployHash: 'deploy-old',
          createdBy: null,
          name: 'Dashboard',
        })
        .mockResolvedValueOnce({
          id: 3,
          projectId: 7,
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-old',
          deployHash: 'deploy-old',
          createdBy: null,
          name: 'Dashboard',
        });
      mockDashboardRepository.updateOne.mockResolvedValue({
        id: 3,
        projectId: 7,
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
        createdBy: 'user-1',
        name: 'Dashboard',
      });

      const result = await dashboardService.getCurrentDashboardForScope(7, {
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
        createdBy: 'user-1',
      });

      expect(mockDashboardRepository.findAllBy).toHaveBeenNthCalledWith(1, {
        knowledgeBaseId: 'kb-1',
      });
      expect(mockDashboardRepository.updateOne).toHaveBeenCalledWith(3, {
        projectId: null,
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
        createdBy: 'user-1',
      });
      expect(result?.kbSnapshotId).toBe('snap-1');
    });

    it('should resolve a knowledge-base bound dashboard without requiring a legacy project bridge', async () => {
      mockDashboardRepository.findAllBy.mockResolvedValueOnce([
        {
          id: 30,
          projectId: 7,
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
          createdBy: 'user-1',
          name: 'Dashboard',
        },
      ]);
      mockDashboardRepository.findOneBy.mockResolvedValueOnce({
        id: 30,
        projectId: 7,
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
        createdBy: 'user-1',
        name: 'Dashboard',
      });
      mockDashboardRepository.updateOne.mockResolvedValueOnce({
        id: 30,
        projectId: null,
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
        createdBy: 'user-1',
        name: 'Dashboard',
      });

      const result = await dashboardService.getCurrentDashboardForScope(null, {
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
        createdBy: 'user-1',
      });

      expect(mockDashboardRepository.findAllBy).toHaveBeenCalledWith({
        knowledgeBaseId: 'kb-1',
      });
      expect(mockDashboardRepository.findOneBy).toHaveBeenCalledWith({
        id: 30,
      });
      expect(mockDashboardRepository.updateOne).toHaveBeenCalledWith(30, {
        projectId: null,
      });
      expect(result?.id).toBe(30);
      expect(result?.projectId).toBeNull();
    });

    it('should create a bound dashboard when no scoped dashboard exists and no legacy project bridge is available', async () => {
      mockDashboardRepository.findAllBy.mockResolvedValueOnce([]);
      mockDashboardRepository.createOne.mockResolvedValue({
        id: 31,
        projectId: null,
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
        createdBy: 'user-1',
        name: 'Dashboard',
      });

      const result = await dashboardService.getCurrentDashboardForScope(null, {
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
        createdBy: 'user-1',
      });

      expect(mockDashboardRepository.createOne).toHaveBeenCalledWith({
        isDefault: true,
        name: 'Dashboard',
        projectId: null,
        workspaceId: null,
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
        createdBy: 'user-1',
      });
      expect(result?.projectId).toBeNull();
    });

    it('should backfill runtime binding onto legacy project dashboard', async () => {
      mockDashboardRepository.findAllBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 4,
            projectId: 9,
            name: 'Dashboard',
            knowledgeBaseId: null,
          },
        ]);
      mockDashboardRepository.findOneBy.mockResolvedValueOnce({
        id: 4,
        projectId: 9,
        name: 'Dashboard',
        knowledgeBaseId: null,
      });
      mockDashboardRepository.updateOne.mockResolvedValue({
        id: 4,
        projectId: 9,
        knowledgeBaseId: 'kb-9',
        kbSnapshotId: 'snap-9',
        deployHash: 'deploy-9',
        createdBy: 'user-9',
        name: 'Dashboard',
      });

      const result = await dashboardService.getCurrentDashboardForScope(9, {
        knowledgeBaseId: 'kb-9',
        kbSnapshotId: 'snap-9',
        deployHash: 'deploy-9',
        createdBy: 'user-9',
      });

      expect(mockDashboardRepository.findAllBy).toHaveBeenNthCalledWith(1, {
        knowledgeBaseId: 'kb-9',
      });
      expect(mockDashboardRepository.findAllBy).toHaveBeenNthCalledWith(2, {
        projectId: 9,
      });
      expect(mockDashboardRepository.updateOne).toHaveBeenCalledWith(4, {
        projectId: null,
        knowledgeBaseId: 'kb-9',
        kbSnapshotId: 'snap-9',
        deployHash: 'deploy-9',
        createdBy: 'user-9',
      });
      expect(result?.knowledgeBaseId).toBe('kb-9');
    });

    it('should create a scoped dashboard instead of rebinding another knowledge base', async () => {
      mockDashboardRepository.findAllBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 5,
            projectId: 11,
            knowledgeBaseId: 'kb-other',
            name: 'Dashboard',
          },
        ]);
      mockDashboardRepository.createOne.mockResolvedValue({
        id: 6,
        projectId: 11,
        knowledgeBaseId: 'kb-11',
        kbSnapshotId: 'snap-11',
        deployHash: 'deploy-11',
        createdBy: 'user-11',
        name: 'Dashboard',
      });

      const result = await dashboardService.getCurrentDashboardForScope(11, {
        knowledgeBaseId: 'kb-11',
        kbSnapshotId: 'snap-11',
        deployHash: 'deploy-11',
        createdBy: 'user-11',
      });

      expect(mockDashboardRepository.createOne).toHaveBeenCalledWith({
        name: 'Dashboard',
        projectId: null,
        workspaceId: null,
        knowledgeBaseId: 'kb-11',
        kbSnapshotId: 'snap-11',
        deployHash: 'deploy-11',
        createdBy: 'user-11',
        isDefault: true,
      });
      expect(result?.id).toBe(6);
    });

    it('should ignore workspace-bound legacy dashboards when resolving a project-only dashboard', async () => {
      mockDashboardRepository.findAllBy.mockResolvedValue([
        {
          id: 70,
          projectId: 14,
          workspaceId: 'ws-1',
          knowledgeBaseId: null,
          kbSnapshotId: null,
          deployHash: null,
          name: 'Workspace Dashboard',
        },
      ]);
      mockDashboardRepository.createOne.mockResolvedValue({
        id: 71,
        projectId: 14,
        workspaceId: null,
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
        createdBy: null,
        isDefault: true,
        name: 'Dashboard',
      });

      const result = await dashboardService.getCurrentDashboardForScope(14);

      expect(mockDashboardRepository.findAllBy).toHaveBeenCalledWith({
        projectId: 14,
      });
      expect(mockDashboardRepository.createOne).toHaveBeenCalledWith({
        isDefault: true,
        name: 'Dashboard',
        projectId: 14,
        workspaceId: null,
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
        createdBy: null,
      });
      expect(result?.id).toBe(71);
    });

    it('should mark only the first dashboard in a scope as default when creating', async () => {
      mockDashboardRepository.findAllBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 41,
            projectId: 15,
            name: '经营总览',
            isDefault: true,
          },
        ]);
      mockDashboardRepository.createOne
        .mockResolvedValueOnce({
          id: 41,
          projectId: 15,
          name: '经营总览',
          isDefault: true,
        })
        .mockResolvedValueOnce({
          id: 42,
          projectId: 15,
          name: '销售日报',
          isDefault: false,
        });

      await dashboardService.createDashboardForScope({ name: '经营总览' }, 15);
      await dashboardService.createDashboardForScope({ name: '销售日报' }, 15);

      expect(mockDashboardRepository.createOne).toHaveBeenNthCalledWith(1, {
        isDefault: true,
        name: '经营总览',
        projectId: 15,
        workspaceId: null,
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
        createdBy: null,
      });
      expect(mockDashboardRepository.createOne).toHaveBeenNthCalledWith(2, {
        isDefault: false,
        name: '销售日报',
        projectId: 15,
        workspaceId: null,
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
        createdBy: null,
      });
    });

    it('should promote the selected dashboard to default within the active scope', async () => {
      const scopeDashboards = [
        {
          id: 51,
          projectId: 20,
          name: '经营总览',
          isDefault: true,
        },
        {
          id: 52,
          projectId: 20,
          name: '销售日报',
          isDefault: false,
        },
      ];
      mockDashboardRepository.findAllBy
        .mockResolvedValueOnce(scopeDashboards)
        .mockResolvedValueOnce(scopeDashboards);
      mockDashboardRepository.updateOne
        .mockResolvedValueOnce({
          ...scopeDashboards[0],
          isDefault: false,
        })
        .mockResolvedValueOnce({
          ...scopeDashboards[1],
          isDefault: true,
        });

      const result = await dashboardService.updateDashboardForScope(
        52,
        { isDefault: true },
        20,
      );

      expect(mockDashboardRepository.transaction).toHaveBeenCalled();
      expect(mockDashboardRepository.updateOne).toHaveBeenNthCalledWith(
        1,
        51,
        { isDefault: false },
        { tx: mockTransaction },
      );
      expect(mockDashboardRepository.updateOne).toHaveBeenNthCalledWith(
        2,
        52,
        { isDefault: true },
        { tx: mockTransaction },
      );
      expect(mockDashboardRepository.commit).toHaveBeenCalledWith(
        mockTransaction,
      );
      expect(result.isDefault).toBe(true);
    });

    it('lists workspace-scoped dashboards when only workspace scope is provided', async () => {
      mockDashboardRepository.findAllBy.mockResolvedValue([
        {
          id: 101,
          projectId: null,
          workspaceId: 'ws-1',
          knowledgeBaseId: null,
          name: '经营总览',
          isDefault: true,
        },
        {
          id: 102,
          projectId: null,
          workspaceId: 'ws-1',
          knowledgeBaseId: null,
          name: '销售日报',
          isDefault: false,
        },
        {
          id: 103,
          projectId: 27,
          workspaceId: 'ws-1',
          knowledgeBaseId: null,
          name: '旧知识库看板',
          isDefault: false,
        },
        {
          id: 104,
          projectId: null,
          workspaceId: 'ws-2',
          knowledgeBaseId: null,
          name: '其他工作空间',
          isDefault: true,
        },
      ]);

      const result = await dashboardService.listDashboardsForScope(null, {
        workspaceId: 'ws-1',
      });

      expect(mockDashboardRepository.findAllBy).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
      });
      expect(result.map((dashboard) => dashboard.id)).toEqual([101, 102]);
    });

    it('creates workspace-scoped dashboards with workspace binding and non-default follow-ups', async () => {
      mockDashboardRepository.findAllBy
        .mockResolvedValueOnce([
          {
            id: 201,
            projectId: null,
            workspaceId: 'ws-1',
            knowledgeBaseId: null,
            name: '默认看板',
            isDefault: true,
          },
        ])
        .mockResolvedValueOnce([]);
      mockDashboardRepository.createOne
        .mockResolvedValueOnce({
          id: 202,
          projectId: null,
          workspaceId: 'ws-1',
          knowledgeBaseId: null,
          name: '经营总览',
          isDefault: false,
        })
        .mockResolvedValueOnce({
          id: 203,
          projectId: null,
          workspaceId: 'ws-2',
          knowledgeBaseId: null,
          name: '首个看板',
          isDefault: true,
        });

      await dashboardService.createDashboardForScope(
        { name: '经营总览' },
        null,
        { workspaceId: 'ws-1', createdBy: 'user-1' },
      );
      await dashboardService.createDashboardForScope(
        { name: '首个看板' },
        null,
        { workspaceId: 'ws-2', createdBy: 'user-2' },
      );

      expect(mockDashboardRepository.createOne).toHaveBeenNthCalledWith(1, {
        isDefault: false,
        name: '经营总览',
        projectId: null,
        workspaceId: 'ws-1',
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
        createdBy: 'user-1',
      });
      expect(mockDashboardRepository.createOne).toHaveBeenNthCalledWith(2, {
        isDefault: true,
        name: '首个看板',
        projectId: null,
        workspaceId: 'ws-2',
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
        createdBy: 'user-2',
      });
    });
  });
});
