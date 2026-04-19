export type ReferenceDemoField = {
  key: string;
  fieldName: string;
  fieldType: string;
  aiName: string;
  example: string;
  enumValue?: string | null;
  note?: string | null;
};

export type ReferenceDemoKnowledge = {
  id: string;
  name: string;
  aliases: string[];
  snapshotCount: number;
  score: number;
  description: string;
  assetName: string;
  owner: string;
  fields: ReferenceDemoField[];
  suggestedQuestions: string[];
};

export type ReferenceDemoKnowledgeTarget =
  | string
  | {
      name?: string | null;
      kind?: string | null;
      sampleDataset?: string | null;
      slug?: string | null;
    }
  | null;

export type ReferenceAssetAliasEntry = {
  name: string;
  description?: string;
};
