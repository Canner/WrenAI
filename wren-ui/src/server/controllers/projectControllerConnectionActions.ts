import { DataSourceName } from '../types';
import { Project } from '../repositories';
import { encryptConnectionInfo } from '../dataSource';
import { TelemetryEvent } from '../telemetry/telemetry';
import { getLogger } from '@server/utils';
import {
  buildConnectionSettingsFromConnector,
  canBridgeConnectionTypeToConnector,
} from '@server/utils/connectionConnectorBridge';
import { MANAGED_FEDERATED_RUNTIME_READONLY_MESSAGE } from './projectControllerRuntimeSupport';
import {
  ProjectControllerMutationDeps,
  ResetCurrentProjectArgs,
  SaveConnectionArgs,
  UpdateConnectionArgs,
  UpdateCurrentProjectArgs,
} from './projectControllerMutationTypes';

const logger = getLogger('ProjectController');

export const updateCurrentProjectAction = async ({
  language,
  ctx,
  deps,
}: UpdateCurrentProjectArgs & {
  deps: Pick<
    ProjectControllerMutationDeps,
    | 'resolveActiveRuntimeKnowledgeBase'
    | 'resolveActiveRuntimeProject'
    | 'assertKnowledgeBaseWriteAccess'
    | 'getCurrentRuntimeScopeId'
    | 'recordKnowledgeBaseWriteAudit'
  >;
}) => {
  const [knowledgeBase, project] = await Promise.all([
    deps.resolveActiveRuntimeKnowledgeBase(ctx),
    deps.resolveActiveRuntimeProject(ctx),
  ]);
  if (!project && !knowledgeBase) {
    throw new Error('Active runtime project is required for this operation');
  }

  await deps.assertKnowledgeBaseWriteAccess(ctx);
  await Promise.all([
    project
      ? ctx.projectRepository.updateOne(project.id, { language })
      : Promise.resolve(null),
    knowledgeBase
      ? ctx.knowledgeBaseRepository.updateOne(knowledgeBase.id, { language })
      : Promise.resolve(null),
  ]);

  if (
    project &&
    (knowledgeBase?.sampleDataset ?? project.sampleDataset) === null
  ) {
    await ctx.projectService.generateProjectRecommendationQuestions(
      project.id,
      deps.getCurrentRuntimeScopeId(ctx),
    );
  }
  await deps.recordKnowledgeBaseWriteAudit(ctx, {
    resourceType: knowledgeBase ? 'knowledge_base' : 'project',
    resourceId: knowledgeBase?.id || project?.id || null,
    afterJson: { language },
    payloadJson: { operation: 'update_current_project' },
  });
  return true;
};

export const resetCurrentProjectAction = async ({
  ctx,
  deps,
}: ResetCurrentProjectArgs & {
  deps: Pick<
    ProjectControllerMutationDeps,
    | 'resolveActiveRuntimeProject'
    | 'resolveActiveRuntimeKnowledgeBase'
    | 'assertKnowledgeBaseWriteAccess'
    | 'getCurrentPersistedRuntimeIdentity'
    | 'toAskRuntimeIdentity'
    | 'recordKnowledgeBaseWriteAudit'
  >;
}) => {
  const [project, knowledgeBase] = await Promise.all([
    deps.resolveActiveRuntimeProject(ctx),
    deps.resolveActiveRuntimeKnowledgeBase(ctx),
  ]);
  if (!project) {
    return true;
  }

  await deps.assertKnowledgeBaseWriteAccess(ctx);
  const eventName = TelemetryEvent.SETTING_RESET_PROJECT;
  try {
    const id = project.id;
    await ctx.schemaChangeRepository.deleteAllBy({ projectId: id });
    await ctx.deployService.deleteAllByProjectId(id);
    await ctx.askingService.deleteAllByProjectId(id);
    await ctx.modelService.deleteAllViewsByProjectId(id);
    await ctx.modelService.deleteAllModelsByProjectId(id);
    const linkedKnowledgeBaseId =
      knowledgeBase?.runtimeProjectId === id ? knowledgeBase.id : null;
    if (linkedKnowledgeBaseId) {
      await ctx.knowledgeBaseRepository.updateOne(linkedKnowledgeBaseId, {
        runtimeProjectId: null,
      });
    }
    await ctx.projectService.deleteProject(id);
    try {
      await ctx.wrenAIAdaptor.delete({
        runtimeIdentity: deps.toAskRuntimeIdentity(
          deps.getCurrentPersistedRuntimeIdentity(ctx),
        ),
      });
    } catch (deleteError: any) {
      logger.warn(
        `Failed to delete semantics for project ${id} during reset: ${deleteError?.message || deleteError}`,
      );
    }

    ctx.telemetry.sendEvent(eventName, {
      projectId: id,
      connectionType: project.type,
    });
    await deps.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: 'project',
      resourceId: id,
      payloadJson: {
        operation: 'reset_current_project',
        connectionType: project.type,
      },
    });
  } catch (err: any) {
    ctx.telemetry.sendEvent(
      eventName,
      { connectionType: project.type, error: err.message },
      err.extensions?.service,
      false,
    );
    throw err;
  }

  return true;
};

