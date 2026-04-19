import buildManageConnectorsControlState from './buildManageConnectorsControlState';

describe('buildManageConnectorsControlState', () => {
  it('keeps modal actions enabled for database connectors with no blockers', () => {
    expect(
      buildManageConnectorsControlState({
        createConnectorBlockedReason: null,
        editingConnector: null,
        submitting: false,
        updateConnectorBlockedReason: null,
        watchedConnectorType: 'database',
      }),
    ).toEqual(
      expect.objectContaining({
        modalSubmitDisabled: false,
        modalTestDisabled: false,
      }),
    );
  });

  it('disables modal actions when permissions or connector type block them', () => {
    expect(
      buildManageConnectorsControlState({
        createConnectorBlockedReason: 'no create',
        editingConnector: { id: 'connector-1' },
        submitting: true,
        updateConnectorBlockedReason: 'no update',
        watchedConnectorType: 'rest_json',
      }),
    ).toEqual(
      expect.objectContaining({
        modalSubmitDisabled: true,
        modalTestDisabled: true,
      }),
    );
  });
});
