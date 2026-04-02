import { ProjectResolver } from '../projectResolver';
import { RelationType } from '../../types';

describe('ProjectResolver', () => {
  describe('getProjectRecommendationQuestions', () => {
    it('prefers runtime scope project id', async () => {
      const resolver = new ProjectResolver();
      const getCurrentProject = jest.fn();
      const getProjectRecommendationQuestions = jest
        .fn()
        .mockResolvedValue({ status: 'NOT_STARTED', questions: [], error: null });

      const result = await resolver.getProjectRecommendationQuestions(
        null,
        null,
        {
          runtimeScope: {
            project: { id: 42 },
          },
          projectService: {
            getCurrentProject,
            getProjectRecommendationQuestions,
          },
        } as any,
      );

      expect(getCurrentProject).not.toHaveBeenCalled();
      expect(getProjectRecommendationQuestions).toHaveBeenCalledWith(42);
      expect(result).toEqual({
        status: 'NOT_STARTED',
        questions: [],
        error: null,
      });
    });

    it('requires an active runtime scope project', async () => {
      const resolver = new ProjectResolver();
      const getProjectRecommendationQuestions = jest
        .fn()
        .mockResolvedValue({ status: 'FINISHED', questions: [], error: null });

      await expect(
        resolver.getProjectRecommendationQuestions(null, null, {
          runtimeScope: null,
          projectService: {
            getCurrentProject: jest.fn(),
            getProjectRecommendationQuestions,
          },
        } as any),
      ).rejects.toThrow('Active runtime project is required for this operation');

      expect(getProjectRecommendationQuestions).not.toHaveBeenCalled();
    });
  });

  describe('scoped read requirements', () => {
    it('rejects getSettings when runtime scope is missing', async () => {
      const resolver = new ProjectResolver();
      const ctx = {
        runtimeScope: null,
        config: {},
        projectService: {
          getGeneralConnectionInfo: jest.fn(),
        },
      } as any;

      await expect(resolver.getSettings(null, null, ctx)).rejects.toThrow(
        'Active runtime project is required for this operation',
      );

      expect(ctx.projectService.getGeneralConnectionInfo).not.toHaveBeenCalled();
    });

    it('keeps onboarding status bootstrap-compatible when runtime scope is missing', async () => {
      const resolver = new ProjectResolver();
      const getCurrentProject = jest.fn().mockRejectedValue(new Error('missing'));
      const ctx = {
        runtimeScope: null,
        projectService: {
          getCurrentProject,
        },
      } as any;

      await expect(resolver.getOnboardingStatus(null, null, ctx)).resolves.toEqual({
        status: 'NOT_STARTED',
      });
      expect(getCurrentProject).not.toHaveBeenCalled();
    });
  });

  describe('saveRelations', () => {
    it('rejects relation saves when referenced models are outside the active project', async () => {
      const resolver = new ProjectResolver();
      const ctx = {
        runtimeScope: {
          project: { id: 42 },
        },
        telemetry: { sendEvent: jest.fn() },
        modelRepository: {
          findAllByIds: jest.fn().mockResolvedValue([
            { id: 1, projectId: 42 },
            { id: 2, projectId: 99 },
          ]),
        },
        modelService: {
          saveRelations: jest.fn(),
        },
      } as any;

      await expect(
        resolver.saveRelations(
          null,
          {
            data: {
              relations: [
                {
                  fromModelId: 1,
                  fromColumnId: 11,
                  toModelId: 2,
                  toColumnId: 22,
                  type: RelationType.ONE_TO_MANY,
                },
              ],
            },
          },
          ctx,
        ),
      ).rejects.toThrow('Relation model not found in active project');

      expect(ctx.modelService.saveRelations).not.toHaveBeenCalled();
    });
  });

  describe('mutation scope requirements', () => {
    it('rejects updateCurrentProject when runtime scope is missing', async () => {
      const resolver = new ProjectResolver();
      const ctx = {
        runtimeScope: null,
        projectRepository: {
          updateOne: jest.fn(),
        },
        projectService: {
          generateProjectRecommendationQuestions: jest.fn(),
        },
      } as any;

      await expect(
        resolver.updateCurrentProject(
          null,
          { data: { language: 'EN' } },
          ctx,
        ),
      ).rejects.toThrow('Active runtime project is required for this operation');

      expect(ctx.projectRepository.updateOne).not.toHaveBeenCalled();
      expect(
        ctx.projectService.generateProjectRecommendationQuestions,
      ).not.toHaveBeenCalled();
    });

    it('keeps resetCurrentProject scoped and does not fall back to current project', async () => {
      const resolver = new ProjectResolver();
      const getCurrentProject = jest.fn();
      const ctx = {
        runtimeScope: null,
        projectService: {
          getCurrentProject,
        },
      } as any;

      await expect(
        resolver.resetCurrentProject(null, null, ctx),
      ).resolves.toBe(true);

      expect(getCurrentProject).not.toHaveBeenCalled();
    });
  });

  describe('startSampleDataset', () => {
    it('reuses the newly created project instead of falling back to current project', async () => {
      const resolver = new ProjectResolver() as any;
      const project = { id: 42, sampleDataset: null };
      const models = [
        { id: 10, projectId: 42, sourceTableName: 'employees' },
        { id: 11, projectId: 42, sourceTableName: 'departments' },
      ];
      const columns = [
        { id: 100, modelId: 10, referenceName: 'emp_no' },
        { id: 101, modelId: 11, referenceName: 'dept_no' },
      ];

      resolver.createProjectFromDataSource = jest.fn().mockResolvedValue(project);
      resolver.overwriteModelsAndColumns = jest
        .fn()
        .mockResolvedValue({ models, columns });
      resolver.buildRelationInput = jest.fn().mockReturnValue([]);
      resolver.deploy = jest.fn().mockResolvedValue(undefined);

      const ctx = {
        runtimeScope: {
          project: { id: 42 },
        },
        telemetry: { sendEvent: jest.fn() },
        projectService: {
          getCurrentProject: jest.fn(() => {
            throw new Error('should not call projectService.getCurrentProject');
          }),
          getProjectDataSourceTables: jest
            .fn()
            .mockResolvedValue([
              { name: 'employees' },
              { name: 'departments' },
            ]),
        },
        modelService: {
          updatePrimaryKeys: jest.fn().mockResolvedValue(undefined),
          batchUpdateModelProperties: jest.fn().mockResolvedValue(undefined),
          batchUpdateColumnProperties: jest.fn().mockResolvedValue(undefined),
          saveRelations: jest.fn().mockResolvedValue([]),
        },
        modelRepository: {
          findAll: jest.fn(() => {
            throw new Error('should not call modelRepository.findAll');
          }),
        },
        modelColumnRepository: {
          findAll: jest.fn(() => {
            throw new Error('should not call modelColumnRepository.findAll');
          }),
        },
        projectRepository: {
          updateOne: jest.fn().mockResolvedValue(undefined),
        },
      } as any;

      await resolver.startSampleDataset(
        null,
        { data: { name: 'HR' } },
        ctx,
      );

      expect(resolver.createProjectFromDataSource).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'DUCKDB',
        }),
        ctx,
      );
      expect(ctx.projectService.getCurrentProject).not.toHaveBeenCalled();
      expect(ctx.projectService.getProjectDataSourceTables).toHaveBeenCalledWith(
        project,
      );

      expect(resolver.buildRelationInput).toHaveBeenCalledWith(
        expect.any(Array),
        models,
        columns,
      );
      expect(resolver.deploy).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({
          id: 42,
          sampleDataset: 'HR',
        }),
      );
      expect(ctx.modelService.saveRelations).toHaveBeenCalledWith([]);
      expect(ctx.modelRepository.findAll).not.toHaveBeenCalled();
      expect(ctx.modelColumnRepository.findAll).not.toHaveBeenCalled();
    });
  });
});
