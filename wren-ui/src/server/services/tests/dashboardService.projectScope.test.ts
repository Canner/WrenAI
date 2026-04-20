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
      expect(mockDashboardRepository.updateOne).not.toHaveBeenCalled();
      expect(result?.id).toBe(30);
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
        projectId: 11,
        knowledgeBaseId: 'kb-11',
        kbSnapshotId: 'snap-11',
        deployHash: 'deploy-11',
        createdBy: 'user-11',
        isDefault: true,
      });
      expect(result?.id).toBe(6);
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
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
        createdBy: null,
      });
      expect(mockDashboardRepository.createOne).toHaveBeenNthCalledWith(2, {
        isDefault: false,
        name: '销售日报',
        projectId: 15,
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
  });
});
