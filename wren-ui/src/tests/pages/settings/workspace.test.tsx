import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SettingsWorkspacePage from '../../../pages/settings/workspace';

jest.mock(
  '@/features/settings/platform-workspaces/ManagePlatformWorkspacesPage',
  () => ({
    __esModule: true,
    default: () => <div>Platform Workspaces Canonical Page</div>,
  }),
);

describe('settings/workspace compatibility route', () => {
  it('keeps /settings/workspace pointing to the canonical platform workspaces page', () => {
    const markup = renderToStaticMarkup(<SettingsWorkspacePage />);

    expect(markup).toContain('Platform Workspaces Canonical Page');
  });
});
