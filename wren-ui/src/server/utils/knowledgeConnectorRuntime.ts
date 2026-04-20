import { encryptConnectionInfo } from '@server/dataSource';
import { DataSourceName, IContext } from '@server/types';
import {
  KnowledgeBase,
  Project,
  WREN_AI_CONNECTION_INFO,
} from '@server/repositories';
import {
  buildDatabaseConnectorConnectionInfo,
  getConnectionTypeForDatabaseProvider,
} from '@server/utils/connectorDatabaseProvider';
import { syncLatestExecutableKnowledgeBaseSnapshot } from './knowledgeBaseRuntime';

const findKnowledgeBaseRuntimeConnector = async (
  ctx: IContext,
  knowledgeBase: KnowledgeBase,
) => {
  if (knowledgeBase.primaryConnectorId) {
    const primaryConnector = await ctx.connectorRepository.findOneBy({
      id: knowledgeBase.primaryConnectorId,
    });
    if (
      primaryConnector &&
      primaryConnector.workspaceId === knowledgeBase.workspaceId &&
      primaryConnector.knowledgeBaseId === knowledgeBase.id
    ) {
      return primaryConnector;
    }
  }

  const scopedConnectors = await ctx.connectorRepository.findAllBy({
    workspaceId: knowledgeBase.workspaceId,
    knowledgeBaseId: knowledgeBase.id,
  });
  return scopedConnectors[0] || null;
};

const resolveProjectVersion = async (ctx: IContext, project: Project) => {
  await ctx.projectService.getProjectConnectionTables(project);
  return await ctx.projectService.getProjectConnectionVersion(project);
};

const createProjectFromConnector = async ({
  ctx,
  connectionInfo,
  connectionType,
  displayName,
  knowledgeBase,
}: {
  ctx: IContext;
  connectionInfo: WREN_AI_CONNECTION_INFO;
  connectionType: DataSourceName;
  displayName: string;
  knowledgeBase: KnowledgeBase;
}) => {
  const createdProject = await ctx.projectService.createProject({
    displayName,
    type: connectionType,
    connectionInfo,
  });

  try {
    await ctx.dashboardService.initDashboard(createdProject.id, {
      knowledgeBaseId: knowledgeBase.id,
      kbSnapshotId: null,
      deployHash: null,
      createdBy: ctx.runtimeScope?.userId || null,
    });
    const version = await resolveProjectVersion(ctx, createdProject);
    return await ctx.projectService.updateProject(createdProject.id, {
      version,
    });
  } catch (error) {
    await ctx.projectRepository.deleteOne(createdProject.id);
    throw error;
  }
};

const updateProjectFromConnector = async ({
  ctx,
  connectionInfo,
  connectionType,
  displayName,
  project,
}: {
  ctx: IContext;
  connectionInfo: WREN_AI_CONNECTION_INFO;
  connectionType: DataSourceName;
  displayName: string;
  project: Project;
}) => {
  const encryptedConnectionInfo = encryptConnectionInfo(
    connectionType,
    connectionInfo as any,
  );
  const candidateProject = {
    ...project,
    type: connectionType,
    displayName,
    connectionInfo: encryptedConnectionInfo,
  } as Project;
  const version = await resolveProjectVersion(ctx, candidateProject);

  return await ctx.projectRepository.updateOne(project.id, {
    type: connectionType,
    displayName,
    connectionInfo: encryptedConnectionInfo,
    version,
  });
};

