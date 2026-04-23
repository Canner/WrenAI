import crypto from 'crypto';
import { getLogger } from '@server/utils';
import {
  Connector,
  IDeployLogRepository,
  IConnectorRepository,
  IKBSnapshotRepository,
  IKnowledgeBaseRepository,
  IWorkspaceRepository,
  KBSnapshot,
  KnowledgeBase,
  Workspace,
} from '../repositories';
import { DataSourceName } from '../types';
import {
  canCreateKnowledgeBaseInWorkspace,
  isSystemSampleKnowledgeBase,
  KNOWLEDGE_BASE_KINDS,
} from '@/utils/workspaceGovernance';
import { IDeployService } from './deployService';
import { IFederatedRuntimeProjectService } from './federatedRuntimeProjectService';
import { IMDLService } from './mdlService';
import { IProjectService } from './projectService';
import { syncLatestExecutableKnowledgeBaseSnapshot } from '../utils/knowledgeBaseRuntime';
import {
  ServiceAuthorization,
  assertServiceAuthorized,
} from './serviceAuthorization';

export interface CreateKnowledgeBaseInput {
  workspaceId: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  createdBy?: string | null;
  authorization?: ServiceAuthorization | null;
}

export interface UpdateKnowledgeBaseInput {
  knowledgeBaseId: string;
  workspaceId: string;
  name?: string;
  description?: string | null;
  defaultKbSnapshotId?: string | null;
  primaryConnectorId?: string | null;
  language?: string | null;
  sampleDataset?: string | null;
  archivedAt?: Date | null;
  authorization?: ServiceAuthorization | null;
}

export interface IKnowledgeBaseService {
  listKnowledgeBases(
    workspaceId: string,
    authorization?: ServiceAuthorization | null,
  ): Promise<KnowledgeBase[]>;
  getKnowledgeBaseById(
    workspaceId: string,
    knowledgeBaseId: string,
    authorization?: ServiceAuthorization | null,
  ): Promise<KnowledgeBase | null>;
  createKnowledgeBase(input: CreateKnowledgeBaseInput): Promise<KnowledgeBase>;
  updateKnowledgeBase(input: UpdateKnowledgeBaseInput): Promise<KnowledgeBase>;
  getPrimaryConnector(knowledgeBase: KnowledgeBase): Promise<Connector | null>;
}

const normalizeSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'knowledge-base';

const logger = getLogger('KnowledgeBaseService');
logger.level = 'debug';

export class KnowledgeBaseService implements IKnowledgeBaseService {
  private readonly workspaceRepository: IWorkspaceRepository;
  private readonly knowledgeBaseRepository: IKnowledgeBaseRepository;
  private readonly kbSnapshotRepository: IKBSnapshotRepository;
  private readonly connectorRepository: IConnectorRepository;
  private readonly federatedRuntimeProjectService: IFederatedRuntimeProjectService;
  private readonly projectService: IProjectService;
  private readonly mdlService: IMDLService;
  private readonly deployService: IDeployService;
  private readonly deployLogRepository: IDeployLogRepository;

  constructor({
    workspaceRepository,
    knowledgeBaseRepository,
    kbSnapshotRepository,
    connectorRepository,
    federatedRuntimeProjectService,
    projectService,
    mdlService,
    deployService,
    deployLogRepository,
  }: {
    workspaceRepository: IWorkspaceRepository;
    knowledgeBaseRepository: IKnowledgeBaseRepository;
    kbSnapshotRepository: IKBSnapshotRepository;
    connectorRepository: IConnectorRepository;
    federatedRuntimeProjectService: IFederatedRuntimeProjectService;
    projectService: IProjectService;
    mdlService: IMDLService;
    deployService: IDeployService;
    deployLogRepository: IDeployLogRepository;
  }) {
    this.workspaceRepository = workspaceRepository;
    this.knowledgeBaseRepository = knowledgeBaseRepository;
    this.kbSnapshotRepository = kbSnapshotRepository;
    this.connectorRepository = connectorRepository;
    this.federatedRuntimeProjectService = federatedRuntimeProjectService;
    this.projectService = projectService;
    this.mdlService = mdlService;
    this.deployService = deployService;
    this.deployLogRepository = deployLogRepository;
  }

  public async listKnowledgeBases(
    workspaceId: string,
    authorization?: ServiceAuthorization | null,
  ): Promise<KnowledgeBase[]> {
    assertServiceAuthorized({
      authorization,
      action: 'knowledge_base.read',
      resource: {
        resourceType: 'workspace',
        resourceId: workspaceId,
        workspaceId,
      },
    });
    await this.ensureWorkspaceExists(workspaceId);

    return await this.knowledgeBaseRepository.findAllBy({
      workspaceId,
    });
  }

