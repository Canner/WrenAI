export interface RelationData {
  fromModelId: number;
  fromModelReferenceName?: string;
  fromColumnId: number;
  fromColumnReferenceName?: string;
  toModelId: number;
  toModelReferenceName?: string;
  toColumnId: number;
  toColumnReferenceName?: string;
  type: RelationType;
  description?: string;
}

export interface UpdateRelationData {
  type: RelationType;
}

export interface ModelingRelationshipData {
  fromModel: string;
  fromColumn: string;
  toModel: string;
  toColumn: string;
  type: RelationType;
}

export interface AnalysisRelationInfo {
  name: string;
  fromModelId: number;
  fromModelReferenceName: string;
  fromColumnId: number;
  fromColumnReferenceName: string;
  toModelId: number;
  toModelReferenceName: string;
  toColumnId: number;
  toColumnReferenceName: string;
  type: RelationType;
}

export enum RelationType {
  ONE_TO_ONE = 'ONE_TO_ONE',
  ONE_TO_MANY = 'ONE_TO_MANY',
  MANY_TO_ONE = 'MANY_TO_ONE',
}
