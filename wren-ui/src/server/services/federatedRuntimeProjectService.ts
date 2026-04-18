import { getLogger } from '@server/utils';
import {
  Connector,
  IConnectorRepository,
  IDeployLogRepository,
  IKBSnapshotRepository,
  IKnowledgeBaseRepository,
  IModelRepository,
  IProjectRepository,
  IRelationRepository,
  IViewRepository,
  KnowledgeBase,
  Project,
  TRINO_CONNECTION_INFO,
} from '@server/repositories';
import { DataSourceName } from '@server/types';
import { encryptConnectionInfo } from '@server/dataSource';
import { ISecretService, SecretPayload } from './secretService';
import { ITrinoAdaptor } from '@server/adaptors';
import { IDeployService } from './deployService';
import { IMDLService } from './mdlService';
import {
  buildTrinoCatalogProperties,
  canAutoFederateConnector,
  DatabaseConnectorProvider,
  extractFederatedSchemaBindings,
  generateTrinoCatalogName,
  normalizeDatabaseProvider,
} from '@server/utils/connectorDatabaseProvider';
import { syncLatestExecutableKnowledgeBaseSnapshot } from '@server/utils/knowledgeBaseRuntime';

const logger = getLogger('FederatedRuntimeProjectService');
logger.level = 'debug';

export interface FederatedRuntimeSyncResult {
  knowledgeBaseId: string;
  runtimeProjectId: number | null;
  federatedConnectorIds: string[];
  defaultConnectorId: string | null;
  mode: 'disabled' | 'federated';
}

export interface IFederatedRuntimeProjectService {
  syncKnowledgeBaseFederation(
    knowledgeBaseId: string,
  ): Promise<FederatedRuntimeSyncResult>;
}

type ResolvedConnector = {
  connector: Connector;
  provider: DatabaseConnectorProvider;
  secret: SecretPayload | null;
};

type FederatedConnectorBinding = ResolvedConnector & {
  catalogName: string;
  schemas: { catalog: string; schema: string }[];
};