  public async getKnowledgeBaseById(
    workspaceId: string,
    knowledgeBaseId: string,
    authorization?: ServiceAuthorization | null,
  ): Promise<KnowledgeBase | null> {
    assertServiceAuthorized({
      authorization,
      action: 'knowledge_base.read',
      resource: {
        resourceType: 'knowledge_base',
        resourceId: knowledgeBaseId,
        workspaceId,
      },
    });
    await this.ensureWorkspaceExists(workspaceId);

    return await this.knowledgeBaseRepository.findOneBy({
      id: knowledgeBaseId,
      workspaceId,
    });
  }

  public async createKnowledgeBase(
    input: CreateKnowledgeBaseInput,
  ): Promise<KnowledgeBase> {
    assertServiceAuthorized({
      authorization: input.authorization,
      action: 'knowledge_base.create',
      resource: {
        resourceType: 'workspace',
        resourceId: input.workspaceId,
        workspaceId: input.workspaceId,
      },
    });
    const workspace = await this.ensureWorkspaceExists(input.workspaceId);
    if (!canCreateKnowledgeBaseInWorkspace(workspace.kind)) {
      throw new Error(
        'Default workspace does not allow creating knowledge bases',
      );
    }

    const knowledgeBase = await this.knowledgeBaseRepository.createOne({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      slug: await this.ensureUniqueSlug(
        input.workspaceId,
        input.slug || input.name,
      ),
      name: input.name.trim(),
      kind: KNOWLEDGE_BASE_KINDS.REGULAR,
      description: input.description?.trim() || null,
      createdBy: input.createdBy || null,
      primaryConnectorId: null,
      runtimeProjectId: null,
      language: null,
      sampleDataset: null,
    });

    await this.bootstrapEmptyRuntimeBestEffort(knowledgeBase);

    return (
      (await this.knowledgeBaseRepository.findOneBy({
        id: knowledgeBase.id,
        workspaceId: knowledgeBase.workspaceId,
      })) || knowledgeBase
    );
  }

  public async updateKnowledgeBase(
    input: UpdateKnowledgeBaseInput,
  ): Promise<KnowledgeBase> {
    assertServiceAuthorized({
      authorization: input.authorization,
      action:
        input.archivedAt !== undefined
          ? 'knowledge_base.archive'
          : 'knowledge_base.update',
      resource: {
        resourceType: 'knowledge_base',
        resourceId: input.knowledgeBaseId,
        workspaceId: input.workspaceId,
      },
    });
    const workspace = await this.ensureWorkspaceExists(input.workspaceId);
    const knowledgeBase = await this.knowledgeBaseRepository.findOneBy({
      id: input.knowledgeBaseId,
      workspaceId: input.workspaceId,
    });
    if (!knowledgeBase) {
      throw new Error(`Knowledge base ${input.knowledgeBaseId} not found`);
    }
    if (!canCreateKnowledgeBaseInWorkspace(workspace.kind)) {
      throw new Error(
        'Default workspace does not allow mutating knowledge bases',
      );
    }
    if (isSystemSampleKnowledgeBase(knowledgeBase.kind)) {
      throw new Error('System sample knowledge base is read only');
    }

    if (input.defaultKbSnapshotId !== undefined) {
      await this.ensureSnapshotBelongsToKnowledgeBase(
        knowledgeBase.id,
        input.defaultKbSnapshotId,
      );
    }

    if (input.primaryConnectorId !== undefined) {
      await this.ensureConnectorBelongsToKnowledgeBase(
        input.workspaceId,
        knowledgeBase.id,
        input.primaryConnectorId,
      );
    }

    const patch: Partial<KnowledgeBase> = {};

    const assignIfPresent = <K extends keyof KnowledgeBase>(
      key: K,
      value: KnowledgeBase[K] | undefined,
    ) => {
      if (value !== undefined) {
        patch[key] = value;
      }
    };

    assignIfPresent('name', input.name?.trim() as KnowledgeBase['name']);
    assignIfPresent(
      'description',
      input.description === undefined
        ? undefined
        : input.description?.trim() || null,
    );
    assignIfPresent('defaultKbSnapshotId', input.defaultKbSnapshotId);
    assignIfPresent('primaryConnectorId', input.primaryConnectorId);
    assignIfPresent(
      'language',
      input.language === undefined ? undefined : input.language || null,
    );
    assignIfPresent(
      'sampleDataset',
      input.sampleDataset === undefined
        ? undefined
        : input.sampleDataset || null,
    );
    assignIfPresent('archivedAt', input.archivedAt);

    if (Object.keys(patch).length === 0) {
      return knowledgeBase;
    }

    const updatedKnowledgeBase = await this.knowledgeBaseRepository.updateOne(
      knowledgeBase.id,
      patch,
    );
    if (
      Object.prototype.hasOwnProperty.call(input, 'primaryConnectorId') &&
      input.primaryConnectorId !== knowledgeBase.primaryConnectorId
    ) {
      await this.federatedRuntimeProjectService.syncKnowledgeBaseFederation(
        knowledgeBase.id,
      );
    }

    return updatedKnowledgeBase;
  }

