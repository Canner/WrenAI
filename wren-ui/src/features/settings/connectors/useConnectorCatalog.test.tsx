import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useConnectorCatalog from './useConnectorCatalog';

const mockMessageError = jest.fn();
const mockUseRestRequest = jest.fn();

jest.mock('antd', () => ({
  message: {
    error: (...args: any[]) => mockMessageError(...args),
  },
}));

jest.mock('@/hooks/useRestRequest', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseRestRequest(...args),
}));

describe('useConnectorCatalog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRestRequest.mockReturnValue({
      data: [
        {
          id: 'connector-1',
          workspaceId: 'workspace-1',
          type: 'database',
          displayName: 'Warehouse',
          hasSecret: true,
        },
        {
          id: 'connector-2',
          workspaceId: 'workspace-1',
          type: 'rest_json',
          displayName: 'Sales API',
          hasSecret: false,
        },
      ],
      loading: false,
      refetch: jest.fn(),
    });
  });

  const renderHarness = (
    props?: Partial<Parameters<typeof useConnectorCatalog>[0]>,
  ): ReturnType<typeof useConnectorCatalog> => {
    let current: ReturnType<typeof useConnectorCatalog> | null = null;
    const resolvedProps = {
      enabled: true,
      workspaceScopedSelector: { workspaceId: 'workspace-1' },
      ...props,
    };

    const Harness = () => {
      current = useConnectorCatalog(resolvedProps);
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error('Failed to initialize useConnectorCatalog');
    }

    return current as ReturnType<typeof useConnectorCatalog>;
  };

  it('passes the workspace-scoped request key into useRestRequest', () => {
    renderHarness();

    expect(mockUseRestRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        initialData: [],
        requestKey: 'workspace-1',
        onError: expect.any(Function),
      }),
    );
  });

  it('derives configured secret count from connectors returned by the request hook', () => {
    const hookValue = renderHarness();

    expect(hookValue.connectors).toHaveLength(2);
    expect(hookValue.configuredSecretCount).toBe(1);
    expect(hookValue.loading).toBe(false);
  });

  it('disables the request when no workspace-scoped selector is available', () => {
    renderHarness({
      enabled: false,
      workspaceScopedSelector: null,
    });

    expect(mockUseRestRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        requestKey: null,
      }),
    );
  });
});
