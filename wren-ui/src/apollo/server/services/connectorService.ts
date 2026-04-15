import crypto from 'crypto';
import {
  Connector,
  IConnectorRepository,
  IKnowledgeBaseRepository,
  IQueryOptions,
  IWorkspaceRepository,
} from '../repositories';
import { ISecretService, SecretPayload } from './secretService';
import { IDataSourceMetadataService } from './metadataService';
import { DataSourceName } from '../types';
import { encryptConnectionInfo } from '../dataSource';
import { getConnectorScopeRestrictionReason } from '@/utils/workspaceGovernance';
import {
  buildDatabaseConnectorConnectionInfo,
  getDataSourceNameForDatabaseProvider,
  requireDatabaseProvider,
} from '@server/utils/connectorDatabaseProvider';
import { IFederatedRuntimeProjectService } from './federatedRuntimeProjectService';

export interface CreateConnectorInput {
  workspaceId: string;
  knowledgeBaseId?: string | null;
  type: string;
  databaseProvider?: string | null;
  displayName: string;
  config?: Record<string, any> | null;
  secret?: SecretPayload | null;
  createdBy?: string | null;
}

export interface UpdateConnectorInput {
  knowledgeBaseId?: string | null;
  type?: string;
  databaseProvider?: string | null;
  displayName?: string;
  config?: Record<string, any> | null;
  secret?: SecretPayload | null;
}

export interface ResolvedConnector extends Connector {
  secret: SecretPayload | null;
}

export interface TestConnectorConnectionInput {
  workspaceId: string;
  knowledgeBaseId?: string | null;
  connectorId?: string;
  type?: string;
  databaseProvider?: string | null;
  config?: Record<string, any> | null;
  secret?: SecretPayload | null;
}

export interface ConnectorConnectionTestResult {
  success: true;
  message: string;
  connectorType: string;
  dataSource?: DataSourceName;
  tableCount?: number;
  sampleTables?: string[];
  version?: string | null;
}

export interface IConnectorService {
  createConnector(input: CreateConnectorInput): Promise<Connector>;
  updateConnector(
    connectorId: string,
    input: UpdateConnectorInput,
  ): Promise<Connector>;
  getConnectorById(connectorId: string): Promise<Connector | null>;
  listConnectorsByKnowledgeBase(
    workspaceId: string,
    knowledgeBaseId: string,
  ): Promise<Connector[]>;
  deleteConnector(connectorId: string): Promise<void>;
  resolveConnectorSecret(connectorId: string): Promise<SecretPayload | null>;
  getResolvedConnector(connectorId: string): Promise<ResolvedConnector | null>;
  testConnectorConnection(
    input: TestConnectorConnectionInput,
  ): Promise<ConnectorConnectionTestResult>;
}

export class ConnectorService implements IConnectorService {
  private connectorRepository: IConnectorRepository;
  private workspaceRepository: IWorkspaceRepository;
  private knowledgeBaseRepository: IKnowledgeBaseRepository;
  private secretService: ISecretService;
  private metadataService: IDataSourceMetadataService;
  private federatedRuntimeProjectService: IFederatedRuntimeProjectService;

  constructor({
    connectorRepository,
    workspaceRepository,
    knowledgeBaseRepository,
    secretService,
    metadataService,
    federatedRuntimeProjectService,
  }: {
    connectorRepository: IConnectorRepository;
    workspaceRepository: IWorkspaceRepository;
    knowledgeBaseRepository: IKnowledgeBaseRepository;
    secretService: ISecretService;
    metadataService: IDataSourceMetadataService;
    federatedRuntimeProjectService: IFederatedRuntimeProjectService;
  }) {
    this.connectorRepository = connectorRepository;
    this.workspaceRepository = workspaceRepository;
    this.knowledgeBaseRepository = knowledgeBaseRepository;
    this.secretService = secretService;
    this.metadataService = metadataService;
    this.federatedRuntimeProjectService = federatedRuntimeProjectService;
  }

