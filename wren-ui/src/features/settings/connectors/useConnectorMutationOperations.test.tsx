import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useConnectorMutationOperations from './useConnectorMutationOperations';

const mockMessageSuccess = jest.fn();
const mockMessageError = jest.fn();
const mockMessageInfo = jest.fn();
const mockFetch = jest.fn();
const mockUseConnectorTestingOperations = jest.fn();

jest.mock('antd', () => ({
  message: {
    success: (...args: any[]) => mockMessageSuccess(...args),
    error: (...args: any[]) => mockMessageError(...args),
    info: (...args: any[]) => mockMessageInfo(...args),
  },
}));

jest.mock('./useConnectorTestingOperations', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseConnectorTestingOperations(...args),
}));

describe('useConnectorMutationOperations', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as typeof fetch;
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    mockUseConnectorTestingOperations.mockReturnValue({
      testingConnection: false,
      testingConnectorId: null,
      handleModalTestConnection: jest.fn(),
      handleTestSavedConnector: jest.fn(),
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  const renderHarness = (
    props: Partial<Parameters<typeof useConnectorMutationOperations>[0]> = {},
  ): ReturnType<typeof useConnectorMutationOperations> => {
    let current: ReturnType<typeof useConnectorMutationOperations> | null =
      null;

    const resolvedProps = {
      form: {
        validateFields: jest.fn().mockResolvedValue({
          type: 'database',
          displayName: 'Warehouse',
          databaseProvider: 'postgres',
          configText: '{"host":"db.internal"}',
          secretText: '{"password":"secret"}',
        }),
        getFieldsValue: jest.fn(),
      },
      editingConnector: null,
      clearSecretChecked: false,
      createConnectorBlockedReason: null,
      updateConnectorBlockedReason: null,
      deleteConnectorBlockedReason: null,
      requireWorkspaceSelector: () => ({ workspaceId: 'workspace-1' }),
      loadConnectors: jest.fn().mockResolvedValue([]),
      closeModal: jest.fn(),
      ...props,
    };

    const Harness = () => {
      current = useConnectorMutationOperations(resolvedProps);
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error('Failed to initialize useConnectorMutationOperations');
    }

    return current as ReturnType<typeof useConnectorMutationOperations>;
  };

  it('creates connectors through the workspace-scoped collection endpoint', async () => {
    const form = {
      validateFields: jest.fn().mockResolvedValue({
        type: 'database',
        displayName: 'Warehouse',
        databaseProvider: 'postgres',
        configText: '{"host":"db.internal"}',
        secretText: '{"password":"secret"}',
      }),
      getFieldsValue: jest.fn(),
    };
    const loadConnectors = jest.fn().mockResolvedValue([]);
    const closeModal = jest.fn();
    const hookValue = renderHarness({ form, loadConnectors, closeModal });

    await hookValue.submitConnector();

    expect(mockUseConnectorTestingOperations).toHaveBeenCalledWith(
      expect.objectContaining({
        form,
        updateConnectorBlockedReason: null,
      }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/connectors?workspaceId=workspace-1',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(closeModal).toHaveBeenCalledTimes(1);
    expect(loadConnectors).toHaveBeenCalledTimes(1);
    expect(mockMessageSuccess).toHaveBeenCalledWith('连接器已创建。');
  });

  it('deletes connectors and refreshes the catalog', async () => {
    const loadConnectors = jest.fn().mockResolvedValue([]);
    const hookValue = renderHarness({ loadConnectors });

    await hookValue.deleteConnector('connector-1');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/connectors/connector-1?workspaceId=workspace-1',
      expect.objectContaining({
        method: 'DELETE',
      }),
    );
    expect(loadConnectors).toHaveBeenCalledTimes(1);
    expect(mockMessageSuccess).toHaveBeenCalledWith('连接器已删除。');
  });
});
