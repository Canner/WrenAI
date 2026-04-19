export type LocalStateInput = {
  canSaveKnowledgeBase: boolean;
  knowledgeTab: string;
  setKnowledgeTab: (value: string) => void;
  detailTab: any;
  detailFieldKeyword: string;
  detailFieldFilter: any;
  setDetailTab: any;
  setDetailFieldKeyword: any;
  setDetailFieldFilter: any;
  kbForm: any;
  ruleForm: any;
  sqlTemplateForm: any;
  assetModalOpen: boolean;
  assetWizardStep: number;
  setAssetWizardStep: any;
  assetDraft: any;
  setAssetDraft: any;
};
