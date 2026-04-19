import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SetupConnectionPage from '../../../pages/setup/connection';
import SetupModelsPage from '../../../pages/setup/models';
import SetupRelationshipsPage from '../../../pages/setup/relationships';

jest.mock('@/features/setup/ManageSetupConnectionPage', () => ({
  __esModule: true,
  default: () => <div>Setup Connection Feature Page</div>,
}));

jest.mock('@/features/setup/ManageSetupModelsPage', () => ({
  __esModule: true,
  default: () => <div>Setup Models Feature Page</div>,
}));

jest.mock('@/features/setup/ManageSetupRelationshipsPage', () => ({
  __esModule: true,
  default: () => <div>Setup Relationships Feature Page</div>,
}));

describe('setup route entries', () => {
  it('reuses the setup connection feature page', () => {
    expect(renderToStaticMarkup(<SetupConnectionPage />)).toContain(
      'Setup Connection Feature Page',
    );
  });

  it('reuses the setup models feature page', () => {
    expect(renderToStaticMarkup(<SetupModelsPage />)).toContain(
      'Setup Models Feature Page',
    );
  });

  it('reuses the setup relationships feature page', () => {
    expect(renderToStaticMarkup(<SetupRelationshipsPage />)).toContain(
      'Setup Relationships Feature Page',
    );
  });
});