  public async createConnector(
    input: CreateConnectorInput,
  ): Promise<Connector> {
    const tx = await this.connectorRepository.transaction();

    try {
      await this.ensureWritableConnectorScope(
        input.workspaceId,
        input.knowledgeBaseId,
        { tx },
      );
      const normalizedInput = this.normalizeConnectorInput({
        type: input.type,
        databaseProvider: input.databaseProvider,
      });

      const connectorId = crypto.randomUUID();
      let secretRecordId: string | null = null;

      if (input.secret) {
        const secretRecord = await this.secretService.createSecretRecord(
          {
            workspaceId: input.workspaceId,
            scopeType: 'connector',
            scopeId: connectorId,
            payload: input.secret,
            createdBy: input.createdBy,
          },
          { tx },
        );
        secretRecordId = secretRecord.id;
      }

      const connector = await this.connectorRepository.createOne(
        {
          id: connectorId,
          workspaceId: input.workspaceId,
          knowledgeBaseId: input.knowledgeBaseId ?? null,
          type: normalizedInput.type,
          databaseProvider: normalizedInput.databaseProvider,
          displayName: input.displayName,
          configJson: input.config ?? null,
          secretRecordId,
          createdBy: input.createdBy,
        },
        { tx },
      );

      await this.connectorRepository.commit(tx);
      await this.syncKnowledgeBaseFederationIfNeeded([
        connector.knowledgeBaseId,
      ]);
      return connector;
    } catch (error) {
      await this.connectorRepository.rollback(tx);
      throw error;
    }
  }

  public async updateConnector(
    connectorId: string,
    input: UpdateConnectorInput,
  ): Promise<Connector> {
    const tx = await this.connectorRepository.transaction();

    try {
      const connector = await this.connectorRepository.findOneBy(
        { id: connectorId },
        { tx },
      );
      if (!connector) {
        throw new Error(`Connector ${connectorId} not found`);
      }

      await this.ensureWritableConnectorScope(
        connector.workspaceId,
        Object.prototype.hasOwnProperty.call(input, 'knowledgeBaseId')
          ? input.knowledgeBaseId
          : connector.knowledgeBaseId,
        { tx },
      );

      const patch: Partial<Connector> = {};
      const previousKnowledgeBaseId = connector.knowledgeBaseId ?? null;
      const nextKnowledgeBaseId = Object.prototype.hasOwnProperty.call(
        input,
        'knowledgeBaseId',
      )
        ? input.knowledgeBaseId ?? null
        : previousKnowledgeBaseId;
      const normalizedInput = this.normalizeConnectorInput({
        type: input.type ?? connector.type,
        databaseProvider: Object.prototype.hasOwnProperty.call(
          input,
          'databaseProvider',
        )
          ? input.databaseProvider
          : connector.databaseProvider,
      });

      if (Object.prototype.hasOwnProperty.call(input, 'knowledgeBaseId')) {
        patch.knowledgeBaseId = nextKnowledgeBaseId;
      }
      if (input.type !== undefined) {
        patch.type = normalizedInput.type;
      }
      if (Object.prototype.hasOwnProperty.call(input, 'databaseProvider')) {
        patch.databaseProvider = normalizedInput.databaseProvider;
      } else if (
        input.type !== undefined &&
        normalizedInput.databaseProvider !== connector.databaseProvider
      ) {
        patch.databaseProvider = normalizedInput.databaseProvider;
      }
      if (input.displayName !== undefined) {
        patch.displayName = input.displayName;
      }
      if (Object.prototype.hasOwnProperty.call(input, 'config')) {
        patch.configJson = input.config ?? null;
      }

      if (Object.prototype.hasOwnProperty.call(input, 'secret')) {
        if (input.secret) {
          if (connector.secretRecordId) {
            await this.secretService.updateSecretRecord(
              connector.secretRecordId,
              { payload: input.secret },
              { tx },
            );
          } else {
            const secretRecord = await this.secretService.createSecretRecord(
              {
                workspaceId: connector.workspaceId,
                scopeType: 'connector',
                scopeId: connector.id,
                payload: input.secret,
                createdBy: connector.createdBy,
              },
              { tx },
            );
            patch.secretRecordId = secretRecord.id;
          }
        } else if (connector.secretRecordId) {
          await this.secretService.deleteSecretRecord(
            connector.secretRecordId,
            {
              tx,
            },
          );
          patch.secretRecordId = null;
        }
      }

      const updatedConnector =
        Object.keys(patch).length === 0
          ? connector
          : await this.connectorRepository.updateOne(connectorId, patch, {
              tx,
            });

      await this.connectorRepository.commit(tx);
      await this.syncKnowledgeBaseFederationIfNeeded([
        previousKnowledgeBaseId,
        nextKnowledgeBaseId,
      ]);
      return updatedConnector;
    } catch (error) {
      await this.connectorRepository.rollback(tx);
      throw error;
    }
  }

