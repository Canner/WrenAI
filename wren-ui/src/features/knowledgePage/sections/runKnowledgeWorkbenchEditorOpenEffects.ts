import type {
  KnowledgeWorkbenchEditorOpenActionArgs,
  KnowledgeWorkbenchEditorOpenActionParams,
} from './knowledgeWorkbenchEditorOpenActionTypes';

export async function runKnowledgeWorkbenchEditorOpenEffects<
  TItem,
  TDraftValues extends Record<string, any>,
>({
  activeWorkbenchSection,
  targetSection,
  onChangeWorkbenchSection,
  onOpenDetail,
  form,
  syncDraftBaseline,
  setContextAssetId,
  setDrawerOpen,
  buildEditorValues,
  item,
  draftValues,
  contextAssetId,
  switchSection,
}: Pick<
  KnowledgeWorkbenchEditorOpenActionArgs<TItem, TDraftValues>,
  | 'activeWorkbenchSection'
  | 'targetSection'
  | 'onChangeWorkbenchSection'
  | 'onOpenDetail'
  | 'form'
  | 'syncDraftBaseline'
  | 'setContextAssetId'
  | 'setDrawerOpen'
  | 'buildEditorValues'
> &
  Required<
    Pick<
      KnowledgeWorkbenchEditorOpenActionParams<TItem, TDraftValues>,
      'switchSection'
    >
  > &
  Pick<
    KnowledgeWorkbenchEditorOpenActionParams<TItem, TDraftValues>,
    'item' | 'draftValues' | 'contextAssetId'
  >) {
  if (switchSection && activeWorkbenchSection !== targetSection) {
    await onChangeWorkbenchSection(targetSection);
  }

  const nextValues = buildEditorValues({
    item,
    draftValues,
  });
  onOpenDetail(item);
  form.setFieldsValue(nextValues);
  syncDraftBaseline(nextValues);
  setContextAssetId(contextAssetId);
  setDrawerOpen(true);
}
