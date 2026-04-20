import type { SelectedAssetTableValue } from './types';

export type ContentDataInput = {
  canContinueAssetWizard: boolean;
  connectorsLoading: boolean;
  isDemoSource: boolean;
  loadConnectors?: () => Promise<unknown> | unknown;
  previewFieldCount: number;
  selectedConnectorId?: string;
  selectedDemoKnowledge?: any;
  selectedDemoTable?: SelectedAssetTableValue;
  selectedSourceType: any;
  setSelectedConnectorId: any;
  setSelectedDemoTable: any;
  setSelectedSourceType: any;
};
