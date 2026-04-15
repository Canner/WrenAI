import { DeployStatusEnum } from '@server/repositories/deployLogRepository';
import { DataSourceName } from '@server/types';
import { WORKSPACE_KINDS } from '@/utils/workspaceGovernance';
import { KnowledgeBaseService } from '../knowledgeBaseService';

describe('KnowledgeBaseService', () => {
  let workspaceRepository: any;
  let knowledgeBaseRepository: any;
  let kbSnapshotRepository: any;
  let connectorRepository: any;
  let federatedRuntimeProjectService: any;
  let projectService: any;
  let mdlService: any;
  let deployService: any;
  let deployLogRepository: any;
  let service: KnowledgeBaseService;

  const workspace = {
    id: 'ws-1',
    kind: WORKSPACE_KINDS.REGULAR,
  };
  const createdKnowledgeBase = {
    id: 'kb-1',
    workspaceId: 'ws-1',
    slug: 'sales',
    name: 'Sales',
    kind: 'regular',
    description: null,
    createdBy: 'user-1',
    defaultKbSnapshotId: null,
  };

  beforeEach(() => {
    workspaceRepository = {
      findOneBy: jest.fn().mockResolvedValue(workspace),
    };
    knowledgeBaseRepository = {
      findAllBy: jest.fn(),
      findOneBy: jest.fn().mockImplementation(async (filter: any) => {
        if (filter.workspaceId === 'ws-1' && filter.slug === 'sales') {
          return null;
        }
        if (filter.id === 'kb-1' && filter.workspaceId === 'ws-1') {
          return createdKnowledgeBase;
        }
        return null;
      }),
      createOne: jest.fn().mockResolvedValue(createdKnowledgeBase),
      updateOne: jest.fn(),
    };
    kbSnapshotRepository = {
      findOneBy: jest.fn().mockResolvedValue(null),
      createOne: jest.fn().mockResolvedValue({
        id: 'snap-1',
        knowledgeBaseId: 'kb-1',
        snapshotKey: 'latest-executable-default',
        deployHash: 'deploy-101',
        status: 'active',
      }),
      updateOne: jest.fn(),
    };
    connectorRepository = {
      findOneBy: jest.fn(),
    };
    federatedRuntimeProjectService = {
      syncKnowledgeBaseFederation: jest.fn(),
    };
    projectService = {
      createProject: jest.fn().mockResolvedValue({ id: 101 }),
    };
    mdlService = {
      makeCurrentModelMDL: jest.fn().mockResolvedValue({
        manifest: { models: [], relationships: [], views: [] },
      }),
    };
    deployService = {
      deploy: jest.fn().mockResolvedValue({
        status: DeployStatusEnum.SUCCESS,
      }),
      getLastDeploymentByRuntimeIdentity: jest.fn().mockResolvedValue({
        id: 1,
        projectId: 101,
        hash: 'deploy-101',
        kbSnapshotId: null,
      }),
    };
    deployLogRepository = {
      updateOne: jest.fn(),
    };

    service = new KnowledgeBaseService({
      workspaceRepository,
      knowledgeBaseRepository,
      kbSnapshotRepository,
      connectorRepository,
      federatedRuntimeProjectService,
      projectService,
      mdlService,
      deployService,
      deployLogRepository,
    });
  });

  it('bootstraps an empty runtime when creating a knowledge base', async () => {
    knowledgeBaseRepository.findOneBy.mockImplementation(
      async (filter: any) => {
        if (filter.workspaceId === 'ws-1' && filter.slug === 'sales') {
          return null;
        }
        if (filter.id === 'kb-1' && filter.workspaceId === 'ws-1') {
          return {
            ...createdKnowledgeBase,
            defaultKbSnapshotId: 'snap-1',
          };
        }
        return null;
      },
    );
    knowledgeBaseRepository.updateOne.mockResolvedValue({
      ...createdKnowledgeBase,
      defaultKbSnapshotId: 'snap-1',
    });

    const result = await service.createKnowledgeBase({
      workspaceId: 'ws-1',
      name: 'Sales',
      createdBy: 'user-1',
    });

    expect(projectService.createProject).toHaveBeenCalledWith({
      displayName: '[internal] Sales bootstrap runtime',
      type: DataSourceName.DUCKDB,
      connectionInfo: {
        initSql: '',
        extensions: [],
        configurations: {},
      },
    });
    expect(mdlService.makeCurrentModelMDL).toHaveBeenCalledWith(101);
    expect(deployService.deploy).toHaveBeenCalledWith(
      { models: [], relationships: [], views: [] },
      {
        projectId: 101,
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: null,
        deployHash: null,
        actorUserId: 'user-1',
      },
      false,
    );
    expect(
      deployService.getLastDeploymentByRuntimeIdentity,
    ).toHaveBeenCalledWith({
      projectId: null,
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: null,
      deployHash: null,
    });
    expect(kbSnapshotRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: 'kb-1',
        snapshotKey: 'latest-executable-default',
        deployHash: 'deploy-101',
        status: 'active',
      }),
    );
    expect(knowledgeBaseRepository.updateOne).toHaveBeenCalledWith('kb-1', {
      defaultKbSnapshotId: 'snap-1',
    });
    expect(result).toMatchObject({
      id: 'kb-1',
      defaultKbSnapshotId: 'snap-1',
    });
  });

  it('still creates the knowledge base when bootstrap deploy fails', async () => {
    deployService.deploy.mockResolvedValue({
      status: DeployStatusEnum.FAILED,
      error: 'deploy failed',
    });

    const result = await service.createKnowledgeBase({
      workspaceId: 'ws-1',
      name: 'Sales',
      createdBy: 'user-1',
    });

    expect(projectService.createProject).toHaveBeenCalled();
    expect(
      deployService.getLastDeploymentByRuntimeIdentity,
    ).not.toHaveBeenCalled();
    expect(kbSnapshotRepository.createOne).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: 'kb-1',
      defaultKbSnapshotId: null,
    });
  });
});