  public async getConnectorById(
    connectorId: string,
  ): Promise<Connector | null> {
    return await this.connectorRepository.findOneBy({ id: connectorId });
  }

  public async listConnectorsByKnowledgeBase(
    workspaceId: string,
    knowledgeBaseId: string,
  ): Promise<Connector[]> {
    return await this.connectorRepository.findAllBy({
      workspaceId,
      knowledgeBaseId,
    });
  }

  public async deleteConnector(connectorId: string): Promise<void> {
    const tx = await this.connectorRepository.transaction();
    let knowledgeBaseId: string | null = null;

    try {
      const connector = await this.connectorRepository.findOneBy(
        { id: connectorId },
        { tx },
      );
      if (!connector) {
        throw new Error(`Connector ${connectorId} not found`);
      }

      await this.ensureWritableConnectorScope(
        connector.workspaceId,
        connector.knowledgeBaseId,
        { tx },
      );

      knowledgeBaseId = connector.knowledgeBaseId ?? null;
      await this.connectorRepository.deleteOne(connectorId, { tx });
      if (connector.secretRecordId) {
        await this.secretService.deleteSecretRecord(connector.secretRecordId, {
          tx,
        });
      }

      await this.connectorRepository.commit(tx);
      await this.syncKnowledgeBaseFederationIfNeeded([knowledgeBaseId]);
    } catch (error) {
      await this.connectorRepository.rollback(tx);
      throw error;
    }
  }

  public async resolveConnectorSecret(
    connectorId: string,
  ): Promise<SecretPayload | null> {
    const connector = await this.getConnectorById(connectorId);
    if (!connector) {
      throw new Error(`Connector ${connectorId} not found`);
    }

    if (!connector.secretRecordId) {
      return null;
    }

    return await this.secretService.decryptSecretRecord(
      connector.secretRecordId,
    );
  }

  public async getResolvedConnector(
    connectorId: string,
  ): Promise<ResolvedConnector | null> {
    const connector = await this.getConnectorById(connectorId);
    if (!connector) {
      return null;
    }

    return {
      ...connector,
      secret: connector.secretRecordId
        ? await this.secretService.decryptSecretRecord(connector.secretRecordId)
        : null,
    };
  }

  public async testConnectorConnection(
    input: TestConnectorConnectionInput,
  ): Promise<ConnectorConnectionTestResult> {
    if (!input.connectorId) {
      await this.ensureWritableConnectorScope(
        input.workspaceId,
        input.knowledgeBaseId,
      );
    }
    const target = await this.resolveConnectorTestTarget(input);
    await this.ensureWritableConnectorScope(
      input.workspaceId,
      input.knowledgeBaseId ?? target.persistedConnector?.knowledgeBaseId,
    );

    if (
      target.persistedConnector &&
      target.persistedConnector.workspaceId !== input.workspaceId
    ) {
      throw new Error(
        `Connector ${target.persistedConnector.id} does not belong to workspace ${input.workspaceId}`,
      );
    }

    if (target.type !== 'database') {
      throw new Error(`暂不支持 ${target.type} 连接器的连接测试`);
    }

    return await this.testDatabaseConnector(target);
  }

