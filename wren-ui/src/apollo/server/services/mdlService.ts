import { MDLBuilder } from '../mdl/mdlBuilder';
import {
  IModelColumnRepository,
  IModelRepository,
  IProjectRepository,
  IRelationRepository,
} from '../repositories';
import { Manifest } from '../mdl/type';

export interface IMDLService {
  makeCurrentModelMDL(): Promise<Manifest>;
}

export class MDLService implements IMDLService {
  private projectRepository: IProjectRepository;
  private modelRepository: IModelRepository;
  private modelColumnRepository: IModelColumnRepository;
  private relationRepository: IRelationRepository;

  constructor({
    projectRepository,
    modelRepository,
    modelColumnRepository,
    relationRepository,
  }: {
    projectRepository: IProjectRepository;
    modelRepository: IModelRepository;
    modelColumnRepository: IModelColumnRepository;
    relationRepository: IRelationRepository;
  }) {
    this.projectRepository = projectRepository;
    this.modelRepository = modelRepository;
    this.modelColumnRepository = modelColumnRepository;
    this.relationRepository = relationRepository;
  }

  public async makeCurrentModelMDL() {
    const project = await this.projectRepository.getCurrentProject();
    const projectId = project.id;
    const models = await this.modelRepository.findAllBy({ projectId });
    const modelIds = models.map((m) => m.id);
    const columns =
      await this.modelColumnRepository.findColumnsByModelIds(modelIds);
    const relations = await this.relationRepository.findRelationInfoBy({
      projectId,
    });
    const relatedModels = models;
    const relatedColumns = columns;
    const relatedRelations = relations;
    const mdlBuilder = new MDLBuilder({
      project,
      models,
      columns,
      relations,
      relatedModels,
      relatedColumns,
      relatedRelations,
    });
    return mdlBuilder.build();
  }
}
