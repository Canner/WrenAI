import { resetKnowledgeStateForSwitch } from './useKnowledgeSwitchReset';

describe('useKnowledgeSwitchReset helpers', () => {
  it('resets asset and selector states when knowledge base switches', () => {
    const setDetailAsset = jest.fn();
    const resetDetailViewState = jest.fn();
    const setDraftAssets = jest.fn();
    const setAssetModalOpen = jest.fn();
    const setAssetWizardStep = jest.fn();
    const resetRuleSqlManagerState = jest.fn();
    const setSelectedConnectorId = jest.fn();
    const setSelectedDemoTable = jest.fn();
    const resetAssetDraft = jest.fn();

    resetKnowledgeStateForSwitch({
      setDetailAsset,
      resetDetailViewState,
      setDraftAssets,
      setAssetModalOpen,
      setAssetWizardStep,
      resetRuleSqlManagerState,
      setSelectedConnectorId,
      setSelectedDemoTable,
      resetAssetDraft,
    });

    expect(setDetailAsset).toHaveBeenCalledWith(null);
    expect(resetDetailViewState).toHaveBeenCalledTimes(1);
    expect(setDraftAssets).toHaveBeenCalledWith([]);
    expect(setAssetModalOpen).toHaveBeenCalledWith(false);
    expect(setAssetWizardStep).toHaveBeenCalledWith(0);
    expect(resetRuleSqlManagerState).toHaveBeenCalledTimes(1);
    expect(setSelectedConnectorId).toHaveBeenCalledWith(undefined);
    expect(setSelectedDemoTable).toHaveBeenCalledWith(undefined);
    expect(resetAssetDraft).toHaveBeenCalledTimes(1);
  });
});
