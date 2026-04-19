import { useState } from 'react';
import { Form } from 'antd';
import useKnowledgeAssetDraftState from '@/hooks/useKnowledgeAssetDraftState';
import useKnowledgeDetailViewState from '@/hooks/useKnowledgeDetailViewState';
import type { AssetView } from './types';
import type {
  RuleDetailFormValues,
  SqlTemplateFormValues,
} from '@/hooks/useKnowledgeRuleSqlManager';

export function useKnowledgePageLocalState() {
  const [knowledgeTab, setKnowledgeTab] = useState('workspace');
  const [assetModalOpen, setAssetModalOpen] = useState(false);
  const [assetWizardStep, setAssetWizardStep] = useState(0);
  const [detailAsset, setDetailAsset] = useState<AssetView | null>(null);
  const [draftAssets, setDraftAssets] = useState<AssetView[]>([]);
  const { assetDraft, setAssetDraft, resetAssetDraft } =
    useKnowledgeAssetDraftState();
  const {
    detailTab,
    setDetailTab,
    detailFieldKeyword,
    setDetailFieldKeyword,
    detailFieldFilter,
    setDetailFieldFilter,
    resetDetailViewState,
  } = useKnowledgeDetailViewState();
  const [kbForm] = Form.useForm<{ name: string; description?: string }>();
  const [ruleForm] = Form.useForm<RuleDetailFormValues>();
  const [sqlTemplateForm] = Form.useForm<SqlTemplateFormValues>();
  const kbNameValue = Form.useWatch('name', kbForm);

  return {
    assetDraft,
    assetModalOpen,
    assetWizardStep,
    detailAsset,
    detailFieldFilter,
    detailFieldKeyword,
    detailTab,
    draftAssets,
    kbForm,
    kbNameValue,
    knowledgeTab,
    resetAssetDraft,
    resetDetailViewState,
    ruleForm,
    setAssetDraft,
    setAssetModalOpen,
    setAssetWizardStep,
    setDetailAsset,
    setDetailFieldFilter,
    setDetailFieldKeyword,
    setDetailTab,
    setDraftAssets,
    setKnowledgeTab,
    sqlTemplateForm,
  };
}

export default useKnowledgePageLocalState;
