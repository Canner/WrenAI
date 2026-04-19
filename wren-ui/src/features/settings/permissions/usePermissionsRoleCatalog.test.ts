import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import usePermissionsRoleCatalog, {
  buildPermissionsRoleCatalogRequestKey,
  buildPermissionsRoleCatalogUrl,
  EMPTY_ROLE_CATALOG_RESPONSE,
  normalizePermissionsRoleCatalogPayload,
} from './usePermissionsRoleCatalog';

const mockUseRestRequest = jest.fn();

jest.mock('@/hooks/useRestRequest', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseRestRequest(...args),
}));

describe('usePermissionsRoleCatalog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRestRequest.mockReturnValue({
      data: EMPTY_ROLE_CATALOG_RESPONSE,
      loading: false,
      refetch: jest.fn(),
    });
  });

  it('builds a stable request key and canonical roles url', () => {
    expect(buildPermissionsRoleCatalogRequestKey({ enabled: true })).toBe(
      'workspace-roles',
    );
    expect(
      buildPermissionsRoleCatalogRequestKey({ enabled: false }),
    ).toBeNull();
    expect(buildPermissionsRoleCatalogUrl()).toBe('/api/v1/workspace/roles');
  });

  it('normalizes malformed role catalog payloads to empty arrays', () => {
    expect(normalizePermissionsRoleCatalogPayload(null)).toEqual(
      EMPTY_ROLE_CATALOG_RESPONSE,
    );
    expect(
      normalizePermissionsRoleCatalogPayload({
        roles: 'invalid',
        bindings: null,
        permissionCatalog: {},
      }),
    ).toEqual(EMPTY_ROLE_CATALOG_RESPONSE);
  });

  it('passes the derived request key into useRestRequest', () => {
    const Harness = () => {
      usePermissionsRoleCatalog({ enabled: true });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    expect(mockUseRestRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        initialData: EMPTY_ROLE_CATALOG_RESPONSE,
        requestKey: 'workspace-roles',
      }),
    );
  });
});
