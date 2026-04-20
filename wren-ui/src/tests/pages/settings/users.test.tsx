import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SettingsUsersPage from '../../../pages/settings/users';

jest.mock('@/features/settings/platform-users/ManagePlatformUsersPage', () => ({
  __esModule: true,
  default: () => <div>Platform Users Canonical Page</div>,
}));

describe('settings/users compatibility route', () => {
  it('keeps /settings/users pointing to the canonical platform users page', () => {
    const markup = renderToStaticMarkup(<SettingsUsersPage />);

    expect(markup).toContain('Platform Users Canonical Page');
  });
});
