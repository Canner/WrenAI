import { runKnowledgeWorkbenchEditorOpenEffects } from './runKnowledgeWorkbenchEditorOpenEffects';

describe('runKnowledgeWorkbenchEditorOpenEffects', () => {
  it('switches sections before applying editor values when requested', async () => {
    const onChangeWorkbenchSection = jest.fn(async () => undefined);
    const onOpenDetail = jest.fn();
    const form = { setFieldsValue: jest.fn() };
    const syncDraftBaseline = jest.fn();
    const setContextAssetId = jest.fn();
    const setDrawerOpen = jest.fn();
    const buildEditorValues = jest.fn(({ item, draftValues }) => ({
      id: item?.id,
      ...draftValues,
    }));

    await runKnowledgeWorkbenchEditorOpenEffects({
      activeWorkbenchSection: 'instructions',
      targetSection: 'sqlTemplates',
      onChangeWorkbenchSection,
      onOpenDetail,
      form,
      syncDraftBaseline,
      setContextAssetId,
      setDrawerOpen,
      buildEditorValues,
      item: { id: 'sql-2' },
      draftValues: { description: 'Revenue' },
      contextAssetId: 'asset-1',
      switchSection: true,
    });

    expect(onChangeWorkbenchSection).toHaveBeenCalledWith('sqlTemplates');
    expect(onOpenDetail).toHaveBeenCalledWith({ id: 'sql-2' });
    expect(form.setFieldsValue).toHaveBeenCalledWith({
      id: 'sql-2',
      description: 'Revenue',
    });
    expect(syncDraftBaseline).toHaveBeenCalledWith({
      id: 'sql-2',
      description: 'Revenue',
    });
    expect(setContextAssetId).toHaveBeenCalledWith('asset-1');
    expect(setDrawerOpen).toHaveBeenCalledWith(true);
  });

  it('skips section switching when the editor stays in the current section', async () => {
    const onChangeWorkbenchSection = jest.fn(async () => undefined);

    await runKnowledgeWorkbenchEditorOpenEffects({
      activeWorkbenchSection: 'sqlTemplates',
      targetSection: 'sqlTemplates',
      onChangeWorkbenchSection,
      onOpenDetail: jest.fn(),
      form: { setFieldsValue: jest.fn() },
      syncDraftBaseline: jest.fn(),
      setContextAssetId: jest.fn(),
      setDrawerOpen: jest.fn(),
      buildEditorValues: jest.fn(() => ({})),
      item: { id: 'sql-1' },
      draftValues: undefined,
      contextAssetId: undefined,
      switchSection: false,
    });

    expect(onChangeWorkbenchSection).not.toHaveBeenCalled();
  });
});