export const saveConnectionAction = async ({
  args,
  ctx,
  deps,
}: SaveConnectionArgs & {
  deps: Pick<
    ProjectControllerMutationDeps,
    | 'assertKnowledgeBaseWriteAccess'
    | 'resolveActiveRuntimeKnowledgeBase'
    | 'upsertKnowledgeBaseConnectorForConnection'
    | 'createProjectFromConnection'
    | 'recordKnowledgeBaseWriteAudit'
  >;
}) => {
  await deps.assertKnowledgeBaseWriteAccess(ctx);
  const knowledgeBase = await deps.resolveActiveRuntimeKnowledgeBase(ctx);
  const supportsConnectorBridge =
    Boolean(knowledgeBase) &&
    canBridgeConnectionTypeToConnector(args.data.type as DataSourceName);
  let connectorResource = null;

  if (knowledgeBase && supportsConnectorBridge) {
    connectorResource = await deps.upsertKnowledgeBaseConnectorForConnection({
      ctx,
      knowledgeBase,
      connection: args.data,
      mode: 'save',
    });
  }

  const project = await deps.createProjectFromConnection(args.data, ctx);
  if (knowledgeBase && connectorResource && !knowledgeBase.primaryConnectorId) {
    await ctx.knowledgeBaseRepository.updateOne(knowledgeBase.id, {
      primaryConnectorId: connectorResource.id,
    });
  }
  await deps.recordKnowledgeBaseWriteAudit(ctx, {
    resourceType: knowledgeBase ? 'knowledge_base' : 'project',
    resourceId: knowledgeBase?.id || project.id,
    afterJson: {
      type: project.type,
      displayName: project.displayName,
      ...(connectorResource
        ? {
            primaryConnectorId: connectorResource.id,
            databaseProvider: connectorResource.databaseProvider,
          }
        : {}),
    },
    payloadJson: { operation: 'save_connection' },
  });

  return connectorResource
    ? buildConnectionSettingsFromConnector({
        displayName: connectorResource.displayName,
        databaseProvider: connectorResource.databaseProvider,
        config: connectorResource.configJson,
      }) ?? {
        type: project.type,
        properties: {
          displayName: project.displayName,
          ...ctx.projectService.getGeneralConnectionInfo(project),
        },
      }
    : {
        type: project.type,
        properties: {
          displayName: project.displayName,
          ...ctx.projectService.getGeneralConnectionInfo(project),
        },
      };
};

