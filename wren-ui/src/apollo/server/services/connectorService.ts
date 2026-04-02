import crypto from 'crypto';
import {
  Connector,
  IConnectorRepository,
  IKnowledgeBaseRepository,
  IQueryOptions,
  IWorkspaceRepository,
} from '../repositories';
import { ISecretService, SecretPayload } from './secretService';

export interface CreateConnectorInput {
  workspaceId: string;
  knowledgeBaseId?: string | null;
  type: string;
  displayName: string;
  config?: Record<string, any> | null;
  secret?: SecretPayload | null;
  createdBy?: string | null;
}

export interface UpdateConnectorInput {
  knowledgeBaseId?: string | null;
  type?: string;
  displayName?: string;
  config?: Record<string, any> | null;
  secret?: SecretPayload | null;
}

export interface ResolvedConnector extends Connector {
  secret: SecretPayload | null;
}

export interface IConnectorService {
  createConnector(input: CreateConnectorInput): Promise<Connector>;
  updateConnector(
    connectorId: string,
    input: UpdateConnectorInput,
  ): Promise<Connector>;
  getConnectorById(connectorId: string): Promise<Connector | null>;
  listConnectorsByKnowledgeBase(knowledgeBaseId: string): Promise<Connector[]>;
  deleteConnector(connectorId: string): Promise<void>;
  resolveConnectorSecret(connectorId: string): Promise<SecretPayload | null>;
  getResolvedConnector(connectorId: string): Promise<ResolvedConnector | null>;
}

export class ConnectorService implements IConnectorService {
  private connectorRepository: IConnectorRepository;
  private workspaceRepository: IWorkspaceRepository;
  private knowledgeBaseRepository: IKnowledgeBaseRepository;
  private secretService: ISecretService;

  constructor({
    connectorRepository,
    workspaceRepository,
    knowledgeBaseRepository,
    secretService,
  }: {
    connectorRepository: IConnectorRepository;
    workspaceRepository: IWorkspaceRepository;
    knowledgeBaseRepository: IKnowledgeBaseRepository;
    secretService: ISecretService;
  }) {
    this.connectorRepository = connectorRepository;
    this.workspaceRepository = workspaceRepository;
    this.knowledgeBaseRepository = knowledgeBaseRepository;
    this.secretService = secretService;
  }

  public async createConnector(input: CreateConnectorInput): Promise<Connector> {
    const tx = await this.connectorRepository.transaction();

    try {
      await this.ensureWorkspaceExists(input.workspaceId, { tx });
      await this.ensureKnowledgeBaseExists(
        input.workspaceId,
        input.knowledgeBaseId,
        { tx },
      );

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
          type: input.type,
          displayName: input.displayName,
          configJson: input.config ?? null,
          secretRecordId,
          createdBy: input.createdBy,
        },
        { tx },
      );

      await this.connectorRepository.commit(tx);
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

      if (Object.prototype.hasOwnProperty.call(input, 'knowledgeBaseId')) {
        await this.ensureKnowledgeBaseExists(
          connector.workspaceId,
          input.knowledgeBaseId,
          { tx },
        );
      }

      const patch: Partial<Connector> = {};

      if (Object.prototype.hasOwnProperty.call(input, 'knowledgeBaseId')) {
        patch.knowledgeBaseId = input.knowledgeBaseId ?? null;
      }
      if (input.type !== undefined) {
        patch.type = input.type;
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
          await this.secretService.deleteSecretRecord(connector.secretRecordId, {
            tx,
          });
          patch.secretRecordId = null;
        }
      }

      const updatedConnector =
        Object.keys(patch).length === 0
          ? connector
          : await this.connectorRepository.updateOne(connectorId, patch, { tx });

      await this.connectorRepository.commit(tx);
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
    knowledgeBaseId: string,
  ): Promise<Connector[]> {
    return await this.connectorRepository.findAllBy({ knowledgeBaseId });
  }

  public async deleteConnector(connectorId: string): Promise<void> {
    const tx = await this.connectorRepository.transaction();

    try {
      const connector = await this.connectorRepository.findOneBy(
        { id: connectorId },
        { tx },
      );
      if (!connector) {
        throw new Error(`Connector ${connectorId} not found`);
      }

      await this.connectorRepository.deleteOne(connectorId, { tx });
      if (connector.secretRecordId) {
        await this.secretService.deleteSecretRecord(connector.secretRecordId, {
          tx,
        });
      }

      await this.connectorRepository.commit(tx);
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

    return await this.secretService.decryptSecretRecord(connector.secretRecordId);
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
  }

  private async ensureKnowledgeBaseExists(
    workspaceId: string,
    knowledgeBaseId?: string | null,
    queryOptions?: IQueryOptions,
  ) {
    if (!knowledgeBaseId) {
      return;
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
  }
}
