import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useConnectorDeleteOperation from './useConnectorDeleteOperation';

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

describe('useConnectorDeleteOperation', () => {
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
    props: Partial<Parameters<typeof useConnectorDeleteOperation>[0]> = {},
  ): ReturnType<typeof useConnectorDeleteOperation> => {
    let current: ReturnType<typeof useConnectorDeleteOperation> | null = null;

    const resolvedProps = {
      deleteConnectorBlockedReason: null,
      requireWorkspaceSelector: () => ({ workspaceId: 'workspace-1' }),
      loadConnectors: jest.fn().mockResolvedValue([]),
      ...props,
    };

    const Harness = () => {
      current = useConnectorDeleteOperation(resolvedProps);
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error('Failed to initialize useConnectorDeleteOperation');
    }

    return current as ReturnType<typeof useConnectorDeleteOperation>;
  };

  it('deletes connectors and refreshes the catalog', async () => {
    const loadConnectors = jest.fn().mockResolvedValue([]);
    const hookValue = renderHarness({ loadConnectors });

    await hookValue.deleteConnector('connector-1');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/connectors/connector-1?workspaceId=workspace-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(loadConnectors).toHaveBeenCalledTimes(1);
    expect(mockMessageSuccess).toHaveBeenCalledWith('连接器已删除。');
  });

  it('short-circuits when delete is blocked', async () => {
    const hookValue = renderHarness({
      deleteConnectorBlockedReason: 'blocked',
    });

    await hookValue.deleteConnector('connector-1');

    expect(mockMessageInfo).toHaveBeenCalledWith('blocked');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
