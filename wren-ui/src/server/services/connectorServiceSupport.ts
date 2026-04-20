import {
  Connector,
  IKnowledgeBaseRepository,
  IQueryOptions,
  IWorkspaceRepository,
} from '../repositories';
import { CompactTable, IConnectionMetadataService } from './metadataService';
import { SecretPayload } from './secretService';
import { getConnectorScopeRestrictionReason } from '@/utils/workspaceGovernance';
import {
  buildDatabaseConnectorConnectionInfo,
  getConnectionTypeForDatabaseProvider,
  requireDatabaseProvider,
} from '@server/utils/connectorDatabaseProvider';
import { encryptConnectionInfo } from '../dataSource';
import { IFederatedRuntimeProjectService } from './federatedRuntimeProjectService';
import type {
  ConnectorConnectionTestResult,
  TestConnectorConnectionInput,
} from './connectorServiceTypes';

export const requireConnectorString = (
  value: unknown,
  label: string,
): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label}不能为空`);
  }

  return value.trim();
};

export const createConnectorGovernanceError = (message: string) =>
  Object.assign(new Error(message), { statusCode: 403 });

export const assertWritableConnectorScope = ({
  workspaceKind,
  knowledgeBaseKind,
}: {
  workspaceKind?: string | null;
  knowledgeBaseKind?: string | null;
}) => {
  const restrictionReason = getConnectorScopeRestrictionReason({
    workspaceKind,
    knowledgeBaseKind,
  });

  if (restrictionReason) {
    throw createConnectorGovernanceError(restrictionReason);
  }
};

export const ensureWorkspaceExists = async ({
  workspaceId,
  workspaceRepository,
  queryOptions,
}: {
  workspaceId: string;
  workspaceRepository: IWorkspaceRepository;
  queryOptions?: IQueryOptions;
}) => {
  const workspace = await workspaceRepository.findOneBy(
    { id: workspaceId },
    queryOptions,
  );
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  return workspace;
};

export const ensureKnowledgeBaseExists = async ({
  workspaceId,
  knowledgeBaseId,
  knowledgeBaseRepository,
  queryOptions,
}: {
  workspaceId: string;
  knowledgeBaseId?: string | null;
  knowledgeBaseRepository: IKnowledgeBaseRepository;
  queryOptions?: IQueryOptions;
}) => {
  if (!knowledgeBaseId) {
    return null;
  }

  const knowledgeBase = await knowledgeBaseRepository.findOneBy(
    { id: knowledgeBaseId },
    queryOptions,
  );
  if (!knowledgeBase || knowledgeBase.workspaceId !== workspaceId) {
    throw new Error(
      `Knowledge base ${knowledgeBaseId} not found in workspace ${workspaceId}`,
    );
  }

  return knowledgeBase;
};

export const ensureWritableConnectorScope = async ({
  workspaceId,
  knowledgeBaseId,
  workspaceRepository,
  knowledgeBaseRepository,
  queryOptions,
}: {
  workspaceId: string;
  knowledgeBaseId?: string | null;
  workspaceRepository: IWorkspaceRepository;
  knowledgeBaseRepository: IKnowledgeBaseRepository;
  queryOptions?: IQueryOptions;
}) => {
  const workspace = await ensureWorkspaceExists({
    workspaceId,
    workspaceRepository,
    queryOptions,
  });
  const knowledgeBase = await ensureKnowledgeBaseExists({
    workspaceId,
    knowledgeBaseId,
    knowledgeBaseRepository,
    queryOptions,
  });

  assertWritableConnectorScope({
    workspaceKind: workspace.kind,
    knowledgeBaseKind: knowledgeBase?.kind,
  });

  return { workspace, knowledgeBase };
};

export const normalizeConnectorInput = ({
  type,
  databaseProvider,
}: {
  type: string;
  databaseProvider?: string | null;
}) => {
  const normalizedType = requireConnectorString(type, 'Connector type');
  if (normalizedType !== 'database') {
    return {
      type: normalizedType,
      databaseProvider: null,
    };
  }

  return {
    type: normalizedType,
    databaseProvider: requireDatabaseProvider(databaseProvider),
  };
};

export const resolveConnectorTestTarget = async ({
  input,
  getConnectorById,
  resolveConnectorSecret,
}: {
  input: TestConnectorConnectionInput;
  getConnectorById: (connectorId: string) => Promise<Connector | null>;
  resolveConnectorSecret: (
    connectorId: string,
  ) => Promise<SecretPayload | null>;
}) => {
  let persistedConnector: Connector | null = null;
  let persistedSecret: SecretPayload | null = null;

  if (input.connectorId) {
    persistedConnector = await getConnectorById(input.connectorId);
    if (!persistedConnector) {
      throw new Error(`Connector ${input.connectorId} not found`);
    }

    if (
      input.knowledgeBaseId !== undefined &&
      persistedConnector.knowledgeBaseId !== (input.knowledgeBaseId ?? null)
    ) {
      throw new Error(
        `Connector ${input.connectorId} does not belong to knowledge base ${input.knowledgeBaseId}`,
      );
    }

    persistedSecret = await resolveConnectorSecret(input.connectorId);
  }

  const type = input.type ?? persistedConnector?.type;
  if (!type) {
    throw new Error('Connector type is required for connection test');
  }

  const normalizedInput = normalizeConnectorInput({
    type,
    databaseProvider: Object.prototype.hasOwnProperty.call(
      input,
      'databaseProvider',
    )
      ? input.databaseProvider
      : persistedConnector?.databaseProvider,
  });

  const config = Object.prototype.hasOwnProperty.call(input, 'config')
    ? input.config ?? null
    : persistedConnector?.configJson ?? null;
  const secret = Object.prototype.hasOwnProperty.call(input, 'secret')
    ? input.secret ?? null
    : persistedSecret;

  return {
    persistedConnector,
    type: normalizedInput.type,
    databaseProvider: normalizedInput.databaseProvider,
    config,
    secret,
  };
};

export const testDatabaseConnector = async ({
  target,
  metadataService,
}: {
  target: {
    type: string;
    databaseProvider: string | null;
    config: Record<string, any> | null;
    secret: SecretPayload | null;
  };
  metadataService: IConnectionMetadataService;
}): Promise<ConnectorConnectionTestResult> => {
  const { connectionType, project } = buildDatabaseConnectorMetadataProject({
    target,
  });
  const tables = await metadataService.listTables(project as any);
  let version: string | null = null;
  try {
    version = await metadataService.getVersion(project as any);
  } catch (_error) {
    version = null;
  }

  const tableCount = tables.length;
  return {
    success: true,
    message:
      tableCount > 0
        ? `数据库连接测试成功，已发现 ${tableCount} 张表`
        : '数据库连接测试成功，但当前库中没有可见表',
    connectorType: target.type,
    connectionType,
    tableCount,
    sampleTables: tables.slice(0, 5).map((table) => table.name),
    version,
  };
};

export const buildDatabaseConnectorMetadataProject = ({
  target,
}: {
  target: {
    databaseProvider: string | null;
    config: Record<string, any> | null;
    secret: SecretPayload | null;
  };
}) => {
  const provider = requireDatabaseProvider(target.databaseProvider);
  const connectionType = getConnectionTypeForDatabaseProvider(provider);
  const connectionInfo = buildDatabaseConnectorConnectionInfo({
    provider,
    config: target.config,
    secret: target.secret,
  });
  const encryptedConnectionInfo = encryptConnectionInfo(
    connectionType,
    connectionInfo,
  );

  return {
    connectionType,
    project: {
      id: -1,
      type: connectionType,
      connectionInfo: encryptedConnectionInfo,
    },
  };
};

export const listDatabaseConnectorTables = async ({
  target,
  metadataService,
}: {
  target: {
    databaseProvider: string | null;
    config: Record<string, any> | null;
    secret: SecretPayload | null;
  };
  metadataService: IConnectionMetadataService;
}): Promise<CompactTable[]> => {
  const { project } = buildDatabaseConnectorMetadataProject({ target });
  return await metadataService.listTables(project as any);
};

export const syncKnowledgeBaseFederationIfNeeded = async ({
  knowledgeBaseIds,
  federatedRuntimeProjectService,
}: {
  knowledgeBaseIds: Array<string | null | undefined>;
  federatedRuntimeProjectService: IFederatedRuntimeProjectService;
}) => {
  const scopedKnowledgeBaseIds = [...new Set(knowledgeBaseIds.filter(Boolean))];
  for (const knowledgeBaseId of scopedKnowledgeBaseIds) {
    await federatedRuntimeProjectService.syncKnowledgeBaseFederation(
      knowledgeBaseId!,
    );
  }
};
