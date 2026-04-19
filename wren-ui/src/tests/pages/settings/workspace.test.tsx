import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SettingsWorkspacePage from '../../../pages/settings/workspace';

jest.mock('../../../pages/workspace', () => ({
  __esModule: true,
  default: () => <div>Workspace Canonical Page</div>,
}));

describe('settings/workspace compatibility route', () => {
  it('keeps /settings/workspace pointing to the canonical workspace page', () => {
    const markup = renderToStaticMarkup(<SettingsWorkspacePage />);

    expect(markup).toContain('Workspace Canonical Page');
  });
});