export const activateConnectorForKnowledgeBaseRuntime = async ({
  connectorId,
  ctx,
  knowledgeBaseId,
}: {
  connectorId: string;
  ctx: IContext;
  knowledgeBaseId: string;
}) => {
  const knowledgeBase = await ctx.knowledgeBaseRepository.findOneBy({
    id: knowledgeBaseId,
  });
  if (!knowledgeBase) {
    throw new Error(`Knowledge base ${knowledgeBaseId} not found`);
  }

  const resolvedConnector =
    await ctx.connectorService.getResolvedConnector(connectorId);
  if (!resolvedConnector) {
    throw new Error(`Connector ${connectorId} not found`);
  }

  if (resolvedConnector.workspaceId !== knowledgeBase.workspaceId) {
    throw new Error(
      `Connector ${connectorId} does not belong to workspace ${knowledgeBase.workspaceId}`,
    );
  }

  if (resolvedConnector.type !== 'database') {
    throw new Error(`Connector ${connectorId} is not a database connector`);
  }

  const provider = resolvedConnector.databaseProvider?.trim();
  if (!provider) {
    throw new Error(`Connector ${connectorId} is missing database provider`);
  }

  const connectionType = getConnectionTypeForDatabaseProvider(provider as any);
  const connectionInfo = buildDatabaseConnectorConnectionInfo({
    provider: provider as any,
    config: resolvedConnector.configJson,
    secret: resolvedConnector.secret,
  });

  const runtimeConnector = await findKnowledgeBaseRuntimeConnector(
    ctx,
    knowledgeBase,
  );
  const persistedRuntimeConnector = runtimeConnector
    ? await ctx.connectorService.updateConnector(runtimeConnector.id, {
        knowledgeBaseId: knowledgeBase.id,
        type: 'database',
        databaseProvider: provider,
        displayName: resolvedConnector.displayName,
        config: resolvedConnector.configJson,
        secret: resolvedConnector.secret,
      })
    : await ctx.connectorService.createConnector({
        workspaceId: knowledgeBase.workspaceId,
        knowledgeBaseId: knowledgeBase.id,
        type: 'database',
        databaseProvider: provider,
        displayName: resolvedConnector.displayName,
        config: resolvedConnector.configJson,
        secret: resolvedConnector.secret,
        createdBy: ctx.runtimeScope?.userId || null,
      });

  const existingRuntimeProject = knowledgeBase.runtimeProjectId
    ? await ctx.projectRepository.findOneBy({
        id: knowledgeBase.runtimeProjectId,
      })
    : null;
  const shouldCreateRuntimeProject =
    !existingRuntimeProject ||
    existingRuntimeProject.type === DataSourceName.TRINO;
  const runtimeProject = shouldCreateRuntimeProject
    ? await createProjectFromConnector({
        ctx,
        knowledgeBase,
        connectionInfo,
        connectionType,
        displayName: resolvedConnector.displayName,
      })
    : await updateProjectFromConnector({
        ctx,
        project: existingRuntimeProject,
        connectionInfo,
        connectionType,
        displayName: resolvedConnector.displayName,
      });

  const updatedKnowledgeBase =
    knowledgeBase.runtimeProjectId === runtimeProject.id &&
    knowledgeBase.primaryConnectorId === persistedRuntimeConnector.id
      ? knowledgeBase
      : await ctx.knowledgeBaseRepository.updateOne(knowledgeBase.id, {
          runtimeProjectId: runtimeProject.id,
          primaryConnectorId: persistedRuntimeConnector.id,
        });

  const { manifest } = await ctx.mdlService.makeCurrentModelMDL(
    runtimeProject.id,
  );
  const deployResult = await ctx.deployService.deploy(
    manifest,
    {
      projectId: runtimeProject.id,
      workspaceId: updatedKnowledgeBase.workspaceId,
      knowledgeBaseId: updatedKnowledgeBase.id,
      kbSnapshotId: null,
      deployHash: null,
      actorUserId: ctx.runtimeScope?.userId || null,
    },
    false,
  );

  if (deployResult.status !== 'SUCCESS') {
    throw new Error(
      deployResult.error || '激活知识库连接运行时失败，请稍后重试。',
    );
  }

  const latestSnapshot = await syncLatestExecutableKnowledgeBaseSnapshot({
    knowledgeBase: updatedKnowledgeBase,
    knowledgeBaseRepository: ctx.knowledgeBaseRepository,
    kbSnapshotRepository: ctx.kbSnapshotRepository,
    deployLogRepository: ctx.deployRepository,
    deployService: ctx.deployService,
    modelRepository: ctx.modelRepository,
    relationRepository: ctx.relationRepository,
    viewRepository: ctx.viewRepository,
  });

  if (!latestSnapshot?.id || !latestSnapshot.deployHash) {
    throw new Error('知识库运行时激活成功，但默认快照同步失败。');
  }

  return {
    connectorId: persistedRuntimeConnector.id,
    projectId: runtimeProject.id,
    selector: {
      workspaceId: updatedKnowledgeBase.workspaceId,
      knowledgeBaseId: updatedKnowledgeBase.id,
      kbSnapshotId: latestSnapshot.id,
      deployHash: latestSnapshot.deployHash,
    },
  };
};
