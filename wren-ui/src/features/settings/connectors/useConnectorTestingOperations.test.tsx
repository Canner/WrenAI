import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useConnectorTestingOperations from './useConnectorTestingOperations';
import type { ConnectorView } from './connectorsPageUtils';

const mockMessageSuccess = jest.fn();
const mockMessageError = jest.fn();
const mockMessageInfo = jest.fn();
const mockFetch = jest.fn();

jest.mock('antd', () => ({
  message: {
    success: (...args: any[]) => mockMessageSuccess(...args),
    error: (...args: any[]) => mockMessageError(...args),
    info: (...args: any[]) => mockMessageInfo(...args),
  },
}));

describe('useConnectorTestingOperations', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as typeof fetch;
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: '连接测试成功。' }),
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  const renderHarness = ({
    form = {
      getFieldsValue: () => ({
        type: 'database',
        displayName: 'Warehouse',
        databaseProvider: 'postgres',
        configText: '{"host":"db.internal"}',
        secretText: '{"password":"secret"}',
      }),
    },
    editingConnector = null,
    clearSecretChecked = false,
    updateConnectorBlockedReason = null,
    requireWorkspaceSelector = () => ({ workspaceId: 'workspace-1' }),
  }: Partial<
    Parameters<typeof useConnectorTestingOperations>[0]
  > = {}): ReturnType<typeof useConnectorTestingOperations> => {
    let current: ReturnType<typeof useConnectorTestingOperations> | null = null;

    const Harness = () => {
      current = useConnectorTestingOperations({
        form,
        editingConnector,
        clearSecretChecked,
        updateConnectorBlockedReason,
        requireWorkspaceSelector,
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error('Failed to initialize useConnectorTestingOperations');
    }

    return current as ReturnType<typeof useConnectorTestingOperations>;
  };

  it('short-circuits modal testing for non-database connectors', async () => {
    const hookValue = renderHarness({
      form: {
        getFieldsValue: () => ({
          type: 'rest_json',
          displayName: 'Sales API',
        }),
      },
    });

    await hookValue.handleModalTestConnection();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockMessageInfo).toHaveBeenCalledWith(
      '当前仅支持 database 连接器的连接测试。',
    );
  });

  it('posts modal connector tests through the workspace-scoped endpoint', async () => {
    const hookValue = renderHarness();

    await hookValue.handleModalTestConnection();

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/connectors/test?workspaceId=workspace-1',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(mockMessageSuccess).toHaveBeenCalledWith('连接测试成功。');
  });

  it('tests saved database connectors using their persisted config', async () => {
    const hookValue = renderHarness();
    const connector: ConnectorView = {
      id: 'connector-1',
      workspaceId: 'workspace-1',
      type: 'database',
      databaseProvider: 'postgres',
      displayName: 'Warehouse',
      config: { host: 'db.internal', database: 'analytics' },
    };

    await hookValue.handleTestSavedConnector(connector);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/connectors/test?workspaceId=workspace-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          connectorId: 'connector-1',
          type: 'database',
          databaseProvider: 'postgres',
          config: { host: 'db.internal', database: 'analytics' },
        }),
      }),
    );
    expect(mockMessageSuccess).toHaveBeenCalledWith('连接测试成功。');
  });
});
