import { runKnowledgeSummaryMoreAction } from './useKnowledgeSummaryActions';

describe('useKnowledgeSummaryActions helpers', () => {
  it('opens rule manage modal for instructions action', () => {
    const openRuleManageModal = jest.fn();
    const openSqlManageModal = jest.fn();
    const openEditKnowledgeBaseModal = jest.fn();

    runKnowledgeSummaryMoreAction({
      key: 'instructions',
      openRuleManageModal,
      openSqlManageModal,
      openEditKnowledgeBaseModal,
    });

    expect(openRuleManageModal).toHaveBeenCalledTimes(1);
    expect(openSqlManageModal).not.toHaveBeenCalled();
    expect(openEditKnowledgeBaseModal).not.toHaveBeenCalled();
  });

  it('opens sql manage modal for sql-templates action', () => {
    const openRuleManageModal = jest.fn();
    const openSqlManageModal = jest.fn();
    const openEditKnowledgeBaseModal = jest.fn();

    runKnowledgeSummaryMoreAction({
      key: 'sql-templates',
      openRuleManageModal,
      openSqlManageModal,
      openEditKnowledgeBaseModal,
    });

    expect(openRuleManageModal).not.toHaveBeenCalled();
    expect(openSqlManageModal).toHaveBeenCalledTimes(1);
    expect(openEditKnowledgeBaseModal).not.toHaveBeenCalled();
  });

  it('opens edit knowledge modal for edit action', () => {
    const openRuleManageModal = jest.fn();
    const openSqlManageModal = jest.fn();
    const openEditKnowledgeBaseModal = jest.fn();

    runKnowledgeSummaryMoreAction({
      key: 'edit-knowledge',
      openRuleManageModal,
      openSqlManageModal,
      openEditKnowledgeBaseModal,
    });

    expect(openRuleManageModal).not.toHaveBeenCalled();
    expect(openSqlManageModal).not.toHaveBeenCalled();
    expect(openEditKnowledgeBaseModal).toHaveBeenCalledTimes(1);
  });

  it('does nothing for unknown action', () => {
    const openRuleManageModal = jest.fn();
    const openSqlManageModal = jest.fn();
    const openEditKnowledgeBaseModal = jest.fn();

    runKnowledgeSummaryMoreAction({
      key: 'unknown',
      openRuleManageModal,
      openSqlManageModal,
      openEditKnowledgeBaseModal,
    });

    expect(openRuleManageModal).not.toHaveBeenCalled();
    expect(openSqlManageModal).not.toHaveBeenCalled();
    expect(openEditKnowledgeBaseModal).not.toHaveBeenCalled();
  });
});
