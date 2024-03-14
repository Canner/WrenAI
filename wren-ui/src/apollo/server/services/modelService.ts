export interface IModelService {
  generateReferenceName(data: any): string;
}

export interface GenerateReferenceNameData {
  displayName: string;
  sourceTableName: string;
  existedReferenceNames: string[];
}

export class ModelService implements IModelService {
  public generateReferenceName(data: GenerateReferenceNameData): string {
    const { sourceTableName, existedReferenceNames } = data;
    if (!existedReferenceNames.includes(sourceTableName)) {
      return sourceTableName;
    }
    return `${sourceTableName}_${existedReferenceNames.length + 1}`;
  }
}
