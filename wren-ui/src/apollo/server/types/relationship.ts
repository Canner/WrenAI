export interface RelationData {
  name: string;
  fromModel: number;
  fromColumn: number;
  toModel: number;
  toColumn: number;
  type: RelationType;
}

export enum RelationType {
  ONE_TO_ONE = 'ONE_TO_ONE',
  ONE_TO_MANY = 'ONE_TO_MANY',
  MANY_TO_ONE = 'MANY_TO_ONE',
  MANY_TO_MANY = 'MANY_TO_MANY',
}