  private async resolveConnectorTestTarget(
    input: TestConnectorConnectionInput,
  ): Promise<{
    persistedConnector: Connector | null;
    type: string;
    databaseProvider: string | null;
    config: Record<string, any> | null;
    secret: SecretPayload | null;
  }> {
    let persistedConnector: Connector | null = null;
    let persistedSecret: SecretPayload | null = null;

    if (input.connectorId) {
      persistedConnector = await this.getConnectorById(input.connectorId);
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

      persistedSecret = await this.resolveConnectorSecret(input.connectorId);
    }

    const type = input.type ?? persistedConnector?.type;
    if (!type) {
      throw new Error('Connector type is required for connection test');
    }
    const normalizedInput = this.normalizeConnectorInput({
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
  }

  private async testDatabaseConnector(target: {
    type: string;
    databaseProvider: string | null;
    config: Record<string, any> | null;
    secret: SecretPayload | null;
  }): Promise<ConnectorConnectionTestResult> {
    const provider = requireDatabaseProvider(target.databaseProvider);
    const dataSource = getDataSourceNameForDatabaseProvider(provider);
    const connectionInfo = buildDatabaseConnectorConnectionInfo({
      provider,
      config: target.config,
      secret: target.secret,
    });
    const encryptedConnectionInfo = encryptConnectionInfo(
      dataSource,
      connectionInfo,
    );
    const project = {
      id: -1,
      type: dataSource,
      connectionInfo: encryptedConnectionInfo,
    };

    const tables = await this.metadataService.listTables(project as any);
    let version: string | null = null;
    try {
      version = await this.metadataService.getVersion(project as any);
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
      dataSource,
      tableCount,
      sampleTables: tables.slice(0, 5).map((table) => table.name),
      version,
    };
  }

  private requireString(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${label}不能为空`);
    }

    return value.trim();
  }

  private governanceError(message: string) {
    return Object.assign(new Error(message), { statusCode: 403 });
  }

  private assertWritableConnectorScope({
    workspaceKind,
    knowledgeBaseKind,
  }: {
    workspaceKind?: string | null;
    knowledgeBaseKind?: string | null;
  }) {
    const restrictionReason = getConnectorScopeRestrictionReason({
      workspaceKind,
      knowledgeBaseKind,
    });

    if (restrictionReason) {
      throw this.governanceError(restrictionReason);
    }
  }

  private async ensureWorkspaceExists(
    workspaceId: string,
    queryOptions?: IQueryOptions,
  ) {
    const workspace = await this.workspaceRepository.findOneBy(
      { id: workspaceId },
      queryOptions,
    );
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    return workspace;
  }

  private async ensureKnowledgeBaseExists(
    workspaceId: string,
    knowledgeBaseId?: string | null,
    queryOptions?: IQueryOptions,
  ) {
    if (!knowledgeBaseId) {
      return null;
    }

    const knowledgeBase = await this.knowledgeBaseRepository.findOneBy(
      { id: knowledgeBaseId },
      queryOptions,
    );
    if (!knowledgeBase || knowledgeBase.workspaceId !== workspaceId) {
      throw new Error(
        `Knowledge base ${knowledgeBaseId} not found in workspace ${workspaceId}`,
      );
    }

    return knowledgeBase;
  }

  private async ensureWritableConnectorScope(
    workspaceId: string,
    knowledgeBaseId?: string | null,
    queryOptions?: IQueryOptions,
  ) {
    const workspace = await this.ensureWorkspaceExists(
      workspaceId,
      queryOptions,
    );
    const knowledgeBase = await this.ensureKnowledgeBaseExists(
      workspaceId,
      knowledgeBaseId,
      queryOptions,
    );

    this.assertWritableConnectorScope({
      workspaceKind: workspace.kind,
      knowledgeBaseKind: knowledgeBase?.kind,
    });

    return { workspace, knowledgeBase };
  }

  private normalizeConnectorInput({
    type,
    databaseProvider,
  }: {
    type: string;
    databaseProvider?: string | null;
  }) {
    const normalizedType = this.requireString(type, 'Connector type');
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
  }

  private async syncKnowledgeBaseFederationIfNeeded(
    knowledgeBaseIds: Array<string | null | undefined>,
  ) {
    const scopedKnowledgeBaseIds = [
      ...new Set(knowledgeBaseIds.filter(Boolean)),
    ];
    for (const knowledgeBaseId of scopedKnowledgeBaseIds) {
      await this.federatedRuntimeProjectService.syncKnowledgeBaseFederation(
        knowledgeBaseId!,
      );
    }
  }
}
