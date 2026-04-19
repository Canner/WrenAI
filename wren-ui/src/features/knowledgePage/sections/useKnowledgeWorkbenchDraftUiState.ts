import { useState } from 'react';

export function useKnowledgeWorkbenchDraftUiState() {
  const [sqlSearchKeyword, setSqlSearchKeyword] = useState('');
  const [ruleSearchKeyword, setRuleSearchKeyword] = useState('');
  const [sqlListMode, setSqlListMode] = useState<'all' | 'recent'>('all');
  const [ruleListScope, setRuleListScope] = useState<
    'all' | 'default' | 'matched'
  >('all');
  const [sqlTemplateDrawerOpen, setSqlTemplateDrawerOpen] = useState(false);
  const [ruleDrawerOpen, setRuleDrawerOpen] = useState(false);

  return {
    ruleDrawerOpen,
    ruleListScope,
    ruleSearchKeyword,
    setRuleDrawerOpen,
    setRuleListScope,
    setRuleSearchKeyword,
    setSqlListMode,
    setSqlSearchKeyword,
    setSqlTemplateDrawerOpen,
    sqlListMode,
    sqlSearchKeyword,
    sqlTemplateDrawerOpen,
  };
}