export const updateConnectionAction = async ({
  args,
  ctx,
  deps,
}: UpdateConnectionArgs & {
  deps: Pick<
    ProjectControllerMutationDeps,
    | 'resolveActiveRuntimeKnowledgeBase'
    | 'getActiveRuntimeProjectOrThrow'
    | 'assertKnowledgeBaseWriteAccess'
    | 'resolveKnowledgeBaseConnectionConnector'
    | 'isManagedFederatedRuntimeProject'
    | 'upsertKnowledgeBaseConnectorForConnection'
    | 'recordKnowledgeBaseWriteAudit'
    | 'buildDuckDbEnvironment'
  >;
}) => {
  const knowledgeBase = await deps.resolveActiveRuntimeKnowledgeBase(ctx);
  const { properties } = args.data;
  const { displayName, ...connectionInfo } = properties;
  const project = await deps.getActiveRuntimeProjectOrThrow(ctx);
  await deps.assertKnowledgeBaseWriteAccess(ctx);
  const supportsConnectorBridge =
    Boolean(knowledgeBase) &&
    canBridgeConnectionTypeToConnector(args.data.type as DataSourceName);
  const existingConnector = knowledgeBase
    ? await deps.resolveKnowledgeBaseConnectionConnector(ctx, knowledgeBase)
    : null;
  let connectorResource = null;
  const managedFederatedRuntime = deps.isManagedFederatedRuntimeProject(
    project,
    knowledgeBase,
  );

  if (managedFederatedRuntime && !existingConnector) {
    throw new Error(MANAGED_FEDERATED_RUNTIME_READONLY_MESSAGE);
  }

  if (
    knowledgeBase &&
    supportsConnectorBridge &&
    (existingConnector || !managedFederatedRuntime)
  ) {
    connectorResource = await deps.upsertKnowledgeBaseConnectorForConnection({
      ctx,
      knowledgeBase,
      connection: args.data,
      mode: 'update',
    });
  }

  if (!connectorResource && managedFederatedRuntime) {
    throw new Error(MANAGED_FEDERATED_RUNTIME_READONLY_MESSAGE);
  }
  if (connectorResource && managedFederatedRuntime) {
    await deps.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: knowledgeBase ? 'knowledge_base' : 'project',
      resourceId: knowledgeBase?.id || project.id,
      afterJson: {
        type: args.data.type,
        displayName: connectorResource.displayName,
        primaryConnectorId:
          knowledgeBase?.primaryConnectorId || connectorResource.id,
        databaseProvider: connectorResource.databaseProvider,
      },
      payloadJson: {
        operation: 'update_connection',
        runtimeMode: 'connector_managed',
      },
    });

    return (
      buildConnectionSettingsFromConnector({
        displayName: connectorResource.displayName,
        databaseProvider: connectorResource.databaseProvider,
        config: connectorResource.configJson,
      }) || {
        type: args.data.type,
        properties,
      }
    );
  }

  const encryptedConnectionInfo = encryptConnectionInfo(
    project.type,
    connectionInfo as any,
  );
  if (project.type === DataSourceName.DUCKDB) {
    const duckdbConnectionInfo = encryptedConnectionInfo as any;
    await deps.buildDuckDbEnvironment(ctx, {
      initSql: duckdbConnectionInfo.initSql,
      extensions: duckdbConnectionInfo.extensions,
      configurations: duckdbConnectionInfo.configurations,
    });
  } else {
    const updatedProject = {
      ...project,
      displayName,
      connectionInfo: { ...project.connectionInfo, ...encryptedConnectionInfo },
    } as Project;
    await ctx.projectService.getProjectConnectionTables(updatedProject);
  }

  const updatedProject = await ctx.projectRepository.updateOne(project.id, {
    displayName,
    connectionInfo: { ...project.connectionInfo, ...encryptedConnectionInfo },
  });
  if (knowledgeBase && connectorResource && !knowledgeBase.primaryConnectorId) {
    await ctx.knowledgeBaseRepository.updateOne(knowledgeBase.id, {
      primaryConnectorId: connectorResource.id,
    });
  }
  await deps.recordKnowledgeBaseWriteAudit(ctx, {
    resourceType: knowledgeBase ? 'knowledge_base' : 'project',
    resourceId: knowledgeBase?.id || updatedProject.id,
    afterJson: {
      type: updatedProject.type,
      displayName: updatedProject.displayName,
      ...(connectorResource
        ? {
            primaryConnectorId: connectorResource.id,
            databaseProvider: connectorResource.databaseProvider,
          }
        : {}),
    },
    payloadJson: { operation: 'update_connection' },
  });

  return connectorResource
    ? buildConnectionSettingsFromConnector({
        displayName: connectorResource.displayName,
        databaseProvider: connectorResource.databaseProvider,
        config: connectorResource.configJson,
      }) ?? {
        type: updatedProject.type,
        properties: {
          displayName: updatedProject.displayName,
          ...ctx.projectService.getGeneralConnectionInfo(updatedProject),
        },
      }
    : {
        type: updatedProject.type,
        properties: {
          displayName: updatedProject.displayName,
          ...ctx.projectService.getGeneralConnectionInfo(updatedProject),
        },
      };
};
