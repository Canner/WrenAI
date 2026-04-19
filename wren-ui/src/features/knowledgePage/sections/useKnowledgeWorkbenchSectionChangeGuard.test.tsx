import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { KnowledgeWorkbenchSectionKey } from './knowledgeWorkbenchShared';
import { useKnowledgeWorkbenchSectionChangeGuard } from './useKnowledgeWorkbenchSectionChangeGuard';

describe('useKnowledgeWorkbenchSectionChangeGuard', () => {
  const renderHarness = ({
    activeWorkbenchSection = 'overview',
    isRuleDraftDirty = false,
    isSqlDraftDirty = false,
    onChangeWorkbenchSection = jest.fn(),
    runWithDirtyGuard = jest.fn(async (_dirty, action) => {
      await action();
      return true;
    }),
    setRuleDrawerOpen = jest.fn(),
    setSqlTemplateDrawerOpen = jest.fn(),
  }: {
    activeWorkbenchSection?: KnowledgeWorkbenchSectionKey;
    isRuleDraftDirty?: boolean;
    isSqlDraftDirty?: boolean;
    onChangeWorkbenchSection?: jest.Mock;
    runWithDirtyGuard?: jest.Mock;
    setRuleDrawerOpen?: jest.Mock;
    setSqlTemplateDrawerOpen?: jest.Mock;
  } = {}) => {
    let current: ReturnType<
      typeof useKnowledgeWorkbenchSectionChangeGuard
    > | null = null;

    const Harness = () => {
      current = useKnowledgeWorkbenchSectionChangeGuard({
        activeWorkbenchSection,
        isRuleDraftDirty,
        isSqlDraftDirty,
        onChangeWorkbenchSection,
        runWithDirtyGuard,
        setRuleDrawerOpen,
        setSqlTemplateDrawerOpen,
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error(
        'Failed to initialize useKnowledgeWorkbenchSectionChangeGuard',
      );
    }

    return {
      handleWorkbenchSectionChange: current as ReturnType<
        typeof useKnowledgeWorkbenchSectionChangeGuard
      >,
      onChangeWorkbenchSection,
      runWithDirtyGuard,
      setRuleDrawerOpen,
      setSqlTemplateDrawerOpen,
    };
  };

  it('does nothing when the next section matches the active section', async () => {
    const harness = renderHarness({ activeWorkbenchSection: 'sqlTemplates' });

    await harness.handleWorkbenchSectionChange('sqlTemplates');

    expect(harness.runWithDirtyGuard).not.toHaveBeenCalled();
    expect(harness.onChangeWorkbenchSection).not.toHaveBeenCalled();
    expect(harness.setRuleDrawerOpen).not.toHaveBeenCalled();
    expect(harness.setSqlTemplateDrawerOpen).not.toHaveBeenCalled();
  });

  it('runs the dirty guard with the active section dirty state and closes drawers before switching', async () => {
    const harness = renderHarness({
      activeWorkbenchSection: 'instructions',
      isRuleDraftDirty: true,
    });

    await harness.handleWorkbenchSectionChange('sqlTemplates');

    expect(harness.runWithDirtyGuard).toHaveBeenCalledWith(
      true,
      expect.any(Function),
    );
    expect(harness.setSqlTemplateDrawerOpen).toHaveBeenCalledWith(false);
    expect(harness.setRuleDrawerOpen).toHaveBeenCalledWith(false);
    expect(harness.onChangeWorkbenchSection).toHaveBeenCalledWith(
      'sqlTemplates',
    );
  });

  it('keeps the next action gated when the dirty guard declines to continue', async () => {
    const runWithDirtyGuard = jest.fn(async () => false);
    const harness = renderHarness({
      activeWorkbenchSection: 'sqlTemplates',
      isSqlDraftDirty: true,
      runWithDirtyGuard,
    });

    await harness.handleWorkbenchSectionChange('overview');

    expect(runWithDirtyGuard).toHaveBeenCalledWith(true, expect.any(Function));
    expect(harness.onChangeWorkbenchSection).not.toHaveBeenCalled();
    expect(harness.setRuleDrawerOpen).not.toHaveBeenCalled();
    expect(harness.setSqlTemplateDrawerOpen).not.toHaveBeenCalled();
  });
});
