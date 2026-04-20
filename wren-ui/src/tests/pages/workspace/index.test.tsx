import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import WorkspacePage from '../../../pages/workspace';

jest.mock(
  '@/features/settings/platform-workspaces/ManagePlatformWorkspacesPage',
  () => ({
    __esModule: true,
    default: () => <div>Platform Workspaces Canonical Page</div>,
  }),
);

describe('workspace compatibility route', () => {
  it('keeps /workspace pointing to the canonical platform workspaces page', () => {
    const markup = renderToStaticMarkup(<WorkspacePage />);

    expect(markup).toContain('Platform Workspaces Canonical Page');
  });
});
