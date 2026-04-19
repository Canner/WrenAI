export type ModelingStateInput = {
  committedModelingWorkspaceKey: string;
  modelingSummary: {
    modelCount: number;
    relationCount: number;
    viewCount: number;
  };
};
