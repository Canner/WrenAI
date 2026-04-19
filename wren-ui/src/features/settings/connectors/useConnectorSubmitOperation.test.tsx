import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useConnectorSubmitOperation from './useConnectorSubmitOperation';

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

describe('useConnectorSubmitOperation', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as typeof fetch;
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  const renderHarness = (
    props: Partial<Parameters<typeof useConnectorSubmitOperation>[0]> = {},
  ): ReturnType<typeof useConnectorSubmitOperation> => {
    let current: ReturnType<typeof useConnectorSubmitOperation> | null = null;

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
      requireWorkspaceSelector: () => ({ workspaceId: 'workspace-1' }),
      loadConnectors: jest.fn().mockResolvedValue([]),
      closeModal: jest.fn(),
      ...props,
    };

    const Harness = () => {
      current = useConnectorSubmitOperation(resolvedProps);
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error('Failed to initialize useConnectorSubmitOperation');
    }

    return current as ReturnType<typeof useConnectorSubmitOperation>;
  };

  it('creates connectors through the workspace-scoped collection endpoint', async () => {
    const loadConnectors = jest.fn().mockResolvedValue([]);
    const closeModal = jest.fn();
    const hookValue = renderHarness({ loadConnectors, closeModal });

    await hookValue.submitConnector();

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

  it('short-circuits when submit is blocked', async () => {
    const hookValue = renderHarness({
      createConnectorBlockedReason: 'blocked',
    });

    await hookValue.submitConnector();

    expect(mockMessageInfo).toHaveBeenCalledWith('blocked');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
