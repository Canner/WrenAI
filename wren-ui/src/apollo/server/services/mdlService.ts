import { MDLBuilder } from '../mdl/mdlBuilder';
import {
  IModelNestedColumnRepository,
  IModelColumnRepository,
  IModelRepository,
  IProjectRepository,
  IRelationRepository,
  IViewRepository,
} from '../repositories';
import { Manifest } from '../mdl/type';

export interface MakeCurrentModelMDLResult {
  manifest: Manifest;
  mdlBuilder: MDLBuilder;
}
export interface IMDLService {
  makeCurrentModelMDL(): Promise<MakeCurrentModelMDLResult>;
}

export class MDLService implements IMDLService {
  private projectRepository: IProjectRepository;
  private modelRepository: IModelRepository;
  private modelColumnRepository: IModelColumnRepository;
  private modelNestedColumnRepository: IModelNestedColumnRepository;
  private relationRepository: IRelationRepository;
  private viewRepository: IViewRepository;

  constructor({
    projectRepository,
    modelRepository,
    modelColumnRepository,
    modelNestedColumnRepository,
    relationRepository,
    viewRepository,
  }: {
    projectRepository: IProjectRepository;
    modelRepository: IModelRepository;
    modelColumnRepository: IModelColumnRepository;
    modelNestedColumnRepository: IModelNestedColumnRepository;
    relationRepository: IRelationRepository;
    viewRepository: IViewRepository;
  }) {
    this.projectRepository = projectRepository;
    this.modelRepository = modelRepository;
    this.modelColumnRepository = modelColumnRepository;
    this.modelNestedColumnRepository = modelNestedColumnRepository;
    this.relationRepository = relationRepository;
    this.viewRepository = viewRepository;
  }

  public async makeCurrentModelMDL() {
    const project = await this.projectRepository.getCurrentProject();
    const projectId = project.id;
    const models = await this.modelRepository.findAllBy({ projectId });
    const modelIds = models.map((m) => m.id);
    const columns =
      await this.modelColumnRepository.findColumnsByModelIds(modelIds);
    const modelNestedColumns =
      await this.modelNestedColumnRepository.findNestedColumnsByModelIds(
        modelIds,
      );
    const relations = await this.relationRepository.findRelationInfoBy({
      projectId,
    });
    const views = await this.viewRepository.findAllBy({ projectId });
    const relatedModels = models;
    const relatedColumns = columns;
    const relatedRelations = relations;
    const mdlBuilder = new MDLBuilder({
      project,
      models,
      columns,
      nestedColumns: modelNestedColumns,
      relations,
      views,
      relatedModels,
      relatedColumns,
      relatedRelations,
    });
    return { manifest: mdlBuilder.build(), mdlBuilder };
  }
}