  public async getPrimaryConnector(
    knowledgeBase: KnowledgeBase,
  ): Promise<Connector | null> {
    if (!knowledgeBase.primaryConnectorId) {
      return null;
    }

    const connector = await this.connectorRepository.findOneBy({
      id: knowledgeBase.primaryConnectorId,
    });
    if (!connector) {
      return null;
    }

    if (
      connector.workspaceId !== knowledgeBase.workspaceId ||
      connector.knowledgeBaseId !== knowledgeBase.id
    ) {
      return null;
    }

    return connector;
  }

  private async ensureUniqueSlug(workspaceId: string, candidate: string) {
    const baseSlug = normalizeSlug(candidate);
    let slug = baseSlug;
    let suffix = 2;

    while (
      await this.knowledgeBaseRepository.findOneBy({
        workspaceId,
        slug,
      })
    ) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    return slug;
  }

  private async ensureWorkspaceExists(workspaceId: string): Promise<Workspace> {
    const workspace = await this.workspaceRepository.findOneBy({
      id: workspaceId,
    });
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    return workspace;
  }

  private async ensureSnapshotBelongsToKnowledgeBase(
    knowledgeBaseId: string,
    kbSnapshotId?: string | null,
  ): Promise<KBSnapshot | null> {
    if (!kbSnapshotId) {
      return null;
    }

    const snapshot = await this.kbSnapshotRepository.findOneBy({
      id: kbSnapshotId,
    });
    if (!snapshot || snapshot.knowledgeBaseId !== knowledgeBaseId) {
      throw new Error(
        `Knowledge base snapshot ${kbSnapshotId} does not belong to knowledge base ${knowledgeBaseId}`,
      );
    }

    return snapshot;
  }

  private async ensureConnectorBelongsToKnowledgeBase(
    workspaceId: string,
    knowledgeBaseId: string,
    connectorId?: string | null,
  ): Promise<Connector | null> {
    if (!connectorId) {
      return null;
    }

    const connector = await this.connectorRepository.findOneBy({
      id: connectorId,
    });
    if (
      !connector ||
      connector.workspaceId !== workspaceId ||
      connector.knowledgeBaseId !== knowledgeBaseId
    ) {
      throw new Error(
        `Connector ${connectorId} does not belong to knowledge base ${knowledgeBaseId}`,
      );
    }

    return connector;
  }

  private async bootstrapEmptyRuntimeBestEffort(
    knowledgeBase: KnowledgeBase,
  ): Promise<void> {
    try {
      const runtimeProject = await this.projectService.createProject({
        displayName: `[internal] ${knowledgeBase.name} bootstrap runtime`,
        type: DataSourceName.DUCKDB,
        connectionInfo: {
          initSql: '',
          extensions: [],
          configurations: {},
        },
      });
      const { manifest } = await this.mdlService.makeCurrentModelMDL(
        runtimeProject.id,
      );
      const deployResult = await this.deployService.deploy(
        manifest,
        {
          projectId: runtimeProject.id,
          workspaceId: knowledgeBase.workspaceId,
          knowledgeBaseId: knowledgeBase.id,
          kbSnapshotId: null,
          deployHash: null,
          actorUserId: knowledgeBase.createdBy || null,
        },
        false,
      );

      if (deployResult.status !== 'SUCCESS') {
        logger.debug(
          `Skip empty runtime bootstrap for knowledge base ${knowledgeBase.id}: ${deployResult.error || 'deploy failed'}`,
        );
        return;
      }

      await syncLatestExecutableKnowledgeBaseSnapshot({
        knowledgeBase,
        knowledgeBaseRepository: this.knowledgeBaseRepository,
        kbSnapshotRepository: this.kbSnapshotRepository,
        deployLogRepository: this.deployLogRepository,
        deployService: this.deployService,
      });
    } catch (error: any) {
      logger.debug(
        `Skip empty runtime bootstrap for knowledge base ${knowledgeBase.id}: ${error.message}`,
      );
    }
  }
}
