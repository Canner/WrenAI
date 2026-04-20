import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SettingsPermissionsPage from '../../../pages/settings/permissions';

jest.mock(
  '@/features/settings/platform-permissions/ManagePlatformPermissionsPage',
  () => ({
    __esModule: true,
    default: () => <div>Platform Permissions Canonical Page</div>,
  }),
);

describe('settings/permissions compatibility route', () => {
  it('keeps /settings/permissions pointing to the canonical platform permissions page', () => {
    const markup = renderToStaticMarkup(<SettingsPermissionsPage />);

    expect(markup).toContain('Platform Permissions Canonical Page');
  });
});
