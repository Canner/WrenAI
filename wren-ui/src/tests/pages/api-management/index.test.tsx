import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import APIManagementPage from '../../../pages/api-management';

jest.mock('@/features/settings/diagnostics/ManageDiagnosticsPage', () => ({
  __esModule: true,
  default: () => <div>Diagnostics Canonical Page</div>,
}));

describe('api-management compatibility route', () => {
  it('keeps /api-management pointing to the canonical diagnostics page', () => {
    const markup = renderToStaticMarkup(<APIManagementPage />);

    expect(markup).toContain('Diagnostics Canonical Page');
  });
});
