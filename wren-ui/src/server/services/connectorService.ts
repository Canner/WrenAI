import crypto from 'crypto';
import {
  Connector,
  IConnectorRepository,
  IKnowledgeBaseRepository,
  IWorkspaceRepository,
} from '../repositories';
import { ISecretService, SecretPayload } from './secretService';
import { IConnectionMetadataService } from './metadataService';
import { IFederatedRuntimeProjectService } from './federatedRuntimeProjectService';
import {
  ensureWritableConnectorScope,
  listDatabaseConnectorTables,
  normalizeConnectorInput,
  resolveConnectorTestTarget,
  syncKnowledgeBaseFederationIfNeeded,
  testDatabaseConnector,
} from './connectorServiceSupport';
import type {
  ConnectorConnectionTestResult,
  CreateConnectorInput,
  IConnectorService,
  ResolvedConnector,
  TestConnectorConnectionInput,
  UpdateConnectorInput,
} from './connectorServiceTypes';
import { CompactTable } from './metadataService';
export type {
  ConnectorConnectionTestResult,
  CreateConnectorInput,
  IConnectorService,
  ResolvedConnector,
  TestConnectorConnectionInput,
  UpdateConnectorInput,
} from './connectorServiceTypes';

export class ConnectorService implements IConnectorService {
  private connectorRepository: IConnectorRepository;
  private workspaceRepository: IWorkspaceRepository;
  private knowledgeBaseRepository: IKnowledgeBaseRepository;
  private secretService: ISecretService;
  private metadataService: IConnectionMetadataService;
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
    metadataService: IConnectionMetadataService;
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
      await ensureWritableConnectorScope({
        workspaceId: input.workspaceId,
        knowledgeBaseId: input.knowledgeBaseId,
        workspaceRepository: this.workspaceRepository,
        knowledgeBaseRepository: this.knowledgeBaseRepository,
        queryOptions: { tx },
      });
      const normalizedInput = normalizeConnectorInput({
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
      await syncKnowledgeBaseFederationIfNeeded({
        knowledgeBaseIds: [connector.knowledgeBaseId],
        federatedRuntimeProjectService: this.federatedRuntimeProjectService,
      });
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

      await ensureWritableConnectorScope({
        workspaceId: connector.workspaceId,
        knowledgeBaseId: Object.prototype.hasOwnProperty.call(
          input,
          'knowledgeBaseId',
        )
          ? input.knowledgeBaseId
          : connector.knowledgeBaseId,
        workspaceRepository: this.workspaceRepository,
        knowledgeBaseRepository: this.knowledgeBaseRepository,
        queryOptions: { tx },
      });

      const patch: Partial<Connector> = {};
      const previousKnowledgeBaseId = connector.knowledgeBaseId ?? null;
      const nextKnowledgeBaseId = Object.prototype.hasOwnProperty.call(
        input,
        'knowledgeBaseId',
      )
        ? (input.knowledgeBaseId ?? null)
        : previousKnowledgeBaseId;
      const normalizedInput = normalizeConnectorInput({
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
      await syncKnowledgeBaseFederationIfNeeded({
        knowledgeBaseIds: [previousKnowledgeBaseId, nextKnowledgeBaseId],
        federatedRuntimeProjectService: this.federatedRuntimeProjectService,
      });
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

  public async listConnectorTables(
    workspaceId: string,
    connectorId: string,
  ): Promise<CompactTable[]> {
    const target = await resolveConnectorTestTarget({
      input: {
        workspaceId,
        connectorId,
      },
      getConnectorById: this.getConnectorById.bind(this),
      resolveConnectorSecret: this.resolveConnectorSecret.bind(this),
    });

    if (!target.persistedConnector) {
      throw new Error(`Connector ${connectorId} not found`);
    }

    if (target.persistedConnector.workspaceId !== workspaceId) {
      throw new Error(
        `Connector ${connectorId} does not belong to workspace ${workspaceId}`,
      );
    }

    if (target.type !== 'database') {
      throw new Error(`暂不支持 ${target.type} 连接器的数据表探测`);
    }

    return await listDatabaseConnectorTables({
      target,
      metadataService: this.metadataService,
    });
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

  public async listConnectorsByWorkspace(
    workspaceId: string,
  ): Promise<Connector[]> {
    const connectors = await this.connectorRepository.findAllBy({
      workspaceId,
    });
    const workspaceScopedConnectors = connectors.filter(
      (connector) => connector.knowledgeBaseId == null,
    );

    if (workspaceScopedConnectors.length > 0) {
      return workspaceScopedConnectors;
    }

    return await this.backfillWorkspaceScopedConnectors(
      workspaceId,
      connectors,
    );
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

      await ensureWritableConnectorScope({
        workspaceId: connector.workspaceId,
        knowledgeBaseId: connector.knowledgeBaseId,
        workspaceRepository: this.workspaceRepository,
        knowledgeBaseRepository: this.knowledgeBaseRepository,
        queryOptions: { tx },
      });

      knowledgeBaseId = connector.knowledgeBaseId ?? null;
      await this.connectorRepository.deleteOne(connectorId, { tx });
      if (connector.secretRecordId) {
        await this.secretService.deleteSecretRecord(connector.secretRecordId, {
          tx,
        });
      }

      await this.connectorRepository.commit(tx);
      await syncKnowledgeBaseFederationIfNeeded({
        knowledgeBaseIds: [knowledgeBaseId],
        federatedRuntimeProjectService: this.federatedRuntimeProjectService,
      });
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
      await ensureWritableConnectorScope({
        workspaceId: input.workspaceId,
        knowledgeBaseId: input.knowledgeBaseId,
        workspaceRepository: this.workspaceRepository,
        knowledgeBaseRepository: this.knowledgeBaseRepository,
      });
    }
    const target = await resolveConnectorTestTarget({
      input,
      getConnectorById: this.getConnectorById.bind(this),
      resolveConnectorSecret: this.resolveConnectorSecret.bind(this),
    });
    await ensureWritableConnectorScope({
      workspaceId: input.workspaceId,
      knowledgeBaseId:
        input.knowledgeBaseId ?? target.persistedConnector?.knowledgeBaseId,
      workspaceRepository: this.workspaceRepository,
      knowledgeBaseRepository: this.knowledgeBaseRepository,
    });

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

    return await testDatabaseConnector({
      target,
      metadataService: this.metadataService,
    });
  }

  private buildConnectorFingerprint = ({
    type,
    databaseProvider,
    displayName,
    configJson,
    secret,
  }: {
    type: string;
    databaseProvider?: string | null;
    displayName: string;
    configJson?: Record<string, any> | null;
    secret?: SecretPayload | null;
  }) =>
    JSON.stringify({
      type,
      databaseProvider: databaseProvider ?? null,
      displayName,
      configJson: this.normalizeFingerprintValue(configJson ?? null),
      secret: this.normalizeFingerprintValue(secret ?? null),
    });

  private normalizeFingerprintValue = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeFingerprintValue(item));
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, this.normalizeFingerprintValue(item)]),
      );
    }

    return value;
  };

  private async backfillWorkspaceScopedConnectors(
    workspaceId: string,
    allWorkspaceConnectors: Connector[],
  ): Promise<Connector[]> {
    const workspace = await this.workspaceRepository.findOneBy({
      id: workspaceId,
    });
    if (!workspace || workspace.kind === 'default') {
      return [];
    }

    const knowledgeBases = await this.knowledgeBaseRepository.findAllBy({
      workspaceId,
    });
    const legacyPrimaryConnectorIds = Array.from(
      new Set(
        knowledgeBases
          .map((knowledgeBase) => knowledgeBase.primaryConnectorId)
          .filter((connectorId): connectorId is string => Boolean(connectorId)),
      ),
    );

    if (legacyPrimaryConnectorIds.length === 0) {
      return [];
    }

    const fingerprintSet = new Set<string>();
    const createdConnectors: Connector[] = [];

    for (const connector of allWorkspaceConnectors) {
      if (connector.knowledgeBaseId != null) {
        continue;
      }

      const resolved = await this.getResolvedConnector(connector.id);
      if (!resolved) {
        continue;
      }
      fingerprintSet.add(
        this.buildConnectorFingerprint({
          type: resolved.type,
          databaseProvider: resolved.databaseProvider,
          displayName: resolved.displayName,
          configJson: resolved.configJson,
          secret: resolved.secret,
        }),
      );
    }

    for (const connectorId of legacyPrimaryConnectorIds) {
      const legacyConnector =
        allWorkspaceConnectors.find(
          (connector) => connector.id === connectorId,
        ) || (await this.getConnectorById(connectorId));
      if (
        !legacyConnector ||
        legacyConnector.workspaceId !== workspaceId ||
        legacyConnector.knowledgeBaseId == null
      ) {
        continue;
      }

      const resolvedLegacyConnector = await this.getResolvedConnector(
        legacyConnector.id,
      );
      if (!resolvedLegacyConnector) {
        continue;
      }

      const fingerprint = this.buildConnectorFingerprint({
        type: resolvedLegacyConnector.type,
        databaseProvider: resolvedLegacyConnector.databaseProvider,
        displayName: resolvedLegacyConnector.displayName,
        configJson: resolvedLegacyConnector.configJson,
        secret: resolvedLegacyConnector.secret,
      });

      if (fingerprintSet.has(fingerprint)) {
        continue;
      }

      fingerprintSet.add(fingerprint);
      createdConnectors.push(
        await this.createConnector({
          workspaceId,
          knowledgeBaseId: null,
          type: resolvedLegacyConnector.type,
          databaseProvider: resolvedLegacyConnector.databaseProvider,
          displayName: resolvedLegacyConnector.displayName,
          config: resolvedLegacyConnector.configJson ?? null,
          secret: resolvedLegacyConnector.secret ?? null,
          createdBy: resolvedLegacyConnector.createdBy ?? undefined,
        }),
      );
    }

    return createdConnectors;
  }
}