export class FederatedRuntimeProjectService
  implements IFederatedRuntimeProjectService
{
  private readonly knowledgeBaseRepository: IKnowledgeBaseRepository;
  private readonly connectorRepository: IConnectorRepository;
  private readonly projectRepository: IProjectRepository;
  private readonly deployLogRepository: IDeployLogRepository;
  private readonly kbSnapshotRepository: IKBSnapshotRepository;
  private readonly modelRepository: IModelRepository;
  private readonly relationRepository: IRelationRepository;
  private readonly viewRepository: IViewRepository;
  private readonly secretService: ISecretService;
  private readonly trinoAdaptor: ITrinoAdaptor;
  private readonly mdlService: IMDLService;
  private readonly deployService: IDeployService;
  private readonly runtimeHost: string;
  private readonly runtimePort: number;
  private readonly runtimeUser: string;
  private readonly runtimePassword: string;
  private readonly runtimeSsl: boolean;

  constructor({
    knowledgeBaseRepository,
    connectorRepository,
    projectRepository,
    deployLogRepository,
    kbSnapshotRepository,
    modelRepository,
    relationRepository,
    viewRepository,
    secretService,
    trinoAdaptor,
    mdlService,
    deployService,
    runtimeHost,
    runtimePort,
    runtimeUser,
    runtimePassword,
    runtimeSsl,
  }: {
    knowledgeBaseRepository: IKnowledgeBaseRepository;
    connectorRepository: IConnectorRepository;
    projectRepository: IProjectRepository;
    deployLogRepository: IDeployLogRepository;
    kbSnapshotRepository: IKBSnapshotRepository;
    modelRepository: IModelRepository;
    relationRepository: IRelationRepository;
    viewRepository: IViewRepository;
    secretService: ISecretService;
    trinoAdaptor: ITrinoAdaptor;
    mdlService: IMDLService;
    deployService: IDeployService;
    runtimeHost: string;
    runtimePort: number;
    runtimeUser: string;
    runtimePassword: string;
    runtimeSsl: boolean;
  }) {
    this.knowledgeBaseRepository = knowledgeBaseRepository;
    this.connectorRepository = connectorRepository;
    this.projectRepository = projectRepository;
    this.deployLogRepository = deployLogRepository;
    this.kbSnapshotRepository = kbSnapshotRepository;
    this.modelRepository = modelRepository;
    this.relationRepository = relationRepository;
    this.viewRepository = viewRepository;
    this.secretService = secretService;
    this.trinoAdaptor = trinoAdaptor;
    this.mdlService = mdlService;
    this.deployService = deployService;
    this.runtimeHost = runtimeHost;
    this.runtimePort = runtimePort;
    this.runtimeUser = runtimeUser;
    this.runtimePassword = runtimePassword;
    this.runtimeSsl = runtimeSsl;
  }

  public async syncKnowledgeBaseFederation(
    knowledgeBaseId: string,
  ): Promise<FederatedRuntimeSyncResult> {
    const knowledgeBase = await this.knowledgeBaseRepository.findOneBy({
      id: knowledgeBaseId,
    });
    if (!knowledgeBase) {
      throw new Error(`Knowledge base ${knowledgeBaseId} not found`);
    }

    const connectors = await this.connectorRepository.findAllBy({
      knowledgeBaseId,
    });
    const resolvedConnectors = await Promise.all(
      connectors.map((connector) => this.resolveDatabaseConnector(connector)),
    );
    const federatedConnectors = resolvedConnectors
      .filter((item): item is ResolvedConnector => Boolean(item))
      .filter(({ provider, connector, secret }) =>
        canAutoFederateConnector({
          provider,
          config: connector.configJson,
          secret,
        }),
      );

    if (federatedConnectors.length < 2) {
      const runtimeProjectId = await this.disableFederation(
        knowledgeBase,
        connectors,
      );
      return {
        knowledgeBaseId,
        runtimeProjectId,
        federatedConnectorIds: [],
        defaultConnectorId: null,
        mode: 'disabled',
      };
    }

    const defaultConnector = this.resolveDefaultConnector(
      knowledgeBase,
      federatedConnectors,
    );
    const orderedConnectors = this.orderFederatedConnectors(
      federatedConnectors,
      defaultConnector.connector.id,
    );
    const bindings = orderedConnectors.map((item) => this.toBinding(item));

    await this.syncConnectorCatalogBindings(connectors, bindings);
    await this.ensureCatalogFiles(bindings);

    const runtimeProject = await this.upsertRuntimeProject(
      knowledgeBase,
      bindings,
    );
    await this.redeployKnowledgeBaseRuntime(knowledgeBase, runtimeProject.id);

    return {
      knowledgeBaseId,
      runtimeProjectId: runtimeProject.id,
      federatedConnectorIds: bindings.map((binding) => binding.connector.id),
      defaultConnectorId: defaultConnector.connector.id,
      mode: 'federated',
    };
  }

  private async disableFederation(
    knowledgeBase: KnowledgeBase,
    connectors: Connector[],
  ): Promise<number | null> {
    await Promise.all(
      connectors
        .filter((connector) => connector.trinoCatalogName)
        .map(async (connector) => {
          await this.trinoAdaptor.dropCatalog(connector.trinoCatalogName!);
          if (connector.trinoCatalogName) {
            await this.connectorRepository.updateOne(connector.id, {
              trinoCatalogName: null,
            });
          }
        }),
    );

    if (!knowledgeBase.runtimeProjectId) {
      return null;
    }

    const runtimeProject = await this.projectRepository.findOneBy({
      id: knowledgeBase.runtimeProjectId,
    });
    if (!runtimeProject) {
      await this.knowledgeBaseRepository.updateOne(knowledgeBase.id, {
        runtimeProjectId: null,
      });
      return null;
    }

    if (runtimeProject.type !== DataSourceName.TRINO) {
      return runtimeProject.id;
    }

    await this.deployLogRepository.deleteAllBy({
      projectId: knowledgeBase.runtimeProjectId,
    });
    await this.projectRepository.deleteOne(knowledgeBase.runtimeProjectId);
    await this.knowledgeBaseRepository.updateOne(knowledgeBase.id, {
      runtimeProjectId: null,
    });
    return null;
  }

  private async resolveDatabaseConnector(
    connector: Connector,
  ): Promise<ResolvedConnector | null> {
    if (connector.type !== 'database') {
      return null;
    }

    const provider = normalizeDatabaseProvider(connector.databaseProvider);
    if (!provider) {
      return null;
    }

    const secret = connector.secretRecordId
      ? await this.secretService.decryptSecretRecord(connector.secretRecordId)
      : null;

    return {
      connector,
      provider,
      secret,
    };
  }

  private resolveDefaultConnector(
    knowledgeBase: KnowledgeBase,
    connectors: ResolvedConnector[],
  ): ResolvedConnector {
    const preferredConnector = knowledgeBase.primaryConnectorId
      ? connectors.find(
          ({ connector }) => connector.id === knowledgeBase.primaryConnectorId,
        )
      : null;

    return preferredConnector || connectors[0];
  }

  private orderFederatedConnectors(
    connectors: ResolvedConnector[],
    defaultConnectorId: string,
  ) {
    return [...connectors].sort((left, right) => {
      if (left.connector.id === defaultConnectorId) {
        return -1;
      }
      if (right.connector.id === defaultConnectorId) {
        return 1;
      }
      return left.connector.id.localeCompare(right.connector.id);
    });
  }

  private toBinding(item: ResolvedConnector): FederatedConnectorBinding {
    const knowledgeBaseId = item.connector.knowledgeBaseId;
    if (!knowledgeBaseId) {
      throw new Error(
        `Connector ${item.connector.id} is not scoped to a knowledge base`,
      );
    }

    const catalogName =
      item.connector.trinoCatalogName ||
      generateTrinoCatalogName(knowledgeBaseId, item.connector.id);

    return {
      ...item,
      catalogName,
      schemas: extractFederatedSchemaBindings({
        provider: item.provider,
        config: item.connector.configJson,
        catalogName,
      }),
    };
  }

  private async syncConnectorCatalogBindings(
    connectors: Connector[],
    bindings: FederatedConnectorBinding[],
  ) {
    const desiredCatalogs = new Map(
      bindings.map((binding) => [binding.connector.id, binding.catalogName]),
    );

    await Promise.all(
      connectors.map(async (connector) => {
        const desiredCatalogName = desiredCatalogs.get(connector.id) || null;
        if (connector.trinoCatalogName === desiredCatalogName) {
          return;
        }

        if (
          connector.trinoCatalogName &&
          connector.trinoCatalogName !== desiredCatalogName
        ) {
          await this.trinoAdaptor.dropCatalog(connector.trinoCatalogName);
        }

        await this.connectorRepository.updateOne(connector.id, {
          trinoCatalogName: desiredCatalogName,
        });
      }),
    );
  }

  private async ensureCatalogFiles(bindings: FederatedConnectorBinding[]) {
    await Promise.all(
      bindings.map(async (binding) => {
        await this.trinoAdaptor.ensureCatalog({
          catalogName: binding.catalogName,
          properties: buildTrinoCatalogProperties({
            provider: binding.provider,
            config: binding.connector.configJson,
            secret: binding.secret,
            catalogName: binding.catalogName,
          }),
        });
      }),
    );
  }

  private async upsertRuntimeProject(
    knowledgeBase: KnowledgeBase,
    bindings: FederatedConnectorBinding[],
  ): Promise<Project> {
    const defaultBinding = bindings[0];
    const connectionInfo: TRINO_CONNECTION_INFO = {
      host: this.runtimeHost,
      port: this.runtimePort,
      schemas: this.flattenSchemaBindings(bindings)
        .map((binding) => `${binding.catalog}.${binding.schema}`)
        .join(','),
      username: this.runtimeUser,
      password: this.runtimePassword,
      ssl: this.runtimeSsl,
    };

    const patch: Partial<Project> = {
      type: DataSourceName.TRINO,
      version: '',
      displayName: `[internal] ${knowledgeBase.name} federated runtime`,
      catalog: defaultBinding.catalogName,
      schema: defaultBinding.schemas[0]?.schema || 'public',
      sampleDataset: knowledgeBase.sampleDataset || undefined,
      language: knowledgeBase.language || undefined,
      connectionInfo: encryptConnectionInfo(
        DataSourceName.TRINO,
        connectionInfo,
      ),
    };

    const existingProject = knowledgeBase.runtimeProjectId
      ? await this.projectRepository.findOneBy({
          id: knowledgeBase.runtimeProjectId,
        })
      : null;

    const runtimeProject = existingProject
      ? await this.projectRepository.updateOne(existingProject.id, patch)
      : await this.projectRepository.createOne(patch);

    if (knowledgeBase.runtimeProjectId !== runtimeProject.id) {
      await this.knowledgeBaseRepository.updateOne(knowledgeBase.id, {
        runtimeProjectId: runtimeProject.id,
      });
    }

    return runtimeProject;
  }

  private async redeployKnowledgeBaseRuntime(
    knowledgeBase: KnowledgeBase,
    runtimeProjectId: number,
  ) {
    try {
      const { manifest } =
        await this.mdlService.makeCurrentModelMDLByRuntimeIdentity({
          workspaceId: knowledgeBase.workspaceId,
          knowledgeBaseId: knowledgeBase.id,
        });
      const deployResult = await this.deployService.deploy(
        manifest,
        {
          projectId: runtimeProjectId,
          workspaceId: knowledgeBase.workspaceId,
          knowledgeBaseId: knowledgeBase.id,
        },
        true,
      );

      if (deployResult.status === 'SUCCESS') {
        await syncLatestExecutableKnowledgeBaseSnapshot({
          knowledgeBase,
          knowledgeBaseRepository: this.knowledgeBaseRepository,
          kbSnapshotRepository: this.kbSnapshotRepository,
          deployLogRepository: this.deployLogRepository,
          deployService: this.deployService,
          modelRepository: this.modelRepository,
          relationRepository: this.relationRepository,
          viewRepository: this.viewRepository,
        });
      }
    } catch (error: any) {
      logger.debug(
        `Skip runtime redeploy for knowledge base ${knowledgeBase.id}: ${error.message}`,
      );
    }
  }

  private flattenSchemaBindings(bindings: FederatedConnectorBinding[]) {
    const deduped = new Map<string, { catalog: string; schema: string }>();

    for (const binding of bindings) {
      for (const schemaBinding of binding.schemas) {
        deduped.set(
          `${schemaBinding.catalog}.${schemaBinding.schema}`,
          schemaBinding,
        );
      }
    }

    return [...deduped.values()];
  }
}
